import { describe, expect, it } from 'vitest';
import type { Engine } from '../../src/engine/engine';
import { MPH_TO_FTPS, STEER_RESUME_STABLE_S } from '../../src/shared/constants';
import type { Scenario, TimelineEvent } from '../../src/shared/scenario-schema';
import { build, runFor } from './m3-helpers';

/** R39 steering pause / resume and the M4 Class A causes (doc 13 §6, §7). Engaged at 1.1 s. */
const at = (t: number, action: string, args?: Record<string, unknown>) =>
  ({ t, kind: 'driver', action, ...(args ? { args } : {}) }) as TimelineEvent;

describe('R39 driver steering', () => {
  const steerAndHold = (s: Scenario) =>
    s.timeline.push(
      at(3, 'setGrip', { L: true, R: true }),
      at(3, 'setSteer', { value: 0.1 }),
      at(4, 'setSteer', { value: 0 }),
    );

  it('[R39][R39.1][R34.2][IR25] steering while hands-free shows pulsing blue; HFDS stops steering, ACC continues', () => {
    const e = build(steerAndHold);
    runFor(e, 3.1);
    expect(e.hfds.mode).toBe('DRIVER_STEERING');
    expect(e.hfds.hmi.current.lightBarStatus).toBe('PulsingBlue');
    expect(e.hfds.speedManagement.active).toBe(true);
    expect(e.vehicleControl.currentSteeringAngle).toBeCloseTo(0.1 * 15, 9); // the driver's input
  });

  it(`[R39.2][R35] resumes after ${STEER_RESUME_STABLE_S} s of steady speed, firm grip and no steering`, () => {
    const e = build(steerAndHold);
    runFor(e, 4 + STEER_RESUME_STABLE_S - 0.05); // the window opens at 4.0 s; last tick starts at 6.9 s
    expect(e.hfds.mode).toBe('DRIVER_STEERING');
    runFor(e, 0.1);
    expect(e.hfds.mode).toBe('HANDS_FREE');
    expect(e.hfds.hmi.current.lightBarStatus).toBe('SolidGreen');
  });

  it('[R39.2][R35] does not resume without a firm grip on two areas', () => {
    const e = build((s) =>
      s.timeline.push(
        at(3, 'setGrip', { L: true }),
        at(3, 'setSteer', { value: 0.1 }),
        at(4, 'setSteer', { value: 0 }),
      ),
    );
    runFor(e, 10);
    expect(e.hfds.mode).toBe('DRIVER_STEERING');
  });

  it('[R39.2][A-54] a speed change of more than 1.0 mph restarts the 3 s window', () => {
    const e = build((s) => {
      steerAndHold(s);
      // Driver throttle (A-24) between 5 and 6 s: +6 ft/s² × 0.5 → ≈ 2 mph faster.
      s.timeline.push(at(5, 'setThrottle', { value: 1 }), at(5.5, 'setThrottle', { value: 0 }));
    });
    runFor(e, 7.2);
    expect(e.hfds.mode).toBe('DRIVER_STEERING'); // would have resumed at 7.0 s without the speed change
    runFor(e, 4);
    expect(e.hfds.mode).toBe('HANDS_FREE');
  });

  it('[R39] steering during a takeover request is a takeover, not a pause', () => {
    const e = build((s) => {
      s.road.segments = [{ fromFt: 1500, toFt: 2500, curvatureRadiusFt: 700, direction: 'left' }];
    });
    runFor(e, 12);
    expect(e.hfds.mode).toBe('TAKEOVER_REQUESTED');
    e.enqueueInput({ kind: 'setSteer', value: 0.2 });
    runFor(e, 0.1);
    expect(e.hfds.mode).toBe('UNAVAILABLE');
  });
});

describe('Class A causes added in M4 (doc 13 §7)', () => {
  const engaged = (change: (s: Scenario) => void = () => {}): Engine => {
    const e = build(change);
    runFor(e, 2);
    expect(e.hfds.mode).toBe('HANDS_FREE');
    return e;
  };
  const reason = (e: Engine) => e.hfds.activeClassA?.reason;

  it('[IR26][UC10] an object in the lane within the selection distance → HAZARD_IN_LANE, no avoidance', () => {
    const e = engaged();
    e.enqueueInject({
      kind: 'spawnHazard',
      args: { type: 'StoppedVehicle', laneId: 2, aheadFt: 500 },
    });
    runFor(e, 0.1);
    expect(reason(e)).toBe('HAZARD_IN_LANE');
    const lane = e.road.laneCenterY(2);
    runFor(e, 1, (x) => expect(Math.abs(x.vehicleControl.ego.y - lane)).toBeLessThan(0.05)); // IR26: no swerve
  });

  it('[IR26] a hazard beyond the selection distance or in another lane is not a cause', () => {
    const e = engaged();
    e.enqueueInject({ kind: 'spawnHazard', args: { type: 'Debris', laneId: 2, aheadFt: 900 } });
    e.enqueueInject({ kind: 'spawnHazard', args: { type: 'Pothole', laneId: 1, aheadFt: 200 } });
    runFor(e, 0.1);
    expect(e.hfds.mode).toBe('HANDS_FREE');
  });

  it('[IR5][IR5.4][A-29] leaving the ODD while engaged (rain) → ODD_EXIT takeover request', () => {
    const e = engaged();
    e.enqueueInject({ kind: 'setEnvironment', args: { weather: 'Rain' } });
    runFor(e, 0.1);
    expect(reason(e)).toBe('ODD_EXIT');
    expect(e.eventLog.entries.find((x) => x.type === 'takeover_request')?.reqs).toContain('IR5.4');
  });

  it('[IR16][A-29] the map becoming outdated while engaged is an ODD exit', () => {
    const e = engaged();
    e.map.lastUpdated = '2025-01-01';
    runFor(e, 0.1);
    expect(reason(e)).toBe('ODD_EXIT');
  });

  it('[IR14][UC5] an invalid blue path → INVALID_PATH takeover request', () => {
    const e = engaged();
    e.hfds.pathPrediction.status = 'Faulted';
    runFor(e, 0.1);
    expect(reason(e)).toBe('INVALID_PATH');
  });

  it('[IR1][UC17][A-20] less than 10 s of enabled road ahead → END_OF_ENABLED_ROAD', () => {
    const v = 62 * MPH_TO_FTPS;
    const e = build(
      (s) => (s.road.segments = [{ fromFt: 2 * v + 12 * v, toFt: 40000, enabledForHfds: false }]),
    );
    runFor(e, 4.5);
    expect(reason(e)).toBe('END_OF_ENABLED_ROAD');
  });

  it('[IR5.10] a forward-collision escalation while engaged → FCW_ESCALATION', () => {
    const e = engaged();
    e.enqueueInject({ kind: 'fcwEscalation' });
    runFor(e, 0.1);
    expect(reason(e)).toBe('FCW_ESCALATION');
  });
});
