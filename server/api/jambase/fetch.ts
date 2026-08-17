import { resilientFetch } from "../resilientFetch";
import { createLogger } from "../../logger";
import { getJambaseConfig, JambaseError } from "./config";

export type CallRecorder = (info: {
  status: number | null;
  endpoint: string;
}) => void;

const log = createLogger("JamBase API");

const TIMEOUT_MS = 15000;

let recordCall: CallRecorder | null = null;
let preflightCheck: (() => Promise<void>) | null = null;

/**
 * Quota is counted here rather than in each caller, so a new call site cannot
 * forget to account for itself. Set by the quota service at boot.
 */
export function setCallRecorder(recorder: CallRecorder | null): void {
  recordCall = recorder;
}

/**
 * Runs before every request and may throw to stop it. The quota guard uses it,
 * because the API bills past the allowance rather than refusing, so nothing
 * upstream will ever say no on our behalf.
 */
export function setPreflightCheck(check: (() => Promise<void>) | null): void {
  preflightCheck = check;
}

function classify(status: number): JambaseError {
  if (status === 403) {
    return new JambaseError(
      "plan-gated",
      "JamBase rejected a parameter as unavailable on this plan",
      status
    );
  }
  if (status === 401) {
    return new JambaseError("unauthorized", "JamBase key rejected", status);
  }
  if (status === 404) {
    return new JambaseError("not-found", "JamBase has no such entity", status);
  }
  if (status === 429) {
    return new JambaseError("rate-limited", "JamBase rate limit hit", status);
  }
  return new JambaseError("transient", `JamBase returned ${status}`, status);
}

function buildQuery(
  params: Record<string, string | number | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

/**
 * One JamBase GET. Status is inspected before the body is touched, because a 403
 * plan-gate response is valid JSON and would otherwise be cached and read as
 * data. Retries are left to `resilientFetch`'s default (thrown errors only):
 * retrying a 4xx would burn quota to be told the same thing twice.
 */
export async function jambaseGet<T>(
  endpoint: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const { baseUrl, headers } = getJambaseConfig();
  if (preflightCheck) await preflightCheck();

  const url = `${baseUrl}${endpoint}${buildQuery(params)}`;

  let response: Response;
  try {
    response = await resilientFetch(
      url,
      { headers },
      { timeoutMs: TIMEOUT_MS }
    );
  } catch (error) {
    recordCall?.({ status: null, endpoint });
    log.error(`${endpoint} failed`, error);
    throw new JambaseError(
      "transient",
      `JamBase request failed: ${String(error)}`,
      null
    );
  }

  recordCall?.({ status: response.status, endpoint });

  if (!response.ok) {
    const error = classify(response.status);
    if (error.kind === "plan-gated" || error.kind === "unauthorized") {
      log.error(`${endpoint}: ${error.message}`);
    } else if (error.kind !== "not-found") {
      log.warn(`${endpoint}: ${error.message}`);
    }
    throw error;
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new JambaseError(
      "malformed",
      `JamBase returned a non-JSON body: ${String(error)}`,
      response.status
    );
  }
}
