import { useCallback } from "react";
import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";

type ManagedUser = {
  id: number;
  username: string;
  userType: "local" | "plex";
  permissions: number;
  enabled: boolean;
  thumb: string | null;
};

type CreateUserPayload = {
  username: string;
  password: string;
  permissions: number;
};

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function fetchUsers({ signal }: FetchContext): Promise<ManagedUser[]> {
  return fetchJson<ManagedUser[]>("/api/users", { signal });
}

export type { ManagedUser, CreateUserPayload };

export function useUsers() {
  const { data, loading, error, refresh, setData } = useAsyncData<
    ManagedUser[]
  >("users", fetchUsers);

  const createUser = useCallback(
    async (payload: CreateUserPayload) => {
      const user = await fetchJson<ManagedUser>("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setData((prev) => [...prev, user]);
      return user;
    },
    [setData]
  );

  const updatePermissions = useCallback(
    async (userId: number, permissions: number) => {
      const user = await fetchJson<ManagedUser>(
        `/api/users/${userId}/permissions`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permissions }),
        }
      );
      setData((prev) => prev.map((u) => (u.id === userId ? user : u)));
      return user;
    },
    [setData]
  );

  const toggleEnabled = useCallback(
    async (userId: number) => {
      const user = await fetchJson<ManagedUser>(
        `/api/users/${userId}/toggle-enabled`,
        { method: "PATCH" }
      );
      setData((prev) => prev.map((u) => (u.id === userId ? user : u)));
      return user;
    },
    [setData]
  );

  const removeUser = useCallback(
    async (userId: number) => {
      await fetchJson<void>(`/api/users/${userId}`, { method: "DELETE" });
      setData((prev) => prev.filter((u) => u.id !== userId));
    },
    [setData]
  );

  return {
    users: data ?? [],
    loading,
    error,
    createUser,
    updatePermissions,
    toggleEnabled,
    removeUser,
    reload: refresh,
  };
}
