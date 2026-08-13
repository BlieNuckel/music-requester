import { useCallback } from "react";
import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { WantedItem } from "@/types";

async function fetchWantedItems({
  signal,
}: FetchContext): Promise<WantedItem[]> {
  const res = await fetch("/api/wanted", { signal });
  if (!res.ok) throw new Error("Failed to load wanted list");
  return res.json();
}

export default function useWantedList() {
  const { data, loading, error, refresh, setData } = useAsyncData<WantedItem[]>(
    "wanted-list",
    fetchWantedItems
  );

  const removeItem = useCallback(
    async (albumMbid: string) => {
      try {
        const res = await fetch(
          `/api/wanted/${encodeURIComponent(albumMbid)}`,
          { method: "DELETE" }
        );
        if (res.ok) {
          setData((prev) =>
            prev.filter((item) => item.albumMbid !== albumMbid)
          );
        }
      } catch {
        // Silently fail — user can retry
      }
    },
    [setData]
  );

  return { items: data ?? [], loading, error, removeItem, refresh };
}
