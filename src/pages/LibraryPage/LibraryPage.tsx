import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/context/useAuth";
import { hasPermission } from "@shared/permissions";
import { Permission } from "@shared/permissions";
import { useRequests } from "@/hooks/useRequests";
import useWantedList from "@/hooks/useWantedList";
import usePurchaseList from "@/hooks/usePurchaseList";
import useIsMobile from "@/hooks/useIsMobile";
import { useSettings } from "@/context/useSettings";
import { DEFAULT_SPENDING } from "@/context/spendingDefaults";
import SettingsTabs, { type SettingsRoute } from "@/components/SettingsTabs";
import NotificationBadge from "@/components/NotificationBadge";
import useUnseenReleaseCount from "@/hooks/useUnseenReleaseCount";
import RequestFilter from "./components/RequestFilter";
import RequestList from "./components/RequestList";
import WantedList from "./components/WantedList";
import PurchaseList from "./components/PurchaseList";
import SpendingSummary from "./components/SpendingSummary";
import FollowingList from "./components/FollowingList";
import LiveList from "./components/LiveList";
import Skeleton from "@/components/Skeleton";
import RefreshButton from "@/components/RefreshButton";

type LibraryTab = "purchases" | "wanted" | "following" | "live" | "requests";

function buildLibraryTabs(unseenCount: number): SettingsRoute[] {
  return [
    {
      text: "Purchases",
      route: "/library/purchases",
      regex: /^\/library\/purchases/,
    },
    {
      text: "Wanted",
      route: "/library/wanted",
      regex: /^\/library\/wanted/,
    },
    {
      text: "Following",
      content: (
        <span className="flex items-center gap-2">
          Following
          <NotificationBadge count={unseenCount} />
        </span>
      ),
      route: "/library/following",
      regex: /^\/library\/following/,
    },
    {
      text: "Live",
      route: "/library/live",
      regex: /^\/library\/live/,
    },
    {
      text: "Requests",
      route: "/library/requests",
      regex: /^\/library\/requests/,
    },
  ];
}

export default function LibraryPage() {
  const { user } = useAuth();
  const location = useLocation();
  const isMobile = useIsMobile();
  const { settings } = useSettings();
  const spending = settings.spending ?? DEFAULT_SPENDING;
  const { count: unseenCount, markViewed } = useUnseenReleaseCount();
  const [filters, setFilters] = useState<Record<string, string[]>>({
    requester: [],
    status: [],
  });

  const isRequestsTab = /^\/library\/requests/.test(location.pathname);
  const isPurchasesTab = /^\/library\/purchases/.test(location.pathname);
  const isWantedTab = /^\/library\/wanted/.test(location.pathname);
  const isFollowingTab = /^\/library\/following/.test(location.pathname);
  const isLiveTab = /^\/library\/live/.test(location.pathname);
  const isSubTab =
    isRequestsTab ||
    isWantedTab ||
    isPurchasesTab ||
    isFollowingTab ||
    isLiveTab;

  useEffect(() => {
    if (isFollowingTab && unseenCount > 0) {
      void markViewed();
    }
  }, [isFollowingTab, unseenCount, markViewed]);

  const libraryTabs = useMemo(
    () => buildLibraryTabs(unseenCount),
    [unseenCount]
  );

  const canViewAll =
    user !== null &&
    hasPermission(user.permissions, [
      Permission.REQUEST_VIEW,
      Permission.MANAGE_REQUESTS,
    ]);
  const canManageRequests =
    user !== null &&
    hasPermission(user.permissions, Permission.MANAGE_REQUESTS);
  const isAdmin =
    user !== null && hasPermission(user.permissions, Permission.ADMIN);

  const showMine = filters.requester.includes("mine") || !canViewAll;
  const effectiveShowAll = canViewAll && !filters.requester.includes("mine");
  const requestsOptions = useMemo(
    () => ({
      ...(showMine ? { userId: user?.id } : {}),
      ...(filters.status.length > 0 ? { status: filters.status } : {}),
    }),
    [showMine, user?.id, filters.status]
  );
  const { requests, loading, error, approveRequest, declineRequest, refresh } =
    useRequests(requestsOptions);
  const {
    items: wantedItems,
    loading: wantedLoading,
    error: wantedError,
    removeItem: removeWantedItem,
    refresh: refreshWanted,
  } = useWantedList();
  const {
    items: purchaseItems,
    summary: purchaseSummary,
    loading: purchasesLoading,
    error: purchasesError,
    removeItem: removePurchaseItem,
    refresh: refreshPurchases,
  } = usePurchaseList();

  const activeTab: LibraryTab | null = isPurchasesTab
    ? "purchases"
    : isWantedTab
      ? "wanted"
      : isFollowingTab
        ? "following"
        : isRequestsTab
          ? "requests"
          : null;
  const prevTabRef = useRef<LibraryTab | null>(null);

  useEffect(() => {
    if (activeTab === null || prevTabRef.current === activeTab) return;
    const isFirstTab = prevTabRef.current === null;
    prevTabRef.current = activeTab;
    if (isFirstTab) return;
    if (activeTab === "requests") void refresh();
    else if (activeTab === "wanted") void refreshWanted();
    else if (activeTab === "purchases") void refreshPurchases();
  }, [activeTab, refresh, refreshWanted, refreshPurchases]);

  const handleFilterChange = useCallback((key: string, values: string[]) => {
    setFilters((prev) => ({ ...prev, [key]: values }));
  }, []);

  const handleSearch = useCallback(async (albumId: number) => {
    try {
      await fetch("/api/lidarr/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ albumIds: [albumId] }),
      });
    } catch {
      // Silently fail — user can retry
    }
  }, []);

  const handleUnmonitor = useCallback(
    async (albumMbid: string) => {
      try {
        const res = await fetch("/api/lidarr/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ albumMbid }),
        });
        if (res.ok) refresh();
      } catch {
        // Silently fail — user can retry
      }
    },
    [refresh]
  );

  const tabContent = (
    <>
      {isPurchasesTab && (
        <PurchaseList
          items={purchaseItems}
          loading={purchasesLoading}
          error={purchasesError}
          onRemove={removePurchaseItem}
        />
      )}

      {isWantedTab && (
        <WantedList
          items={wantedItems}
          loading={wantedLoading}
          error={wantedError}
          onRemove={removeWantedItem}
        />
      )}

      {isFollowingTab && <FollowingList />}

      {isLiveTab && <LiveList />}

      {isRequestsTab && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <RequestFilter values={filters} onChange={handleFilterChange} />
            <RefreshButton onRefresh={refresh} ariaLabel="Refresh requests" />
          </div>

          <RequestList
            requests={requests}
            loading={loading}
            error={error}
            emptyMessage={
              showMine ? "You haven't made any requests yet" : "No requests yet"
            }
            showUser={effectiveShowAll}
            showActions={canManageRequests && effectiveShowAll}
            showAdminDetails={isAdmin}
            onApprove={approveRequest}
            onDecline={declineRequest}
            onSearch={handleSearch}
            onUnmonitor={handleUnmonitor}
          />
        </div>
      )}
    </>
  );

  if (isMobile && isSubTab) {
    return (
      <div className="space-y-6">
        <SettingsTabs
          settingsRoutes={libraryTabs}
          parentRoute="/library"
          mobileBackLabel="Library"
        >
          {tabContent}
        </SettingsTabs>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Outlet />
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        Library
      </h1>

      {purchasesLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : (
        purchaseSummary && (
          <SpendingSummary
            summary={purchaseSummary}
            currency={spending.currency}
            monthlyLimit={spending.monthlyLimit}
          />
        )
      )}

      <SettingsTabs
        settingsRoutes={libraryTabs}
        parentRoute="/library"
        mobileBackLabel="Library"
      >
        {tabContent}
      </SettingsTabs>
    </div>
  );
}
