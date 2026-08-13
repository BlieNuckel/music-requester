import { useCallback } from "react";
import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import { RequestItem } from "@/types";

type UseRequestsOptions = {
  userId?: number;
  status?: string[];
};

type UseRequestsReturn = {
  requests: RequestItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  approveRequest: (id: number) => Promise<void>;
  declineRequest: (id: number) => Promise<void>;
};

function buildUrl(options: UseRequestsOptions): string {
  const params = new URLSearchParams();
  if (options.userId !== undefined) {
    params.set("userId", String(options.userId));
  }
  if (options.status) {
    for (const s of options.status) {
      params.append("status", s);
    }
  }
  const qs = params.toString();
  return qs ? `/api/requests?${qs}` : "/api/requests";
}

async function fetchRequestList({
  key,
  signal,
}: FetchContext): Promise<RequestItem[]> {
  const res = await fetch(key, { signal });
  if (!res.ok) throw new Error("Failed to fetch requests");
  return res.json();
}

export function useRequests({
  userId,
  status,
}: UseRequestsOptions = {}): UseRequestsReturn {
  const { data, loading, error, refresh, setData } = useAsyncData<
    RequestItem[]
  >(buildUrl({ userId, status }), fetchRequestList);

  const approveRequest = useCallback(
    async (id: number) => {
      const res = await fetch(`/api/requests/${id}/approve`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to approve request");
      setData((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "approved" } : r))
      );
    },
    [setData]
  );

  const declineRequest = useCallback(
    async (id: number) => {
      const res = await fetch(`/api/requests/${id}/decline`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to decline request");
      setData((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "declined" } : r))
      );
    },
    [setData]
  );

  return {
    requests: data ?? [],
    loading: loading && data === null,
    error,
    refresh,
    approveRequest,
    declineRequest,
  };
}
