import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ImageWithShimmer from "@/components/ImageWithShimmer";
import { pastelColorFromId } from "@/utils/color";
import AlbumActions from "./AlbumActions";
import type { TrackAvailability } from "@/hooks/useLibraryAlbums";
import type { AlbumDetails, ReleaseGroup } from "@/types";

interface AlbumHeaderProps {
  album: AlbumDetails;
  inLibrary?: boolean;
  initialWanted?: boolean;
  trackAvailability?: TrackAvailability | null;
}

function toReleaseGroup(album: AlbumDetails): ReleaseGroup {
  return {
    id: album.mbid,
    score: 0,
    title: album.title,
    "primary-type": album.primaryType ?? "Album",
    "first-release-date": album.firstReleaseDate ?? "",
    "artist-credit": album.artistMbid
      ? [
          {
            name: album.artistName,
            artist: { id: album.artistMbid, name: album.artistName },
          },
        ]
      : [],
  };
}

function buildSubtitle(album: AlbumDetails): string {
  const year = album.firstReleaseDate?.slice(0, 4);
  return [album.primaryType, year, album.label?.name]
    .filter(Boolean)
    .join(" · ");
}

export default function AlbumHeader({
  album,
  inLibrary,
  initialWanted,
  trackAvailability,
}: AlbumHeaderProps) {
  const [coverError, setCoverError] = useState(false);
  const pastelBg = useMemo(() => pastelColorFromId(album.mbid), [album.mbid]);
  const coverUrl = `https://coverartarchive.org/release-group/${album.mbid}/front-500`;
  const subtitle = buildSubtitle(album);

  return (
    <div className="flex items-start gap-4 mb-8">
      <div
        className="w-28 h-28 sm:w-40 sm:h-40 rounded-xl flex-shrink-0 relative overflow-hidden border-2 border-black shadow-cartoon-md"
        style={{ backgroundColor: pastelBg }}
      >
        {!coverError && (
          <ImageWithShimmer
            src={coverUrl}
            alt={`${album.title} cover`}
            className="w-full h-full object-cover"
            onError={() => setCoverError(true)}
          />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
            {album.title}
          </h1>
          {inLibrary && trackAvailability && (
            <span className="text-xs bg-amber-300 text-black px-1.5 py-0.5 rounded-full border-2 border-black font-bold shadow-cartoon-sm whitespace-nowrap">
              {trackAvailability.available}/{trackAvailability.total} tracks
            </span>
          )}
        </div>
        {album.artistMbid ? (
          <Link
            to={`/artist/${album.artistMbid}`}
            className="text-gray-600 dark:text-gray-300 text-base mt-1 inline-block hover:underline truncate"
          >
            {album.artistName}
          </Link>
        ) : (
          <p className="text-gray-600 dark:text-gray-300 text-base mt-1 truncate">
            {album.artistName}
          </p>
        )}
        {subtitle && (
          <p className="text-gray-400 dark:text-gray-500 text-sm mt-1 truncate">
            {subtitle}
          </p>
        )}
        <div className="mt-4">
          <AlbumActions
            releaseGroup={toReleaseGroup(album)}
            inLibrary={inLibrary}
            initialWanted={initialWanted}
          />
        </div>
      </div>
    </div>
  );
}
