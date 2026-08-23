import { render, screen, fireEvent } from "@testing-library/react";
import RecommendationsSection from "../RecommendationsSection";
import { DEFAULT_PROMOTED_ALBUM } from "@/context/promotedAlbumDefaults";

describe("RecommendationsSection — ratings backup toggle", () => {
  it("reflects ratingsBackupEnabled and toggles it off", () => {
    const onChange = vi.fn();
    render(
      <RecommendationsSection
        config={DEFAULT_PROMOTED_ALBUM}
        onConfigChange={onChange}
      />
    );

    const checkbox = screen.getByLabelText(/Back up Plex ratings/i);
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_PROMOTED_ALBUM,
      ratingsBackupEnabled: false,
    });
  });

  it("edits the play trend window and rating weight", () => {
    const onChange = vi.fn();
    render(
      <RecommendationsSection
        config={DEFAULT_PROMOTED_ALBUM}
        onConfigChange={onChange}
      />
    );

    fireEvent.change(screen.getByLabelText(/Play Trend Window/i), {
      target: { value: "30" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_PROMOTED_ALBUM,
      playTrendWindowDays: 30,
    });

    fireEvent.change(screen.getByLabelText(/Rating Weight/i), {
      target: { value: "1" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_PROMOTED_ALBUM,
      ratingWeight: 1,
    });
  });

  it("edits the one-hit discount and its minimum play count", () => {
    const onChange = vi.fn();
    render(
      <RecommendationsSection
        config={DEFAULT_PROMOTED_ALBUM}
        onConfigChange={onChange}
      />
    );

    fireEvent.change(screen.getByLabelText(/One-Hit Discount/i), {
      target: { value: "0.25" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_PROMOTED_ALBUM,
      distributionWeight: 0.25,
    });

    fireEvent.change(screen.getByLabelText(/Minimum Plays for the Discount/i), {
      target: { value: "12" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_PROMOTED_ALBUM,
      minPlaysForDistribution: 12,
    });
  });

  it("edits how much listening time counts against play count", () => {
    const onChange = vi.fn();
    render(
      <RecommendationsSection
        config={DEFAULT_PROMOTED_ALBUM}
        onConfigChange={onChange}
      />
    );

    fireEvent.change(screen.getByLabelText(/Listening Time vs Plays/i), {
      target: { value: "0.5" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_PROMOTED_ALBUM,
      listeningWeight: 0.5,
    });
  });

  it("edits the per-play ceiling on listening time", () => {
    const onChange = vi.fn();
    render(
      <RecommendationsSection
        config={DEFAULT_PROMOTED_ALBUM}
        onConfigChange={onChange}
      />
    );

    fireEvent.change(screen.getByLabelText(/Maximum Minutes per Play/i), {
      target: { value: "20" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_PROMOTED_ALBUM,
      maxTrackMinutesForWeight: 20,
    });
  });

  it("edits the listening-series bucket width and span", () => {
    const onChange = vi.fn();
    render(
      <RecommendationsSection
        config={DEFAULT_PROMOTED_ALBUM}
        onConfigChange={onChange}
      />
    );

    fireEvent.change(screen.getByLabelText(/Listening Series Bucket/i), {
      target: { value: "1" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_PROMOTED_ALBUM,
      seriesBucketDays: 1,
    });

    fireEvent.change(screen.getByLabelText(/Listening Series Span/i), {
      target: { value: "364" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_PROMOTED_ALBUM,
      seriesSpanDays: 364,
    });
  });

  it("edits the momentum window", () => {
    const onChange = vi.fn();
    render(
      <RecommendationsSection
        config={DEFAULT_PROMOTED_ALBUM}
        onConfigChange={onChange}
      />
    );

    fireEvent.change(screen.getByLabelText(/Momentum Window/i), {
      target: { value: "8" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_PROMOTED_ALBUM,
      momentumRecentBuckets: 8,
    });
  });

  it("edits the small-catalogue exemption", () => {
    const onChange = vi.fn();
    render(
      <RecommendationsSection
        config={DEFAULT_PROMOTED_ALBUM}
        onConfigChange={onChange}
      />
    );

    fireEvent.change(screen.getByLabelText(/Small Catalogue Exemption/i), {
      target: { value: "5" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_PROMOTED_ALBUM,
      minAvailableTracksForDistribution: 5,
    });
  });
});
