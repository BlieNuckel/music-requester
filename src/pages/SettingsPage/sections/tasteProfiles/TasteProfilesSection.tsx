import useProfileDebug from "@/hooks/useProfileDebug";
import Skeleton from "@/components/Skeleton";
import RefreshButton from "@/components/RefreshButton";
import ProfileCard from "./ProfileCard";

export default function TasteProfilesSection() {
  const { users, loading, error, refresh } = useProfileDebug();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Taste profiles
        </h2>
        <RefreshButton
          onRefresh={refresh}
          loading={loading}
          ariaLabel="Refresh taste profiles"
        />
      </div>

      <p className="text-gray-400 dark:text-gray-500 text-xs">
        What is actually stored per user: the folded Plex signal series and the
        derived profile built from it. Everything here comes from our own
        tables, so it shows what the pollers have recorded rather than what Plex
        says right now.
      </p>

      {error && (
        <p className="text-rose-500 text-sm">Could not load taste profiles</p>
      )}

      {loading && users.length === 0 && (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!loading && !error && users.length === 0 && (
        <p className="text-gray-400 dark:text-gray-500 text-sm">
          No users yet.
        </p>
      )}

      {users.length > 0 && (
        <ul className="space-y-3">
          {users.map((entry) => (
            <ProfileCard key={entry.userId} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}
