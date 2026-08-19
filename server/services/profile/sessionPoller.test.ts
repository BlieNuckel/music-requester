import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetConfigValue = vi.fn();
const mockGetActiveSessions = vi.fn();

vi.mock("../../config", () => ({
  getConfigValue: (...args: unknown[]) => mockGetConfigValue(...args),
}));
vi.mock("../../api/plex/sessions", () => ({
  getActiveSessions: (...args: unknown[]) => mockGetActiveSessions(...args),
}));

import { runListenSessionPollOnce } from "./sessionPoller";
import { resetWatches } from "./listenSessions";
import { initializeDatabase, closeDatabase, getDataSource } from "../../db";
import { getSignalEvents } from "../../db/userProfile";

const T0 = 1_770_000_000_000;

async function createUser(
  username: string,
  plexToken: string | null,
  enabled = 1
): Promise<void> {
  await getDataSource().query(
    "INSERT INTO users (username, plex_token, enabled) VALUES (?, ?, ?)",
    [username, plexToken, enabled]
  );
}

function session(viewOffsetMs: number) {
  return {
    sessionKey: "12",
    ratingKey: "451",
    title: "Antwerp Expo",
    artistKey: "art1",
    artistName: "Andromedik",
    albumKey: "alb1",
    albumTitle: "Live Sets",
    durationMs: 5_448_000,
    viewOffsetMs,
    machineIdentifier: "device-1",
    product: "Plexamp",
    state: "playing",
  };
}

async function storedEpisodes(userId: number) {
  const events = await getSignalEvents(userId, "plex_listen_sessions");
  return events.flatMap((event) => JSON.parse(event.payload).episodes);
}

beforeEach(async () => {
  await initializeDatabase(":memory:");
  resetWatches();
  mockGetConfigValue.mockReturnValue({ ratingsBackupEnabled: true });
});
afterEach(async () => {
  vi.clearAllMocks();
  await closeDatabase();
});

describe("runListenSessionPollOnce", () => {
  it("records what a client heard once its session goes away", async () => {
    await createUser("alice", "tok-a");
    mockGetActiveSessions.mockResolvedValueOnce([session(0)]);
    await runListenSessionPollOnce(T0);
    mockGetActiveSessions.mockResolvedValueOnce([session(60_000)]);
    await runListenSessionPollOnce(T0 + 60_000);
    mockGetActiveSessions.mockResolvedValueOnce([]);

    expect(await runListenSessionPollOnce(T0 + 70_000)).toBe(1);

    const [episode] = await storedEpisodes(1);
    expect(episode).toMatchObject({
      ratingKey: "451",
      listenedMs: 60_000,
      measured: true,
    });
  });

  it("writes nothing while a session is still running", async () => {
    await createUser("alice", "tok-a");
    mockGetActiveSessions.mockResolvedValue([session(0)]);

    await runListenSessionPollOnce(T0);
    await runListenSessionPollOnce(T0 + 10_000);

    expect(await getSignalEvents(1, "plex_listen_sessions")).toHaveLength(0);
  });

  it("does nothing when the signal backup is disabled", async () => {
    mockGetConfigValue.mockReturnValue({ ratingsBackupEnabled: false });
    await createUser("alice", "tok-a");

    await runListenSessionPollOnce(T0);

    expect(mockGetActiveSessions).not.toHaveBeenCalled();
  });

  it("skips users with no token and disabled users", async () => {
    await createUser("local", null);
    await createUser("disabled", "tok-d", 0);

    await runListenSessionPollOnce(T0);

    expect(mockGetActiveSessions).not.toHaveBeenCalled();
  });

  it("keeps a window open when the read fails rather than committing it early", async () => {
    await createUser("alice", "tok-a");
    mockGetActiveSessions.mockResolvedValueOnce([session(0)]);
    await runListenSessionPollOnce(T0);
    mockGetActiveSessions.mockRejectedValueOnce(new Error("plex down"));

    await runListenSessionPollOnce(T0 + 60_000);

    expect(await getSignalEvents(1, "plex_listen_sessions")).toHaveLength(0);

    mockGetActiveSessions.mockResolvedValueOnce([session(120_000)]);
    await runListenSessionPollOnce(T0 + 120_000);
    mockGetActiveSessions.mockResolvedValueOnce([]);
    await runListenSessionPollOnce(T0 + 130_000);

    expect((await storedEpisodes(1))[0].listenedMs).toBe(120_000);
  });

  it("isolates one user's failure from the rest of the sweep", async () => {
    await createUser("broken", "tok-x");
    await createUser("alice", "tok-a");
    mockGetActiveSessions
      .mockRejectedValueOnce(new Error("plex down"))
      .mockResolvedValueOnce([session(0)]);
    await runListenSessionPollOnce(T0);

    mockGetActiveSessions
      .mockRejectedValueOnce(new Error("plex down"))
      .mockResolvedValueOnce([session(60_000)]);
    await runListenSessionPollOnce(T0 + 60_000);

    mockGetActiveSessions
      .mockRejectedValueOnce(new Error("plex down"))
      .mockResolvedValueOnce([]);
    expect(await runListenSessionPollOnce(T0 + 70_000)).toBe(1);
    expect(await storedEpisodes(2)).toHaveLength(1);
  });
});
