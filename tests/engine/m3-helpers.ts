import { Engine } from '../../src/engine/engine';
import { DT_S } from '../../src/shared/constants';
import type { Scenario } from '../../src/shared/scenario-schema';
import { readPreset } from './helpers';

const s01 = readPreset('s01-activation-success');

/** S01 highway, hands off the wheel, no traffic; HFDS engages at 1.1 s (button at 0.1 s). */
export const m3Base: Scenario = {
  ...s01,
  driver: { eyesOnRoad: true, grip: { L: false, R: false, TOP: false, BOTTOM: false } },
  traffic: [],
  hazards: [],
  timeline: [{ t: 0.1, kind: 'driver', action: 'pressHfdsButton' }],
  expect: [],
  durationS: 300,
};

export const ticks = (s: number) => Math.round(s / DT_S);

export function build(change: (s: Scenario) => void = () => {}): Engine {
  const s = structuredClone(m3Base);
  change(s);
  return new Engine(s);
}

/** Steps for `seconds`, calling `each` after every tick. */
export function runFor(e: Engine, seconds: number, each?: (e: Engine) => void): Engine {
  for (let i = 0; i < ticks(seconds); i++) {
    e.step();
    each?.(e);
  }
  return e;
}
