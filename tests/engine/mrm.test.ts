import { describe, expect, it } from 'vitest';
import type { Engine } from '../../src/engine/engine';
import { MinimalRiskManeuver } from '../../src/engine/hfds/mrm';
import { Road } from '../../src/engine/world/road';
import { TrafficModel } from '../../src/engine/world/traffic';
import {
  MPH_TO_FTPS,
  MRM_MIN_LANE_DWELL_S,
  MRM_SHOULDER_TIME_LIMIT_S,
  ONSTAR_CONNECT_S,
} from '../../src/shared/constants';
import type { Scenario } from '../../src/shared/scenario-schema';
import { build, m3Base, runFor } from './m3-helpers';

/**
 * Minimal risk maneuver (SR1, SR1.1, SR1.1.1, SR1.1.2, SR1.2–SR1.4, IR10; doc 13 §8).
 * Started by an ignored takeover request (SR7): markings vanish at 1500 ft.
 */
const ignoredTakeover = (s: Scenario) => {
  s.road.segments = [{ fromFt: 1500, toFt: 30000, markings: { left: false, right: false } }];
};

/** Runs until the MRM starts (SR7: 30 s after the takeover request). */
function untilMrm(change: (s: Scenario) => void = () => {}): Engine {
  const e = build((s) => {
    ignoredTakeover(s);
    change(s);
  });
  for (let i = 0; i < 2000 && e.hfds.mode !== 'MINIMAL_RISK_MANEUVER'; i++) e.step();
  if (e.hfds.mode !== 'MINIMAL_RISK_MANEUVER') throw new Error(`no MRM: ${e.hfds.mode}`);
  return e;
}

describe('start (SR7, SR1.2)', () => {
  it('[SR7][UC21] an ignored takeover request starts the maneuver after 30 s with hazards on', () => {
    const e = untilMrm();
    expect((e.anchors.mrm ?? 0) - (e.anchors.classA ?? 0)).toBeCloseTo(30, 6);
    expect(e.hfds.hmi.current.lightBarStatus).toBe('FlashingRed');
    expect(e.hfds.hmi.current.hazardLights).toBe(true);
  });
});

describe('to the shoulder (SR1.1, SR1.1.2)', () => {
  it('[SR1.1][SR1.1.2] moves one lane at a time with ≥ 2 s per entered lane, then stops on the shoulder', () => {
    const e = untilMrm((s) => (s.ego.laneId = 3));
    runFor(e, 60);
    const lanes = e.hfds.mrm?.lanes.map((l) => l.lane);
    expect(lanes).toEqual([3, 2, 1, 0]);
    const entered = e.hfds.mrm?.lanes ?? [];
    for (let i = 1; i < entered.length - 1; i++) {
      const dwell = (entered[i + 1]?.enteredAt ?? 0) - (entered[i]?.enteredAt ?? 0);
      expect(dwell).toBeGreaterThanOrEqual(MRM_MIN_LANE_DWELL_S);
    }
    expect(e.hfds.mode).toBe('STOPPED_LOCKOUT');
    expect(e.road.laneIdAt(e.vehicleControl.ego.y)).toBe(0);
    expect(e.vehicleControl.ego.speed).toBe(0);
  });

  it('[SR1.3][SR1.4][A-55] at the stop the doors unlock and OnStar connects after 3 s', () => {
    const e = untilMrm();
    runFor(e, 40);
    const stoppedAt = e.hfds.mrm?.stoppedAt ?? NaN;
    expect(e.hfds.hmi.current.doorsUnlocked).toBe(true);
    expect(e.hfds.hmi.current.onStar).toBe('connected');
    const connected = e.eventLog.entries.find(
      (x) => x.reqs.includes('SR1.3') && /connected/.test(x.message),
    );
    expect((connected?.t ?? 0) - stoppedAt).toBeCloseTo(ONSTAR_CONNECT_S, 1);
  });

  it('[A-56][IR12] coasts while changing lanes and never accelerates', () => {
    const e = untilMrm();
    runFor(e, 30, (x) => expect(x.vehicleControl.appliedHfdsAccel).toBeLessThanOrEqual(0));
  });
});

describe('stop in lane (SR1.1, SR1.1.1)', () => {
  it('[SR1.1] without a right shoulder the vehicle stops in its lane', () => {
    const e = untilMrm((s) => (s.road.rightShoulder = false));
    expect(e.hfds.mrm?.stopInLane).toBe(true);
    runFor(e, 30);
    expect(e.road.laneIdAt(e.vehicleControl.ego.y)).toBe(2);
    expect(e.hfds.mode).toBe('STOPPED_LOCKOUT');
  });

  it('[SR1.1.1][A-23] a vehicle alongside in the target lane blocks the shoulder → stop in lane', () => {
    const e = untilMrm((s) => {
      s.traffic = [{ id: 3, sizeClass: 'Car', laneId: 1, sFt: 10, speedMph: 62 }];
      s.ego.speedMph = 62;
    });
    // The ego coasted for 30 s and the car kept 62 mph, so make it pace the ego again.
    const car = e.traffic.byId(3);
    if (!car) throw new Error('no car');
    car.s = e.vehicleControl.ego.s + 10;
    car.speed = e.vehicleControl.ego.speed;
    runFor(e, 0.1);
    expect(e.hfds.mrm?.stopInLane).toBe(true);
    expect(e.hfds.mrm?.why).toMatch(/lane 1 not clear/);
  });

  it('[SR1.1.1] the time check falls back as soon as the remaining lane changes no longer fit', () => {
    const road = new Road(m3Base.road);
    const traffic = new TrafficModel([], 0, road);
    const ego = { s: 0, y: road.laneCenterY(2), speed: 30, accel: 0, heading: 0 };
    const mrm = new MinimalRiskManeuver('test', { t: 0, ego, road, traffic });
    expect(mrm.stopInLane).toBe(false);
    // Lane 2 needs two lane changes of 3 s plus 2 s dwell each = 10 s; the ego never moves.
    mrm.update({ t: 49.95, ego, road, traffic });
    expect(mrm.stopInLane).toBe(false);
    mrm.update({ t: 50.05, ego, road, traffic });
    expect(mrm.stopInLane).toBe(true);
    expect(mrm.why).toMatch(/needs 10\.0 s/);
  });

  it(`[SR1.1.1] after ${MRM_SHOULDER_TIME_LIMIT_S} s without reaching the shoulder it stops in lane`, () => {
    const road = new Road(m3Base.road);
    const traffic = new TrafficModel([], 0, road);
    const ego = { s: 0, y: road.laneCenterY(1), speed: 30, accel: 0, heading: 0 };
    const mrm = new MinimalRiskManeuver('test', { t: 0, ego, road, traffic });
    mrm.update({ t: MRM_SHOULDER_TIME_LIMIT_S, ego, road, traffic });
    expect(mrm.stopInLane).toBe(true);
    expect(mrm.why).toMatch(/within 60 s/);
  });

  it('[SR1.1.1] a check failing mid-maneuver switches to a stop in the current lane', () => {
    const e = untilMrm((s) => (s.ego.laneId = 3));
    runFor(e, 4); // now in lane 2 or moving towards it
    const lane = e.road.laneIdAt(e.vehicleControl.ego.y);
    const target = Math.max(0, lane - 1);
    e.traffic.vehicles.push(
      ...new TrafficModel(
        [
          {
            id: 9,
            sizeClass: 'Truck',
            laneId: target,
            sFt: e.vehicleControl.ego.s + 5,
            speedMph: e.vehicleControl.ego.speed / MPH_TO_FTPS,
          },
        ],
        0,
        e.road,
      ).vehicles,
    );
    runFor(e, 0.2);
    expect(e.hfds.mrm?.stopInLane).toBe(true);
    runFor(e, 30);
    expect(e.road.laneIdAt(e.vehicleControl.ego.y)).toBe(e.hfds.mrm?.stopLane);
  });
});

describe('lockout and driver authority (IR10, A-21, IR25)', () => {
  it('[IR10] after the stop HFDS stays unavailable until an ignition cycle', () => {
    const e = untilMrm();
    runFor(e, 40);
    expect(e.hfds.mode).toBe('STOPPED_LOCKOUT');
    expect(e.hfds.availabilityChecks.find((c) => c.id === 'IR10')?.pass).toBe(false);
    e.enqueueInput({ kind: 'pressHfdsButton' });
    runFor(e, 0.1);
    expect(e.hfds.mode).toBe('STOPPED_LOCKOUT');
    e.enqueueInject({ kind: 'ignitionCycle' });
    runFor(e, 0.1);
    expect(e.hfds.lockedUntilIgnition).toBe(false);
    expect(e.hfds.availabilityChecks.find((c) => c.id === 'IR10')?.pass).toBe(true);
    expect(e.hfds.hmi.current.hazardLights).toBe(false);
  });

  it('[IR25][A-21] braking during the maneuver returns control; hazards stay on', () => {
    const e = untilMrm();
    e.enqueueInput({ kind: 'setBrake', pressed: true, rate: 3 });
    runFor(e, 0.1);
    expect(e.hfds.mode).toBe('UNAVAILABLE');
    expect(e.hfds.hmi.current.hazardLights).toBe(true);
    expect(e.hfds.mrm).toBeNull();
  });

  it('[IR25][A-21] gripping and steering ends the maneuver; gripping alone does not', () => {
    const e = untilMrm();
    e.enqueueInput({ kind: 'setGrip', L: true, R: true });
    runFor(e, 0.2);
    expect(e.hfds.mode).toBe('MINIMAL_RISK_MANEUVER');
    e.enqueueInput({ kind: 'setSteer', value: 0.1 });
    runFor(e, 0.1);
    expect(e.hfds.mode).toBe('UNAVAILABLE');
  });

  it('[SR1] the HFDS button cannot cancel the maneuver', () => {
    const e = untilMrm();
    e.enqueueInput({ kind: 'pressHfdsButton' });
    runFor(e, 0.1);
    expect(e.hfds.mode).toBe('MINIMAL_RISK_MANEUVER');
  });
});
