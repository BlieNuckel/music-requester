import { useCallback } from "react";
import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";
import type { PurchaseItem, SpendingSummary } from "@/types";

type PurchaseListData = {
  items: PurchaseItem[];
  summary: SpendingSummary | null;
};

async function fetchPurchaseList({
  signal,
}: FetchContext): Promise<PurchaseListData> {
  const [itemsRes, summaryRes] = await Promise.all([
    fetch("/api/purchases", { signal }),
    fetch("/api/purchases/summary", { signal }),
  ]);

  if (!itemsRes.ok) throw new Error("Failed to load purchases");
  if (!summaryRes.ok) throw new Error("Failed to load spending summary");

  const [items, summary] = await Promise.all([
    itemsRes.json() as Promise<PurchaseItem[]>,
    summaryRes.json() as Promise<SpendingSummary>,
  ]);

  return { items, summary };
}

export default function usePurchaseList() {
  const { data, loading, error, refresh, setData } =
    useAsyncData<PurchaseListData>("purchase-list", fetchPurchaseList);

  const removeItem = useCallback(
    async (albumMbid: string) => {
      try {
        const res = await fetch(
          `/api/purchases/${encodeURIComponent(albumMbid)}`,
          { method: "DELETE" }
        );
        if (res.ok) {
          setData((prev) => ({
            ...prev,
            items: prev.items.filter((item) => item.albumMbid !== albumMbid),
          }));
        }
      } catch {
        // Silently fail — user can retry
      }
    },
    [setData]
  );

  return {
    items: data?.items ?? [],
    summary: data?.summary ?? null,
    loading,
    error,
    removeItem,
    refresh,
  };
}
