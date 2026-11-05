import { describe, expect, it } from 'vitest';
import { Engine, runScenario } from '../../src/engine/engine';
import { presetIds, readPreset } from './helpers';

// Doc 15 Part A "Scenario validation": every preset passes the schema (scenario-schema
// test) and runs 100 ticks without error. Expectations run from M2 (scenarios.test.ts).
describe.each(presetIds())('preset %s', (id) => {
  it('runs 100 ticks without error and produces a snapshot', () => {
    const scenario = readPreset(id);
    const engine = runScenario(scenario, { ticks: 100 });
    expect(engine.tick).toBe(100);
    const snap = engine.snapshot({ paused: false, timeScale: 1 });
    expect(snap.scenarioId).toBe(id);
    expect(snap.simTime).toBeCloseTo(5, 9);
    expect(JSON.stringify(snap).length).toBeLessThan(20_000); // doc 15 B4 size budget
  });

  it('runs to its end deterministically', () => {
    const scenario = readPreset(id);
    const a = runScenario(scenario);
    const b = runScenario(scenario);
    expect(a.finished).not.toBeNull();
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('starts the ego in its preset lane at its preset speed', () => {
    const scenario = readPreset(id);
    const e = new Engine(scenario);
    const snap = e.snapshot({ paused: false, timeScale: 1 });
    expect(snap.ego.laneId).toBe(scenario.ego.laneId);
    expect(snap.ego.speedMph).toBeCloseTo(scenario.ego.speedMph, 9);
  });
});
