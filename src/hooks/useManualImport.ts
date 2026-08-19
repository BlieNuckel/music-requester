import { useState, useCallback } from "react";

/** Mirrors the server's trimmed manual-import item — Lidarr omits fields for
 *  files it could not match. */
export type ManualImportItem = {
  path: string;
  name?: string;
  quality?: { quality: { name: string } };
  rejections?: { reason: string }[];
  tracks?: { id: number; title: string; trackNumber: string }[];
  albumReleaseId?: number;
  indexerFlags?: number;
  downloadId?: string;
  disableReleaseSwitching?: boolean;
  artist?: { id: number };
  album?: { id: number };
};

type ImportStep =
  "idle" | "uploading" | "reviewing" | "importing" | "done" | "error";

type ImportState = {
  step: ImportStep;
  uploadId: string | null;
  artistId: number | null;
  albumId: number | null;
  items: ManualImportItem[];
  error: string | null;
};

/** Parse response as JSON, falling back to the raw text as the error message */
const parseResponse = async (res: Response) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text || `Server error (${res.status})`);
  }
};

export default function useManualImport() {
  const [state, setState] = useState<ImportState>({
    step: "idle",
    uploadId: null,
    artistId: null,
    albumId: null,
    items: [],
    error: null,
  });

  const upload = useCallback(async (files: FileList, albumMbid: string) => {
    setState((s) => ({ ...s, step: "uploading", error: null }));

    try {
      const formData = new FormData();
      formData.append("albumMbid", albumMbid);
      for (const file of files) {
        formData.append("files", file);
      }

      const res = await fetch("/api/lidarr/import/upload", {
        method: "POST",
        body: formData,
      });

      const data = await parseResponse(res);
      if (!res.ok) throw new Error(data.error || "Upload failed");

      setState({
        step: "reviewing",
        uploadId: data.uploadId,
        artistId: data.artistId,
        albumId: data.albumId,
        items: data.items,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        step: "error",
        error: err instanceof Error ? err.message : "Upload failed",
      }));
    }
  }, []);

  const confirm = useCallback(async (items: ManualImportItem[]) => {
    setState((s) => ({ ...s, step: "importing", error: null }));

    try {
      const res = await fetch("/api/lidarr/import/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      const data = await parseResponse(res);
      if (!res.ok) throw new Error(data.error || "Import failed");

      setState((s) => ({ ...s, step: "done" }));
    } catch (err) {
      setState((s) => ({
        ...s,
        step: "error",
        error: err instanceof Error ? err.message : "Import failed",
      }));
    }
  }, []);

  const cancel = useCallback(async () => {
    const uploadId = state.uploadId;
    if (uploadId) {
      await fetch(`/api/lidarr/import/${uploadId}`, { method: "DELETE" }).catch(
        () => {}
      );
    }
    setState({
      step: "idle",
      uploadId: null,
      artistId: null,
      albumId: null,
      items: [],
      error: null,
    });
  }, [state.uploadId]);

  const reset = useCallback(() => {
    setState({
      step: "idle",
      uploadId: null,
      artistId: null,
      albumId: null,
      items: [],
      error: null,
    });
  }, []);

  return { ...state, upload, confirm, cancel, reset };
}
