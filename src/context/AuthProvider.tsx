import { useState, useEffect, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import {
  AuthContext,
  type AuthUser,
  type AuthStatus,
  type AuthContextValue,
} from "./authContextDef";
import { login as plexOAuthLogin } from "@/utils/plexOAuth";

interface AuthProviderProps {
  children: ReactNode;
}

async function fetchSetupStatus(): Promise<boolean> {
  const res = await fetch("/api/auth/setup-status");
  if (!res.ok) return false;
  const data = await res.json();
  return data.needsSetup;
}

async function fetchCurrentUser(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me");
  if (!res.ok) return null;
  const data = await res.json();
  return data.user;
}

async function postLogin(
  username: string,
  password: string
): Promise<AuthUser> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Login failed");
  return data.user;
}

async function postPlexLogin(authToken: string): Promise<AuthUser> {
  const res = await fetch("/api/auth/plex-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Plex login failed");
  return data.user;
}

async function postPlexSetup(authToken: string): Promise<AuthUser> {
  const res = await fetch("/api/auth/plex-setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Plex setup failed");
  return data.user;
}

async function postSetup(
  username: string,
  password: string
): Promise<AuthUser> {
  const res = await fetch("/api/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Setup failed");
  return data.user;
}

async function postLinkPlex(authToken: string): Promise<AuthUser> {
  const res = await fetch("/api/auth/link-plex", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to link Plex account");
  return data.user;
}

async function postLogout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

async function patchPreferences(prefs: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/auth/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(prefs),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to update preferences");
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const setupNeeded = await fetchSetupStatus();
        if (setupNeeded) {
          setStatus("needs-setup");
          return;
        }

        const currentUser = await fetchCurrentUser();
        if (currentUser) {
          setUser(currentUser);
          setStatus("authenticated");
        } else {
          setStatus("unauthenticated");
        }
      } catch {
        setStatus("unauthenticated");
      }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const loggedInUser = await postLogin(username, password);
    setUser(loggedInUser);
    setStatus("authenticated");
  }, []);

  const plexLogin = useCallback(async () => {
    const authToken = await plexOAuthLogin();
    if (!authToken) throw new Error("Plex sign-in was cancelled");
    const loggedInUser = await postPlexLogin(authToken);
    setUser(loggedInUser);
    setStatus("authenticated");
  }, []);

  const linkPlex = useCallback(async () => {
    const authToken = await plexOAuthLogin();
    if (!authToken) throw new Error("Plex sign-in was cancelled");
    const updatedUser = await postLinkPlex(authToken);
    setUser(updatedUser);
  }, []);

  const logout = useCallback(async () => {
    await postLogout();
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const setup = useCallback(async (username: string, password: string) => {
    const newUser = await postSetup(username, password);
    setUser(newUser);
    setStatus("authenticated");
  }, []);

  const plexSetup = useCallback(async () => {
    const authToken = await plexOAuthLogin();
    if (!authToken) throw new Error("Plex sign-in was cancelled");
    const newUser = await postPlexSetup(authToken);
    setUser(newUser);
    setStatus("authenticated");
  }, []);

  const updatePreferences = useCallback(
    async (prefs: { theme?: AuthUser["theme"] }) => {
      await patchPreferences(prefs);
      setUser((prev) => (prev ? { ...prev, ...prefs } : prev));
    },
    []
  );

  const refreshUser = useCallback(async () => {
    const currentUser = await fetchCurrentUser();
    if (currentUser) {
      setUser(currentUser);
    }
  }, []);

  const value: AuthContextValue = useMemo(
    () => ({
      status,
      user,
      login,
      plexLogin,
      linkPlex,
      logout,
      setup,
      plexSetup,
      updatePreferences,
      refreshUser,
    }),
    [
      status,
      user,
      login,
      plexLogin,
      linkPlex,
      logout,
      setup,
      plexSetup,
      updatePreferences,
      refreshUser,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
