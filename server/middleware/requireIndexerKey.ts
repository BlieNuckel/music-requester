import { timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { getConfigValue } from "../config";

/**
 * Guards the two endpoints Lidarr talks to directly (`/api/torznab`, `/api/sabnzbd`),
 * which cannot use session cookies. Both are newznab/SABnzbd-shaped, so they
 * authenticate the way those protocols already do: an `apikey` request parameter.
 *
 * When `torznabApiKey` is unset the guard passes everything through, keeping existing
 * installs working after upgrade. Setting a key opts in to enforcement.
 */
export function requireIndexerKey(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const expected = getConfigValue("torznabApiKey");
  if (!expected) return next();

  const provided = readApiKey(req);
  if (provided !== null && matches(provided, expected)) return next();

  const err = new Error("Invalid or missing apikey") as Error & {
    status: number;
  };
  err.status = 401;
  next(err);
}

function readApiKey(req: Request): string | null {
  const fromQuery = req.query.apikey;
  if (typeof fromQuery === "string") return fromQuery;

  const fromBody = (req.body as Record<string, unknown> | undefined)?.apikey;
  if (typeof fromBody === "string") return fromBody;

  return null;
}

function matches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which is itself the answer.
  return a.length === b.length && timingSafeEqual(a, b);
}
