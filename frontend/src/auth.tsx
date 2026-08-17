import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { storage } from "@/src/utils/storage";
import { api, TOKEN_KEY } from "@/src/api";
import { registerForPush } from "@/src/push";

export type Role = "patient" | "doctor" | "admin";
export type AuthUser = {
  id: string;
  name: string;
  email?: string | null;
  role: Role;
  phone?: string | null;
  is_admin?: boolean;
  verified?: boolean;
  preferred_language?: "en" | "hi";
  free_consult_available?: boolean;
  free_consult_used?: boolean;
  call_preference?: "video" | "phone" | null;
  auth_provider?: "email" | "google" | "phone";
  profile_photo?: string | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ user: AuthUser; must_change_password: boolean }>;
  register: (data: { name: string; email: string; password: string; role: Role; phone?: string; registration_number?: string }) => Promise<void>;
  applySession: (token: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    const token = await storage.secureGet<string>(TOKEN_KEY, "");
    if (token) {
      try {
        const u = await api.me();
        setUser(u as AuthUser);
      } catch {
        await storage.secureRemove(TOKEN_KEY);
        setUser(null);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login({ email, password });
    await storage.secureSet(TOKEN_KEY, res.token);
    setUser(res.user);
    registerForPush(res.user.id).catch(() => {});
    return { user: res.user as AuthUser, must_change_password: !!res.must_change_password };
  }, []);

  const register = useCallback(
    async (data: { name: string; email: string; password: string; role: Role; phone?: string; registration_number?: string }) => {
      const res = await api.register(data);
      await storage.secureSet(TOKEN_KEY, res.token);
      setUser(res.user);
      registerForPush(res.user.id).catch(() => {});
      return res.user as AuthUser;
    },
    []
  );

  const logout = useCallback(async () => {
    await storage.secureRemove(TOKEN_KEY);
    setUser(null);
  }, []);

  const applySession = useCallback(async (token: string, u: AuthUser) => {
    await storage.secureSet(TOKEN_KEY, token);
    setUser(u);
    registerForPush(u.id).catch(() => {});
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, applySession, logout, refresh: bootstrap }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
