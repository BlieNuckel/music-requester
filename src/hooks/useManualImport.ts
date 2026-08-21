import { useState, useCallback } from "react";

/** Mirrors the server's trimmed manual-import item — Lidarr omits fields for
 *  files it could not match. */
export type ManualImportItem = {
  id?: number;
  path: string;
  name?: string;
  quality?: {
    quality: { id: number; name: string };
    revision?: { version?: number; real?: number; isRepack?: boolean };
  };
  rejections?: { reason: string }[];
  tracks?: { id: number; title: string; trackNumber: string }[];
  albumReleaseId?: number;
  releaseGroup?: string;
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

/** The confirm endpoint's error body: a message plus the files Lidarr could not
 *  match, if that is why it refused. */
export type ImportErrorBody = {
  error?: string;
  files?: { path: string; reason: string }[];
};

/** Flattens the per-file reasons onto the error message so the UI can show which
 *  file failed rather than just that something did. */
export const importErrorMessage = (data: ImportErrorBody): string => {
  const base = data.error || "Import failed";
  if (!data.files?.length) {
    return base;
  }

  const details = data.files
    .map((file) => `${file.path.split(/[/\\]/).pop()}: ${file.reason}`)
    .join("\n");

  return `${base}\n${details}`;
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

  const confirm = useCallback(
    async (items: ManualImportItem[]) => {
      setState((s) => ({ ...s, step: "importing", error: null }));

      try {
        const res = await fetch("/api/lidarr/import/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items, uploadId: state.uploadId }),
        });

        const data = await parseResponse(res);
        if (!res.ok) throw new Error(importErrorMessage(data));

        setState((s) => ({ ...s, step: "done" }));
      } catch (err) {
        setState((s) => ({
          ...s,
          step: "error",
          error: err instanceof Error ? err.message : "Import failed",
        }));
      }
    },
    [state.uploadId]
  );

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
