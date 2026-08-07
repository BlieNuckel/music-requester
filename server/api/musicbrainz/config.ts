import { resilientFetch } from "../resilientFetch";
import { isRetryableError, isRetryableStatus, retryAfterMs } from "../retry";
import {
  acquireMbSlot,
  reportMbSuccess,
  reportMbThrottled,
  type MbPriority,
} from "./queue";

export const MB_BASE = "https://musicbrainz.org/ws/2";

export const MB_HEADERS = {
  "User-Agent": "Tunearr/0.1.0 (github.com/tunearr)",
  Accept: "application/json",
};

const MB_RETRIES = 2;

/** Statuses that mean "we are shedding your load", as opposed to a one-off fault. */
const THROTTLE_STATUSES = new Set([429, 503]);

/**
 * 404 means the entity doesn't exist and 400 means the MBID can never resolve —
 * both are real answers worth caching. Everything else (429, 5xx) is a statement
 * about MusicBrainz, not about the entity, so it throws rather than being cached
 * as a miss for the next month.
 */
const NOT_FOUND_STATUSES = new Set([400, 404]);

function retryAfterSeconds(response: Response): number | undefined {
  const ms = retryAfterMs(response);
  return ms === undefined ? undefined : ms / 1000;
}

/**
 * Fetch from MusicBrainz through the shared request queue. Every MusicBrainz
 * call must go through here — the queue is the only thing holding us to 1 req/s,
 * so a single call that bypasses it turns a paced stream back into a burst.
 *
 * Each attempt takes its own slot, so a retry is paced like any other request
 * rather than firing straight back at a service that just refused us. Retries
 * are handled here instead of inside `resilientFetch` for exactly that reason.
 */
export async function mbFetch(
  url: string,
  priority: MbPriority = "interactive"
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MB_RETRIES; attempt += 1) {
    await acquireMbSlot(priority);

    try {
      const response = await resilientFetch(
        url,
        { headers: MB_HEADERS },
        { retry: false }
      );

      if (THROTTLE_STATUSES.has(response.status)) {
        reportMbThrottled(retryAfterSeconds(response));
      } else {
        reportMbSuccess();
      }

      if (attempt === MB_RETRIES || !isRetryableStatus(response.status)) {
        return response;
      }
    } catch (error) {
      lastError = error;

      if (attempt === MB_RETRIES || !isRetryableError(error)) {
        throw error;
      }
    }
  }

  throw lastError;
}

/** Fetch and parse a MusicBrainz JSON document. Returns null when it doesn't exist. */
export async function mbJson<T>(
  url: string,
  priority: MbPriority = "interactive"
): Promise<T | null> {
  const response = await mbFetch(url, priority);

  if (NOT_FOUND_STATUSES.has(response.status)) return null;
  if (!response.ok) {
    throw new Error(`MusicBrainz returned ${response.status}`);
  }

  return (await response.json()) as T;
}
