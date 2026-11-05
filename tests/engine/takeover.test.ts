import { describe, expect, it } from 'vitest';
import {
  FCS_TTC_THRESHOLD_S,
  POST_TAKEOVER_RECHECK_S,
  TAKEOVER_PERIOD_S,
} from '../../src/shared/constants';
import type { Engine } from '../../src/engine/engine';
import type { Scenario, TimelineEvent } from '../../src/shared/scenario-schema';
import { build, runFor } from './m3-helpers';

/**
 * Class A takeover core (doc 13 §6 rows "any engaged + Class A", "TAKEOVER_REQUESTED +
 * takeover confirmed", "driver brake"), pulled into M3 because S04 and S06 need it.
 * The 30 s period → minimal risk maneuver (SR7) is M4.
 */
const sharpCurve = (s: Scenario) =>
  (s.road.segments = [{ fromFt: 1500, toFt: 2500, curvatureRadiusFt: 700, direction: 'right' }]);

/** Engaged, then a Class A for the sharp curve at ≈ 11 s. */
function toTakeover(change: (s: Scenario) => void = () => {}): Engine {
  const e = build((s) => {
    sharpCurve(s);
    change(s);
  });
  runFor(e, 12);
  if (e.hfds.mode !== 'TAKEOVER_REQUESTED')
    throw new Error(`expected a takeover request, got ${e.hfds.mode}`);
  return e;
}

const at = (t: number, action: string, args?: Record<string, unknown>) =>
  ({ t, kind: 'driver', action, ...(args ? { args } : {}) }) as TimelineEvent;

describe('takeover request (UC19)', () => {
  it('[UC19][R28.1][R34.3][R46.2] Class A: flashing red, "Take steering control immediately.", warning listed', () => {
    const hmi = toTakeover().hfds.hmi.current;
    expect(hmi.lightBarStatus).toBe('FlashingRed');
    expect(hmi.displayedMessage).toBe('Take steering control immediately.');
    expect(hmi.activeWarnings).toEqual([
      expect.objectContaining({ warningClass: 'A', reason: 'CURVE_TOO_SHARP', isActive: true }),
    ]);
  });

  it('[UC19] chime or seat pulse per vehicle configuration (ISSUE-16)', () => {
    expect(toTakeover().hfds.hmi.current.seatVibration).toBe('pulse'); // S01 car: secondAlertMode seat
    const chime = toTakeover((s) => (s.vehicleConfig.secondAlertMode = 'chime')).hfds.hmi.current;
    expect(chime.audibleAlert).toBe(true);
    expect(chime.seatVibration).toBe('off');
  });

  it('[R45.5][R45.3] the takeover request is logged with a timestamp', () => {
    const e = toTakeover();
    const req = e.eventLog.entries.find((x) => x.type === 'takeover_request');
    expect(req?.t).toBeCloseTo(e.anchors.classA ?? -1, 9);
    expect(req?.reqs).toEqual(expect.arrayContaining(['R45.5', 'UC19', 'UC9']));
    expect(e.hfds.reclaimHistory).toHaveLength(1); // counts towards R41
  });

  it('[IR12][IR13] until the driver takes over: no acceleration, coast, hold the lane', () => {
    const e = toTakeover();
    const lane = e.road.laneCenterY(2);
    runFor(e, 10, (x) => {
      expect(x.hfds.mode).toBe('TAKEOVER_REQUESTED');
      expect(x.vehicleControl.appliedHfdsAccel).toBeLessThanOrEqual(0);
      expect(x.vehicleControl.ego.accel).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(x.vehicleControl.ego.y - lane)).toBeLessThan(0.05);
    });
  });

  it(`[SR7] shows the ${TAKEOVER_PERIOD_S} s takeover countdown (minimal risk maneuver in M4)`, () => {
    const e = toTakeover();
    runFor(e, 4);
    const timers = e.hfds.timers(e.simTime);
    expect(timers.takeoverRemainingS).toBeLessThan(TAKEOVER_PERIOD_S);
    expect(timers.takeoverRemainingS).toBeGreaterThan(TAKEOVER_PERIOD_S - 6);
  });
});

describe('takeover confirmation (R35, UC18)', () => {
  it('[R35] one grip area is not enough; two confirm the takeover', () => {
    const e = toTakeover();
    e.enqueueInput({ kind: 'setGrip', L: true });
    runFor(e, 0.5);
    expect(e.hfds.mode).toBe('TAKEOVER_REQUESTED');
    e.enqueueInput({ kind: 'setGrip', TOP: true });
    runFor(e, 0.1);
    expect(e.hfds.mode).toBe('UNAVAILABLE');
    expect(
      e.eventLog.entries.some((x) => x.type === 'disengagement' && x.reqs.includes('R35')),
    ).toBe(true);
  });

  it('[UC18][IR25] steering confirms the takeover', () => {
    const e = toTakeover();
    e.enqueueInput({ kind: 'setSteer', value: 0.1 });
    runFor(e, 0.1);
    expect(e.hfds.mode).toBe('UNAVAILABLE');
  });

  it('[R40][R50.1] control returns to the driver with a banner; ACC is cancelled; the warning clears', () => {
    const e = toTakeover();
    e.enqueueInput({ kind: 'setGrip', L: true, R: true });
    runFor(e, 0.1);
    const hmi = e.hfds.hmi.current;
    expect(hmi.controlTransferBanner).toBe('You are in control');
    expect(hmi.lightBarStatus).toBe('Off');
    expect(hmi.activeWarnings).toEqual([]);
    expect(e.hfds.speedManagement.active).toBe(false);
    expect(e.anchors.takeover).toBeDefined();
  });

  it(`[R38.4] engagement checks re-run ${POST_TAKEOVER_RECHECK_S} s after the takeover`, () => {
    const e = build((s) => {
      s.road.segments = [{ fromFt: 1500, toFt: 1600, curvatureRadiusFt: 700, direction: 'right' }];
      s.timeline.push(at(12.5, 'setGrip', { L: true, R: true }));
    });
    runFor(e, 13);
    const takeover = e.anchors.takeover ?? NaN;
    runFor(e, takeover + POST_TAKEOVER_RECHECK_S - 0.2 - e.simTime);
    expect(e.hfds.available).toBe(false);
    expect(e.hfds.availabilityChecks.find((c) => c.id === 'R38')?.pass).toBe(false);
    runFor(e, 0.4);
    expect(e.hfds.available).toBe(true);
    expect(e.hfds.hmi.current.availableIndicator).toBe(true);
  });

  it('[UC18] the scripted driver can steer into another lane after the request (takeoverOnClassA)', () => {
    const e = build((s) => {
      sharpCurve(s);
      s.timeline.push({
        t: null,
        kind: 'driver',
        action: 'takeoverOnClassA',
        args: { delayS: 1, grip: ['L', 'R'], steerToLaneId: 3 },
      });
    });
    runFor(e, 25);
    expect(e.road.laneIdAt(e.vehicleControl.ego.y)).toBe(3);
    expect(Math.abs(e.vehicleControl.ego.y - e.road.laneCenterY(3))).toBeLessThan(0.5);
    expect(e.driver.steeringInput).toBe(0);
  });
});

describe('driver braking (IR15, R50)', () => {
  it('[IR15][R50.1][R50.2][R50.3][R40] braking while hands-free disengages, cancels ACC and logs it', () => {
    const e = build((s) => s.timeline.push(at(5, 'setBrake', { pressed: true, rate: 4 })));
    runFor(e, 5.1);
    expect(e.hfds.mode).toBe('UNAVAILABLE'); // R38.4 recheck after a driver takeover (A-53)
    expect(e.hfds.speedManagement.active).toBe(false);
    expect(e.hfds.hmi.current.controlTransferBanner).toBe('You are in control');
    const dis = e.eventLog.entries.find((x) => x.type === 'disengagement');
    expect(dis?.t).toBeCloseTo(5, 9);
    expect(dis?.reqs).toEqual(expect.arrayContaining(['IR15', 'R50.3', 'R45.2']));
  });

  it('[IR15] braking during a takeover request confirms the takeover', () => {
    const e = toTakeover();
    e.enqueueInput({ kind: 'setBrake', pressed: true, rate: 3 });
    runFor(e, 0.1);
    expect(e.hfds.mode).toBe('UNAVAILABLE');
    expect(
      e.eventLog.entries.some(
        (x) =>
          x.type === 'disengagement' && x.message.startsWith('Takeover confirmed: driver braked'),
      ),
    ).toBe(true);
  });

  it('[IR25][A-24] driver throttle overrides ACC but HFDS stays engaged', () => {
    const e = build((s) => s.timeline.push(at(3, 'setThrottle', { value: 0.5 })));
    runFor(e, 4);
    expect(e.hfds.mode).toBe('HANDS_FREE');
    expect(e.vehicleControl.lastSource).toBe('driverThrottle');
  });
});

describe('Forward Collision System (A-25)', () => {
  it(`[IR22] brakes at maxBrakingDecel when time-to-collision drops below ${FCS_TTC_THRESHOLD_S} s, also with HFDS off`, () => {
    // Manual driving (no button press) at 62 mph towards a 35 mph car 150 ft ahead.
    const e = build((s) => {
      s.timeline = [];
      s.traffic = [{ id: 2, sizeClass: 'Car', laneId: 2, sFt: 165, speedMph: 35 }];
    });
    let firstTtc: number | null = null;
    runFor(e, 8, (x) => {
      if (x.hfds.forwardCollision.braking && firstTtc === null) {
        const gap = x.hfds.driverAssist.leadGap ?? 0;
        const closing = x.vehicleControl.ego.speed - (x.traffic.byId(2)?.speed ?? 0);
        firstTtc = gap / closing;
        expect(x.vehicleControl.lastSource).toBe('fcs');
      }
    });
    expect(firstTtc).not.toBeNull();
    expect(firstTtc ?? 99).toBeLessThan(FCS_TTC_THRESHOLD_S + 0.1);
    expect(e.eventLog.entries.filter((x) => x.source === 'ForwardCollisionSystem')).toHaveLength(1);
    // It held until the ego no longer closed on the car, so the gap never reached 0.
    expect(e.hfds.driverAssist.leadGap ?? 0).toBeGreaterThan(0);
    expect(e.vehicleControl.currentSpeed).toBeLessThanOrEqual(35.5);
  });

  it('[IR22] the HMI shows the forward collision alert while it brakes', () => {
    const e = build((s) => {
      s.timeline = [];
      s.traffic = [{ id: 2, sizeClass: 'Car', laneId: 2, sFt: 120, speedMph: 30 }];
    });
    runFor(e, 0.5);
    expect(e.hfds.hmi.current.forwardCollisionAlert).toBe(true);
  });
});
