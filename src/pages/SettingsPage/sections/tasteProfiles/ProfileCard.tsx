import { useState } from "react";
import ProfileFacts from "./ProfileFacts";
import ProfileSignalTable from "./ProfileSignalTable";
import type { ProfileDebugEntry } from "@/types";

interface ProfileCardProps {
  entry: ProfileDebugEntry;
}

function formatStamp(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}

function plexFacts(entry: ProfileDebugEntry) {
  return [
    { label: "Tracks tracked", value: entry.plex.trackedTracks },
    { label: "Total plays", value: entry.plex.totalPlays },
    { label: "Artists", value: entry.plex.artists },
    { label: "Rated items", value: entry.plex.ratedItems },
  ];
}

function profileFacts(entry: ProfileDebugEntry) {
  const profile = entry.profile;
  if (!profile) return [];

  return [
    { label: "Genres", value: profile.counts.genres },
    { label: "Artists", value: profile.counts.artists },
    { label: "Similar seeds", value: profile.counts.similarSeeds },
    { label: "Similar candidates", value: profile.counts.similarCandidates },
    { label: "Known albums", value: profile.counts.knownAlbums },
    { label: "Explored albums", value: profile.counts.exploredAlbums },
    { label: "Explored artists", value: profile.counts.exploredArtists },
    { label: "Schema", value: profile.schemaVersion },
  ];
}

export default function ProfileCard({ entry }: ProfileCardProps) {
  const [expanded, setExpanded] = useState(false);
  const profile = entry.profile;

  return (
    <li className="rounded-xl border-2 border-black bg-white dark:bg-gray-800 shadow-cartoon-sm p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-bold text-gray-900 dark:text-gray-100">
          {entry.username}
        </h3>
        {!entry.hasPlexToken && (
          <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border-2 border-black bg-gray-200 dark:bg-gray-700 text-black dark:text-gray-100">
            No Plex token
          </span>
        )}
        {profile?.stale && (
          <span
            title="The next request regenerates this profile: the config or schema changed, or the vector is empty."
            className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border-2 border-black bg-amber-300 text-black"
          >
            Stale
          </span>
        )}
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="ml-auto text-xs font-bold px-2 py-1 rounded-lg border-2 border-black bg-white dark:bg-gray-700 dark:text-gray-100 shadow-cartoon-sm"
        >
          {expanded ? "Hide detail" : "Show detail"}
        </button>
      </div>

      <div>
        <p className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
          From Plex, as stored
        </p>
        <ProfileFacts facts={plexFacts(entry)} />
      </div>

      {profile ? (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
            Derived profile · generated {formatStamp(profile.generatedAt)} ·
            last used {formatStamp(profile.lastUsedAt)}
          </p>
          <ProfileFacts facts={profileFacts(entry)} />
        </div>
      ) : (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          No derived profile yet. One is built the first time this user loads
          Discover.
        </p>
      )}

      {expanded && (
        <div className="space-y-3 border-t-2 border-dashed border-gray-200 dark:border-gray-700 pt-3">
          {profile && profile.topGenres.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                Top genres
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {profile.topGenres.map((genre) => (
                  <li
                    key={genre.tag}
                    className="text-xs px-2 py-0.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200"
                  >
                    {genre.tag} · {Math.round(genre.weight)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {profile && profile.topArtists.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                Most played artists
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {profile.topArtists.map((artist) => (
                  <li
                    key={artist.name}
                    className="text-xs px-2 py-0.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
                  >
                    {artist.name} · {artist.viewCount}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {profile && (
            <p className="text-[11px] font-mono text-gray-400 dark:text-gray-500 break-all">
              config {profile.configHash.slice(0, 12)} (current{" "}
              {profile.currentConfigHash.slice(0, 12)}) · schema{" "}
              {profile.schemaVersion} of {profile.currentSchemaVersion}
            </p>
          )}

          <ProfileSignalTable
            signals={entry.signals}
            recent={entry.recentSignals}
          />
        </div>
      )}
    </li>
  );
}
