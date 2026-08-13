import { useEffect, useMemo } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/useAuth";
import { hasPermission, Permission } from "@shared/permissions";
import FileUploadZone from "@/components/FileUploadZone";
import ImportReview from "@/components/ImportReview";
import Spinner from "@/components/Spinner";
import ImageWithShimmer from "@/components/ImageWithShimmer";
import useFileUpload from "@/hooks/useFileUpload";
import useAsyncData from "@/hooks/useAsyncData";
import type { FetchContext } from "@/hooks/useAsyncData";
import { pastelColorFromId } from "@/utils/color";
import { ArrowLeftIcon, XMarkIcon, DocumentIcon } from "@/components/icons";

type ReleaseGroupInfo = {
  artistName: string;
  albumTitle: string;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchReleaseGroupInfo({
  key,
  signal,
}: FetchContext): Promise<ReleaseGroupInfo | null> {
  const res = await fetch(`/api/musicbrainz/release-group/${key}`, {
    signal,
  });
  return res.ok ? res.json() : null;
}

function useReleaseGroupInfo(mbid: string | null) {
  const { data, loading } = useAsyncData(mbid, fetchReleaseGroupInfo);
  return { info: data ?? null, loading };
}

export default function UploadPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const mbid = searchParams.get("mbid");

  const canImport =
    user !== null && hasPermission(user.permissions, Permission.IMPORT);

  useEffect(() => {
    if (!canImport) navigate("/library/wanted", { replace: true });
  }, [canImport, navigate]);

  const { info, loading: infoLoading } = useReleaseGroupInfo(mbid);
  const {
    step,
    files,
    items,
    error,
    addFiles,
    removeFile,
    startUpload,
    confirm,
    cancel,
    reset,
  } = useFileUpload();

  const coverUrl = mbid
    ? `https://coverartarchive.org/release-group/${mbid}/front-500`
    : null;
  const pastelBg = useMemo(
    () => (mbid ? pastelColorFromId(mbid) : "#f3f4f6"),
    [mbid]
  );

  if (!mbid) {
    return (
      <div className="space-y-4">
        <p className="text-gray-500 dark:text-gray-400">
          No album specified. Please navigate here from an album card.
        </p>
        <Link
          to="/library/wanted"
          className="text-amber-500 hover:text-amber-600 text-sm font-medium"
        >
          Back to library
        </Link>
      </div>
    );
  }

  if (!canImport) return null;

  const hasFiles = files.length > 0;
  const isUploading = step === "uploading";
  const uploadedCount = files.filter((f) => f.status === "done").length;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Link
        to="/library/wanted"
        className="inline-flex items-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 text-sm font-medium transition-colors"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        Back to library
      </Link>

      <div className="flex items-center gap-4 bg-white dark:bg-gray-800 rounded-xl border-2 border-black shadow-cartoon-md p-4">
        <div
          className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 border-2 border-black"
          style={{ backgroundColor: pastelBg }}
        >
          {coverUrl && (
            <ImageWithShimmer
              src={coverUrl}
              alt="Album cover"
              className="w-full h-full object-cover"
            />
          )}
        </div>
        <div className="min-w-0">
          {infoLoading ? (
            <div className="flex items-center gap-2">
              <Spinner className="w-4 h-4 text-gray-400" />
              <span className="text-gray-400 text-sm">Loading...</span>
            </div>
          ) : info ? (
            <>
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
                {info.albumTitle}
              </h2>
              <p className="text-gray-500 dark:text-gray-400 text-sm truncate">
                {info.artistName}
              </p>
            </>
          ) : (
            <p className="text-gray-400 text-sm">Unknown album</p>
          )}
        </div>
      </div>

      {step === "idle" && (
        <div className="space-y-4 animate-fade-in">
          <FileUploadZone onFiles={addFiles} />

          {hasFiles && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Selected files ({files.length})
              </h3>
              <FileList files={files} onRemove={removeFile} />
              <button
                onClick={() => startUpload(mbid, info?.albumTitle ?? "upload")}
                className="w-full bg-amber-400 hover:bg-amber-300 text-black font-bold py-3 px-4 rounded-xl border-2 border-black shadow-cartoon-md hover:translate-y-[-2px] hover:shadow-cartoon-lg active:translate-y-[1px] active:shadow-cartoon-pressed transition-all"
              >
                Upload {files.length} file{files.length !== 1 ? "s" : ""}
              </button>
            </div>
          )}
        </div>
      )}

      {isUploading && (
        <div className="space-y-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <Spinner className="w-5 h-5 text-amber-400" />
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              Uploading files... ({uploadedCount}/{files.length})
            </p>
          </div>
          <FileList files={files} />
        </div>
      )}

      {step === "scanning" && (
        <div className="flex items-center justify-center gap-2 py-8 animate-fade-in">
          <Spinner className="h-5 w-5 text-amber-400" />
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            Scanning files with Lidarr...
          </p>
        </div>
      )}

      {step === "reviewing" && (
        <div className="animate-fade-in">
          <ImportReview
            items={items}
            onConfirm={() => confirm(items)}
            onCancel={cancel}
          />
        </div>
      )}

      {step === "importing" && (
        <div className="flex items-center justify-center gap-2 py-8 animate-fade-in">
          <Spinner className="h-5 w-5 text-emerald-500" />
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            Importing to Lidarr...
          </p>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-4 animate-slide-up">
          <div className="bg-emerald-400 text-black border-2 border-black rounded-xl p-4 text-sm font-medium shadow-cartoon-sm">
            Files imported successfully!
          </div>
          <Link
            to="/library/wanted"
            className="inline-block text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 text-sm underline"
          >
            Back to library
          </Link>
        </div>
      )}

      {step === "error" && (
        <div className="space-y-3 animate-fade-in">
          <div className="bg-rose-400 text-white border-2 border-black rounded-xl p-4 text-sm font-medium shadow-cartoon-sm">
            {error}
          </div>
          <button
            onClick={reset}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 text-sm underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

type FileListProps = {
  files: { file: File; status: string; error?: string }[];
  onRemove?: (index: number) => void;
};

function FileList({ files, onRemove }: FileListProps) {
  return (
    <div className="max-h-60 overflow-y-auto space-y-1">
      {files.map((f, i) => (
        <div
          key={`${f.file.name}-${i}`}
          className="flex items-center gap-2 p-2 bg-white dark:bg-gray-800 rounded-lg text-sm border-2 border-black shadow-cartoon-sm"
        >
          <DocumentIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-gray-900 dark:text-gray-100 truncate">
              {f.file.name}
            </p>
            <p className="text-gray-400 dark:text-gray-500 text-xs">
              {formatFileSize(f.file.size)}
            </p>
          </div>
          {f.status === "uploading" && (
            <Spinner className="w-4 h-4 text-amber-400 flex-shrink-0" />
          )}
          {f.status === "done" && (
            <span className="text-emerald-500 text-xs font-bold flex-shrink-0">
              Done
            </span>
          )}
          {f.status === "error" && (
            <span className="text-rose-500 text-xs font-bold flex-shrink-0">
              Failed
            </span>
          )}
          {f.status === "pending" && onRemove && (
            <button
              onClick={() => onRemove(i)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
