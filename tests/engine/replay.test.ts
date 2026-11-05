import { describe, expect, it } from 'vitest';
import { Engine, runScenario, type InputLogEntry } from '../../src/engine/engine';
import { Rng } from '../../src/engine/rng';
import { readPreset, withChanges } from './helpers';

const sandbox = readPreset('s00-sandbox');

/** A drive with every Driver input kind and a Director injection. */
const INPUTS: InputLogEntry[] = [
  { tick: 20, type: 'input', action: { kind: 'setThrottle', value: 0.6 } },
  { tick: 80, type: 'input', action: { kind: 'setThrottle', value: 0 } },
  { tick: 100, type: 'input', action: { kind: 'setSteer', value: 0.4 } },
  { tick: 160, type: 'input', action: { kind: 'setSteer', value: 0 } },
  { tick: 200, type: 'input', action: { kind: 'setBrake', pressed: true, rate: 8 } },
  { tick: 230, type: 'input', action: { kind: 'setBrake', pressed: false } },
  { tick: 240, type: 'input', action: { kind: 'setGrip', L: false, R: false } },
  { tick: 250, type: 'input', action: { kind: 'setGaze', eyesOnRoad: false } },
  {
    tick: 260,
    type: 'inject',
    action: { kind: 'spawnHazard', args: { type: 'Debris', laneId: 2, aheadFt: 600 } },
  },
  {
    tick: 300,
    type: 'inject',
    action: { kind: 'trafficHardBrake', args: { vehicleId: 1, decelFtps2: 12, durationS: 1 } },
  },
];

describe('replay / determinism (doc 13 §11)', () => {
  it('[IR29] same scenario + seed + input log ⇒ identical state hash', () => {
    const a = runScenario(sandbox, { ticks: 600, inputLog: INPUTS });
    const b = runScenario(sandbox, { ticks: 600, inputLog: INPUTS });
    expect(a.tick).toBe(600);
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('replaying the recorded input log of a live run reproduces it exactly', () => {
    // "Live": inputs arrive between steps, as from the Worker host.
    const live = new Engine(sandbox);
    for (let i = 0; i < 600; i++) {
      for (const e of INPUTS.filter((x) => x.tick === live.tick)) {
        if (e.type === 'input') live.enqueueInput(e.action);
        else live.enqueueInject(e.action);
      }
      live.step();
    }
    const replay = runScenario(sandbox, { ticks: 600, inputLog: live.inputLog });
    expect(live.inputLog).toHaveLength(INPUTS.length);
    expect(replay.stateHash()).toBe(live.stateHash());
  });

  it('a different input changes the hash (the hash sees driver input)', () => {
    const changed: InputLogEntry[] = INPUTS.map((e) =>
      e.tick === 20 ? { tick: 20, type: 'input', action: { kind: 'setThrottle', value: 0.7 } } : e,
    );
    expect(runScenario(sandbox, { ticks: 600, inputLog: changed }).stateHash()).not.toBe(
      runScenario(sandbox, { ticks: 600, inputLog: INPUTS }).stateHash(),
    );
  });

  it('a different seed changes the hash (seed is part of the state)', () => {
    const other = withChanges(sandbox, { seed: sandbox.seed + 1 });
    expect(new Engine(other).stateHash()).not.toBe(new Engine(sandbox).stateHash());
  });

  it('mulberry32 is deterministic and in [0, 1)', () => {
    const a = new Rng(1000);
    const b = new Rng(1000);
    const xs = Array.from({ length: 1000 }, () => a.next());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b.next()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Set(xs).size).toBe(1000);
  });
});
