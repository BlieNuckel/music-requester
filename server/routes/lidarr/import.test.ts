import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockExistsSync: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockMkdirSync: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockRmSync: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockReaddirSync: any;

const mockGetConfigValue = vi.fn();
const mockScanUploadedFiles = vi.fn();
const mockConfirmImport = vi.fn();
const mockFindImportProblems = vi.fn();

vi.mock("../../config", () => ({
  getConfigValue: (...args: unknown[]) => mockGetConfigValue(...args),
}));

vi.mock("../../services/lidarr/import", () => ({
  ALLOWED_EXTENSIONS: [".flac", ".mp3", ".ogg", ".wav", ".m4a", ".aac"],
  scanUploadedFiles: (...args: unknown[]) => mockScanUploadedFiles(...args),
  confirmImport: (...args: unknown[]) => mockConfirmImport(...args),
  findImportProblems: (...args: unknown[]) => mockFindImportProblems(...args),
}));

vi.mock("../../services/lidarr/helpers", () => ({
  getAlbumByMbid: vi.fn(),
  getOrAddArtist: vi.fn(),
  getOrAddAlbum: vi.fn(),
  waitForAlbumTracks: vi.fn(),
}));

const { recordedPermissions } = vi.hoisted(() => ({
  recordedPermissions: [] as unknown[],
}));

vi.mock("../../middleware/requirePermission", () => ({
  requirePermission: (required: unknown) => {
    recordedPermissions.push(required);
    return (_req: unknown, _res: unknown, next: () => void) => next();
  },
}));

vi.mock("fs", () => ({
  default: {
    existsSync: (p: string) => (mockExistsSync || vi.fn(() => true))(p),
    mkdirSync: (...args: unknown[]) => (mockMkdirSync || vi.fn())(...args),
    rmSync: (...args: unknown[]) => (mockRmSync || vi.fn())(...args),
    readdirSync: (...args: unknown[]) =>
      (mockReaddirSync || vi.fn(() => []))(...args),
  },
  existsSync: (p: string) => (mockExistsSync || vi.fn(() => true))(p),
  mkdirSync: (...args: unknown[]) => (mockMkdirSync || vi.fn())(...args),
  rmSync: (...args: unknown[]) => (mockRmSync || vi.fn())(...args),
  readdirSync: (...args: unknown[]) =>
    (mockReaddirSync || vi.fn(() => []))(...args),
}));

vi.mock("crypto", () => ({
  default: { randomUUID: () => "test-uuid-1234" },
  randomUUID: () => "test-uuid-1234",
}));

vi.mock("multer", () => {
  const makeMiddleware =
    () =>
    (
      req: {
        body: Record<string, unknown>;
        __uploadId: string;
        __uploadDir: string;
      },
      _res: unknown,
      next: () => void
    ) => {
      req.__uploadId = "test-uuid-1234";
      req.__uploadDir = "/imports/test-uuid-1234";
      next();
    };
  const multerMock = () => ({
    array: () => makeMiddleware(),
    single: () => makeMiddleware(),
  });
  multerMock.diskStorage = () => ({});
  return { default: multerMock };
});

import express from "express";
import request from "supertest";
import importRouter from "./import";
import { Permission } from "../../../shared/permissions";

const app = express();
app.use(express.json());
app.use("/", importRouter);
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    res.status(500).json({ error: err.message });
  }
);

beforeEach(() => {
  mockExistsSync = vi.fn(() => true);
  mockMkdirSync = vi.fn();
  mockRmSync = vi.fn();
  mockReaddirSync = vi.fn(() => []);
  vi.clearAllMocks();
  mockFindImportProblems.mockReturnValue([]);
});

describe("import route permissions", () => {
  it("guards endpoints with IMPORT permission, not ADMIN", () => {
    expect(recordedPermissions.length).toBeGreaterThan(0);
    expect(recordedPermissions).toContain(Permission.IMPORT);
    expect(recordedPermissions).not.toContain(Permission.ADMIN);
  });
});

describe("POST /import/upload", () => {
  it("returns 400 when import path is not configured", async () => {
    mockGetConfigValue.mockReturnValue("");

    const res = await request(app).post("/import/upload").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Import path not configured");
  });

  it("returns 400 when import path does not exist", async () => {
    mockGetConfigValue.mockReturnValue("/imports");
    mockExistsSync.mockReturnValue(false);

    const res = await request(app).post("/import/upload").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("does not exist");
  });

  it("returns 400 when albumMbid is missing", async () => {
    mockGetConfigValue.mockReturnValue("/imports");
    mockExistsSync.mockReturnValue(true);

    const res = await request(app).post("/import/upload").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("albumMbid is required");
  });

  it("returns 404 when album has no foreignArtistId", async () => {
    mockGetConfigValue.mockReturnValue("/imports");
    mockExistsSync.mockReturnValue(true);
    mockScanUploadedFiles.mockResolvedValue({
      ok: false,
      error: "Could not determine artist from album lookup",
      status: 404,
    });

    const res = await request(app)
      .post("/import/upload")
      .send({ albumMbid: "mbid-1" });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Could not determine artist");
  });

  it("returns 502 when Lidarr scan fails", async () => {
    mockGetConfigValue.mockReturnValue("/imports");
    mockExistsSync.mockReturnValue(true);
    mockScanUploadedFiles.mockResolvedValue({
      ok: false,
      error: "Lidarr manual import scan failed",
      status: 502,
    });

    const res = await request(app)
      .post("/import/upload")
      .send({ albumMbid: "mbid-1" });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("scan failed");
  });

  it("returns 400 when scan returns no items", async () => {
    mockGetConfigValue.mockReturnValue("/imports");
    mockExistsSync.mockReturnValue(true);
    mockScanUploadedFiles.mockResolvedValue({
      ok: false,
      error:
        "Lidarr found no importable files. Make sure the import path is accessible to Lidarr.",
      status: 400,
    });

    const res = await request(app)
      .post("/import/upload")
      .send({ albumMbid: "mbid-1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("no importable files");
  });

  it("returns upload info on success", async () => {
    mockGetConfigValue.mockReturnValue("/imports");
    mockExistsSync.mockReturnValue(true);
    const scanItems = [
      {
        path: "/imports/test-uuid-1234/song.flac",
        name: "song.flac",
        albumReleaseId: 5,
        tracks: [{ id: 1, title: "Track 1", trackNumber: "1" }],
        rejections: [],
      },
    ];
    mockScanUploadedFiles.mockResolvedValue({
      ok: true,
      artistId: 1,
      albumId: 10,
      items: scanItems,
    });

    const res = await request(app)
      .post("/import/upload")
      .send({ albumMbid: "mbid-1" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      uploadId: "test-uuid-1234",
      artistId: 1,
      albumId: 10,
      items: scanItems,
    });
  });
});

describe("POST /import/upload-file", () => {
  it("returns 400 when import path is not configured", async () => {
    mockGetConfigValue.mockReturnValue("");

    const res = await request(app).post("/import/upload-file").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Import path not configured");
  });

  it("returns ok on success", async () => {
    mockGetConfigValue.mockReturnValue("/imports");
    mockExistsSync.mockReturnValue(true);

    const res = await request(app).post("/import/upload-file").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST /import/scan", () => {
  it("returns 400 when uploadId or albumMbid missing", async () => {
    mockGetConfigValue.mockReturnValue("/imports");
    mockExistsSync.mockReturnValue(true);

    const res = await request(app).post("/import/scan").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("uploadId and albumMbid are required");
  });

  it("returns 404 when upload directory not found", async () => {
    mockGetConfigValue.mockReturnValue("/imports");
    mockExistsSync.mockImplementation((p: string) =>
      p === "/imports" ? true : false
    );

    const res = await request(app)
      .post("/import/scan")
      .send({ uploadId: "some-uuid", albumMbid: "mbid-1" });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Upload directory not found");
  });

  it("returns scan results on success", async () => {
    mockGetConfigValue.mockReturnValue("/imports");
    mockExistsSync.mockReturnValue(true);
    const scanItems = [
      {
        path: "/imports/some-uuid/song.flac",
        name: "song.flac",
        rejections: [{ reason: "bad quality" }],
      },
    ];
    mockScanUploadedFiles.mockResolvedValue({
      ok: true,
      artistId: 1,
      albumId: 10,
      items: scanItems,
    });

    const res = await request(app)
      .post("/import/scan")
      .send({ uploadId: "some-uuid", albumMbid: "mbid-1" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      uploadId: "some-uuid",
      artistId: 1,
      albumId: 10,
      items: scanItems,
    });
  });

  it("returns 400 for path traversal attempts", async () => {
    mockGetConfigValue.mockReturnValue("/imports");

    const res = await request(app)
      .post("/import/scan")
      .send({ uploadId: "../../etc", albumMbid: "mbid-1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid uploadId");
  });
});

const confirmItem = {
  path: "/imports/song.flac",
  artist: { id: 1 },
  album: { id: 10 },
  albumReleaseId: 5,
  tracks: [{ id: 1 }, { id: 2 }],
  quality: { quality: { id: 7, name: "FLAC" } },
};

describe("POST /import/confirm", () => {
  it("returns 400 when items is empty", async () => {
    const res = await request(app).post("/import/confirm").send({ items: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("items array is required");
  });

  it("returns 400 when items is missing", async () => {
    const res = await request(app).post("/import/confirm").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("items array is required");
  });

  it("returns 502 with Lidarr's reason when the import fails", async () => {
    mockConfirmImport.mockResolvedValue({ ok: false, error: "boom" });

    const res = await request(app)
      .post("/import/confirm")
      .send({ items: [confirmItem] });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("boom");
  });

  it("refuses to import files Lidarr could not match", async () => {
    mockFindImportProblems.mockReturnValue([
      {
        path: "/imports/mystery.flac",
        reason: "Lidarr could not determine: track match",
      },
    ]);

    const res = await request(app)
      .post("/import/confirm")
      .send({ items: [{ path: "/imports/mystery.flac" }] });

    expect(res.status).toBe(400);
    expect(res.body.files).toEqual([
      {
        path: "/imports/mystery.flac",
        reason: "Lidarr could not determine: track match",
      },
    ]);
    expect(mockConfirmImport).not.toHaveBeenCalled();
  });

  it("returns success when import succeeds", async () => {
    mockConfirmImport.mockResolvedValue({ ok: true, pending: false });

    const res = await request(app)
      .post("/import/confirm")
      .send({ items: [confirmItem] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "success", pending: false });
  });

  it("cleans up the upload directory once the import completed", async () => {
    mockGetConfigValue.mockReturnValue("/imports");
    mockConfirmImport.mockResolvedValue({ ok: true, pending: false });

    const res = await request(app)
      .post("/import/confirm")
      .send({ items: [confirmItem], uploadId: "album-123" });

    expect(res.status).toBe(200);
    expect(mockRmSync).toHaveBeenCalledWith(
      expect.stringContaining("album-123"),
      { recursive: true }
    );
  });

  it("keeps the upload directory when audio files were left behind", async () => {
    mockGetConfigValue.mockReturnValue("/imports");
    mockConfirmImport.mockResolvedValue({ ok: true, pending: false });
    mockReaddirSync.mockReturnValue(["skipped.flac"]);

    const res = await request(app)
      .post("/import/confirm")
      .send({ items: [confirmItem], uploadId: "album-123" });

    expect(res.status).toBe(200);
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it("keeps the upload directory while Lidarr is still importing", async () => {
    mockGetConfigValue.mockReturnValue("/imports");
    mockConfirmImport.mockResolvedValue({ ok: true, pending: true });

    const res = await request(app)
      .post("/import/confirm")
      .send({ items: [confirmItem], uploadId: "album-123" });

    expect(res.body).toEqual({ status: "success", pending: true });
    expect(mockRmSync).not.toHaveBeenCalled();
  });
});

describe("DELETE /import/:uploadId", () => {
  it("returns 400 when importPath is not configured", async () => {
    mockGetConfigValue.mockReturnValue("");

    const res = await request(app).delete("/import/test-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("importPath not configured");
  });

  it("returns 400 for path traversal attempts", async () => {
    mockGetConfigValue.mockReturnValue("/imports");

    const res = await request(app).delete("/import/..%2F..%2Fetc");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid uploadId");
  });

  it("removes directory when it exists", async () => {
    mockGetConfigValue.mockReturnValue("/imports");
    mockExistsSync.mockReturnValue(true);

    const res = await request(app).delete("/import/test-uuid");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "cleaned" });
    expect(mockRmSync).toHaveBeenCalledWith(
      expect.stringContaining("test-uuid"),
      { recursive: true }
    );
  });

  it("returns cleaned when directory does not exist", async () => {
    mockGetConfigValue.mockReturnValue("/imports");
    mockExistsSync.mockReturnValue(false);

    const res = await request(app).delete("/import/test-uuid");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "cleaned" });
    expect(mockRmSync).not.toHaveBeenCalled();
  });
});
