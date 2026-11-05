/**
 * Expectation runner (doc 14 "Expectations"): runs a preset headless, records one
 * Observation per tick and checks every `expect` entry. Shared by the Vitest scenario
 * tests and (later) the in-page checker. Pure: no DOM, no timers.
 *
 * Timing semantics (doc 14, refined here, see doc 16 ISSUE-37):
 *   at t          holds at a tick within ±1 tick (0.05 s) of t
 *   by t          has become true by t and still holds at t (±1 tick); the result
 *                 records when the current stretch of truth began
 *   from/to       holds at every tick in [from, to]; a bound may be an anchor
 *   after a+s     holds within ±1 tick of anchor a + s (a bare anchor = +0 s)
 *   whenEgoSFt x  holds within ±1 tick of the first tick with ego s ≥ x
 *   whenEgoSFtAtLeast x   holds at some tick with ego s ≥ x
 *   whenHazardWithinFt d  holds at some tick with an in-lane hazard ≤ d ft ahead
 *   beforeSFt x   holds at some tick with ego s < x
 *   (none)        holds at some tick of the run; run-level checks look at the whole run
 * `logged` checks look at log entries instead of ticks, with the same windows.
 */
import { DT_S } from '../../shared/constants';
import { ENGAGED_MODES, HfdsMode, LightBarState, type LogEntry } from '../../shared/domain';
import { AFTER_PATTERN, type Expectation, type Scenario } from '../../shared/scenario-schema';
import { Engine, type Observation } from '../engine';
import type { Anchors } from '../hfds/hfds';

const EPS = 1e-6;
const TOL = DT_S + EPS;

export interface ExpectationResult {
  index: number;
  expectation: Expectation;
  pass: boolean;
  /** Why it failed, or where it passed. */
  message: string;
}

export interface RunRecord {
  scenario: Scenario;
  frames: Observation[];
  log: readonly LogEntry[];
  anchors: Anchors;
}

/** Runs a scenario to its end, recording one Observation per tick. */
export function recordRun(scenario: Scenario): RunRecord {
  const engine = new Engine(scenario);
  const frames: Observation[] = [];
  const maxTicks = Math.ceil(scenario.durationS / DT_S) + 1;
  for (let i = 0; i < maxTicks && !engine.finished; i++) {
    engine.step();
    frames.push(engine.observe());
  }
  return { scenario, frames, log: engine.eventLog.entries, anchors: { ...engine.anchors } };
}

// ---------------------------------------------------------------------------
// Small arithmetic evaluator for `trailDistanceFt.approxFormula` (no eval).
// ---------------------------------------------------------------------------

export function evalFormula(src: string, vars: Record<string, number>): number {
  const tokens = src.match(/\d+(?:\.\d+)?|[A-Za-z_]\w*|[-+*/()]/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const primary = (): number => {
    const tok = next();
    if (tok === undefined) throw new Error(`formula ended early: ${src}`);
    if (tok === '(') {
      const v = expr();
      if (next() !== ')') throw new Error(`missing ) in ${src}`);
      return v;
    }
    if (tok === '-') return -primary();
    if (/^\d/.test(tok)) return Number(tok);
    const v = vars[tok];
    if (v === undefined) throw new Error(`unknown identifier ${tok} in ${src}`);
    return v;
  };
  const term = (): number => {
    let v = primary();
    while (peek() === '*' || peek() === '/') v = next() === '*' ? v * primary() : v / primary();
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (peek() === '+' || peek() === '-') v = next() === '+' ? v + term() : v - term();
    return v;
  };
  const v = expr();
  if (i !== tokens.length) throw new Error(`unexpected "${peek()}" in ${src}`);
  return v;
}

// ---------------------------------------------------------------------------
// Per-tick predicates
// ---------------------------------------------------------------------------

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function nonEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === false) return false;
  if (typeof v === 'string' || Array.isArray(v)) return v.length > 0;
  return true;
}

/** State predicate for one tick, or null for checks that are not per-tick. */
function predicate(e: Expectation): ((f: Observation) => boolean) | null {
  switch (e.check) {
    case 'mode':
      return (f) => f.mode === e.value;
    case 'notEngaged':
      return (f) => !ENGAGED_MODES.includes(f.mode);
    case 'available':
      return (f) => f.available === e.value;
    case 'lightBar':
      return (f) => f.lightBar === e.value;
    case 'hmi':
      return (f) => {
        const v = f.hmi[e.field];
        if (e.nonEmpty) return nonEmpty(v);
        if (e.valueIn) return e.valueIn.some((x) => deepEqual(v, x));
        return deepEqual(v, e.value);
      };
    case 'warningActive':
      return (f) => f.warnings.some((w) => w.cls === e.cls && (!e.reason || w.reason === e.reason));
    case 'noWarningClass':
      return (f) => !f.warnings.some((w) => w.cls === e.cls);
    case 'setSpeedMph':
      return (f) => f.setSpeedMph !== null && Math.abs(f.setSpeedMph - e.approx) <= e.tol + EPS;
    case 'speedMph':
      return (f) => Math.abs(f.speedMph - e.approx) <= e.tol + EPS;
    case 'accActive':
      return (f) => f.accActive === e.value;
    case 'lead':
      return (f) => f.leadId === e.vehicleId;
    case 'gapAtLeastTrail':
      return (f) => f.gapFt === null || f.gapFt >= e.factor * f.trailDistanceFt - EPS;
    case 'gapAboveCushion':
      return (f) => f.gapFt === null || f.gapFt > f.safetyCushionFt;
    case 'trailDistanceFt':
      return (f) =>
        Math.abs(
          f.trailDistanceFt -
            evalFormula(e.approxFormula, {
              speedFtps: f.speedFtps,
              timeGapS: f.timeGapS,
              sizeFactor: f.sizeFactor,
            }),
        ) <=
        e.tol + EPS;
    case 'invariantInLane':
      return (f) => f.inLane;
    case 'onShoulderStopped':
      return (f) => f.laneId === 0 && f.speedMph < 0.1;
    case 'stoppedInLane':
      return (f) => f.laneId === e.laneId && f.speedMph < 0.1;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** Resolves "<anchor>[+s]" to a time, or null if the anchor never happened. */
export function resolveAnchor(spec: string, anchors: Anchors): number | null {
  const m = AFTER_PATTERN.exec(spec);
  if (!m) return null;
  const base = anchors[m[1] as keyof Anchors];
  return base === undefined ? null : base + Number(m[2] ?? 0);
}

type Window =
  | { kind: 'near'; t: number; what: string }
  | { kind: 'by'; t: number }
  | { kind: 'all'; from: number; to: number }
  | { kind: 'some'; select: (f: Observation) => boolean; what: string }
  | { kind: 'missing'; why: string };

function windowOf(e: Expectation, rec: RunRecord): Window {
  const frames = rec.frames;
  const end = frames.at(-1)?.t ?? 0;
  const bound = (b: number | string, fallback: number): number | null =>
    typeof b === 'number' ? b : (resolveAnchor(b, rec.anchors) ?? fallback);
  if (e.at !== undefined) return { kind: 'near', t: e.at, what: `at ${e.at} s` };
  if (e.by !== undefined) return { kind: 'by', t: e.by };
  if (e.from !== undefined && e.to !== undefined) {
    const from = bound(e.from, 0);
    const to = bound(e.to, end);
    return from === null || to === null
      ? { kind: 'missing', why: 'window anchor missing' }
      : { kind: 'all', from, to };
  }
  if (e.after !== undefined) {
    const t = resolveAnchor(e.after, rec.anchors);
    return t === null
      ? { kind: 'missing', why: `anchor "${e.after}" never recorded` }
      : { kind: 'near', t, what: `${e.after} (${t.toFixed(2)} s)` };
  }
  if (e.whenEgoSFt !== undefined) {
    const x = e.whenEgoSFt;
    const first = frames.find((f) => f.egoS >= x - EPS);
    return first
      ? { kind: 'near', t: first.t, what: `ego at ${x} ft (${first.t.toFixed(2)} s)` }
      : { kind: 'missing', why: `ego never reached ${x} ft` };
  }
  if (e.whenEgoSFtAtLeast !== undefined) {
    const x = e.whenEgoSFtAtLeast;
    return { kind: 'some', select: (f) => f.egoS >= x - EPS, what: `once ego s ≥ ${x} ft` };
  }
  if (e.whenHazardWithinFt !== undefined) {
    const d = e.whenHazardWithinFt;
    return {
      kind: 'some',
      select: (f) => f.hazardAheadFt !== null && f.hazardAheadFt <= d + EPS,
      what: `while a hazard is within ${d} ft`,
    };
  }
  if (e.beforeSFt !== undefined) {
    const x = e.beforeSFt;
    return { kind: 'some', select: (f) => f.egoS < x, what: `before ego s ${x} ft` };
  }
  return { kind: 'some', select: () => true, what: 'during the run' };
}

function checkFrames(
  pred: (f: Observation) => boolean,
  w: Window,
  frames: Observation[],
): { pass: boolean; message: string } {
  switch (w.kind) {
    case 'missing':
      return { pass: false, message: w.why };
    case 'near': {
      const near = frames.filter((f) => Math.abs(f.t - w.t) <= TOL);
      if (near.length === 0) return { pass: false, message: `run has no tick ${w.what}` };
      const hit = near.find(pred);
      return hit
        ? { pass: true, message: `held ${w.what}` }
        : { pass: false, message: `did not hold ${w.what}` };
    }
    case 'by': {
      // "Becomes true by t": it must hold at t, not merely at some earlier tick.
      const idx = frames.findIndex((f) => Math.abs(f.t - w.t) <= TOL && pred(f));
      if (idx < 0) return { pass: false, message: `did not hold at ${w.t} s` };
      let start = idx;
      while (start > 0 && pred(frames[start - 1] as Observation)) start--;
      const since = frames[start]?.t ?? 0;
      return { pass: true, message: `held at ${w.t} s (true since ${since.toFixed(2)} s)` };
    }
    case 'all': {
      const inside = frames.filter((f) => f.t >= w.from - EPS && f.t <= w.to + EPS);
      if (inside.length === 0) return { pass: false, message: `no ticks in [${w.from}, ${w.to}]` };
      const bad = inside.find((f) => !pred(f));
      return bad
        ? {
            pass: false,
            message: `failed at ${bad.t.toFixed(2)} s (window ${w.from.toFixed(2)}–${w.to.toFixed(2)} s)`,
          }
        : { pass: true, message: `held ${w.from.toFixed(2)}–${w.to.toFixed(2)} s` };
    }
    case 'some': {
      const hit = frames.find((f) => w.select(f) && pred(f));
      return hit
        ? { pass: true, message: `held at ${hit.t.toFixed(2)} s ${w.what}` }
        : { pass: false, message: `never held ${w.what}` };
    }
  }
}

function checkLogged(
  e: Extract<Expectation, { check: 'logged' }>,
  w: Window,
  rec: RunRecord,
): { pass: boolean; message: string } {
  const matches = rec.log.filter(
    (x) =>
      x.type === e.type &&
      (!e.contains || x.message.toLowerCase().includes(e.contains.toLowerCase())) &&
      (!e.code || (x.data as { code?: string } | undefined)?.code === e.code),
  );
  const describe = `${e.type}${e.contains ? ` containing "${e.contains}"` : ''}${e.code ? ` ${e.code}` : ''}`;
  let ok: LogEntry | undefined;
  switch (w.kind) {
    case 'missing':
      return { pass: false, message: w.why };
    case 'near':
      ok = matches.find((x) => Math.abs(x.t - w.t) <= TOL);
      break;
    case 'by':
      ok = matches.find((x) => x.t <= w.t + EPS);
      break;
    case 'all':
      ok = matches.find((x) => x.t >= w.from - EPS && x.t <= w.to + EPS);
      break;
    case 'some': {
      // The entry must be logged at or after the first tick where the condition holds.
      const first = rec.frames.find(w.select);
      ok = first ? matches.find((x) => x.t >= first.t - TOL) : undefined;
      break;
    }
  }
  return ok
    ? { pass: true, message: `logged at ${ok.t.toFixed(2)} s: ${ok.message}` }
    : {
        pass: false,
        message: `no ${describe} entry${matches.length ? ` in the window (${matches.length} elsewhere)` : ''}`,
      };
}

// ---------------------------------------------------------------------------
// Run-level checks
// ---------------------------------------------------------------------------

function runLevel(e: Expectation, rec: RunRecord): { pass: boolean; message: string } | null {
  const frames = rec.frames;
  switch (e.check) {
    case 'zoneSeen': {
      const limit = e.by ?? Infinity;
      let k = 0;
      for (const f of frames) {
        if (f.t > limit + EPS) break;
        if (f.zone === e.sequence[k]) k++;
        if (k === e.sequence.length)
          return {
            pass: true,
            message: `zones ${e.sequence.join(' → ')} seen by ${f.t.toFixed(2)} s`,
          };
      }
      return {
        pass: false,
        message: `saw ${e.sequence.slice(0, k).join(' → ') || 'none'} of ${e.sequence.join(' → ')}`,
      };
    }
    case 'targetOffsetNonZeroWhilePassing': {
      const beside = frames.filter((f) => f.besideVehicleIds.includes(e.vehicleId));
      if (beside.length === 0)
        return { pass: false, message: `never beside vehicle ${e.vehicleId}` };
      const hit = beside.find((f) => Math.abs(f.targetOffset) > EPS);
      return hit
        ? {
            pass: true,
            message: `offset ${hit.targetOffset.toFixed(2)} ft at ${hit.t.toFixed(2)} s`,
          }
        : { pass: false, message: `offset stayed 0 while beside vehicle ${e.vehicleId}` };
    }
    case 'noAccelWhileRed': {
      const bad = frames.find(
        (f) => f.lightBar === LightBarState.FlashingRed && f.hfdsAccelCmd > EPS,
      );
      return bad
        ? {
            pass: false,
            message: `HFDS commanded +${bad.hfdsAccelCmd.toFixed(2)} ft/s² at ${bad.t.toFixed(2)} s while flashing red`,
          }
        : { pass: true, message: 'no HFDS acceleration while flashing red' };
    }
    case 'laneUnchangedUntilTakeover': {
      const until = rec.anchors.takeover ?? Infinity;
      const first = frames[0]?.laneId;
      const bad = frames.find((f) => f.t < until - EPS && f.laneId !== first);
      return bad
        ? { pass: false, message: `lane changed to ${bad.laneId} at ${bad.t.toFixed(2)} s` }
        : { pass: true, message: `stayed in lane ${first}` };
    }
    case 'laneDwellAtLeast': {
      const mrm = frames.filter((f) => f.mode === HfdsMode.MINIMAL_RISK_MANEUVER);
      if (mrm.length === 0) return { pass: false, message: 'no minimal risk maneuver' };
      // Lanes entered during the maneuver (not the starting lane) must each be held ≥ seconds
      // before the next lateral transition (SR1.1.2).
      const segments: Array<{ lane: number; from: number; to: number }> = [];
      for (const f of mrm) {
        const last = segments.at(-1);
        if (last && last.lane === f.laneId) last.to = f.t;
        else segments.push({ lane: f.laneId, from: f.t, to: f.t });
      }
      const entered = segments.slice(1, -1);
      const short = entered.find((s) => s.to - s.from + DT_S < e.seconds - EPS);
      return short
        ? {
            pass: false,
            message: `lane ${short.lane} held only ${(short.to - short.from + DT_S).toFixed(2)} s`,
          }
        : { pass: true, message: `lanes ${segments.map((s) => s.lane).join(' → ')}` };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function evaluateExpectation(
  e: Expectation,
  index: number,
  rec: RunRecord,
): ExpectationResult {
  const result = (r: { pass: boolean; message: string }): ExpectationResult => ({
    index,
    expectation: e,
    ...r,
  });
  try {
    const level = runLevel(e, rec);
    if (level) return result(level);
    const w = windowOf(e, rec);
    if (e.check === 'logged') return result(checkLogged(e, w, rec));
    const pred = predicate(e);
    if (!pred) return result({ pass: false, message: `check "${e.check}" is not implemented` });
    return result(checkFrames(pred, w, rec.frames));
  } catch (err) {
    return result({ pass: false, message: String(err) });
  }
}

export function evaluateScenario(rec: RunRecord): ExpectationResult[] {
  return rec.scenario.expect.map((e, i) => evaluateExpectation(e, i, rec));
}

/** Readable test name, e.g. "[R14][R42] mode = STARTING at 2.5 s". */
export function describeExpectation(e: Expectation): string {
  const ids = e.reqs.length ? e.reqs.map((r) => `[${r}]`).join('') : '(setup)';
  const args = Object.entries(e)
    .filter(([k]) => !['check', 'reqs'].includes(k))
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  return `${ids} ${e.check} ${args}`;
}
