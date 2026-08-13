type AutoSetupStatus = {
  indexerExists: boolean;
  downloadClientExists: boolean;
} | null;

interface SlskdSectionProps {
  url: string;
  apiKey: string;
  downloadPath: string;
  indexerApiKey: string;
  testing: boolean;
  onUrlChange: (url: string) => void;
  onApiKeyChange: (apiKey: string) => void;
  onDownloadPathChange: (path: string) => void;
  onIndexerApiKeyChange: (apiKey: string) => void;
  onTest: (e: React.MouseEvent<HTMLButtonElement>) => void;
  isConnected: boolean;
  autoSetupStatus: AutoSetupStatus;
  autoSetupLoading: boolean;
  onAutoSetup: () => void;
}

function getButtonState(
  isConnected: boolean,
  status: AutoSetupStatus,
  loading: boolean
) {
  if (loading) return "loading" as const;
  if (!isConnected) return "disabled" as const;
  if (status?.indexerExists && status?.downloadClientExists)
    return "added" as const;
  return "ready" as const;
}

export default function SlskdSection({
  url,
  apiKey,
  downloadPath,
  indexerApiKey,
  testing,
  onUrlChange,
  onApiKeyChange,
  onDownloadPathChange,
  onIndexerApiKeyChange,
  onTest,
  isConnected,
  autoSetupStatus,
  autoSetupLoading,
  onAutoSetup,
}: SlskdSectionProps) {
  const buttonState = getButtonState(
    isConnected,
    autoSetupStatus,
    autoSetupLoading
  );

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
        slskd (Soulseek)
      </h2>
      <div>
        <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
          slskd URL
        </label>
        <input
          type="text"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="http://slskd:5030"
          className="w-full sm:w-sm px-3 py-2 bg-white dark:bg-gray-800 border-2 border-black rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-200 dark:placeholder-gray-600 focus:outline-none focus:border-amber-400 shadow-cartoon-md"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
          API Key
        </label>
        <input
          type="text"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder="Enter slskd API key"
          className="w-full sm:w-sm px-3 py-2 bg-white dark:bg-gray-800 border-2 border-black rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-200 dark:placeholder-gray-600 focus:outline-none focus:border-amber-400 shadow-cartoon-md"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
          Download Path
        </label>
        <input
          type="text"
          value={downloadPath}
          onChange={(e) => onDownloadPathChange(e.target.value)}
          placeholder="/downloads/slskd/complete"
          className="w-full sm:w-sm px-3 py-2 bg-white dark:bg-gray-800 border-2 border-black rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-200 dark:placeholder-gray-600 focus:outline-none focus:border-amber-400 shadow-cartoon-md"
        />
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
          Path where Lidarr can access slskd&apos;s completed downloads (shared
          volume mount)
        </p>
      </div>
      <div>
        <label
          htmlFor="slskd-indexer-api-key"
          className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1"
        >
          Indexer API Key
        </label>
        <input
          id="slskd-indexer-api-key"
          type="text"
          value={indexerApiKey}
          onChange={(e) => onIndexerApiKeyChange(e.target.value)}
          placeholder="Leave blank to allow unauthenticated access"
          className="w-full sm:w-sm px-3 py-2 bg-white dark:bg-gray-800 border-2 border-black rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-200 dark:placeholder-gray-600 focus:outline-none focus:border-amber-400 shadow-cartoon-md"
        />
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
          Secret Lidarr must send to Tunearr&apos;s indexer and download client.
          While blank, anyone who can reach this server can trigger Soulseek
          searches and downloads. Changing it means updating both entries in
          Lidarr, or re-running Set Up in Lidarr.
        </p>
      </div>
      <div className="flex flex-wrap gap-3 pt-2">
        <button
          type="button"
          onClick={onTest}
          disabled={testing || !url || !apiKey}
          className="px-4 py-2 bg-amber-300 hover:bg-amber-200 disabled:opacity-50 text-black font-bold rounded-lg text-sm border-2 border-black shadow-cartoon-sm hover:translate-y-[-1px] hover:shadow-cartoon-md active:translate-y-[1px] active:shadow-cartoon-pressed transition-all"
        >
          {testing ? "Testing..." : "Test Connection"}
        </button>
        <AutoSetupButton state={buttonState} onClick={onAutoSetup} />
      </div>
    </div>
  );
}

function AutoSetupButton({
  state,
  onClick,
}: {
  state: "disabled" | "loading" | "added" | "ready";
  onClick: () => void;
}) {
  if (state === "added") {
    return (
      <button
        disabled
        className="w-sm px-4 py-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-bold rounded-lg border-2 border-black shadow-cartoon-sm cursor-default"
      >
        ✓ Added to Lidarr
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={state === "disabled" || state === "loading"}
      className="w-xxs px-4 py-2 bg-amber-300 hover:bg-amber-200 text-black font-bold rounded-lg border-2 border-black shadow-cartoon-sm active:translate-y-0.5 active:shadow-none disabled:opacity-50 disabled:cursor-not-allowed transition-all"
    >
      {state === "loading" ? "Checking…" : "Set Up in Lidarr"}
    </button>
  );
}
