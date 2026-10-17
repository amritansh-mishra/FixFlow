// Login state shared by the whole app.
//
// The session token is kept in localStorage so a page reload stays logged in.
// (Simple and fine for a demo; an httpOnly cookie would protect it from
// injected scripts and is the planned upgrade.)

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler, type User } from "./api";

const STORAGE_KEY = "fixflow.session";

interface Session {
  token: string;
  user: User;
}

interface AuthValue {
  user: User | null;
  token: string | null;
  login: (organization: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession);

  const save = useCallback((next: Session | null) => {
    setSession(next);
    try {
      if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable (private mode): stay logged in for this tab only.
    }
  }, []);

  // An expired or revoked session logs the user out everywhere in the app.
  useEffect(() => setUnauthorizedHandler(() => save(null)), [save]);

  // On load, check the stored session is still valid and refresh the user.
  useEffect(() => {
    const stored = loadSession();
    if (!stored) return;
    api<{ data: User }>("/api/auth/me", { token: stored.token })
      .then(({ data }) => save({ token: stored.token, user: data }))
      .catch(() => {});
  }, [save]);

  const login = useCallback(
    async (organization: string, email: string, password: string) => {
      const { data } = await api<{ data: { token: string; user: User } }>("/api/auth/login", {
        method: "POST",
        body: { organization, email, password },
      });
      save({ token: data.token, user: data.user });
    },
    [save],
  );

  const logout = useCallback(async () => {
    const token = session?.token;
    save(null);
    if (token) await api("/api/auth/logout", { method: "POST", token }).catch(() => {});
  }, [session, save]);

  const value = useMemo(
    () => ({ user: session?.user ?? null, token: session?.token ?? null, login, logout }),
    [session, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export const isManager = (user: User | null) => user?.role === "manager" || user?.role === "admin";
