import { describe, expect, it } from 'vitest';
import { ACC_MAX_ACCEL_FTPS2, COAST_DECEL_FTPS2, MPH_TO_FTPS } from '../../src/shared/constants';
import { build, runFor } from './m3-helpers';

/** ACC following (doc 13 §3; R5, R21–R25, IR9, IR27) with the revised A-05 zones. */
const lead = (sFt: number, speedMph: number, laneId = 2) => ({
  id: 1,
  sizeClass: 'Car' as const,
  laneId,
  sFt,
  speedMph,
});

describe('no lead (R24, IR27)', () => {
  it('[R24] resumes the set speed at no more than 3 ft/s² (A-09)', () => {
    let maxAccel = 0;
    const e = build((s) => ((s.ego.speedMph = 60), (s.ego.setSpeedMph = 70)));
    runFor(e, 15, (x) => (maxAccel = Math.max(maxAccel, x.vehicleControl.ego.accel)));
    expect(e.vehicleControl.currentSpeed).toBeCloseTo(70, 1);
    expect(maxAccel).toBeLessThanOrEqual(ACC_MAX_ACCEL_FTPS2 + 1e-9);
  });

  it('[IR27] never commands a speed above 85 mph, even with a 90 mph set speed', () => {
    let top = 0;
    const e = build((s) => ((s.ego.speedMph = 80), (s.ego.setSpeedMph = 90)));
    runFor(e, 20, (x) => (top = Math.max(top, x.vehicleControl.currentSpeed)));
    expect(e.hfds.speedManagement.setSpeed).toBe(85);
    expect(top).toBeLessThanOrEqual(85 + 1e-9);
    expect(top).toBeGreaterThan(84.5);
  });
});

describe('closing and coast zones (R5, R21, IR9; A-05)', () => {
  it('[R4][R5] a slower lead inside the selection distance is followed; the closing zone holds the current speed', () => {
    const e = build((s) => ((s.ego.speedMph = 65), (s.traffic = [lead(515, 55)])));
    const speeds: number[] = [];
    runFor(e, 12, (x) => {
      if (x.hfds.speedManagement.currentZone === 'Closing')
        speeds.push(x.vehicleControl.currentSpeed);
    });
    expect(e.hfds.driverAssist.leadVehicle?.vehicleId).toBe(1);
    expect(speeds.length).toBeGreaterThan(20);
    for (const v of speeds) expect(v).toBeCloseTo(65, 6);
  });

  it('[R5][A-05] a faster lead in the closing zone does not make HFDS accelerate (A-05b)', () => {
    const e = build(
      (s) => ((s.ego.speedMph = 60), (s.ego.setSpeedMph = 70), (s.traffic = [lead(415, 65)])),
    );
    runFor(e, 4);
    expect(e.hfds.speedManagement.currentZone).toBe('Closing');
    expect(e.vehicleControl.currentSpeed).toBeCloseTo(60, 6);
  });

  it('[R21][IR9][R25] coasts to the lead speed and settles at the trail distance, never inside it', () => {
    const e = build((s) => ((s.ego.speedMph = 70), (s.traffic = [lead(615, 55)])));
    let coastDecel = 0;
    runFor(e, 60, (x) => {
      if (
        x.hfds.driverAssist.lastLongitudinal?.zone === 'Coast' &&
        x.vehicleControl.lastSource === 'hfds'
      ) {
        coastDecel = Math.min(coastDecel, x.vehicleControl.appliedHfdsAccel);
      }
    });
    const sm = e.hfds.speedManagement;
    const v = e.vehicleControl.ego.speed;
    expect(e.vehicleControl.currentSpeed).toBeCloseTo(55, 1);
    expect(e.hfds.driverAssist.leadGap ?? 0).toBeCloseTo(sm.computeTrailDistance(v, 'Car'), 0);
    expect(coastDecel).toBeCloseTo(-COAST_DECEL_FTPS2, 9); // zero throttle, no braking
  });

  it('[R25] following a truck uses the 1.25 size factor', () => {
    const e = build((s) => {
      s.ego.speedMph = 60;
      s.traffic = [{ id: 1, sizeClass: 'Truck', laneId: 2, sFt: 420, speedMph: 55 }];
    });
    runFor(e, 70);
    const v = e.vehicleControl.ego.speed;
    expect(e.hfds.driverAssist.leadGap ?? 0).toBeCloseTo(v * 2.0 * 1.25, 0);
  });
});

describe('braking for closing speed (R22, R23)', () => {
  // A car in lane 1 at 45 mph cuts in at 3 s, `gap` ft ahead of a 65 mph ego (closing 29.3 ft/s).
  const cutIn = (gapAt3s: number) =>
    build((s) => {
      s.ego.speedMph = 65;
      s.traffic = [
        {
          id: 1,
          sizeClass: 'Car',
          laneId: 1,
          sFt: gapAt3s + 15 + 3 * 20 * MPH_TO_FTPS,
          speedMph: 45,
          behavior: [{ t: 3, action: 'changeLane', toLaneId: 2, durationS: 1 }],
        },
      ];
    });

  it('[R22][R22.1][R22.2] brakes at a_req when coasting is not enough and a_req ≤ 11.5 ft/s²', () => {
    const e = cutIn(120);
    let braked = 0;
    let minGapOverCushion = Infinity;
    runFor(e, 15, (x) => {
      const lon = x.hfds.driverAssist.lastLongitudinal;
      if (lon?.braking && lon.aReq !== null) {
        braked++;
        expect(x.vehicleControl.appliedHfdsAccel).toBeCloseTo(-lon.aReq, 9);
        expect(lon.aReq).toBeLessThanOrEqual(11.5);
      }
      const gap = x.hfds.driverAssist.leadGap;
      if (gap !== null) {
        const cushion = x.hfds.speedManagement.safetyCushion(x.vehicleControl.ego.speed, 'Car');
        minGapOverCushion = Math.min(minGapOverCushion, gap - cushion);
      }
    });
    expect(braked).toBeGreaterThan(0);
    expect(e.hfds.mode).toBe('HANDS_FREE'); // no reclaim warning
    expect(minGapOverCushion).toBeGreaterThan(0);
  });

  it('[R23][R28.1] a_req above 11.5 ft/s² issues a Class A reclaim warning (BRAKING_INSUFFICIENT)', () => {
    const e = cutIn(70);
    runFor(e, 4);
    expect(e.hfds.mode).toBe('TAKEOVER_REQUESTED');
    expect(e.hfds.activeClassA?.reason).toBe('BRAKING_INSUFFICIENT');
    expect(
      e.eventLog.entries.some((x) => x.type === 'takeover_request' && x.reqs.includes('R23')),
    ).toBe(true);
  });

  it('[R22.3] a gap inside the safety cushion is treated as a_req > maxBrakingDecel', () => {
    const e = cutIn(40); // cushion at 65 mph is 47.7 ft
    runFor(e, 3.1);
    expect(e.hfds.speedManagement.currentZone).toBe('Safety');
    expect(e.hfds.activeClassA?.reason).toBe('BRAKING_INSUFFICIENT');
    const req = e.eventLog.entries.find((x) => x.type === 'takeover_request');
    expect(req?.message).toMatch(/inside the safety cushion/);
    expect(req?.reqs).toContain('R22.3');
  });

  it('[R24] resumes the set speed after the lead leaves the lane', () => {
    const e = build((s) => {
      s.ego.speedMph = 65;
      s.traffic = [
        {
          ...lead(400, 55),
          behavior: [{ t: 30, action: 'changeLane', toLaneId: 1, durationS: 2 }],
        },
      ];
    });
    runFor(e, 30);
    expect(e.vehicleControl.currentSpeed).toBeLessThan(57);
    runFor(e, 15);
    expect(e.hfds.driverAssist.leadVehicle).toBeNull();
    expect(e.vehicleControl.currentSpeed).toBeCloseTo(65, 0);
  });
});
