import { useState } from "react";
import { Link } from "react-router-dom";
import type { PromotedAlbumData } from "@/hooks/usePromotedAlbum";
import MonitorButton from "@/components/MonitorButton";
import OptionSelect from "@/components/OptionSelect";
import useHaptics from "@/hooks/useHaptics";
import PurchaseLinksModal from "@/components/PurchaseLinksModal";
import RecommendationTraceModal from "./RecommendationTraceModal";
import TracksPreviewModal from "./TracksPreviewModal";
import { MusicalNoteIcon } from "@/components/icons";
import SectionHeader from "./SectionHeader";
import ShuffleButton from "./ShuffleButton";
import useLidarr from "@/hooks/useLidarr";
import useWanted from "@/hooks/useWanted";
import useReleaseTracks from "@/hooks/useReleaseTracks";
import useAudioPreview from "@/hooks/useAudioPreview";
import ImageWithShimmer from "@/components/ImageWithShimmer";
import { AlbumLibraryPill } from "@/components/AlbumLibraryBadge";
import Skeleton from "@/components/Skeleton";
import { pastelColorFromId } from "@/utils/color";
import { getMonitorState } from "@/utils/monitorState";
import type { Option } from "@/components/OptionSelect";

interface PromotedAlbumProps {
  data: PromotedAlbumData | null;
  loading: boolean;
  onRefresh: () => void;
}

export default function PromotedAlbum({
  data,
  loading,
  onRefresh,
}: PromotedAlbumProps) {
  const [coverError, setCoverError] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isTracksOpen, setIsTracksOpen] = useState(false);
  const [fetchedMbid, setFetchedMbid] = useState<string | null>(null);

  const haptics = useHaptics();
  const { state, errorMsg, requestAlbum, reset: resetLidarr } = useLidarr();
  const {
    state: wantedState,
    addToWanted,
    removeFromWanted,
    reset: resetWanted,
  } = useWanted();
  const {
    media,
    loading: tracksLoading,
    error: tracksError,
    fetchTracks,
    reset: resetTracks,
  } = useReleaseTracks();
  const { toggle, stop, isTrackPlaying } = useAudioPreview();

  const album = data?.album;
  const inLibrary = data?.inLibrary ?? false;
  const pastelBg = album ? pastelColorFromId(album.mbid) : "hsl(200, 70%, 85%)";

  const isWanted = wantedState === "wanted";
  const wantedOptions: Option[] = [
    isWanted
      ? {
          label: "Remove from wanted",
          onClick: () => album && removeFromWanted(album.mbid),
        }
      : {
          label: "Add to wanted",
          onClick: () => album && addToWanted(album.mbid),
        },
  ];

  const effectiveState = getMonitorState(state, inLibrary);

  const handleMonitorClick = () => {
    haptics.medium();
    if (effectiveState === "idle" || effectiveState === "error") {
      setIsModalOpen(true);
    }
  };

  const handleAddToLibrary = () => {
    if (!album) return;
    requestAlbum({ albumMbid: album.mbid });
  };

  const handleRefresh = () => {
    if (loading) return;
    setIsAnimating(true);
    resetLidarr();
    resetWanted();
    setIsTracksOpen(false);
    setFetchedMbid(null);
    resetTracks();
    stop();
    setTimeout(() => {
      onRefresh();
      setCoverError(false);
      setTimeout(() => setIsAnimating(false), 50);
    }, 300);
  };

  const handleTracksOpen = () => {
    if (album && fetchedMbid !== album.mbid && !tracksLoading) {
      fetchTracks(album.mbid, album.artistName);
      setFetchedMbid(album.mbid);
    }
    setIsTracksOpen(true);
  };

  const handleTracksClose = () => {
    stop();
    setIsTracksOpen(false);
  };

  return (
    <>
      <div className="h-full flex flex-col">
        <SectionHeader
          title="Recommended for you"
          action={
            <ShuffleButton
              onClick={handleRefresh}
              disabled={isAnimating || loading}
              spinning={isAnimating || loading}
              ariaLabel="Shuffle recommendation"
            />
          }
        />

        <div
          className={`relative flex-1 lg:min-h-80 bg-white dark:bg-gray-800 rounded-xl border-2 border-black shadow-cartoon-md overflow-hidden flex flex-col transition-all duration-300 ${
            isAnimating
              ? "opacity-0 -translate-x-4 scale-95"
              : "opacity-100 translate-x-0 scale-100"
          }`}
        >
          <div className="flex-1 flex flex-col sm:flex-row">
            <div
              className="w-full sm:w-48 lg:w-auto aspect-square sm:aspect-auto sm:h-48 lg:h-auto flex-shrink-0 overflow-hidden lg:absolute lg:inset-0"
              style={{ backgroundColor: pastelBg }}
            >
              {loading ? (
                <Skeleton className="w-full h-full rounded-none" />
              ) : (
                !coverError &&
                album && (
                  <ImageWithShimmer
                    src={album.coverUrl}
                    alt={`${album.name} cover`}
                    className="w-full h-full object-cover"
                    wrapperClassName="w-full h-full"
                    onError={() => setCoverError(true)}
                  />
                )
              )}
              <div className="hidden lg:block absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent pointer-events-none" />
            </div>

            <div className="flex-1 p-4 flex flex-col justify-between min-w-0 lg:relative lg:justify-end lg:p-5">
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-5 w-32 rounded-full mt-2" />
                </div>
              ) : album ? (
                <>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate lg:text-xl lg:text-white">
                      {album.name}
                    </h3>
                    <p className="text-gray-500 dark:text-gray-400 text-sm truncate lg:text-gray-300">
                      <Link
                        to={`/search?q=${encodeURIComponent(album.artistName)}`}
                        className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                      >
                        {album.artistName}
                      </Link>
                      {album.year && (
                        <span className="ml-1.5">· {album.year}</span>
                      )}
                    </p>
                    {data && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={() => setIsTraceOpen(true)}
                          className="inline-block px-2 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-medium rounded-full border border-violet-200 dark:border-violet-700 hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors cursor-pointer"
                        >
                          {data.mode === "within_taste"
                            ? `Because you listen to ${data.tag}`
                            : `Fans of ${data.seedArtist} also love this`}
                        </button>
                        {data.mode === "explore" &&
                          data.newGenres.length > 0 && (
                            <span className="inline-block px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-medium rounded-full border border-emerald-200 dark:border-emerald-700">
                              New genre: {data.newGenres[0]}
                            </span>
                          )}
                        {data.library && (
                          <AlbumLibraryPill info={data.library} />
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <button
                      onClick={handleTracksOpen}
                      className="flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 lg:text-gray-300 lg:hover:text-amber-400 transition-colors"
                      aria-label="Preview tracks"
                    >
                      <MusicalNoteIcon className="w-3.5 h-3.5" />
                      <span>Preview</span>
                    </button>
                    <div className="flex items-center gap-1.5">
                      <OptionSelect
                        options={wantedOptions}
                        title={album?.name}
                      />
                      <MonitorButton
                        state={effectiveState}
                        onClick={handleMonitorClick}
                        errorMsg={errorMsg ?? undefined}
                      />
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {album && (
        <TracksPreviewModal
          isOpen={isTracksOpen}
          onClose={handleTracksClose}
          albumName={album.name}
          artistName={album.artistName}
          media={media}
          loading={tracksLoading}
          error={tracksError}
          onTogglePreview={toggle}
          isTrackPlaying={isTrackPlaying}
        />
      )}

      {album && (
        <PurchaseLinksModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          artistName={album.artistName}
          albumTitle={album.name}
          albumMbid={album.mbid}
          onAddToLibrary={handleAddToLibrary}
        />
      )}

      {data?.trace && album && (
        <RecommendationTraceModal
          isOpen={isTraceOpen}
          onClose={() => setIsTraceOpen(false)}
          trace={data.trace}
          albumName={album.name}
          artistName={album.artistName}
        />
      )}
    </>
  );
}
