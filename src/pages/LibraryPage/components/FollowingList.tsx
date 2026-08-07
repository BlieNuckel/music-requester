import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import useFollowedArtists from "@/hooks/useFollowedArtists";
import FollowArtistButton from "@/components/FollowArtistButton";
import Skeleton from "@/components/Skeleton";
import { SearchIcon } from "@/components/icons";
import type { FollowedReleaseItem } from "@/types";

function buildSearchHref(release: FollowedReleaseItem): string {
  const query = `${release.artistName} ${release.albumTitle}`.trim();
  const params = new URLSearchParams({ q: query });
  return `/search?${params.toString()}`;
}

function formatChecked(iso: string | null): string {
  if (!iso) return "Never checked";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Never checked";
  return `Last checked ${parsed.toLocaleDateString()}`;
}

function ReleaseFeed() {
  const [items, setItems] = useState<FollowedReleaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/followed/releases?limit=30")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load recent releases");
        return res.json();
      })
      .then((data: FollowedReleaseItem[]) => {
        if (active) {
          setItems(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-rose-500 text-sm">{error}</p>;
  }

  if (items.length === 0) {
    return (
      <p className="text-gray-400 dark:text-gray-500 text-sm">
        No releases yet. New releases will appear here as your followed artists
        publish them.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((release) => (
        <li
          key={release.id}
          className="flex items-center gap-3 rounded-xl border-2 border-black bg-white dark:bg-gray-800 shadow-cartoon-sm px-3 py-2"
        >
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
              {release.albumTitle}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {release.artistName}
              {release.releaseDate ? ` · ${release.releaseDate}` : ""}
            </p>
          </div>
          <Link
            to={buildSearchHref(release)}
            aria-label={`Search for ${release.albumTitle}`}
            title={`Search for ${release.albumTitle}`}
            className="inline-flex items-center justify-center w-8 h-8 rounded-full border-2 border-black bg-yellow-400 text-black shadow-cartoon-sm"
          >
            <SearchIcon className="w-4 h-4" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DevPollButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleClick = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/followed/poll-now", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMsg("Poll triggered — reload to see updates");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="px-3 py-1 text-xs font-bold rounded-lg border-2 border-black bg-amber-300 text-black shadow-cartoon-sm disabled:opacity-50"
      >
        {busy ? "Polling…" : "Dev: run poller now"}
      </button>
      {msg && (
        <span className="text-xs text-gray-500 dark:text-gray-400">{msg}</span>
      )}
    </div>
  );
}

export default function FollowingList() {
  const { items, loading, error } = useFollowedArtists();

  return (
    <div className="space-y-8">
      {import.meta.env.DEV && <DevPollButton />}
      <section>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">
          Followed artists
        </h3>
        {loading && (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        )}
        {error && <p className="text-rose-500 text-sm">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="text-gray-400 dark:text-gray-500 text-sm">
            You aren&apos;t following any artists yet. Tap the bell on any
            artist tile to start.
          </p>
        )}
        {!loading && !error && items.length > 0 && (
          <ul className="space-y-2">
            {items.map((follow) => (
              <li
                key={follow.id}
                className="flex items-center gap-3 rounded-xl border-2 border-black bg-white dark:bg-gray-800 shadow-cartoon-sm px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                    {follow.artistName}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {formatChecked(follow.lastCheckedAt)}
                  </p>
                </div>
                <FollowArtistButton
                  artistMbid={follow.artistMbid}
                  artistName={follow.artistName}
                  size="sm"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-3">
          Recent releases
        </h3>
        <ReleaseFeed />
      </section>
    </div>
  );
}
