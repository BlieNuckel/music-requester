import { applyParamChange, effectiveMax } from "../paramCoupling";
import { DEFAULT_PROMOTED_ALBUM } from "@/context/promotedAlbumDefaults";
import type { ParamDef } from "@shared/recommenderGraph";

const pickedArtists: ParamDef = {
  key: "pickedArtistsCount",
  kind: "int",
  label: "Artists per recommendation",
  min: 1,
  max: 50,
  maxFrom: "topArtistsCount",
  description: "",
};

describe("effectiveMax", () => {
  it("takes the lower of the declared max and the bounding param", () => {
    expect(effectiveMax(pickedArtists, DEFAULT_PROMOTED_ALBUM)).toBe(
      DEFAULT_PROMOTED_ALBUM.topArtistsCount
    );
  });

  it("falls back to the declared max when nothing bounds it", () => {
    expect(
      effectiveMax(
        { ...pickedArtists, maxFrom: undefined },
        DEFAULT_PROMOTED_ALBUM
      )
    ).toBe(50);
  });
});

describe("applyParamChange", () => {
  it("sets the value it was given", () => {
    const next = applyParamChange(DEFAULT_PROMOTED_ALBUM, "ratingWeight", 1.5);

    expect(next.ratingWeight).toBe(1.5);
    expect(DEFAULT_PROMOTED_ALBUM.ratingWeight).not.toBe(1.5);
  });

  it("pushes the deep page maximum up when the minimum passes it", () => {
    const next = applyParamChange(DEFAULT_PROMOTED_ALBUM, "deepPageMin", 20);

    expect(next.deepPageMin).toBe(20);
    expect(next.deepPageMax).toBe(20);
  });

  it("pulls the deep page minimum down when the maximum drops below it", () => {
    const config = { ...DEFAULT_PROMOTED_ALBUM, deepPageMin: 8 };
    const next = applyParamChange(config, "deepPageMax", 3);

    expect(next.deepPageMax).toBe(3);
    expect(next.deepPageMin).toBe(3);
  });

  it("leaves the pair alone when the change keeps it valid", () => {
    const next = applyParamChange(DEFAULT_PROMOTED_ALBUM, "deepPageMin", 2);

    expect(next.deepPageMax).toBe(DEFAULT_PROMOTED_ALBUM.deepPageMax);
  });

  it("clamps artists per recommendation when the profile stops covering that many", () => {
    const config = { ...DEFAULT_PROMOTED_ALBUM, pickedArtistsCount: 8 };
    const next = applyParamChange(config, "topArtistsCount", 4);

    expect(next.pickedArtistsCount).toBe(4);
  });

  it("accepts a tag list", () => {
    const next = applyParamChange(DEFAULT_PROMOTED_ALBUM, "genericTags", [
      "live",
    ]);

    expect(next.genericTags).toEqual(["live"]);
  });
});
