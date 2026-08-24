import type {
  PromotedAlbumSettings,
  LibraryPreference,
} from "@/context/settingsContextDef";
import { DEFAULT_PROMOTED_ALBUM } from "@/context/promotedAlbumDefaults";
import TagListEditor from "./TagListEditor";

interface RecommendationsSectionProps {
  config: PromotedAlbumSettings;
  onConfigChange: (config: PromotedAlbumSettings) => void;
}

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  description?: string;
}

interface PercentFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  description?: string;
}

const LIBRARY_PREFERENCE_OPTIONS: {
  value: LibraryPreference;
  label: string;
}[] = [
  { value: "prefer_new", label: "Prefer New" },
  { value: "prefer_library", label: "Prefer Library" },
  { value: "no_preference", label: "No Preference" },
];

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  description,
}: NumberFieldProps) {
  const fieldId = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return (
    <div>
      <label
        htmlFor={fieldId}
        className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1"
      >
        {label}
      </label>
      <input
        id={fieldId}
        type="number"
        value={value}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (!Number.isNaN(parsed))
            onChange(Math.max(min, Math.min(max, parsed)));
        }}
        min={min}
        max={max}
        step={step}
        className="w-full sm:w-xs px-3 py-2 bg-white dark:bg-gray-800 border-2 border-black rounded-lg text-gray-900 dark:text-gray-100 focus:outline-none focus:border-amber-400 shadow-cartoon-md text-[16px]"
      />
      {description && (
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
          {description}
        </p>
      )}
    </div>
  );
}

function PercentField({
  label,
  value,
  onChange,
  description,
}: PercentFieldProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-sm font-medium text-gray-600 dark:text-gray-400">
          {label}
        </label>
        <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
          {Math.round(value * 100)}%
        </span>
      </div>
      <input
        type="range"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={0}
        max={1}
        step={0.05}
        className="w-full accent-amber-400"
      />
      {description && (
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
          {description}
        </p>
      )}
    </div>
  );
}

export default function RecommendationsSection({
  config,
  onConfigChange,
}: RecommendationsSectionProps) {
  const update = <K extends keyof PromotedAlbumSettings>(
    key: K,
    value: PromotedAlbumSettings[K]
  ) => {
    onConfigChange({ ...config, [key]: value });
  };

  const handleReset = () => {
    onConfigChange({ ...DEFAULT_PROMOTED_ALBUM });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Recommendations
        </h2>
        <button
          type="button"
          onClick={handleReset}
          className="px-3 py-1.5 text-xs font-bold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-2 border-black rounded-lg shadow-cartoon-sm hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
        >
          Reset to Defaults
        </button>
      </div>

      <NumberField
        label="Cache Duration (minutes)"
        value={config.cacheDurationMinutes}
        onChange={(v) => update("cacheDurationMinutes", v)}
        min={0}
        max={120}
        step={5}
        description="How long to cache a promoted album before picking a new one. Set to 0 to disable caching."
      />

      <NumberField
        label="Taste Profile Lifetime (minutes)"
        value={config.profileTtlMinutes}
        onChange={(v) => update("profileTtlMinutes", v)}
        min={0}
        max={10080}
        step={60}
        description="How long your derived taste profile (genre vector) is reused before the expensive Plex + Last.fm rebuild runs again. Longer is cheaper; shorter tracks taste changes faster."
      />

      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="background-regen-enabled"
          checked={config.backgroundRegenEnabled}
          onChange={(e) => update("backgroundRegenEnabled", e.target.checked)}
          className="h-4 w-4 rounded border-2 border-black"
        />
        <label
          htmlFor="background-regen-enabled"
          className="text-sm font-medium text-gray-900 dark:text-gray-100"
        >
          Keep taste profiles warm in the background
        </label>
      </div>
      <p className="text-gray-400 dark:text-gray-500 text-xs -mt-2">
        Periodically rebuilds stale profiles for recently-active users so no
        request waits on the rate-limited rebuild. Single-instance only.
      </p>

      {config.backgroundRegenEnabled && (
        <>
          <NumberField
            label="Background Refresh Interval (minutes)"
            value={config.backgroundRegenIntervalMinutes}
            onChange={(v) => update("backgroundRegenIntervalMinutes", v)}
            min={5}
            max={1440}
            step={5}
            description="How often the background refresh checks for stale profiles."
          />
          <NumberField
            label="Active User Window (minutes)"
            value={config.backgroundRegenActiveWithinMinutes}
            onChange={(v) => update("backgroundRegenActiveWithinMinutes", v)}
            min={60}
            max={43200}
            step={60}
            description="Only refresh profiles for users who viewed recommendations within this window, so dormant accounts don't burn Plex / Last.fm quota."
          />
        </>
      )}

      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="ratings-backup-enabled"
          checked={config.ratingsBackupEnabled}
          onChange={(e) => update("ratingsBackupEnabled", e.target.checked)}
          className="h-4 w-4 rounded border-2 border-black"
        />
        <label
          htmlFor="ratings-backup-enabled"
          className="text-sm font-medium text-gray-900 dark:text-gray-100"
        >
          Back up Plex ratings &amp; play counts daily
        </label>
      </div>
      <p className="text-gray-400 dark:text-gray-500 text-xs -mt-2">
        Once a day, tunearr records each user's Plex star ratings and per-artist
        play counts into its own database, so your taste data survives a Plex
        history clear, re-import, or server migration. Single-instance only.
      </p>

      <NumberField
        label="Play Trend Window (days)"
        value={config.playTrendWindowDays}
        onChange={(v) => update("playTrendWindowDays", v)}
        min={1}
        max={365}
        step={1}
        description="Recommendations weight artists by plays within this many recent days, diffed from tunearr's own daily snapshots. Until the snapshot history is this deep, all-time play counts are used."
      />
      <NumberField
        label="Rating Weight"
        value={config.ratingWeight}
        onChange={(v) => update("ratingWeight", v)}
        min={0}
        max={3}
        step={0.1}
        description="How much your Plex star ratings boost an artist's weight: ×(1 + weight × stars/5). 0 ignores ratings; 0.5 gives a 5-star artist +50% weight."
      />
      <NumberField
        label="Listening Time vs Plays"
        value={config.listeningWeight}
        onChange={(v) => update("listeningWeight", v)}
        min={0}
        max={1}
        step={0.05}
        description="What counts as listening to an artist more. 1 ranks by time spent, so an hour-long DJ set outweighs a three-minute single played once. 0 ranks by play count, so twenty plays of one short track outweigh one long set. Plays measure how often you chose it again; time measures how much of your listening it filled."
      />
      <NumberField
        label="Maximum Minutes per Play"
        value={config.maxTrackMinutesForWeight}
        onChange={(v) => update("maxTrackMinutesForWeight", v)}
        min={0}
        max={240}
        step={5}
        description="Ceiling on how much listening time a single play can be worth. 0 is uncapped and is usually right — a low cap re-creates the under-counting of long tracks this is meant to fix. Raise it off 0 only if skipping through long mixes is inflating an artist."
      />
      <NumberField
        label="One-Hit Discount"
        value={config.distributionWeight}
        onChange={(v) => update("distributionWeight", v)}
        min={0}
        max={1}
        step={0.05}
        description="How much to discount an artist whose plays all sit on one track, so a single song on repeat doesn't count as liking the whole artist. 0 ignores how plays are spread; 0.5 halves the weight of an artist you only play one track by."
      />
      <NumberField
        label="Minimum Plays for the Discount"
        value={config.minPlaysForDistribution}
        onChange={(v) => update("minPlaysForDistribution", v)}
        min={1}
        max={100}
        step={1}
        description="Artists below this many plays in the trend window keep their full weight — at a handful of plays, how they're spread is noise rather than a preference."
      />
      <NumberField
        label="Small Catalogue Exemption"
        value={config.minAvailableTracksForDistribution}
        onChange={(v) => update("minAvailableTracksForDistribution", v)}
        min={0}
        max={50}
        step={1}
        description="Artists with this many tracks or fewer in your library keep their full weight — playing one of their two tracks isn't a one-hit habit, there was nothing else to play. 0 turns the exemption off."
      />

      <NumberField
        label="Listening Series Bucket (days)"
        value={config.seriesBucketDays}
        onChange={(v) => update("seriesBucketDays", v)}
        min={1}
        max={31}
        step={1}
        description="How wide one point on an artist's listening-over-time series is. 7 smooths day-to-day noise into a weekly rhythm; 1 shows every day but makes a quiet week look like a collapse."
      />
      <NumberField
        label="Listening Series Span (days)"
        value={config.seriesSpanDays}
        onChange={(v) => update("seriesSpanDays", v)}
        min={7}
        max={730}
        step={7}
        description="How far back that series runs. It can only show listening tunearr has a record of, so a span longer than your Plex history simply starts empty rather than being wrong."
      />
      <NumberField
        label="Momentum Window (buckets)"
        value={config.momentumRecentBuckets}
        onChange={(v) => update("momentumRecentBuckets", v)}
        min={1}
        max={26}
        step={1}
        description="How many recent buckets count as 'now' when deciding an artist is rising or fading. Each artist is compared against its own earlier buckets, so a small artist doubling registers as strongly as a big one. Fewer buckets reacts faster and mistakes a busy week for a trend."
      />

      <NumberField
        label="Top Artists Count"
        value={config.topArtistsCount}
        onChange={(v) => update("topArtistsCount", v)}
        min={1}
        max={50}
        description="How many of your most-played artists the profile covers. Tags are fetched for all of them, and every recommendation draws from the whole set."
      />

      <NumberField
        label="Artists per Recommendation"
        value={config.pickedArtistsCount}
        onChange={(v) => update("pickedArtistsCount", v)}
        min={1}
        max={config.topArtistsCount}
        description="How many artists shape a single recommendation, drawn fresh each time and weighted by play count. Lower is more focused per recommendation; higher blends more of your taste into each one."
      />

      <NumberField
        label="Tags per Artist"
        value={config.tagsPerArtist}
        onChange={(v) => update("tagsPerArtist", v)}
        min={1}
        max={20}
        description="Maximum number of tags to use per artist after filtering generic tags."
      />

      <NumberField
        label="Album Tag Lookups per Artist"
        value={config.albumTagsPerArtist}
        onChange={(v) => update("albumTagsPerArtist", v)}
        min={0}
        max={20}
        description="Genre is read from the album rather than the artist, so an acoustic or live record stops dragging a whole artist into the wrong tag. This is how many of each artist's albums get the richer Last.fm tags, most-listened first; the rest use the genres Plex already has. Set to 0 to use Plex genres only."
      />

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Deep Page Min"
          value={config.deepPageMin}
          onChange={(v) => {
            const updated = { ...config, deepPageMin: v };
            if (v > config.deepPageMax) updated.deepPageMax = v;
            onConfigChange(updated);
          }}
          min={1}
          max={50}
        />
        <NumberField
          label="Deep Page Max"
          value={config.deepPageMax}
          onChange={(v) => {
            const updated = { ...config, deepPageMax: v };
            if (v < config.deepPageMin) updated.deepPageMin = v;
            onConfigChange(updated);
          }}
          min={1}
          max={50}
        />
      </div>
      <p className="text-gray-400 dark:text-gray-500 text-xs -mt-2">
        Range of Last.fm tag album pages to sample from for variety.
      </p>

      <div>
        <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
          Library Preference
        </label>
        <div className="flex rounded-lg border-2 border-black overflow-hidden shadow-cartoon-sm">
          {LIBRARY_PREFERENCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => update("libraryPreference", opt.value)}
              className={`flex-1 px-3 py-2 text-sm font-bold transition-colors ${
                config.libraryPreference === opt.value
                  ? "bg-amber-300 text-black"
                  : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-amber-50 dark:hover:bg-gray-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
          Whether to prefer albums from new artists, artists already in your
          library, or no preference.
        </p>
      </div>

      <div className="pt-2 border-t-2 border-dashed border-gray-200 dark:border-gray-700 space-y-4">
        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300">
          Exploration
        </h3>

        <PercentField
          label="Exploration mix"
          value={config.explorationRate}
          onChange={(v) => update("explorationRate", v)}
          description="What share of each set of recommendations breaks out of your usual genres (similar vibe, different genre) rather than staying next to what you already play. 40% of five recommendations means two genre jumps every time, not a coin flip per album. 0% never explores; 100% always tries."
        />

        <PercentField
          label="Genre difference threshold"
          value={config.genreOverlapThreshold}
          onChange={(v) => update("genreOverlapThreshold", v)}
          description="Where the line between the two bands falls: a similar artist sharing less genre overlap than this counts as a genre jump, and one sharing more is treated as next to your taste. Nothing is discarded either way — lower means the jumps land further out."
        />

        <NumberField
          label="Candidates considered"
          value={config.exploreCandidateCount}
          onChange={(v) => update("exploreCandidateCount", v)}
          min={1}
          max={50}
          description="How many similar artists to evaluate per exploration before picking the most genre-distant one."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
          Generic Tags (filtered out)
        </label>
        <TagListEditor
          tags={config.genericTags}
          onTagsChange={(tags) => update("genericTags", tags)}
        />
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
          Tags that are too generic to be useful for recommendations. These are
          filtered out during tag analysis.
        </p>
      </div>
    </div>
  );
}
