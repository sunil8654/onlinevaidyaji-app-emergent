// Socket.IO provider for realtime consultation chat — the same protocol the
// website uses (socket.io 4.x + JWT handshake auth). One connection per signed-in
// user, torn down on logout. Reads the token from the SAME secure store the API
// client uses, so the socket authenticates as the same identity.
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

import { TOKEN_KEY } from "@/src/api";
import { useAuth } from "@/src/auth";
import { storage } from "@/src/utils/storage";

const BASE = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/api$/, "");

type SocketContextValue = {
  socket: Socket | null;
  isConnected: boolean;
};

const SocketContext = createContext<SocketContextValue>({ socket: null, isConnected: false });

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!user?.id) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocket(null);
      setIsConnected(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const token = (await storage.secureGet<string>(TOKEN_KEY, "")) || "";
      if (!token || cancelled) return;
      const s = io(BASE, { auth: { token }, transports: ["websocket", "polling"] });
      s.on("connect", () => setIsConnected(true));
      s.on("disconnect", () => setIsConnected(false));
      socketRef.current = s;
      setSocket(s);
    })();

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocket(null);
      setIsConnected(false);
    };
  }, [user?.id]);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>{children}</SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
