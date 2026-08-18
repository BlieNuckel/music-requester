import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { ProfileDebugEntry } from "@/types";

type ProfileDebugResponse = { users: ProfileDebugEntry[] };

async function fetchProfileDebug({
  signal,
}: FetchContext): Promise<ProfileDebugResponse> {
  const res = await fetch("/api/profile/debug", { signal });
  if (!res.ok) throw new Error("Failed to load taste profiles");
  return res.json();
}

/** Admin-only view of every stored taste profile and the signals behind it. */
export default function useProfileDebug() {
  const { data, loading, error, refresh } = useAsyncData<ProfileDebugResponse>(
    "profile-debug",
    fetchProfileDebug
  );

  return { users: data?.users ?? [], loading, error, refresh };
}
