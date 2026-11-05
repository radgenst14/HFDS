import { describe, expect, it } from 'vitest';
import { stepsForRealTick, simTimeOf } from '../../src/engine/clock';
import { Engine, runScenario, validateClientAction } from '../../src/engine/engine';
import { TimelineRunner } from '../../src/engine/scenario/timeline';
import { integrateEgo } from '../../src/engine/world/ego-kinematics';
import { Road } from '../../src/engine/world/road';
import {
  DRIVER_DEFAULT_BRAKE_FTPS2,
  DRIVER_MAX_ACCEL_FTPS2,
  DRIVER_MAX_LATERAL_SPEED_FTPS,
  DT_S,
  MPH_TO_FTPS,
  TRAFFIC_DEFAULT_SPEED_CHANGE_FTPS2,
  VEHICLE_DIMENSIONS_FT,
} from '../../src/shared/constants';
import type { TimelineEvent } from '../../src/shared/scenario-schema';
import { readPreset, withChanges } from './helpers';

const sandbox = readPreset('s00-sandbox');
const quiet = withChanges(sandbox, { traffic: [] });
const ticks = (s: number) => Math.round(s / DT_S);

describe('fixed tick and time scale', () => {
  it('[IR29] tick is 50 ms and sim time is tick × 0.05 s', () => {
    expect(DT_S).toBeCloseTo(0.05, 12);
    expect(simTimeOf(40)).toBeCloseTo(2.0, 12);
    const e = runScenario(quiet, { ticks: 200 });
    expect(e.simTime).toBeCloseTo(10, 9);
  });

  it.each([
    [1, [1, 1, 1, 1]],
    [2, [2, 2, 2, 2]],
    [4, [4, 4, 4, 4]],
    [0.5, [0, 1, 0, 1]],
  ] as const)('[A-34] time scale %s× runs %j fixed steps per real tick', (scale, expected) => {
    let acc = 0;
    const got: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = stepsForRealTick(scale, acc);
      acc = r.accumulator;
      got.push(r.steps);
    }
    expect(got).toEqual(expected);
  });
});

describe('timeline runner (doc 14)', () => {
  const ev = (t: number, text: string): TimelineEvent => ({ t, kind: 'note', args: { text } });

  it('applies an event at the first tick whose start time is ≥ t', () => {
    const r = new TimelineRunner([ev(2.0, 'a'), ev(0.12, 'b')]);
    expect(r.due(simTimeOf(2))).toEqual([]); // 0.10 s < 0.12 s
    expect(r.due(simTimeOf(3)).map((e) => (e.kind === 'note' ? e.args.text : ''))).toEqual(['b']);
    expect(r.due(simTimeOf(39))).toEqual([]);
    expect(r.due(simTimeOf(40)).length).toBe(1); // 2.0 s despite float rounding
    expect(r.remaining).toBe(0);
  });

  it('keeps file order for equal times and sets reactive events aside', () => {
    const r = new TimelineRunner([
      ev(1, 'first'),
      {
        t: null,
        kind: 'driver',
        action: 'takeoverOnClassA',
        args: { delayS: 3, grip: ['L', 'R'] },
      },
      ev(1, 'second'),
    ]);
    expect(r.reactive).toHaveLength(1);
    expect(r.due(1).map((e) => (e.kind === 'note' ? e.args.text : ''))).toEqual([
      'first',
      'second',
    ]);
  });

  it('scripted driver actions reach the Driver at their time', () => {
    const scen = withChanges(quiet, {
      timeline: [{ t: 1.0, kind: 'driver', action: 'setBrake', args: { pressed: true, rate: 8 } }],
    });
    const e = new Engine(scen);
    for (let i = 0; i < ticks(1.0); i++) e.step();
    expect(e.driver.brakePressed).toBe(false);
    e.step();
    expect(e.driver.brakePressed).toBe(true);
    expect(e.driver.brakeRate).toBe(8);
  });
});

describe('manual driving (A-26, A-36, IR25)', () => {
  it('[A-26] with no pedal input the ego holds its speed', () => {
    const e = runScenario(quiet, { ticks: ticks(10) });
    expect(e.vehicleControl.currentSpeed).toBeCloseTo(65, 9);
    expect(e.vehicleControl.ego.s).toBeCloseTo(65 * MPH_TO_FTPS * 10, 6);
  });

  it('[IR25] driver throttle accelerates at throttle × max accel', () => {
    const e = runScenario(quiet, {
      ticks: ticks(2),
      inputLog: [{ tick: 0, type: 'input', action: { kind: 'setThrottle', value: 0.5 } }],
    });
    expect(e.vehicleControl.ego.speed).toBeCloseTo(
      65 * MPH_TO_FTPS + 0.5 * DRIVER_MAX_ACCEL_FTPS2 * 2,
      6,
    );
  });

  it('[IR25] driver brake decelerates at the requested rate and stops at 0, not below', () => {
    const e = runScenario(quiet, {
      ticks: ticks(20),
      inputLog: [{ tick: 0, type: 'input', action: { kind: 'setBrake', pressed: true } }],
    });
    expect(e.driver.brakeRate).toBe(DRIVER_DEFAULT_BRAKE_FTPS2);
    expect(e.vehicleControl.ego.speed).toBe(0);
    // 95.33 ft/s at 10 ft/s² stops in ~9.5 s; stopping distance v²/2a.
    const v = 65 * MPH_TO_FTPS;
    expect(e.vehicleControl.ego.s).toBeCloseTo((v * v) / (2 * DRIVER_DEFAULT_BRAKE_FTPS2), -1);
  });

  it('[IR25] steering moves the ego sideways, + = left, and the lane follows', () => {
    const e = runScenario(quiet, {
      ticks: ticks(3),
      inputLog: [{ tick: 0, type: 'input', action: { kind: 'setSteer', value: 1 } }],
    });
    const road = e.road;
    expect(e.vehicleControl.ego.y).toBeCloseTo(
      road.laneCenterY(2) + 3 * DRIVER_MAX_LATERAL_SPEED_FTPS,
      9,
    );
    expect(road.laneIdAt(e.vehicleControl.ego.y)).toBe(3);
    expect(e.vehicleControl.currentSteeringAngle).toBeGreaterThan(0);
  });

  it('[A-36] the ego cannot leave the paved road', () => {
    const bounds = new Road(quiet.road).pavedBounds();
    let s = { s: 0, y: 0, speed: 90, accel: 0, heading: 0 };
    for (let i = 0; i < 400; i++) s = integrateEgo(s, { accel: 0, lateralSpeed: -4 }, DT_S, bounds);
    expect(s.y).toBe(bounds.minY);
  });
});

describe('road (A-28, A-38)', () => {
  const road = new Road(sandbox.road);
  it('lane 1 is at y = 0, lanes are 3.66 m apart, shoulder is lane 0', () => {
    expect(road.laneWidthFt).toBeCloseTo(3.66 * 3.28084, 9);
    expect(road.laneCenterY(1)).toBe(0);
    expect(road.laneCenterY(3)).toBeCloseTo(2 * road.laneWidthFt, 9);
    expect(road.laneIdAt(road.laneCenterY(0))).toBe(0);
    expect(road.getLanes(0).map((l) => l.laneId)).toEqual([0, 1, 2, 3]);
  });

  it('[IR2] segment markings flags make a lane fail bothMarkingsVisible()', () => {
    const r = new Road({
      ...sandbox.road,
      segments: [{ fromFt: 100, toFt: 200, markings: { left: false, right: true } }],
    });
    expect(r.getLanes(50).every((l) => l.bothMarkingsVisible())).toBe(true);
    expect(
      r
        .getLanes(150)
        .find((l) => l.laneId === 2)
        ?.bothMarkingsVisible(),
    ).toBe(false);
  });
});

describe('scripted traffic (doc 14 behavior)', () => {
  it('[R6] vehicles take the A-18 dimensions of their size class', () => {
    const e = new Engine(sandbox);
    const semi = e.traffic.byId(2);
    expect(semi?.length).toBe(VEHICLE_DIMENSIONS_FT.SemiTruck.length);
    expect(semi?.width).toBe(VEHICLE_DIMENSIONS_FT.SemiTruck.width);
    expect(e.traffic.byId(1)?.s).toBe(700); // sFt is relative to the ego at s = 0
  });

  it('[A-33] setSpeed changes speed at 5 ft/s² by default, then holds', () => {
    const scen = withChanges(quiet, {
      traffic: [
        {
          id: 1,
          sizeClass: 'Car',
          laneId: 2,
          sFt: 500,
          speedMph: 60,
          behavior: [{ t: 1, action: 'setSpeed', speedMph: 40 }],
        },
      ],
    });
    const e = new Engine(scen);
    for (let i = 0; i < ticks(2); i++) e.step();
    const v = e.traffic.byId(1);
    expect(v?.speed).toBeCloseTo(60 * MPH_TO_FTPS - TRAFFIC_DEFAULT_SPEED_CHANGE_FTPS2 * 1, 6);
    for (let i = 0; i < ticks(20); i++) e.step();
    expect(v?.speed).toBeCloseTo(40 * MPH_TO_FTPS, 9);
  });

  it('changeLane moves to the target lane over durationS', () => {
    const scen = withChanges(quiet, {
      traffic: [
        {
          id: 1,
          sizeClass: 'Car',
          laneId: 1,
          sFt: 300,
          speedMph: 60,
          behavior: [{ t: 0, action: 'changeLane', toLaneId: 2, durationS: 2 }],
        },
      ],
    });
    const e = new Engine(scen);
    for (let i = 0; i < ticks(1); i++) e.step();
    const v = e.traffic.byId(1);
    expect(v?.y).toBeCloseTo(e.road.laneWidthFt / 2, 6);
    expect(v?.lateralVelocity).toBeCloseTo(e.road.laneWidthFt / 2, 6);
    for (let i = 0; i < ticks(1.5); i++) e.step();
    expect(v?.y).toBeCloseTo(e.road.laneCenterY(2), 9);
    expect(v?.laneId).toBe(2);
  });

  it('[IR8.1] Director trafficHardBrake decelerates for durationS, then holds', () => {
    const scen = withChanges(quiet, {
      traffic: [{ id: 7, sizeClass: 'Truck', laneId: 2, sFt: 400, speedMph: 60 }],
    });
    const eng = new Engine(scen);
    eng.enqueueInject({
      kind: 'trafficHardBrake',
      args: { vehicleId: 7, decelFtps2: 12, durationS: 1 },
    });
    for (let i = 0; i < ticks(3); i++) eng.step();
    expect(eng.traffic.byId(7)?.speed).toBeCloseTo(60 * MPH_TO_FTPS - 12, 6);
  });
});

describe('Director injections handled in M1', () => {
  it('spawnHazard places a hazard aheadFt in front of the ego', () => {
    const e = new Engine(quiet);
    for (let i = 0; i < 20; i++) e.step();
    const egoS = e.vehicleControl.ego.s;
    e.enqueueInject({ kind: 'spawnHazard', args: { type: 'Debris', laneId: 2, aheadFt: 500 } });
    e.step();
    expect(e.hazards.all.at(-1)?.s).toBeCloseTo(egoS + 500, 9);
  });

  it('injections without an M1 effect are logged as not simulated yet', () => {
    const e = new Engine(quiet);
    e.enqueueInject({ kind: 'collision', args: { airbag: true } });
    const r = e.step();
    expect(r.entries.some((x) => /not simulated yet/.test(x.message))).toBe(true);
  });

  it('client intents are validated with the timeline schema', () => {
    expect(validateClientAction('input', { kind: 'setThrottle', value: 0.5 })).toBeNull();
    expect(validateClientAction('input', { kind: 'setThrottle', value: 3 })).toMatch(/setThrottle/);
    expect(validateClientAction('inject', { kind: 'ignitionCycle' })).toBeNull();
    expect(
      validateClientAction('inject', {
        kind: 'failSensor',
        args: { sensorId: 'NOPE', status: 'Failed' },
      }),
    ).not.toBeNull();
  });
});

describe('run end (A-37) and log (R45)', () => {
  it('stops at durationS', () => {
    const e = runScenario(withChanges(quiet, { durationS: 3 }), { ticks: 1000 });
    expect(e.finished).toBe('duration');
    expect(e.simTime).toBeCloseTo(3, 9);
  });

  it('stops at the end of the road', () => {
    const e = runScenario(withChanges(quiet, { road: { ...quiet.road, lengthFt: 500 } }), {
      ticks: 1000,
    });
    expect(e.finished).toBe('end_of_road');
    expect(e.vehicleControl.ego.s).toBeGreaterThanOrEqual(500);
  });

  it('[R45] every log entry has a timestamp', () => {
    const e = runScenario(quiet, { ticks: 100 });
    expect(e.eventLog.entries.length).toBeGreaterThan(0);
    expect(e.eventLog.entries.every((x) => Number.isFinite(x.t))).toBe(true);
    expect(e.exportLog()).toMatchObject({ scenarioId: 's00-sandbox', seed: 1000 });
  });
});
