import { useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import SearchBar from "./components/SearchBar";
import ReleaseGroupCard from "@/components/ReleaseGroupCard";
import ArtistCard from "@/pages/DiscoverPage/components/ArtistCard";
import Skeleton from "@/components/Skeleton";
import useSearch from "@/hooks/useSearch";
import useLibraryAlbums from "@/hooks/useLibraryAlbums";
import useLibraryArtists from "@/hooks/useLibraryArtists";

const DEAL_ROTATIONS = [-4, 3.5, -3, 4.5, -3.5, 3];

const SECTION_HEADING_CLASS =
  "text-sm font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3";
const ALBUM_GRID_CLASS =
  "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-4";
const ARTIST_GRID_CLASS =
  "grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-3 sm:gap-4";

function AlbumSkeletonCard() {
  return (
    <div>
      <div className="sm:hidden bg-white dark:bg-gray-800 rounded-xl border-2 border-black shadow-cartoon-sm overflow-hidden">
        <div className="flex items-center">
          <Skeleton className="w-24 aspect-square flex-shrink-0 rounded-none" />
          <div className="flex-1 min-w-0 px-4 py-3 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      </div>
      <div className="hidden sm:block bg-white dark:bg-gray-800 rounded-xl border-2 border-black shadow-cartoon-sm overflow-hidden">
        <Skeleton className="aspect-square rounded-none" />
        <div className="p-3 border-t-2 border-black space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    </div>
  );
}

function SearchSkeletons() {
  return (
    <div className="mt-6 space-y-8">
      <div className={ARTIST_GRID_CLASS}>
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex flex-col items-center">
            <Skeleton className="w-full aspect-square rounded-full" />
            <Skeleton className="mt-2 h-3 w-3/4" />
          </div>
        ))}
      </div>
      <div className={ALBUM_GRID_CLASS}>
        {[...Array(6)].map((_, i) => (
          <AlbumSkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { albums, artists, loading, error, search } = useSearch();
  const { isAlbumInLibrary } = useLibraryAlbums();
  const { isArtistInLibrary } = useLibraryArtists();
  const inputRef = useRef<HTMLInputElement>(null);

  const query = searchParams.get("q") ?? "";

  useEffect(() => {
    if (query) {
      search(query);
    }
  }, [query, search]);

  useEffect(() => {
    const handleReset = () => {
      setSearchParams({});
      inputRef.current?.focus();
    };
    window.addEventListener("search:reset", handleReset);
    return () => window.removeEventListener("search:reset", handleReset);
  }, [setSearchParams]);

  const handleSearch = useCallback(
    (newQuery: string) => {
      setSearchParams({ q: newQuery });
    },
    [setSearchParams]
  );

  const hasResults = artists.length > 0 || albums.length > 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Search</h1>

      <SearchBar
        onSearch={handleSearch}
        initialQuery={query}
        inputRef={inputRef}
      />

      {loading && <SearchSkeletons />}

      {error && <p className="text-rose-500 mt-4">Error: {error}</p>}

      {!loading && !error && hasResults && (
        <div className="mt-6 space-y-8">
          {artists.length > 0 && (
            <section>
              <h2 className={SECTION_HEADING_CLASS}>Artists</h2>
              <div className={ARTIST_GRID_CLASS}>
                {artists.map((artist) => (
                  <ArtistCard
                    key={artist.mbid}
                    name={artist.name}
                    mbid={artist.mbid}
                    imageUrl={artist.imageUrl}
                    inLibrary={isArtistInLibrary(artist.mbid, artist.name)}
                  />
                ))}
              </div>
            </section>
          )}

          {albums.length > 0 && (
            <section>
              <h2 className={SECTION_HEADING_CLASS}>Albums</h2>
              <div className={ALBUM_GRID_CLASS}>
                {albums.map((rg, index) => (
                  <div
                    key={rg.id}
                    className="cascade-deal-in"
                    style={
                      {
                        "--deal-index": index,
                        "--deal-rotate": `${DEAL_ROTATIONS[index % DEAL_ROTATIONS.length]}deg`,
                      } as React.CSSProperties
                    }
                  >
                    <ReleaseGroupCard
                      releaseGroup={rg}
                      inLibrary={isAlbumInLibrary(rg.id)}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {!loading && !error && !hasResults && (
        <div className="mt-16 flex flex-col items-center text-gray-400 animate-fade-in">
          <svg
            className="w-16 h-16 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          {query ? (
            <>
              <p className="text-lg font-medium text-gray-500">
                No results found
              </p>
              <p className="mt-1 text-center">Try a different search term.</p>
            </>
          ) : (
            <>
              <p className="text-lg font-medium text-gray-500">
                Search for music
              </p>
              <p className="mt-1 text-center">
                Find albums or artists by name to add to your library.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
