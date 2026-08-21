import express, { Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createLogger } from "../../logger";
import { getConfigValue } from "../../config";
import { requirePermission } from "../../middleware/requirePermission";
import { Permission } from "../../../shared/permissions";
import type { LidarrManualImportItem } from "../../api/lidarr/types";
import {
  ALLOWED_EXTENSIONS,
  scanUploadedFiles,
  confirmImport,
  findImportProblems,
} from "../../services/lidarr/import";

const log = createLogger("Import");

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      __uploadId?: string;
      __uploadDir?: string;
    }
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      const importPath = getConfigValue("importPath");
      if (!importPath) {
        return cb(new Error("importPath not configured"), "");
      }

      const uploadId = _req.__uploadId || crypto.randomUUID();
      const uploadDir = path.join(importPath, uploadId);
      fs.mkdirSync(uploadDir, { recursive: true });

      _req.__uploadId = uploadId;
      _req.__uploadDir = uploadDir;

      cb(null, uploadDir);
    } catch (err) {
      cb(err instanceof Error ? err : new Error("Unknown error"), "");
    }
  },
  filename: (_req, file, cb) => {
    cb(null, file.originalname);
  },
});

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXTENSIONS.includes(ext)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `File type ${ext} not allowed. Accepted: ${ALLOWED_EXTENSIONS.join(", ")}`
      )
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 },
});

const singleFileStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      const importPath = getConfigValue("importPath");
      if (!importPath) {
        return cb(new Error("importPath not configured"), "");
      }

      const uploadId =
        _req.body?.uploadId || _req.__uploadId || crypto.randomUUID();
      const uploadDir = path.join(importPath, uploadId);
      fs.mkdirSync(uploadDir, { recursive: true });

      _req.__uploadId = uploadId;
      _req.__uploadDir = uploadDir;

      cb(null, uploadDir);
    } catch (err) {
      cb(err instanceof Error ? err : new Error("Unknown error"), "");
    }
  },
  filename: (_req, file, cb) => {
    cb(null, file.originalname);
  },
});

const singleUpload = multer({
  storage: singleFileStorage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 },
});

const router = express.Router();
const requireImport = requirePermission(Permission.IMPORT);

const requireImportPath = (_req: Request, res: Response, next: () => void) => {
  const importPath = getConfigValue("importPath");
  if (!importPath) {
    return res.status(400).json({
      error: "Import path not configured. Please set it in Settings.",
    });
  }
  if (!fs.existsSync(importPath)) {
    return res.status(400).json({
      error: `Import path "${importPath}" does not exist. Make sure the directory is created or the volume is mounted.`,
    });
  }
  next();
};

/** Guards against an uploadId escaping the import path via `..` segments. */
const resolveUploadDir = (
  importPath: string,
  uploadId: string
): string | null => {
  const uploadDir = path.join(importPath, uploadId);
  return path.resolve(uploadDir).startsWith(path.resolve(importPath))
    ? uploadDir
    : null;
};

/**
 * Removes the upload directory once Lidarr has moved the files out. Audio files
 * still sitting there are ones Lidarr did not take, so the directory stays and
 * the upload is not lost.
 */
const cleanupUploadDir = (uploadId: string) => {
  const importPath = getConfigValue("importPath");
  if (!importPath) {
    return;
  }

  const uploadDir = resolveUploadDir(importPath, uploadId);
  if (!uploadDir || !fs.existsSync(uploadDir)) {
    return;
  }

  const leftovers = fs
    .readdirSync(uploadDir)
    .filter((name) =>
      ALLOWED_EXTENSIONS.includes(path.extname(name).toLowerCase())
    );

  if (leftovers.length) {
    log.warn("Leaving upload directory in place, audio files remain", {
      uploadDir,
      leftovers,
    });
    return;
  }

  fs.rmSync(uploadDir, { recursive: true });
};

router.post(
  "/import/upload",
  requireImport,
  requireImportPath,
  upload.array("files"),
  async (req: Request, res: Response) => {
    const { albumMbid } = req.body;
    if (!albumMbid) {
      return res.status(400).json({ error: "albumMbid is required" });
    }

    const uploadId = req.__uploadId;
    const uploadDir = req.__uploadDir;

    if (!uploadId || !uploadDir) {
      return res.status(500).json({ error: "Upload failed" });
    }

    const result = await scanUploadedFiles(albumMbid, uploadDir);

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    for (const item of result.items) {
      log.info("upload scan item", {
        path: item.path,
        name: item.name,
        albumReleaseId: item.albumReleaseId,
        trackCount: item.tracks?.length ?? 0,
        trackIds: item.tracks?.map((t) => t.id) ?? [],
        rejectionCount: item.rejections?.length ?? 0,
        rejections: item.rejections?.map((r) => r.reason) ?? [],
      });
    }

    res.json({
      uploadId,
      artistId: result.artistId,
      albumId: result.albumId,
      items: result.items,
    });
  }
);

router.post(
  "/import/upload-file",
  requireImport,
  requireImportPath,
  singleUpload.single("file"),
  async (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  }
);

router.post(
  "/import/scan",
  requireImport,
  requireImportPath,
  async (req: Request, res: Response) => {
    const { uploadId, albumMbid } = req.body;
    if (!uploadId || !albumMbid) {
      return res
        .status(400)
        .json({ error: "uploadId and albumMbid are required" });
    }

    const importPath = getConfigValue("importPath")!;
    const uploadDir = resolveUploadDir(importPath, uploadId);

    if (!uploadDir) {
      return res.status(400).json({ error: "Invalid uploadId" });
    }

    if (!fs.existsSync(uploadDir)) {
      return res.status(404).json({ error: "Upload directory not found" });
    }

    const result = await scanUploadedFiles(albumMbid, uploadDir);

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    for (const item of result.items) {
      log.info("scan item", {
        path: item.path,
        name: item.name,
        rejectionCount: item.rejections?.length ?? 0,
        rejections: item.rejections?.map((r) => r.reason) ?? [],
      });
    }

    res.json({
      uploadId,
      artistId: result.artistId,
      albumId: result.albumId,
      items: result.items,
    });
  }
);

router.post(
  "/import/confirm",
  requireImport,
  async (req: Request, res: Response) => {
    const {
      items,
      uploadId,
    }: { items: LidarrManualImportItem[]; uploadId?: string } = req.body;
    if (!items?.length) {
      return res.status(400).json({ error: "items array is required" });
    }

    const problems = findImportProblems(items);
    if (problems.length) {
      log.warn("Refusing manual import, Lidarr could not match every file", {
        problems,
      });
      return res.status(400).json({
        error:
          "Lidarr could not match every file to a track. Check the file tags and try again.",
        files: problems,
      });
    }

    const result = await confirmImport(items);

    log.info("Manual import outcome", result);

    if (!result.ok) {
      return res.status(502).json({ error: result.error });
    }

    if (!result.pending && uploadId) {
      cleanupUploadDir(uploadId);
    }

    res.json({ status: "success", pending: result.pending });
  }
);

router.delete(
  "/import/:uploadId",
  requireImport,
  async (req: Request<{ uploadId: string }>, res: Response) => {
    const importPath = getConfigValue("importPath");
    if (!importPath) {
      return res.status(400).json({ error: "importPath not configured" });
    }

    const uploadDir = resolveUploadDir(importPath, req.params.uploadId);

    if (!uploadDir) {
      return res.status(400).json({ error: "Invalid uploadId" });
    }

    if (fs.existsSync(uploadDir)) {
      fs.rmSync(uploadDir, { recursive: true });
    }

    res.json({ status: "cleaned" });
  }
);

export default router;
