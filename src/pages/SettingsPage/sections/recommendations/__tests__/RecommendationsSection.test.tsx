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
});
