import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ImageWithShimmer from "./ImageWithShimmer";
import ContextMenu from "./ContextMenu";
import AlbumActionModals from "./AlbumActionModals";
import { CheckIcon } from "./icons";
import useHaptics from "../hooks/useHaptics";
import useAlbumActions from "../hooks/useAlbumActions";
import { pastelColorFromId } from "../utils/color";
import { ReleaseGroup } from "../types";

interface ReleaseGroupCardProps {
  releaseGroup: ReleaseGroup;
  inLibrary?: boolean;
}

export default function ReleaseGroupCard({
  releaseGroup,
  inLibrary,
}: ReleaseGroupCardProps) {
  const navigate = useNavigate();
  const haptics = useHaptics();
  const actions = useAlbumActions({ releaseGroup });

  const artistName =
    releaseGroup["artist-credit"]?.[0]?.artist?.name || "Unknown Artist";
  const albumTitle = releaseGroup.title || "";
  const albumMbid = releaseGroup.id;
  const year = releaseGroup["first-release-date"]?.slice(0, 4) || "";
  const pastelBg = useMemo(() => pastelColorFromId(albumMbid), [albumMbid]);
  const coverUrl = `https://coverartarchive.org/release-group/${albumMbid}/front-500`;

  const [coverError, setCoverError] = useState(false);

  const handleClick = () => {
    haptics.light();
    navigate(`/album/${albumMbid}`);
  };

  const coverImage = !coverError ? (
    <div className="absolute inset-0">
      <ImageWithShimmer
        src={coverUrl}
        alt={`${albumTitle} cover`}
        className="w-full h-full object-cover"
        onError={() => setCoverError(true)}
      />
    </div>
  ) : null;

  const inLibraryBadge = inLibrary ? (
    <span
      className="absolute bottom-1.5 right-1.5 flex items-center justify-center w-5 h-5 bg-amber-300 text-black rounded-full border-2 border-black shadow-cartoon-sm"
      aria-label="In Library"
    >
      <CheckIcon className="w-3 h-3" />
    </span>
  ) : null;

  return (
    <ContextMenu options={actions.contextOptions} title={albumTitle}>
      <button
        type="button"
        onClick={handleClick}
        className="sm:hidden w-full flex items-center text-left bg-white dark:bg-gray-800 rounded-xl border-2 border-black shadow-cartoon-md overflow-hidden"
        data-testid="release-group-card-mobile"
      >
        <div
          className="w-24 aspect-square flex-shrink-0 relative"
          style={{ backgroundColor: pastelBg }}
        >
          {coverImage}
          {inLibraryBadge}
        </div>
        <div className="flex-1 min-w-0 px-4 py-3">
          <h3 className="text-gray-900 dark:text-gray-100 font-semibold text-base truncate">
            {albumTitle}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm truncate">
            {artistName}
          </p>
          {year && (
            <p className="text-gray-400 dark:text-gray-500 text-xs">{year}</p>
          )}
        </div>
      </button>

      <button
        type="button"
        onClick={handleClick}
        className="hidden sm:block w-full text-left bg-white dark:bg-gray-800 rounded-xl border-2 border-black shadow-cartoon-md overflow-hidden hover:translate-y-[-2px] hover:shadow-cartoon-lg transition-all"
        data-testid="release-group-card"
      >
        <div
          className="aspect-square relative"
          style={{ backgroundColor: pastelBg }}
        >
          {coverImage}
          {inLibraryBadge}
        </div>
        <div className="p-3 border-t-2 border-black">
          <h3 className="text-gray-900 dark:text-gray-100 font-semibold text-sm truncate mb-1">
            {albumTitle}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 text-xs truncate">
            {artistName}
          </p>
          {year && (
            <p className="text-gray-400 dark:text-gray-500 text-xs mt-0.5">
              {year}
            </p>
          )}
        </div>
      </button>

      <AlbumActionModals actions={actions} />
    </ContextMenu>
  );
}
