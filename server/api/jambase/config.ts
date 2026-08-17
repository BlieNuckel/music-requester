import { getConfig } from "../../config";

export type JambaseRequestConfig = {
  baseUrl: string;
  headers: Record<string, string>;
};

/**
 * Why a JamBase call failed, because the caller has to treat these differently:
 * `not-found` is a legitimate answer about an entity, `plan-gated` is permanent
 * until someone pays, and only `transient` is worth trying again.
 */
export type JambaseErrorKind =
  | "not-found"
  | "plan-gated"
  | "unauthorized"
  | "rate-limited"
  | "quota-exceeded"
  | "transient"
  | "malformed";

/**
 * `https://api.data.jambase.com/v3`, not `data.jambase.com/v3`: the latter serves
 * the marketing site and answers 200 with HTML, so a wrong base fails as
 * unparseable JSON rather than a clean 404.
 */
const JAMBASE_BASE_URL = "https://api.data.jambase.com/v3";

export class JambaseError extends Error {
  kind: JambaseErrorKind;
  status: number | null;

  constructor(kind: JambaseErrorKind, message: string, status: number | null) {
    super(message);
    this.name = "JambaseError";
    this.kind = kind;
    this.status = status;
  }
}

/** Read lazily at request time so a settings change needs no restart. */
export function getJambaseConfig(): JambaseRequestConfig {
  const { liveEvents } = getConfig();

  if (!liveEvents.enabled) {
    throw new JambaseError("plan-gated", "Live events are disabled", null);
  }
  if (!liveEvents.apiKey) {
    throw new JambaseError(
      "unauthorized",
      "JamBase API key not configured",
      null
    );
  }

  return {
    baseUrl: JAMBASE_BASE_URL,
    headers: {
      Authorization: `Bearer ${liveEvents.apiKey}`,
      Accept: "application/json",
    },
  };
}

export function isLiveEventsConfigured(): boolean {
  const { liveEvents } = getConfig();
  return liveEvents.enabled && liveEvents.apiKey.length > 0;
}

export { JAMBASE_BASE_URL };
