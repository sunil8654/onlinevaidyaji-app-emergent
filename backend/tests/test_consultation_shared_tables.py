"""Round-trip checks for the doctor consultation surface against the shared DB.

The bug class these guard against: consultation_rooms / messages / video_sessions
are all INT-`id` + ENUM + TIMESTAMP tables, and none of those base types are in
msdb's _MIRROR_TYPES. Without explicit COLUMN_MAPS callables, split_doc drops
every ENUM and timestamp into the JSON blob, so MySQL stores NULL and the
website sees empty rooms and unreadable messages.
"""
import uuid

import pytest

import msdb
import server


class Fixture:
    """Shared-row fixture. `users.id` is INT AUTO_INCREMENT, so ids come back
    from the insert and every other row is created with those real values."""

    def __init__(self):
        self.room_ids = []
        self.doctor_id = None
        self.doctor_user_id = None
        self.patient_user_id = None

    async def setup(self):
        suffix = uuid.uuid4().hex[:8]
        u1 = await server.db.users.insert_one(
            {
                "name": "Dr Parity Check",
                "email": f"parity_doc_{suffix}@example.test",
                "phone": f"9{suffix}1",
                "role": "doctor",
                "is_doctor": True,
            }
        )
        self.doctor_user_id = u1.inserted_id
        # `doctors.id` is also INT AUTO_INCREMENT, and consultation_rooms.doctor_id
        # references it, so read the real id back rather than reusing user_id.
        d = await server.db.doctors.insert_one(
            {
                "user_id": self.doctor_user_id,
                "name": "Dr Parity Check",
                "specialty": "Ayurveda",
                "qualification": "BAMS",
                "consultation_fee": 500,
            }
        )
        self.doctor_id = d.inserted_id
        u2 = await server.db.users.insert_one(
            {
                "name": "Parity Patient",
                "email": f"parity_pat_{suffix}@example.test",
                "phone": f"8{suffix}1",
                "role": "patient",
            }
        )
        self.patient_user_id = u2.inserted_id
        return self

    def new_room(self):
        room_id = f"consult_{uuid.uuid4().hex[:8]}"
        self.room_ids.append(room_id)
        return room_id

    async def add_room(self, appointment_id, room_id=None):
        room_id = room_id or self.new_room()
        await server.db.consultation_rooms.insert_one(
            {
                "appointment_id": appointment_id,
                "room_id": room_id,
                "doctor_id": self.doctor_id,
                "patient_id": self.patient_user_id,
                "type": "both",
                "status": "active",
                "created_at": server.now_iso(),
            }
        )
        return room_id

    async def teardown(self):
        for room_id in self.room_ids:
            await msdb._query("DELETE FROM messages WHERE room_id = %s", (room_id,))
        await msdb._query(
            "DELETE FROM consultation_rooms WHERE doctor_id = %s", (self.doctor_id,)
        )
        await msdb._query("DELETE FROM doctors WHERE id = %s", (self.doctor_id,))
        await msdb._query(
            "DELETE FROM users WHERE id IN (%s, %s)",
            (self.doctor_user_id, self.patient_user_id),
        )


@pytest.fixture
def ctx():
    return Fixture()


def raw(sql, params=None):
    return msdb._query(sql, params)


@pytest.mark.asyncio
async def test_consultation_room_enum_and_timestamp_hit_real_columns(ctx):
    await ctx.setup()
    try:
        room_id = await ctx.add_room(4242)
        rows = await raw(
            "SELECT id, type, status, created_at FROM consultation_rooms WHERE room_id = %s",
            (room_id,),
        )
        assert len(rows) == 1
        row = rows[0]
        # INT AUTO_INCREMENT: a uuid would have been coerced to 0.
        assert isinstance(row["id"], int) and row["id"] > 0
        # ENUM columns must not be NULL - that is the blob-leak failure.
        assert row["type"] == "both"
        assert row["status"] == "active"
        assert row["created_at"] is not None
    finally:
        await ctx.teardown()


@pytest.mark.asyncio
async def test_consultation_message_enum_bool_and_timestamp_hit_real_columns(ctx):
    await ctx.setup()
    try:
        room_id = await ctx.add_room(4343)
        await server.db.messages.insert_one(
            {
                "room_id": room_id,
                "sender_id": ctx.patient_user_id,
                "sender_role": "patient",
                "message_type": "text",
                "content": "hello doctor",
                "is_read": False,
                "read_at": None,
                "created_at": server.now_iso(),
            }
        )
        rows = await raw(
            "SELECT id, sender_role, message_type, is_read, created_at, content "
            "FROM messages WHERE room_id = %s",
            (room_id,),
        )
        assert len(rows) == 1
        row = rows[0]
        assert isinstance(row["id"], int) and row["id"] > 0
        assert row["sender_role"] == "patient"
        assert row["message_type"] == "text"
        assert int(row["is_read"]) == 0
        assert row["created_at"] is not None
        assert row["content"] == "hello doctor"
    finally:
        await ctx.teardown()


@pytest.mark.asyncio
async def test_messages_do_not_collide_with_community_dm_thread_ids(ctx):
    """Community DMs and consultation chat share the `messages` table.

    Community DMs key on a uuid thread_id; consultation chat keys on the
    `consult_` room_id prefix. Neither may read the other's rows.
    """
    await ctx.setup()
    try:
        thread_id = str(uuid.uuid4())
        ctx.room_ids.append(thread_id)
        await server.db.messages.insert_one(
            {
                "room_id": thread_id,
                "sender_id": ctx.doctor_user_id,
                "sender_role": "doctor",
                "message_type": "text",
                "content": "community dm body",
                "is_read": False,
                "created_at": server.now_iso(),
            }
        )
        room_id = await ctx.add_room(4444)
        await server.db.messages.insert_one(
            {
                "room_id": room_id,
                "sender_id": ctx.doctor_user_id,
                "sender_role": "doctor",
                "message_type": "text",
                "content": "consultation body",
                "is_read": False,
                "created_at": server.now_iso(),
            }
        )

        by_thread = await raw("SELECT content FROM messages WHERE room_id = %s", (thread_id,))
        assert [r["content"] for r in by_thread] == ["community dm body"]

        by_room = await raw("SELECT content FROM messages WHERE room_id = %s", (room_id,))
        assert [r["content"] for r in by_room] == ["consultation body"]
    finally:
        await ctx.teardown()
