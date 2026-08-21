import { ManualImportItem } from "../hooks/useManualImport";

interface ImportReviewProps {
  items: ManualImportItem[];
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Mirrors Lidarr's own interactive-import rule. Lidarr's ManualImport command
 * throws on a missing id instead of reporting a rejection, so a file that fails
 * this check has to be kept out of the confirm request.
 */
function missingFields(item: ManualImportItem): string[] {
  const missing: string[] = [];

  if (!item.artist?.id) missing.push("artist");
  if (!item.album?.id) missing.push("album");
  if (!item.albumReleaseId) missing.push("album release");
  if (!item.tracks?.length) missing.push("track match");
  if (!item.quality?.quality?.id) missing.push("quality");

  return missing;
}

export default function ImportReview({
  items,
  onConfirm,
  onCancel,
}: ImportReviewProps) {
  const unmatched = items.filter((item) => missingFields(item).length > 0);
  const canImport = unmatched.length === 0;

  return (
    <div className="space-y-3">
      <div className="max-h-80 overflow-y-auto space-y-1">
        {items.map((item: ManualImportItem) => {
          const missing = missingFields(item);

          return (
            <div
              key={item.path}
              className="p-2 bg-amber-50 dark:bg-gray-700/50 rounded-lg text-sm border-2 border-black shadow-cartoon-sm"
            >
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-gray-900 dark:text-gray-100 truncate">
                    {item.name}
                  </p>
                  <div className="flex gap-2 text-xs">
                    {item.tracks?.[0] && (
                      <span className="text-gray-500 dark:text-gray-400">
                        {item.tracks[0].trackNumber}. {item.tracks[0].title}
                      </span>
                    )}
                    <span className="text-gray-400 dark:text-gray-500">
                      {item.quality?.quality?.name}
                    </span>
                  </div>
                </div>
              </div>
              {missing.length > 0 && (
                <p className="mt-1.5 text-rose-600 dark:text-rose-400 text-xs font-medium">
                  Lidarr could not determine: {missing.join(", ")}
                </p>
              )}
              {(item.rejections?.length ?? 0) > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {item.rejections?.map((r, j) => (
                    <p
                      key={j}
                      className="text-amber-700 dark:text-amber-400 text-xs"
                    >
                      {r.reason}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!canImport && (
        <div className="bg-rose-400 text-white border-2 border-black rounded-xl p-3 text-xs font-medium shadow-cartoon-sm">
          Lidarr could not match {unmatched.length} file
          {unmatched.length !== 1 ? "s" : ""} to a track. Importing would leave
          them out of your library, so fix the file tags and upload again.
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          disabled={!canImport}
          className="flex-1 bg-emerald-400 hover:bg-emerald-300 disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:text-gray-500 dark:disabled:text-gray-400 disabled:cursor-not-allowed disabled:shadow-cartoon-sm disabled:translate-y-0 text-black dark:text-black font-bold py-2 px-4 rounded-xl border-2 border-black shadow-cartoon-sm hover:translate-y-[-1px] hover:shadow-cartoon-md active:translate-y-[1px] active:shadow-cartoon-pressed transition-all text-sm"
        >
          Confirm Import ({items.length} file{items.length !== 1 ? "s" : ""})
        </button>
        <button
          onClick={onCancel}
          className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 font-medium py-2 px-4 rounded-xl border-2 border-black shadow-cartoon-sm hover:translate-y-[-1px] hover:shadow-cartoon-md active:translate-y-[1px] active:shadow-cartoon-pressed transition-all text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
