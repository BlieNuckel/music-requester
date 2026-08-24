import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TasteProfilesSection from "../TasteProfilesSection";
import type { ProfileDebugEntry } from "@/types";

const mockFetch = vi.fn();

function entry(overrides: Partial<ProfileDebugEntry> = {}): ProfileDebugEntry {
  return {
    userId: 1,
    username: "lasse",
    hasPlexToken: true,
    profile: {
      generatedAt: "2026-08-18T10:00:00.000Z",
      lastUsedAt: "2026-08-18T11:00:00.000Z",
      schemaVersion: 6,
      currentSchemaVersion: 6,
      configHash: "abcdef123456789",
      currentConfigHash: "abcdef123456789",
      stale: false,
      counts: {
        genres: 12,
        artists: 40,
        taggedAlbums: 96,
        albumsWithOwnGenre: 71,
        genrelessAlbums: 4,
        similarSeeds: 3,
        similarCandidates: 36,
        knownAlbums: 210,
        exploredAlbums: 5,
        exploredArtists: 8,
      },
      topGenres: [{ tag: "shoegaze", weight: 120.4 }],
      topOtherTags: [
        { tag: "Nigeria", weight: 48.6, tagClass: "region" },
        { tag: "2024", weight: 12.2, tagClass: "era" },
      ],
      topArtists: [{ name: "Slowdive", viewCount: 90 }],
    },
    signals: [
      {
        kind: "plex_track_plays",
        count: 4,
        firstAt: "2026-08-01T10:00:00.000Z",
        lastAt: "2026-08-18T10:00:00.000Z",
      },
    ],
    recentSignals: [
      {
        kind: "plex_track_plays",
        recordedAt: "2026-08-18T10:00:00.000Z",
        changed: 0,
      },
    ],
    plex: {
      trackedTracks: 1200,
      totalPlays: 5400,
      artists: 180,
      ratedItems: 42,
      listenEpisodes: 4800,
      listenedHours: 310,
    },
    ...overrides,
  };
}

function respond(users: ProfileDebugEntry[]) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ users }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TasteProfilesSection", () => {
  it("shows what is stored from Plex per user", async () => {
    respond([entry()]);

    render(<TasteProfilesSection />);

    expect(await screen.findByText("lasse")).toBeInTheDocument();
    expect(screen.getByText("1200")).toBeInTheDocument();
    expect(screen.getByText("5400")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("shows how much listening the episode series holds", async () => {
    respond([entry()]);

    render(<TasteProfilesSection />);

    expect(await screen.findByText("Listen episodes")).toBeInTheDocument();
    expect(screen.getByText("4800")).toBeInTheDocument();
    expect(screen.getByText("Listened hours")).toBeInTheDocument();
    expect(screen.getByText("310")).toBeInTheDocument();
  });

  it("shows the derived profile counts", async () => {
    respond([entry()]);

    render(<TasteProfilesSection />);

    await screen.findByText("lasse");
    expect(screen.getByText("Known albums")).toBeInTheDocument();
    expect(screen.getByText("210")).toBeInTheDocument();
  });

  it("shows how many stored albums carry a genre of their own", async () => {
    respond([entry()]);

    render(<TasteProfilesSection />);

    await screen.findByText("lasse");
    expect(screen.getByText("Tagged albums")).toBeInTheDocument();
    expect(screen.getByText("96")).toBeInTheDocument();
    expect(screen.getByText("Own genre")).toBeInTheDocument();
    expect(screen.getByText("71")).toBeInTheDocument();
    expect(screen.getByText("No genre")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("says so when a user has no derived profile yet", async () => {
    respond([entry({ profile: null })]);

    render(<TasteProfilesSection />);

    expect(
      await screen.findByText(/No derived profile yet/)
    ).toBeInTheDocument();
  });

  it("marks a user with no Plex token", async () => {
    respond([entry({ hasPlexToken: false })]);

    render(<TasteProfilesSection />);

    expect(await screen.findByText("No Plex token")).toBeInTheDocument();
  });

  it("marks a stale profile, which is the thing worth spotting", async () => {
    respond([entry({ profile: { ...entry().profile!, stale: true } })]);

    render(<TasteProfilesSection />);

    expect(await screen.findByText("Stale")).toBeInTheDocument();
  });

  it("keeps genres, artists and signals behind a toggle", async () => {
    respond([entry()]);

    render(<TasteProfilesSection />);

    await screen.findByText("lasse");
    expect(screen.queryByText(/shoegaze/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show detail" }));

    expect(screen.getByText(/shoegaze/)).toBeInTheDocument();
    expect(screen.getByText(/Slowdive/)).toBeInTheDocument();
    expect(screen.getByText(/4 events/)).toBeInTheDocument();
  });

  it("shows what was recognised but kept out of the genre vector", async () => {
    respond([entry()]);

    render(<TasteProfilesSection />);

    await screen.findByText("lasse");
    await userEvent.click(screen.getByRole("button", { name: "Show detail" }));

    expect(screen.getByText("Recognised but not a genre")).toBeInTheDocument();
    expect(screen.getByText(/Nigeria · region/)).toBeInTheDocument();
    expect(screen.getByText(/2024 · era/)).toBeInTheDocument();
  });

  it("calls out a poll that recorded nothing", async () => {
    respond([entry()]);

    render(<TasteProfilesSection />);
    await screen.findByText("lasse");
    await userEvent.click(screen.getByRole("button", { name: "Show detail" }));

    expect(screen.getByText(/no items/)).toBeInTheDocument();
  });

  it("explains an empty signal log rather than showing a blank table", async () => {
    respond([entry({ signals: [], recentSignals: [] })]);

    render(<TasteProfilesSection />);
    await screen.findByText("lasse");
    await userEvent.click(screen.getByRole("button", { name: "Show detail" }));

    expect(screen.getByText(/No signals recorded yet/)).toBeInTheDocument();
  });

  it("surfaces a failed load", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    render(<TasteProfilesSection />);

    expect(
      await screen.findByText("Could not load taste profiles")
    ).toBeInTheDocument();
  });

  it("says when there are no users at all", async () => {
    respond([]);

    render(<TasteProfilesSection />);

    expect(await screen.findByText("No users yet.")).toBeInTheDocument();
  });

  it("refetches on refresh", async () => {
    respond([entry()]);

    render(<TasteProfilesSection />);
    await screen.findByText("lasse");

    await userEvent.click(
      screen.getByRole("button", { name: "Refresh taste profiles" })
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
