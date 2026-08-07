import {
  withRetry,
  isRetryableStatus,
  retryAfterMs,
  type RetryOptions,
} from "./retry";

export interface ResilientFetchOptions {
  timeoutMs?: number;
  retry?: RetryOptions<Response> | boolean;
  /**
   * Also retry responses carrying a retryable status. Off by default: `fetch`
   * resolves those rather than throwing, so switching this on globally would
   * multiply load on every service during an outage. Turn it on per caller,
   * ideally alongside something that backs off when the service says stop.
   */
  retryOnStatus?: boolean;
  fetchFn?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10000;

function isRetryableResponse(response: Response): boolean {
  return isRetryableStatus(response.status);
}

export function resilientFetch(
  url: string,
  init?: RequestInit,
  options?: ResilientFetchOptions
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchFn = options?.fetchFn ?? fetch;
  const retryOpt = options?.retry ?? true;

  const retryOptions: RetryOptions<Response> | undefined =
    retryOpt === true ? {} : retryOpt === false ? undefined : retryOpt;

  const doFetch = () => {
    const signal = AbortSignal.timeout(timeoutMs);
    return fetchFn(url, { ...init, signal });
  };

  if (!retryOptions) return doFetch();

  const statusRetry: RetryOptions<Response> = options?.retryOnStatus
    ? { retryOnResult: isRetryableResponse, delayForResult: retryAfterMs }
    : {};

  return withRetry(doFetch, { ...statusRetry, ...retryOptions });
}
