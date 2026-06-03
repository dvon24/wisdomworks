/**
 * Minimal 5-field cron parser → next-run calculator.
 *
 * Deliberately tiny — no dependency, no per-tenant timezone yet. Supports:
 *   • wildcards:   * * * * *
 *   • literals:    0 8 * * *
 *   • steps:       *​/15 * * * *
 *   • comma lists: 0,30 * * * *
 *   • ranges:      0 9-17 * * 1-5
 *   • day-of-week: 0=Sunday, 6=Saturday
 *
 * NOT supported in MVP (add when first owner needs them):
 *   • @aliases (@daily, @hourly, @weekly)
 *   • L (last day of month)
 *   • # (nth weekday)
 *   • Per-tenant timezones (uses UTC throughout)
 *
 * Strategy: brute-force minute-by-minute scan forward from the given
 * baseline until a minute matches all 5 fields. Capped at 366 days
 * ahead to avoid runaway loops on misconfigured expressions.
 */

interface ParsedField {
  values: Set<number>;
}

function parseField(field: string, min: number, max: number): ParsedField {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    // step expression like */15 or 0-30/5
    const stepMatch = part.match(/^(.+?)\/(\d+)$/);
    let base = part;
    let step = 1;
    if (stepMatch) {
      base = stepMatch[1]!;
      step = parseInt(stepMatch[2]!, 10);
    }
    if (base === '*') {
      for (let v = min; v <= max; v += step) values.add(v);
      continue;
    }
    const rangeMatch = base.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1]!, 10);
      const to = parseInt(rangeMatch[2]!, 10);
      for (let v = from; v <= to; v += step) values.add(v);
      continue;
    }
    const n = parseInt(base, 10);
    if (!Number.isNaN(n)) values.add(n);
  }
  return { values };
}

interface ParsedCron {
  minute: ParsedField;
  hour: ParsedField;
  dom: ParsedField;       // day of month (1-31)
  month: ParsedField;     // 1-12
  dow: ParsedField;       // day of week (0-6, 0=Sunday)
}

export function parseCronExpression(expr: string): ParsedCron | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  try {
    return {
      minute: parseField(parts[0]!, 0, 59),
      hour: parseField(parts[1]!, 0, 23),
      dom: parseField(parts[2]!, 1, 31),
      month: parseField(parts[3]!, 1, 12),
      dow: parseField(parts[4]!, 0, 6),
    };
  } catch {
    return null;
  }
}

// Cron fields (minute / hour / day-of-month / month / day-of-week) for `date`
// evaluated in `timeZone` (IANA, e.g. 'Europe/Berlin'). This lets a workflow's
// schedule track LOCAL wall-clock across DST instead of drifting with UTC —
// "3pm Europe/Berlin" stays 3pm whether it's CET (UTC+1) or CEST (UTC+2).
const _WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function cronFields(date: Date, timeZone?: string): { m: number; h: number; d: number; month: number; w: number } {
  if (!timeZone) {
    return {
      m: date.getUTCMinutes(), h: date.getUTCHours(), d: date.getUTCDate(),
      month: date.getUTCMonth() + 1, w: date.getUTCDay(),
    };
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  let h = parseInt(get('hour'), 10);
  if (h === 24) h = 0; // some runtimes emit '24' for midnight in hour12:false mode
  return {
    m: parseInt(get('minute'), 10), h, d: parseInt(get('day'), 10),
    month: parseInt(get('month'), 10), w: _WEEKDAY[get('weekday')] ?? 0,
  };
}

/**
 * Compute the next datetime AFTER `from` that matches the cron expression.
 * Returns null if the expression is invalid or no match within 366 days.
 *
 * `timeZone` (IANA): when set, the cron's hour/minute/day fields are matched
 * against LOCAL time in that zone (DST-aware) — so "0 15 * * *" with
 * 'Europe/Berlin' always fires at 15:00 local. Omitted → UTC (unchanged).
 */
export function nextRunAfter(expr: string, from: Date, timeZone?: string): Date | null {
  const parsed = parseCronExpression(expr);
  if (!parsed) return null;

  // Start one minute after `from`, zero out seconds.
  const cursor = new Date(from);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const ceiling = from.getTime() + 366 * 24 * 60 * 60 * 1000;

  while (cursor.getTime() <= ceiling) {
    const f = cronFields(cursor, timeZone);

    if (
      parsed.minute.values.has(f.m) &&
      parsed.hour.values.has(f.h) &&
      parsed.dom.values.has(f.d) &&
      parsed.month.values.has(f.month) &&
      parsed.dow.values.has(f.w)
    ) {
      return new Date(cursor);
    }

    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return null;
}
