import express, { Request, Response } from "express";
import { lidarrGet } from "../../api/lidarr/get";
import { lidarrPost } from "../../api/lidarr/post";
import type {
  LidarrIndexerResource,
  LidarrDownloadClientResource,
  LidarrSchemaField,
} from "../../api/lidarr/types";
import { extractLidarrError } from "../../api/lidarr/types";
import { getConfigValue } from "../../config";

type SetupResult = { success: boolean; error?: string };

const TUNEARR_NAME = "Tunearr";

/** Lidarr rejects a blank apikey field, so an unsecured install still needs a placeholder. */
const PLACEHOLDER_API_KEY = "a";

function indexerApiKey(): string {
  return getConfigValue("torznabApiKey") || PLACEHOLDER_API_KEY;
}

function patchField(
  fields: LidarrSchemaField[],
  name: string,
  value: unknown
): LidarrSchemaField[] {
  return fields.map((f) => (f.name === name ? { ...f, value } : f));
}

async function createIndexer(
  host: string,
  port: number,
  schemas: LidarrIndexerResource[],
  downloadClientId: number
): Promise<SetupResult> {
  const newznab = schemas.find((s) => s.implementation === "Newznab");
  if (!newznab) {
    return { success: false, error: "Newznab schema not found in Lidarr" };
  }

  let fields = newznab.fields;
  fields = patchField(fields, "baseUrl", `http://${host}:${port}/api/torznab`);
  fields = patchField(fields, "apiPath", "");
  fields = patchField(fields, "apiKey", indexerApiKey());

  const result = await lidarrPost("/indexer", {
    ...newznab,
    name: TUNEARR_NAME,
    enableRss: true,
    enableAutomaticSearch: true,
    enableInteractiveSearch: true,
    downloadClientId,
    fields,
  });

  if (!result.ok) {
    return { success: false, error: extractLidarrError(result.data) };
  }
  return { success: true };
}

async function createDownloadClient(
  host: string,
  port: number,
  schemas: LidarrDownloadClientResource[]
): Promise<SetupResult> {
  const sabnzbd = schemas.find((s) => s.implementation === "Sabnzbd");
  if (!sabnzbd) {
    return { success: false, error: "Sabnzbd schema not found in Lidarr" };
  }

  let fields = sabnzbd.fields;
  fields = patchField(fields, "host", host);
  fields = patchField(fields, "port", port);
  fields = patchField(fields, "apiKey", indexerApiKey());
  fields = patchField(fields, "password", PLACEHOLDER_API_KEY);
  fields = patchField(fields, "urlBase", "/api/sabnzbd");

  const result = await lidarrPost("/downloadclient", {
    ...sabnzbd,
    name: TUNEARR_NAME,
    enable: true,
    fields,
  });

  if (!result.ok) {
    return { success: false, error: extractLidarrError(result.data) };
  }
  return { success: true };
}

const router = express.Router();

router.get("/auto-setup/status", async (_req: Request, res: Response) => {
  const [indexers, downloadClients] = await Promise.all([
    lidarrGet<LidarrIndexerResource[]>("/indexer"),
    lidarrGet<LidarrDownloadClientResource[]>("/downloadclient"),
  ]);

  const indexerExists = indexers.data.some((i) => i.name === TUNEARR_NAME);
  const downloadClientExists = downloadClients.data.some(
    (d) => d.name === TUNEARR_NAME
  );

  res.json({ indexerExists, downloadClientExists });
});

router.post("/auto-setup", async (req: Request, res: Response) => {
  const { host, port } = req.body;

  if (!host || port == null) {
    return res.status(400).json({ error: "host and port are required" });
  }

  const [indexerSchemas, downloadClientSchemas] = await Promise.all([
    lidarrGet<LidarrIndexerResource[]>("/indexer/schema"),
    lidarrGet<LidarrDownloadClientResource[]>("/downloadclient/schema"),
  ]);

  const downloadClient = await createDownloadClient(
    host,
    port,
    downloadClientSchemas.data
  ).catch((e): SetupResult => ({
    success: false,
    error: e instanceof Error ? e.message : String(e),
  }));

  let indexer: SetupResult;
  if (!downloadClient.success) {
    indexer = {
      success: false,
      error: "Skipped: download client must be created first",
    };
  } else {
    const clients =
      await lidarrGet<LidarrDownloadClientResource[]>("/downloadclient");
    const tunearrClient = clients.data.find((d) => d.name === TUNEARR_NAME);

    if (!tunearrClient) {
      indexer = {
        success: false,
        error: "Download client was created but could not be found",
      };
    } else {
      indexer = await createIndexer(
        host,
        port,
        indexerSchemas.data,
        tunearrClient.id
      ).catch((e): SetupResult => ({
        success: false,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }

  res.json({ indexer, downloadClient });
});

export default router;
