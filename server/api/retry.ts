export interface RetryOptions<T = unknown> {
  retries?: number;
  baseDelayMs?: number;
  retryOn?: (error: unknown) => boolean;
  /** Retry a resolved value — `fetch` reports a 503 as a Response, not a throw. */
  retryOnResult?: (result: T) => boolean;
  /** Overrides the backoff for a retried result, e.g. to honor `Retry-After`. */
  delayForResult?: (result: T) => number | undefined;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/** `AbortSignal.timeout()` rejects with a DOMException rather than an Error. */
const RETRYABLE_ERROR_NAMES = new Set(["TimeoutError"]);

/** A server that asks us to wait an hour still shouldn't hold a request open that long. */
const MAX_RETRY_AFTER_MS = 30_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(baseDelayMs: number, attempt: number): number {
  return baseDelayMs * Math.pow(2, attempt);
}

function hasRetryableCode(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (typeof code === "string" && RETRYABLE_NETWORK_CODES.has(code))
    return true;

  const cause = (error as { cause?: unknown })?.cause;
  if (cause && typeof cause === "object") {
    const causeCode = (cause as NodeJS.ErrnoException).code;
    if (typeof causeCode === "string" && RETRYABLE_NETWORK_CODES.has(causeCode))
      return true;
  }

  return false;
}

/** Parses `Retry-After`, which is either a delay in seconds or an HTTP date. */
export function retryAfterMs(response: Response): number | undefined {
  const header = response.headers?.get?.("retry-after");
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.min(Math.max(seconds * 1000, 0), MAX_RETRY_AFTER_MS);
  }

  const parsed = Date.parse(header);
  if (Number.isNaN(parsed)) return undefined;

  return Math.min(Math.max(parsed - Date.now(), 0), MAX_RETRY_AFTER_MS);
}

/** True for statuses worth another attempt: rate limiting and server faults. */
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) return true;

  const name = (error as { name?: unknown })?.name;
  if (typeof name === "string" && RETRYABLE_ERROR_NAMES.has(name)) return true;

  if (hasRetryableCode(error)) return true;

  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return isRetryableStatus((error as { status: number }).status);
  }

  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions<T>
): Promise<T> {
  const retries = options?.retries ?? 2;
  const baseDelayMs = options?.baseDelayMs ?? 500;
  const retryOn = options?.retryOn ?? isRetryableError;
  const retryOnResult = options?.retryOnResult;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fn();

      if (attempt === retries || !retryOnResult?.(result)) return result;

      await delay(
        options?.delayForResult?.(result) ?? backoffMs(baseDelayMs, attempt)
      );
    } catch (error) {
      lastError = error;

      if (attempt === retries || !retryOn(error)) {
        throw error;
      }

      await delay(backoffMs(baseDelayMs, attempt));
    }
  }

  throw lastError;
}
