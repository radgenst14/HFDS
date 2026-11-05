/**
 * LiDARMap (doc 12): the stored precision map. The prototype map covers the scenario
 * road; `enabled` says whether that road is HFDS-enabled (IR1).
 *
 * IR16: the map is outdated when it is more than 7 months older than the scenario's
 * `simDate`. Dates are ISO calendar dates compared by calendar arithmetic (no clock).
 * `detectMismatch()` (R10) arrives in M5.
 */
import { MAP_MAX_AGE_MONTHS } from '../../shared/constants';
import type { MapUpdate } from '../../shared/domain';
import type { Scenario } from '../../shared/scenario-schema';

interface YMD {
  y: number;
  m: number;
  d: number;
}

function parseDate(iso: string): YMD {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`bad ISO date ${iso}`);
  return { y, m, d };
}

const daysInMonth = (y: number, m: number): number =>
  [
    31,
    (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][m - 1] ?? 31;

/** Calendar month addition, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso: string, months: number): string {
  const { y, m, d } = parseDate(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/** Whole calendar months from `from` to `to` (for the checklist text). */
export function monthsBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1;
  return months;
}

export class LiDARMap {
  version: string;
  lastUpdated: string;
  /** Scenario road enabled for HFDS in the map (IR1). */
  enabled: boolean;
  /** IR5.7 "LiDAR map … data is in error or unavailable" (Director `mapError`). */
  dataError = false;

  constructor(spec: Scenario['map']) {
    this.version = spec.version;
    this.lastUpdated = spec.lastUpdated;
    this.enabled = spec.enabled;
  }

  /** IR16: more than 7 months old on `simDate`. Exactly 7 months is still current. */
  isOutdated(simDate: string): boolean {
    return addMonths(this.lastUpdated, MAP_MAX_AGE_MONTHS) < simDate;
  }

  ageMonths(simDate: string): number {
    return monthsBetween(this.lastUpdated, simDate);
  }

  /** IR1: the scenario road is enabled for HFDS in the map. Data errors are IR5.7. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** R11: a downloaded map update replaces the stored version. */
  applyUpdate(update: MapUpdate): void {
    this.version = update.version;
    this.lastUpdated = update.lastUpdated;
  }
}
