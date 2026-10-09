"""Socket.IO realtime layer for the app backend.

Ports the website's realtime protocol (OnlineVaidhyaJi.com/backend/socket/index.js)
to the FastAPI app so the SAME client events work in the mobile app. It
authenticates with the app's JWT (handshake `auth.token`), and persists through
the shared MySQL-backed `db` layer, so chat written here is byte-compatible with
what the website reads and writes.

Mounted by `attach(app)` at `/socket.io` so the existing `server:app` entrypoint
(uvicorn) keeps working unchanged.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import jwt
import socketio
from socketio.exceptions import ConnectionRefusedError

logger = logging.getLogger("realtime")


BRIDGE_CHANNEL = os.environ.get("SOCKET_BRIDGE_CHANNEL", "consult:bridge")


class _RedisBridge:
    """Language-agnostic Redis pub/sub relay between the app (Python) and the
    website (Node) Socket.IO servers.

    The two servers are separate processes with independent in-memory rooms, so
    ``io.to(room).emit(...)`` never crosses. We deliberately do NOT use
    ``socketio.AsyncRedisManager``: its single ``socketio`` / pickle channel is
    not wire-compatible with ``@socket.io/redis-adapter``'s ``socket.io#<ns>#`` /
    msgpack protocol. Instead each side publishes the local broadcast it just
    made on one shared JSON channel and replays foreign broadcasts against its
    own rooms, which works across languages/versions.
    """

    def __init__(self, url: str, channel: str = BRIDGE_CHANNEL):
        self.url = url
        self.channel = channel
        self.origin = f"app-{os.getpid()}-{uuid.uuid4().hex[:8]}"
        self._client = None
        self._pubsub = None
        self._task = None

    async def start(self, sio: "socketio.AsyncServer") -> None:
        import redis.asyncio as aioredis

        self._client = aioredis.from_url(
            self.url, socket_connect_timeout=5, health_check_interval=30
        )
        self._pubsub = self._client.pubsub()
        await self._pubsub.subscribe(self.channel)
        self._task = asyncio.create_task(self._listen(sio))
        logger.info("Socket.IO bridge listening on Redis channel %r", self.channel)

    async def _listen(self, sio: "socketio.AsyncServer") -> None:
        try:
            async for message in self._pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    payload = json.loads(message["data"])
                except (TypeError, ValueError):
                    continue
                if not isinstance(payload, dict):
                    continue
                if payload.get("origin") == self.origin:
                    continue
                event = payload.get("event")
                if not event:
                    continue
                try:
                    # Deliver locally only; bypasses the bridge-emitting override.
                    await socketio.AsyncServer.emit(
                        sio, event, payload.get("data"), room=payload.get("room")
                    )
                except Exception:
                    logger.exception("bridge delivery failed for %s", event)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("bridge listener crashed")

    async def publish(self, room, event, data) -> None:
        if self._client is None:
            return
        try:
            await self._client.publish(
                self.channel,
                json.dumps(
                    {"origin": self.origin, "room": room, "event": event, "data": data},
                    default=str,
                ),
            )
        except Exception:
            logger.exception("bridge publish failed for %s", event)

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        if self._pubsub is not None:
            await self._pubsub.close()
        if self._client is not None:
            await self._client.aclose()


class _BridgeServer(socketio.AsyncServer):
    """AsyncServer that mirrors every local broadcast onto the Redis bridge."""

    bridge: Optional["_RedisBridge"] = None

    async def emit(
        self,
        event,
        data=None,
        to=None,
        room=None,
        skip_sid=None,
        namespace=None,
        callback=None,
        ignore_queue=False,
    ):
        await super().emit(
            event,
            data,
            to=to,
            room=room,
            skip_sid=skip_sid,
            namespace=namespace,
            callback=callback,
            ignore_queue=ignore_queue,
        )
        # `to=` targets a single local sid and cannot be replayed elsewhere.
        if self.bridge is not None and to is None:
            await self.bridge.publish(room, event, data)


def _make_server() -> _BridgeServer:
    sio = _BridgeServer(
        async_mode="asgi",
        cors_allowed_origins="*",
        logger=False,
        engineio_logger=False,
    )
    redis_url = os.environ.get("REDIS_URL")
    if redis_url:
        sio.bridge = _RedisBridge(redis_url)
    return sio


sio = _make_server()


def attach(app) -> "socketio.AsyncServer":
    """Mount the Socket.IO ASGI app under `/socket.io`.

    The inner app is created with ``socketio_path=""`` so the path check matches
    the already-stripped ``/`` that Starlette's Mount hands it.
    """
    inner = socketio.ASGIApp(sio, socketio_path="")
    app.mount("/socket.io", inner)

    if sio.bridge is not None:

        @app.on_event("startup")
        async def _start_bridge():
            try:
                await sio.bridge.start(sio)
            except Exception:
                logger.exception(
                    "Redis bridge failed to start - cross-server fan-out disabled"
                )

        @app.on_event("shutdown")
        async def _stop_bridge():
            try:
                await sio.bridge.stop()
            except Exception:
                logger.exception("Redis bridge shutdown failed")

    return sio


def _server():
    # Imported lazily: server.py imports this module at the very end of its body,
    # so by the time any event fires the module is fully initialised. Importing at
    # module scope would deadlock the circular import.
    import server

    return server


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _resolve_user(token: Optional[str]) -> Optional[dict]:
    srv = _server()
    if not token:
        return None
    try:
        payload = jwt.decode(token, srv.JWT_SECRET, algorithms=[srv.JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    user = await srv.db.users.find_one({"id": payload.get("sub")}, {"_id": 0, "password": 0})
    if not user:
        return None
    try:
        user["id"] = int(user["id"])
    except (TypeError, ValueError):
        pass
    return user


async def _doctor_row_id(user_id) -> Optional[int]:
    srv = _server()
    d = await srv.db.doctors.find_one({"user_id": user_id}, {"_id": 0, "id": 1})
    if not d:
        return None
    try:
        return int(d["id"])
    except (TypeError, ValueError):
        return d.get("id")


async def _set_doctor_status(doctor_id, status: str, touch_last_seen: bool = False) -> None:
    srv = _server()
    now = _now_iso()
    patch = {"status": status, "updated_at": now}
    if touch_last_seen:
        patch["last_seen"] = now
    try:
        existing = await srv.db.doctor_status.find_one(
            {"doctor_id": doctor_id}, {"_id": 0, "doctor_id": 1}
        )
        if existing:
            await srv.db.doctor_status.update_one({"doctor_id": doctor_id}, {"$set": patch})
        else:
            await srv.db.doctor_status.insert_one(
                {"doctor_id": doctor_id, "status": status, "last_seen": now, "updated_at": now}
            )
    except Exception:
        logger.exception("doctor_status update failed for %s", doctor_id)


async def _room_context(room_id: str) -> Optional[dict]:
    """Return the consultation room plus the doctor's user_id, or None."""
    srv = _server()
    room = await srv.db.consultation_rooms.find_one({"room_id": room_id}, {"_id": 0})
    if not room:
        return None
    doctor_user_id = None
    if room.get("doctor_id") is not None:
        doc = await srv.db.doctors.find_one(
            {"id": room.get("doctor_id")}, {"_id": 0, "user_id": 1}
        )
        doctor_user_id = (doc or {}).get("user_id")
        try:
            doctor_user_id = int(doctor_user_id)
        except (TypeError, ValueError):
            pass
    ctx = dict(room)
    ctx["doctor_user_id"] = doctor_user_id
    return ctx


def _is_participant(ctx: dict, session: dict) -> bool:
    uid = session.get("user_id")
    if ctx.get("patient_id") == uid:
        return True
    did = session.get("doctor_id")
    return bool(did is not None and ctx.get("doctor_id") == did)


# ----------------- Connection lifecycle -----------------
@sio.event
async def connect(sid, environ, auth):
    auth = auth or {}
    user = await _resolve_user(auth.get("token"))
    if not user:
        raise ConnectionRefusedError("Invalid token")

    user_id = user["id"]
    role = user.get("role")
    session = {"user_id": user_id, "role": role, "name": user.get("name")}
    await sio.save_session(sid, session)
    await sio.enter_room(sid, f"user:{user_id}")

    if role == "doctor":
        doctor_id = await _doctor_row_id(user_id)
        if doctor_id is not None:
            session["doctor_id"] = doctor_id
            await sio.save_session(sid, session)
            await sio.enter_room(sid, f"doctor:{doctor_id}")
            await _set_doctor_status(doctor_id, "online")
            await sio.emit("doctor:status", {"doctorId": doctor_id, "status": "online"})

    logger.info("[Socket] %s %s connected", role, user_id)


@sio.event
async def disconnect(sid):
    try:
        session = await sio.get_session(sid)
    except KeyError:
        return
    if session.get("role") == "doctor" and session.get("doctor_id") is not None:
        doctor_id = session["doctor_id"]
        await _set_doctor_status(doctor_id, "offline", touch_last_seen=True)
        await sio.emit("doctor:status", {"doctorId": doctor_id, "status": "offline"})
    logger.info("[Socket] %s %s disconnected", session.get("role"), session.get("user_id"))


@sio.on("doctor:status:change")
async def doctor_status_change(sid, data):
    session = await sio.get_session(sid)
    if session.get("role") != "doctor":
        return
    doctor_id = session.get("doctor_id")
    status = (data or {}).get("status")
    if doctor_id is None or status not in ("online", "offline", "busy"):
        return
    await _set_doctor_status(doctor_id, status, touch_last_seen=status == "offline")
    await sio.emit("doctor:status", {"doctorId": doctor_id, "status": status})


# ----------------- Chat -----------------
@sio.on("chat:join")
async def chat_join(sid, data):
    room_id = (data or {}).get("roomId")
    if not room_id:
        return
    session = await sio.get_session(sid)
    ctx = await _room_context(room_id)
    if not ctx or not _is_participant(ctx, session):
        return
    await sio.enter_room(sid, f"chat:{room_id}")


@sio.on("chat:typing")
async def chat_typing(sid, data):
    data = data or {}
    room_id = data.get("roomId")
    if not room_id:
        return
    session = await sio.get_session(sid)
    await sio.emit(
        "chat:typing",
        {
            "roomId": room_id,
            "userId": session.get("user_id"),
            "role": session.get("role"),
            "isTyping": bool(data.get("isTyping")),
        },
        room=f"chat:{room_id}",
        skip_sid=sid,
    )


@sio.on("chat:message")
async def chat_message(sid, data):
    data = data or {}
    room_id = data.get("roomId")
    content = (data.get("content") or "").strip()
    if not room_id or not content:
        return {"error": "Missing fields"}

    session = await sio.get_session(sid)
    user_id = session.get("user_id")
    ctx = await _room_context(room_id)
    if not ctx or ctx.get("status") != "active" or not _is_participant(ctx, session):
        return {"error": "Room not found, inactive, or not authorized"}

    is_doctor = ctx.get("doctor_id") == session.get("doctor_id") and session.get("role") == "doctor"
    sender_role = "doctor" if is_doctor else "patient"

    message_type = data.get("messageType") or "text"
    doc = {
        "room_id": room_id,
        "sender_id": user_id,
        "sender_role": sender_role,
        "message_type": message_type,
        "content": content,
        "file_url": data.get("fileUrl"),
        "file_name": data.get("fileName"),
        "file_size": data.get("fileSize"),
        "is_read": False,
        "read_at": None,
        "created_at": _now_iso(),
    }

    srv = _server()
    try:
        res = await srv.db.messages.insert_one(doc)
        message = dict(doc)
        message["id"] = res.inserted_id
        await sio.emit("chat:message", message, room=f"chat:{room_id}")
    except Exception:
        logger.exception("chat:message insert failed")
        return {"error": "Server error"}

    # Notify the recipient (in-app + push inbox). Best-effort, never blocks the send.
    recipient_id = ctx.get("patient_id") if is_doctor else ctx.get("doctor_user_id")
    if recipient_id is not None:
        sender_name = "Doctor" if is_doctor else "Patient"
        title = f"New message from {sender_name}"
        snippet = content[:100]
        try:
            nres = await srv.db.notifications.insert_one({
                "user_id": recipient_id,
                "title": title,
                "message": snippet,
                "type": "new_message",
                "related_id": room_id,
                "related_type": "chat",
                "is_read": False,
                "created_at": _now_iso(),
            })
            await sio.emit(
                "notification",
                {
                    "id": nres.inserted_id,
                    "userId": recipient_id,
                    "type": "new_message",
                    "title": title,
                    "message": snippet,
                    "relatedId": room_id,
                    "relatedType": "chat",
                },
                room=f"user:{recipient_id}",
            )
        except Exception:
            logger.exception("chat notification failed")

    return {"success": True, "message": message}


@sio.on("chat:markRead")
async def chat_mark_read(sid, data):
    room_id = (data or {}).get("roomId")
    if not room_id:
        return
    session = await sio.get_session(sid)
    user_id = session.get("user_id")
    srv = _server()
    try:
        await srv.db.messages.update_many(
            {"room_id": room_id, "sender_id": {"$ne": user_id}, "is_read": False},
            {"$set": {"is_read": True, "read_at": _now_iso()}},
        )
        await sio.emit(
            "chat:read",
            {"roomId": room_id, "userId": user_id},
            room=f"chat:{room_id}",
        )
    except Exception:
        logger.exception("chat:markRead failed")


# ----------------- Video signalling -----------------
@sio.on("video:join")
async def video_join(sid, data):
    room_id = (data or {}).get("roomId")
    if not room_id:
        return
    session = await sio.get_session(sid)
    await sio.enter_room(sid, f"video:{room_id}")
    await sio.emit(
        "video:user-joined",
        {"userId": session.get("user_id"), "role": session.get("role")},
        room=f"video:{room_id}",
        skip_sid=sid,
    )

    ctx = await _room_context(room_id)
    if ctx:
        is_doctor = session.get("role") == "doctor" and ctx.get("doctor_id") == session.get("doctor_id")
        recipient_id = ctx.get("patient_id") if is_doctor else ctx.get("doctor_user_id")
        if recipient_id is not None:
            try:
                await sio.emit(
                    "notification",
                    {
                        "userId": recipient_id,
                        "type": "video_call_incoming",
                        "title": "Incoming video call",
                        "message": "Someone is calling you for a video consultation.",
                        "relatedId": room_id,
                        "relatedType": "video_call",
                    },
                    room=f"user:{recipient_id}",
                )
            except Exception:
                logger.exception("video:join notification failed")


@sio.on("video:signal")
async def video_signal(sid, data):
    data = data or {}
    room_id = data.get("roomId")
    if not room_id:
        return
    session = await sio.get_session(sid)
    await sio.emit(
        "video:signal",
        {"userId": session.get("user_id"), "signal": data.get("signal")},
        room=f"video:{room_id}",
        skip_sid=sid,
    )


@sio.on("video:state-change")
async def video_state_change(sid, data):
    data = data or {}
    room_id = data.get("roomId")
    if not room_id:
        return
    session = await sio.get_session(sid)
    await sio.emit(
        "video:state-change",
        {"userId": session.get("user_id"), "state": data.get("state")},
        room=f"video:{room_id}",
        skip_sid=sid,
    )


@sio.on("video:leave")
async def video_leave(sid, data):
    room_id = (data or {}).get("roomId")
    if not room_id:
        return
    session = await sio.get_session(sid)
    await sio.emit(
        "video:user-left",
        {"userId": session.get("user_id"), "role": session.get("role")},
        room=f"video:{room_id}",
        skip_sid=sid,
    )
    await sio.leave_room(sid, f"video:{room_id}")
