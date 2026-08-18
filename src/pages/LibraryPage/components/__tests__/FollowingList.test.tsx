import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FollowingList from "../FollowingList";
import { __resetFollowedArtistsForTests } from "@/hooks/useFollowedArtists";

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  __resetFollowedArtistsForTests();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockEndpoints(map: Record<string, unknown>) {
  vi.mocked(fetch).mockImplementation((input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const key = Object.keys(map).find((k) => url.includes(k));
    if (key) {
      return Promise.resolve(
        new Response(JSON.stringify(map[key]), { status: 200 })
      );
    }
    return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
  });
}

describe("FollowingList", () => {
  it("renders empty state for followed artists when none", async () => {
    mockEndpoints({
      "/api/followed/releases": [],
      "/api/followed": [],
    });

    renderWithRouter(<FollowingList />);

    expect(
      await screen.findByText(/aren't following any artists yet/i)
    ).toBeInTheDocument();
  });

  it("renders followed artists with last-checked label", async () => {
    mockEndpoints({
      "/api/followed/releases": [],
      "/api/followed": [
        {
          id: 1,
          artistMbid: "mbid-1",
          artistName: "Radiohead",
          lastCheckedAt: "2025-05-01T12:00:00.000Z",
          createdAt: "2025-04-01",
        },
      ],
    });

    renderWithRouter(<FollowingList />);
    expect(await screen.findByText("Radiohead")).toBeInTheDocument();
    expect(screen.getByText(/Last checked/i)).toBeInTheDocument();
  });

  it("flags an artist the live source has no listing for", async () => {
    mockEndpoints({
      "/api/followed/releases": [],
      "/api/followed": [
        {
          id: 1,
          artistMbid: "mbid-1",
          artistName: "Radiohead",
          lastCheckedAt: null,
          createdAt: "2025-04-01",
          liveTracking: "unavailable",
        },
      ],
    });

    renderWithRouter(<FollowingList />);
    expect(await screen.findByText("No live listings")).toBeInTheDocument();
  });

  it("leaves tracked and pending artists unmarked, so the flag means something", async () => {
    mockEndpoints({
      "/api/followed/releases": [],
      "/api/followed": [
        {
          id: 1,
          artistMbid: "mbid-1",
          artistName: "Radiohead",
          lastCheckedAt: null,
          createdAt: "2025-04-01",
          liveTracking: "tracked",
        },
        {
          id: 2,
          artistMbid: "mbid-2",
          artistName: "Boards of Canada",
          lastCheckedAt: null,
          createdAt: "2025-04-01",
          liveTracking: "pending",
        },
      ],
    });

    renderWithRouter(<FollowingList />);

    await screen.findByText("Radiohead");
    expect(screen.queryByText("No live listings")).not.toBeInTheDocument();
  });

  it("renders the seen-release feed when entries exist", async () => {
    mockEndpoints({
      "/api/followed/releases": [
        {
          id: 5,
          followedArtistId: 1,
          artistMbid: "mbid-1",
          artistName: "Radiohead",
          releaseKey: "k",
          source: "musicbrainz",
          albumTitle: "New EP",
          releaseDate: "2025-05-01",
          externalId: "rg-1",
          notifiedAt: "2025-05-02",
        },
      ],
      "/api/followed": [],
    });

    renderWithRouter(<FollowingList />);
    await waitFor(() => {
      expect(screen.getByText("New EP")).toBeInTheDocument();
    });
    expect(screen.getByText(/Radiohead/)).toBeInTheDocument();
  });

  it("renders a search link for each release", async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/followed/releases")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 5,
                followedArtistId: 1,
                artistMbid: "mbid-1",
                artistName: "Radiohead",
                releaseKey: "k",
                source: "musicbrainz",
                albumTitle: "New EP",
                releaseDate: "2025-05-01",
                externalId: "rg-1",
                notifiedAt: "2025-05-02",
              },
            ]),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    });

    renderWithRouter(<FollowingList />);

    const link = (await screen.findByRole("link", {
      name: /Search for New EP/i,
    })) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/search?q=Radiohead+New+EP");
  });

  it("shows release feed error message on failure", async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/api/followed/releases")) {
        return Promise.resolve(new Response("", { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    });

    renderWithRouter(<FollowingList />);
    expect(
      await screen.findByText(/Failed to load recent releases/i)
    ).toBeInTheDocument();
  });
});
