import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ImageWithShimmer from "@/components/ImageWithShimmer";
import { pastelColorFromId } from "@/utils/color";
import AlbumActions from "./AlbumActions";
import { AlbumLibraryPill } from "@/components/AlbumLibraryBadge";
import type { AlbumDetails, AlbumLabel, ReleaseGroup } from "@/types";
import type { AlbumLibraryInfo } from "@shared/albumLibrary";

interface AlbumHeaderProps {
  album: AlbumDetails;
  label?: AlbumLabel | null;
  inLibrary?: boolean;
  initialWanted?: boolean;
  library?: AlbumLibraryInfo | null;
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

function buildSubtitle(album: AlbumDetails, label?: AlbumLabel | null): string {
  const year = album.firstReleaseDate?.slice(0, 4);
  return [album.primaryType, year, label?.name].filter(Boolean).join(" · ");
}

export default function AlbumHeader({
  album,
  label,
  inLibrary,
  initialWanted,
  library,
}: AlbumHeaderProps) {
  const [coverError, setCoverError] = useState(false);
  const pastelBg = useMemo(() => pastelColorFromId(album.mbid), [album.mbid]);
  const coverUrl = `https://coverartarchive.org/release-group/${album.mbid}/front-500`;
  const subtitle = buildSubtitle(album, label);

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
          {library && <AlbumLibraryPill info={library} />}
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
