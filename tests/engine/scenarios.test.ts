import { describe, expect, it } from 'vitest';
import {
  describeExpectation,
  evaluateScenario,
  recordRun,
  type ExpectationResult,
  type RunRecord,
} from '../../src/engine/scenario/expectations';
import { presetIds, readPreset } from './helpers';

/**
 * Every preset's `expect` list as acceptance tests (doc 14, doc 17). A preset's checks
 * run once the milestone that implements its behaviour is done; until then they are
 * listed as todo so the gap stays visible.
 */
const CURRENT_MILESTONE = 3;
const PRESET_MILESTONE: Record<string, number> = {
  's01-activation-success': 2,
  's02-rejected-outdated-map': 2,
  's03-rejected-conditions': 2,
  's04-lane-keeping-curves-trucks': 3,
  's05-follow-lead-vehicle': 3,
  's06-cut-in-braking': 3,
  's07-sensor-fault-redundant': 5,
  's08-sensor-fault-takeover': 5,
  's09-inattention-ignored': 4,
  's10-inattention-recovered': 4,
  's11-road-hazard-takeover': 4,
  's12-takeover-ignored-stop-in-lane': 4,
  's13-driver-brakes': 4,
  's14-driver-steers-resume': 4,
  's15-repeated-reclaims': 5,
  's16-map-mismatch-construction': 5,
  's17-driver-camera-tamper': 5,
  's18-collision-onstar': 6,
  's19-unauthorized-command': 6,
};

describe.each(presetIds().filter((id) => id !== 's00-sandbox'))('preset %s', (id) => {
  const scenario = readPreset(id);
  const milestone = PRESET_MILESTONE[id] ?? 99;

  if (milestone > CURRENT_MILESTONE) {
    for (const e of scenario.expect) it.todo(`${describeExpectation(e)} (M${milestone})`);
    return;
  }

  let rec: RunRecord;
  let results: ExpectationResult[];
  const run = () => {
    rec ??= recordRun(scenario);
    results ??= evaluateScenario(rec);
    return results;
  };

  scenario.expect.forEach((e, i) => {
    it(describeExpectation(e), () => {
      const r = run()[i];
      expect(r?.pass, r?.message).toBe(true);
    });
  });

  it('[IR12] HFDS never commands acceleration while the light bar flashes red', () => {
    run();
    const bad = rec.frames.find((f) => f.lightBar === 'FlashingRed' && f.hfdsAccelCmd > 1e-9);
    expect(bad, bad && `+${bad.hfdsAccelCmd} ft/s² at ${bad.t} s`).toBeUndefined();
  });

  it('[IR27] HFDS never commands more than 85 mph', () => {
    run();
    for (const f of rec.frames) {
      if (f.setSpeedMph !== null) expect(f.setSpeedMph).toBeLessThanOrEqual(85);
      if (f.mode === 'HANDS_FREE' && f.hfdsAccelCmd > 0)
        expect(f.speedMph).toBeLessThanOrEqual(85 + 1e-6);
    }
  });

  it('[R18] while hands-free the vehicle stays inside its lane', () => {
    run();
    const bad = rec.frames.find((f) => f.mode === 'HANDS_FREE' && !f.inLane);
    expect(bad, bad && `left the lane at ${bad.t} s`).toBeUndefined();
  });

  it('[R45] every log entry has a timestamp, in order', () => {
    run();
    const times = rec.log.map((x) => x.t);
    expect(times.every(Number.isFinite)).toBe(true);
    expect(times.every((t, k) => k === 0 || t >= (times[k - 1] ?? 0))).toBe(true);
  });
});
