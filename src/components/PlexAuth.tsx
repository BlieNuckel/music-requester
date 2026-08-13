import { useState, useEffect, useCallback } from "react";
import Spinner from "./Spinner";
import usePlexLogin, {
  fetchAccount,
  pickBestServer,
} from "@/hooks/usePlexLogin";
import type { PlexAccount, PlexServer } from "@/hooks/usePlexLogin";
import { getClientId } from "@/utils/plexOAuth";
import { useAuth } from "@/context/useAuth";

interface PlexAuthProps {
  serverUrl?: string;
  onServerUrl: (url: string) => void;
  onSignOut?: () => void;
  onLoginComplete?: (serverUrl: string) => void;
}

function SignedInCard({
  account,
  serverName,
  onSignOut,
}: {
  account: PlexAccount;
  serverName: string;
  onSignOut: () => void;
}) {
  return (
    <div className="w-xs flex items-center gap-3 p-3 bg-white dark:bg-gray-800 border-2 border-black rounded-lg shadow-cartoon-md">
      <img
        src={account.thumb}
        alt={account.username}
        className="w-10 h-10 rounded-full border-2 border-black"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
          {account.username}
        </p>
        {serverName && (
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {serverName}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg border-2 border-black shadow-cartoon-sm transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}

function formatServerOption(server: PlexServer): string {
  try {
    const { host } = new URL(server.uri);
    return `${server.name} — ${host}${server.local ? " (local)" : ""}`;
  } catch {
    return server.uri;
  }
}

function ServerPicker({
  servers,
  selectedUrl,
  onChange,
}: {
  servers: PlexServer[];
  selectedUrl: string;
  onChange: (url: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Server connection
      </label>
      <select
        value={selectedUrl}
        onChange={(e) => onChange(e.target.value)}
        className="w-full sm:w-sm px-3 py-2 bg-white dark:bg-gray-800 border-2 border-black rounded-lg text-sm text-gray-900 dark:text-gray-100 shadow-cartoon-sm"
      >
        {servers.map((s) => (
          <option key={s.uri} value={s.uri}>
            {formatServerOption(s)}
          </option>
        ))}
      </select>
    </div>
  );
}

type AccountFetch =
  | { status: "idle" }
  | { status: "fetching" }
  | { status: "done"; account: PlexAccount | null };

export default function PlexAuth({
  serverUrl = "",
  onServerUrl,
  onSignOut: onSignOutProp,
  onLoginComplete,
}: PlexAuthProps) {
  const { user } = useAuth();
  const hasPlexToken = user?.hasPlexToken ?? false;

  const [fetchState, setFetchState] = useState<AccountFetch>({
    status: "idle",
  });
  const [servers, setServers] = useState<PlexServer[]>([]);
  const serverName = servers.find((s) => s.uri === serverUrl)?.name ?? "";

  const handleAccount = useCallback((acct: PlexAccount) => {
    setFetchState({ status: "done", account: acct });
  }, []);

  const { loading, login } = usePlexLogin({
    onServers: (fetched: PlexServer[]) => {
      setServers(fetched);
      const best = pickBestServer(fetched);
      if (best) {
        onServerUrl(best.uri);
        onLoginComplete?.(best.uri);
      }
    },
    onAccount: handleAccount,
  });

  useEffect(() => {
    if (!hasPlexToken) return;
    if (fetchState.status !== "idle") return;

    let cancelled = false;
    const clientId = getClientId();

    const load = async () => {
      if (cancelled) return;
      setFetchState({ status: "fetching" });

      const [acct, serversData] = await Promise.all([
        fetchAccount(),
        fetch(
          `/api/plex/servers?clientId=${encodeURIComponent(clientId)}`
        ).then((res) => (res.ok ? res.json() : null)),
      ]);

      if (cancelled) return;
      setFetchState({ status: "done", account: acct });
      if (serversData?.servers) {
        setServers((prev) => (prev.length > 0 ? prev : serversData.servers));
      }
    };

    Promise.resolve().then(load);

    return () => {
      cancelled = true;
    };
    // fetchState.status is read as a run-once guard, not as an input. Listing it
    // would re-run this effect the moment `load` sets "fetching", and the re-run's
    // cleanup would cancel the very fetch that set it. fetchAccount is module-level
    // and so already stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPlexToken]);

  const handleSignOut = () => {
    setFetchState({ status: "idle" });
    setServers([]);
    if (onSignOutProp) {
      onSignOutProp();
    } else {
      onServerUrl("");
    }
  };

  const isLoading = fetchState.status === "fetching";
  const account =
    hasPlexToken && fetchState.status === "done" ? fetchState.account : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 p-3 bg-white dark:bg-gray-800 border-2 border-black rounded-lg shadow-cartoon-md">
        <Spinner className="w-4 h-4" />
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Loading account...
        </span>
      </div>
    );
  }

  if (account) {
    return (
      <div className="space-y-3">
        <SignedInCard
          account={account}
          serverName={serverName}
          onSignOut={handleSignOut}
        />
        {servers.length > 1 && (
          <ServerPicker
            servers={servers}
            selectedUrl={serverUrl}
            onChange={onServerUrl}
          />
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={login}
      disabled={loading}
      className="w-auto px-4 py-2.5 bg-amber-300 hover:bg-amber-200 disabled:opacity-60 text-black font-bold rounded-lg border-2 border-black shadow-cartoon-md transition-colors flex items-center justify-center gap-2"
    >
      {loading ? (
        <>
          <Spinner className="w-4 h-4" />
          Signing in...
        </>
      ) : (
        "Sign in with Plex"
      )}
    </button>
  );
}
