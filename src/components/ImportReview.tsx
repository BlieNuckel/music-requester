import { ManualImportItem } from "../hooks/useManualImport";

interface ImportReviewProps {
  items: ManualImportItem[];
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ImportReview({
  items,
  onConfirm,
  onCancel,
}: ImportReviewProps) {
  return (
    <div className="space-y-3">
      <div className="max-h-80 overflow-y-auto space-y-1">
        {items.map((item: ManualImportItem) => (
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
            {item.rejections?.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {item.rejections.map((r, j) => (
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
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="flex-1 bg-emerald-400 hover:bg-emerald-300 text-black dark:text-black font-bold py-2 px-4 rounded-xl border-2 border-black shadow-cartoon-sm hover:translate-y-[-1px] hover:shadow-cartoon-md active:translate-y-[1px] active:shadow-cartoon-pressed transition-all text-sm"
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
