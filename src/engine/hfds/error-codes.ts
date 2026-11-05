/**
 * Error codes (R9, R37, R38, IR23, IR29b; catalog A-19 in doc 13 §9).
 *
 * Every fault HFDS detects is recorded as an ErrorCode with a description (R37.1), a
 * severity 0–100 and its band (R37.2: 0–24 low, 25–74 middle, 75–100 high), and, for
 * sensor faults, the sensor's identifying metadata (IR29b). FaultMonitor compares the
 * faults observed this tick with the active codes, raising new ones and clearing gone
 * ones (R9: detected every tick by the self-tests, IR29 / SR10).
 *
 * Codes E107–E109 extend the kit catalog (A-58): rear camera, positioning data service
 * (IR17) and grip sensors.
 */
import { SEVERITY_BANDS } from '../../shared/constants';
import { ErrorBand, type ErrorCode, type SensorMetadata } from '../../shared/domain';

export interface CatalogEntry {
  code: string;
  description: string;
  severity: number;
  /** SRS IDs the fault relates to (log tags). */
  reqs: string[];
}

const entry = (
  code: string,
  description: string,
  severity: number,
  reqs: string[],
): CatalogEntry => ({
  code,
  description,
  severity,
  reqs,
});

/** A-19 (doc 13 §9) + A-58 extensions. */
export const ERROR_CATALOG: Readonly<Record<string, CatalogEntry>> = {
  E101: entry('E101', 'Front camera obstructed or failed', 60, ['R9', 'R9.1', 'IR5.6']),
  E102: entry('E102', 'Front radar failed', 50, ['R9', 'R9.1', 'IR5.6']),
  E103: entry('E103', 'LiDAR sensor fault', 40, ['R9', 'R9.1', 'IR5.6']),
  E104: entry('E104', 'GPS receiver or navigation data fault', 70, ['R9', 'R9.2', 'IR5.7']),
  E105: entry('E105', 'GPS correction data older than 5 s', 20, ['R9', 'R9.2', 'IR5.8']),
  E106: entry('E106', 'Redundant lane-position sources disagree by more than 0.3 m', 55, [
    'R9',
    'IR5.8',
    'SR10',
  ]),
  E107: entry('E107', 'Rear camera obstructed or failed', 30, ['R9', 'R9.1', 'IR5.6']),
  E108: entry('E108', 'Real-time positioning data service unavailable', 50, ['R9', 'IR17']),
  E109: entry('E109', 'Steering-wheel grip sensor failed', 20, ['R9', 'R9.1', 'R35']),
  E201: entry('E201', 'LiDAR map data error or unavailable', 80, ['R9', 'R9.3', 'IR5.7']),
  E202: entry('E202', 'LiDAR map older than 7 months', 30, ['R9', 'R9.3', 'IR16']),
  E203: entry('E203', 'LiDAR map does not match the sensed road (unmapped construction zone)', 60, [
    'R10',
    'IR14',
  ]),
  E301: entry('E301', 'Path Prediction Subsystem fault', 80, ['R9', 'R9.4', 'IR14']),
  E401: entry('E401', 'Driver camera blocked, disabled or failed', 85, ['SR5', 'R9.1']),
  E402: entry('E402', 'Driver camera tampering detected', 90, ['SR2', 'SR5']),
  E501: entry('E501', 'HFDS control process corrupted', 75, ['R44']),
  E601: entry('E601', 'Primary computing or power hardware failure', 95, ['SR4.3', 'SR3']),
};

/** R37.2 severity band. */
export function bandOf(severity: number): ErrorBand {
  if (severity >= SEVERITY_BANDS.high.min) return ErrorBand.high;
  if (severity >= SEVERITY_BANDS.middle.min) return ErrorBand.middle;
  return ErrorBand.low;
}

/** A fault seen this tick. */
export interface ObservedFault {
  code: string;
  sensor?: SensorMetadata;
  detail?: string;
}

export class FaultMonitor {
  /** Active codes by code. */
  readonly active = new Map<string, ErrorCode>();
  /** Every code ever raised (with clearedAt once cleared). */
  readonly history: ErrorCode[] = [];

  /** R9: raise codes that appeared and clear codes that went away. */
  detect(
    t: number,
    observed: readonly ObservedFault[],
  ): { raised: ErrorCode[]; cleared: ErrorCode[] } {
    const seen = new Set(observed.map((o) => o.code));
    const raised: ErrorCode[] = [];
    const cleared: ErrorCode[] = [];
    for (const o of observed) {
      if (this.active.has(o.code)) continue;
      const cat = ERROR_CATALOG[o.code];
      if (!cat) throw new Error(`unknown error code ${o.code}`);
      const code: ErrorCode = {
        code: cat.code,
        description: o.detail ? `${cat.description} (${o.detail})` : cat.description,
        severity: cat.severity,
        band: bandOf(cat.severity),
        raisedAt: t,
      };
      if (o.sensor) code.sensor = { ...o.sensor };
      this.active.set(o.code, code);
      this.history.push(code);
      raised.push(code);
    }
    for (const [key, code] of [...this.active]) {
      if (seen.has(key)) continue;
      code.clearedAt = t;
      this.active.delete(key);
      cleared.push(code);
    }
    return { raised, cleared };
  }

  has(code: string): boolean {
    return this.active.has(code);
  }

  /** IR23: the active high-severity codes. */
  highSeverity(): ErrorCode[] {
    return [...this.active.values()].filter((c) => c.band === ErrorBand.high);
  }

  middleSeverity(): ErrorCode[] {
    return [...this.active.values()].filter((c) => c.band === ErrorBand.middle);
  }

  list(): ErrorCode[] {
    return [...this.active.values()].map((c) => ({ ...c }));
  }
}
