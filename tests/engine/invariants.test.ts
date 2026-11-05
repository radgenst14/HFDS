import { describe, expect, it } from 'vitest';
import { recordRun, type RunRecord } from '../../src/engine/scenario/expectations';
import { HfdsMode } from '../../src/shared/domain';
import { presetIds, readPreset } from './helpers';

/**
 * Global invariants over every preset (doc 13 §6 "Invariant tests", doc 14 "Global
 * invariants", doc 17 M4): IR11, IR12, IR27, R18, R45. Determinism is in replay.test.ts
 * and scenario-run.test.ts.
 */
const HANDS_FREE_FAMILY: readonly string[] = [
  HfdsMode.HANDS_FREE,
  HfdsMode.DRIVER_STEERING,
  HfdsMode.ALERT_FIRST,
  HfdsMode.ALERT_SECOND,
  HfdsMode.ALERT_FINAL,
];
/** Modes in which HFDS itself steers (R18 applies; not while the driver steers or the MRM changes lanes). */
const HFDS_STEERS: readonly string[] = [
  HfdsMode.HANDS_FREE,
  HfdsMode.ALERT_FIRST,
  HfdsMode.ALERT_SECOND,
  HfdsMode.ALERT_FINAL,
  HfdsMode.TAKEOVER_REQUESTED,
];

describe.each(presetIds())('invariants: %s', (id) => {
  let rec: RunRecord;
  const run = () => (rec ??= recordRun(readPreset(id)));

  it('[IR11] never in hands-free driving after the driver is deemed inactive', () => {
    const bad = run().frames.find((f) => f.driverInactive && HANDS_FREE_FAMILY.includes(f.mode));
    expect(bad, bad && `mode ${bad.mode} at ${bad.t} s`).toBeUndefined();
  });

  it('[IR12] no HFDS acceleration while the light bar flashes red', () => {
    const bad = run().frames.find((f) => f.lightBar === 'FlashingRed' && f.hfdsAccelCmd > 1e-9);
    expect(bad, bad && `+${bad.hfdsAccelCmd} ft/s² at ${bad.t} s`).toBeUndefined();
  });

  it('[IR27] HFDS never commands more than 85 mph', () => {
    const bad = run().frames.find(
      (f) => (f.setSpeedMph ?? 0) > 85 || (f.hfdsAccelCmd > 0 && f.speedMph > 85 + 1e-6),
    );
    expect(bad, bad && `${bad.speedMph} mph at ${bad.t} s`).toBeUndefined();
  });

  it('[R18] while HFDS steers, the vehicle stays inside its lane', () => {
    const bad = run().frames.find((f) => HFDS_STEERS.includes(f.mode) && !f.inLane);
    expect(bad, bad && `outside the lane at ${bad.t} s in ${bad.mode}`).toBeUndefined();
  });

  it('[R45] every log entry has a timestamp, in order', () => {
    const times = run().log.map((x) => x.t);
    expect(times.every(Number.isFinite)).toBe(true);
    expect(times.every((t, k) => k === 0 || t >= (times[k - 1] ?? 0))).toBe(true);
  });
});
