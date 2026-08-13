import useAsyncData from "./useAsyncData";
import type { FetchContext } from "./useAsyncData";

type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  label: string;
  message: string;
  data?: unknown;
};

type LogsResponse = {
  logs: LogEntry[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

type UseLogsParams = {
  page: number;
  pageSize: number;
  level?: LogLevel[];
  search?: string;
};

function buildLogsUrl({
  page,
  pageSize,
  level,
  search,
}: UseLogsParams): string {
  const params = new URLSearchParams({
    page: page.toString(),
    pageSize: pageSize.toString(),
  });

  if (level) {
    for (const l of level) {
      params.append("level", l);
    }
  }

  if (search) {
    params.append("search", search);
  }

  return `/api/logs?${params.toString()}`;
}

async function fetchLogs({ key, signal }: FetchContext): Promise<LogsResponse> {
  const res = await fetch(key, { signal });

  if (!res.ok) {
    throw new Error("Failed to fetch logs");
  }

  return res.json();
}

export default function useLogs(params: UseLogsParams) {
  const { data, loading, error, refresh } = useAsyncData<LogsResponse>(
    buildLogsUrl(params),
    fetchLogs
  );

  return { data, loading, error, refetch: refresh };
}
