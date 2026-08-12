import {
  deriveAlbumLibraryInfo,
  albumLibraryLabel,
  albumLibraryTitle,
} from "@shared/albumLibrary";

describe("deriveAlbumLibraryInfo", () => {
  it("treats a monitored album with no files as requested", () => {
    expect(
      deriveAlbumLibraryInfo({ trackFileCount: 0, totalTrackCount: 7 })
    ).toEqual({ state: "requested", available: 0, total: 7 });
  });

  it("treats every track downloaded as complete", () => {
    expect(
      deriveAlbumLibraryInfo({ trackFileCount: 12, totalTrackCount: 12 })
    ).toEqual({ state: "complete", available: 12, total: 12 });
  });

  it("treats some tracks downloaded as partial", () => {
    expect(
      deriveAlbumLibraryInfo({ trackFileCount: 3, totalTrackCount: 7 })
    ).toEqual({ state: "partial", available: 3, total: 7 });
  });

  it("treats more files than expected tracks as complete", () => {
    expect(
      deriveAlbumLibraryInfo({ trackFileCount: 13, totalTrackCount: 12 })
    ).toEqual({ state: "complete", available: 13, total: 12 });
  });

  it("treats files with an unknown track total as complete", () => {
    expect(
      deriveAlbumLibraryInfo({ trackFileCount: 4, totalTrackCount: 0 })
    ).toEqual({ state: "complete", available: 4, total: 0 });
  });

  it("defaults to requested when statistics are missing", () => {
    expect(deriveAlbumLibraryInfo()).toEqual({
      state: "requested",
      available: 0,
      total: 0,
    });
    expect(deriveAlbumLibraryInfo(null)).toEqual({
      state: "requested",
      available: 0,
      total: 0,
    });
  });
});

describe("albumLibraryLabel", () => {
  it("names the complete state without counts", () => {
    expect(
      albumLibraryLabel({ state: "complete", available: 12, total: 12 })
    ).toBe("In library");
  });

  it("shows the track count for incomplete albums", () => {
    expect(
      albumLibraryLabel({ state: "partial", available: 3, total: 7 })
    ).toBe("3/7 tracks");
    expect(
      albumLibraryLabel({ state: "requested", available: 0, total: 7 })
    ).toBe("0/7 tracks");
  });

  it("falls back when the track total is unknown", () => {
    expect(
      albumLibraryLabel({ state: "requested", available: 0, total: 0 })
    ).toBe("Not downloaded");
  });
});

describe("albumLibraryTitle", () => {
  it("spells out each state", () => {
    expect(
      albumLibraryTitle({ state: "complete", available: 12, total: 12 })
    ).toBe("In library");
    expect(
      albumLibraryTitle({ state: "partial", available: 3, total: 7 })
    ).toBe("Partially downloaded — 3/7 tracks");
    expect(
      albumLibraryTitle({ state: "requested", available: 0, total: 7 })
    ).toBe("Requested, not downloaded");
  });
});
