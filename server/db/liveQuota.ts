import { getDataSource, LiveQuotaUsage } from "./index";

export type QuotaPeriod = {
  period: string;
  calls: number;
  warnedThresholds: number[];
};

function repo() {
  return getDataSource().getRepository(LiveQuotaUsage);
}

function parseThresholds(json: string | null): number[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is number => typeof value === "number")
      : [];
  } catch {
    return [];
  }
}

function toPeriod(row: LiveQuotaUsage): QuotaPeriod {
  return {
    period: row.period,
    calls: row.calls,
    warnedThresholds: parseThresholds(row.warned_thresholds),
  };
}

export async function getQuotaPeriod(period: string): Promise<QuotaPeriod> {
  const row = await repo().findOne({ where: { period } });
  return row ? toPeriod(row) : { period, calls: 0, warnedThresholds: [] };
}

/**
 * A single atomic upsert rather than a read-modify-write. Calls are counted from
 * concurrent requests inside a sweep, so reading then writing in JS would lose
 * increments and undercount exactly when usage matters most. An explicit
 * transaction is no help either: better-sqlite3 is one synchronous connection,
 * so parallel transactions collide.
 */
export async function incrementQuotaCalls(
  period: string,
  at: string,
  by = 1
): Promise<void> {
  await getDataSource().query(
    `INSERT INTO live_quota_usage ("period", "calls", "updated_at")
     VALUES (?, ?, ?)
     ON CONFLICT("period") DO UPDATE SET
       "calls" = "calls" + excluded."calls",
       "updated_at" = excluded."updated_at"`,
    [period, by, at]
  );
}

export async function recordWarnedThreshold(
  period: string,
  threshold: number,
  at: string
): Promise<void> {
  const current = await getQuotaPeriod(period);
  if (current.warnedThresholds.includes(threshold)) return;

  const thresholds = [...current.warnedThresholds, threshold];
  const rows = repo();
  const existing = await rows.findOne({ where: { period } });

  if (!existing) {
    await rows.insert({
      period,
      calls: 0,
      warned_thresholds: JSON.stringify(thresholds),
      updated_at: at,
    });
    return;
  }

  await rows.update(
    { period },
    { warned_thresholds: JSON.stringify(thresholds), updated_at: at }
  );
}

export async function listRecentPeriods(limit = 6): Promise<QuotaPeriod[]> {
  const rows = await repo()
    .createQueryBuilder("q")
    .orderBy("q.period", "DESC")
    .limit(limit)
    .getMany();
  return rows.map(toPeriod);
}
