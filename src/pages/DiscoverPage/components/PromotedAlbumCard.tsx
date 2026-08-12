import { useState } from "react";
import { Link } from "react-router-dom";
import type { PromotedAlbumData } from "@/hooks/usePromotedAlbums";
import MonitorButton from "@/components/MonitorButton";
import OptionSelect from "@/components/OptionSelect";
import useHaptics from "@/hooks/useHaptics";
import PurchaseLinksModal from "@/components/PurchaseLinksModal";
import RecommendationTraceModal from "./RecommendationTraceModal";
import TracksPreviewModal from "./TracksPreviewModal";
import { MusicalNoteIcon } from "@/components/icons";
import useLidarr from "@/hooks/useLidarr";
import useWanted from "@/hooks/useWanted";
import useReleaseTracks from "@/hooks/useReleaseTracks";
import useAudioPreview from "@/hooks/useAudioPreview";
import ImageWithShimmer from "@/components/ImageWithShimmer";
import { AlbumLibraryPill } from "@/components/AlbumLibraryBadge";
import { pastelColorFromId } from "@/utils/color";
import { getMonitorState } from "@/utils/monitorState";
import type { Option } from "@/components/OptionSelect";

interface PromotedAlbumCardProps {
  data: PromotedAlbumData;
}

export default function PromotedAlbumCard({ data }: PromotedAlbumCardProps) {
  const [coverError, setCoverError] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const [isTracksOpen, setIsTracksOpen] = useState(false);
  const [tracksFetched, setTracksFetched] = useState(false);

  const haptics = useHaptics();
  const { state, errorMsg, requestAlbum } = useLidarr();
  const { state: wantedState, addToWanted, removeFromWanted } = useWanted();
  const {
    media,
    loading: tracksLoading,
    error: tracksError,
    fetchTracks,
  } = useReleaseTracks();
  const { toggle, stop, isTrackPlaying } = useAudioPreview();

  const album = data.album;
  const inLibrary = data.inLibrary;
  const pastelBg = pastelColorFromId(album.mbid);

  const isWanted = wantedState === "wanted";
  const wantedOptions: Option[] = [
    isWanted
      ? {
          label: "Remove from wanted",
          onClick: () => removeFromWanted(album.mbid),
        }
      : {
          label: "Add to wanted",
          onClick: () => addToWanted(album.mbid),
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
    requestAlbum({ albumMbid: album.mbid });
  };

  const handleTracksOpen = () => {
    if (!tracksFetched && !tracksLoading) {
      fetchTracks(album.mbid, album.artistName);
      setTracksFetched(true);
    }
    setIsTracksOpen(true);
  };

  const handleTracksClose = () => {
    stop();
    setIsTracksOpen(false);
  };

  return (
    <>
      <div className="relative flex-1 flex flex-col sm:flex-row min-w-0">
        <div
          className="w-full sm:w-48 lg:w-auto aspect-square sm:aspect-auto sm:h-48 lg:h-auto flex-shrink-0 overflow-hidden lg:absolute lg:inset-0"
          style={{ backgroundColor: pastelBg }}
        >
          {!coverError && (
            <ImageWithShimmer
              src={album.coverUrl}
              alt={`${album.name} cover`}
              className="w-full h-full object-cover"
              wrapperClassName="w-full h-full"
              onError={() => setCoverError(true)}
            />
          )}
          <div className="hidden lg:block absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent pointer-events-none" />
        </div>

        <div className="flex-1 p-4 flex flex-col justify-between min-w-0 lg:relative lg:justify-end lg:p-5">
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
              {album.year && <span className="ml-1.5">· {album.year}</span>}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setIsTraceOpen(true)}
                className="inline-block px-2 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-medium rounded-full border border-violet-200 dark:border-violet-700 hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors cursor-pointer"
              >
                {data.mode === "within_taste"
                  ? `Because you listen to ${data.tag}`
                  : `Fans of ${data.seedArtist} also love this`}
              </button>
              {data.mode === "explore" && data.newGenres.length > 0 && (
                <span className="inline-block px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-medium rounded-full border border-emerald-200 dark:border-emerald-700">
                  New genre: {data.newGenres[0]}
                </span>
              )}
              {data.library && <AlbumLibraryPill info={data.library} />}
            </div>
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
              <OptionSelect options={wantedOptions} title={album.name} />
              <MonitorButton
                state={effectiveState}
                onClick={handleMonitorClick}
                errorMsg={errorMsg ?? undefined}
              />
            </div>
          </div>
        </div>
      </div>

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

      <PurchaseLinksModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        artistName={album.artistName}
        albumTitle={album.name}
        albumMbid={album.mbid}
        onAddToLibrary={handleAddToLibrary}
      />

      {data.trace && (
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
