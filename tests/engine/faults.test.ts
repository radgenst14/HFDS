import { describe, expect, it } from 'vitest';
import type { Engine } from '../../src/engine/engine';
import { bandOf, ERROR_CATALOG } from '../../src/engine/hfds/error-codes';
import {
  CORRUPTION_BLOCK_S,
  POST_TAKEOVER_RECHECK_S,
  REACTIVATION_BUFFER_S,
} from '../../src/shared/constants';
import type { SensorId, SensorStatus } from '../../src/shared/domain';
import type { DirectorAction } from '../../src/shared/protocol';
import type { Scenario } from '../../src/shared/scenario-schema';
import { build, runFor } from './m3-helpers';

/** Doc 17 faults.test.ts: doc 13 §9 table, R37, R38 bands, IR23, SR3, SR4.4, R41, R44. */
const engaged = (change: (s: Scenario) => void = () => {}): Engine => {
  const e = build(change);
  runFor(e, 2);
  expect(e.hfds.mode).toBe('HANDS_FREE');
  return e;
};
const inject = (e: Engine, action: DirectorAction, seconds = 0.1) => {
  e.enqueueInject(action);
  return runFor(e, seconds);
};
const fail = (e: Engine, sensorId: SensorId, status: SensorStatus = 'Failed') =>
  inject(e, { kind: 'failSensor', args: { sensorId, status } });
const errors = (e: Engine) => e.eventLog.entries.filter((x) => x.type === 'error');

describe('error codes (R37, A-19)', () => {
  it('[R37.2] severity bands: 0–24 low, 25–74 middle, 75–100 high', () => {
    expect([0, 24, 25, 74, 75, 100].map(bandOf)).toEqual([
      'low',
      'low',
      'middle',
      'middle',
      'high',
      'high',
    ]);
  });

  it('[R37][R37.1][R37.2] every catalog code has a description and an in-range severity', () => {
    for (const c of Object.values(ERROR_CATALOG)) {
      expect(c.description.length).toBeGreaterThan(10);
      expect(c.severity).toBeGreaterThanOrEqual(0);
      expect(c.severity).toBeLessThanOrEqual(100);
    }
    expect(ERROR_CATALOG.E402?.severity).toBe(90);
    expect(bandOf(ERROR_CATALOG.E102?.severity ?? 0)).toBe('middle');
  });

  it('[R9.1][R45.4][IR29b] a sensor fault is logged once with its code and sensor metadata', () => {
    const e = engaged();
    fail(e, 'RADAR_FRONT');
    runFor(e, 1);
    const [err] = errors(e);
    expect(errors(e)).toHaveLength(1);
    expect(err?.reqs).toEqual(expect.arrayContaining(['R37', 'R45.4', 'IR29b']));
    expect(err?.data).toMatchObject({
      code: 'E102',
      severity: 50,
      band: 'middle',
      sensor: { sensorId: 'RADAR_FRONT', type: 'Radar', status: 'Failed' },
    });
    expect((err?.data as { sensor: { lastReadingAt: number } }).sensor.lastReadingAt).toBeLessThan(
      e.simTime,
    );
  });

  it('[R9.2][R9.3][R9.4] GPS, map data and Path Prediction faults are detected', () => {
    const e = engaged();
    inject(e, { kind: 'gpsError' });
    inject(e, { kind: 'mapError' });
    e.hfds.pathPrediction.status = 'Faulted';
    runFor(e, 0.1);
    const codes = errors(e).map((x) => (x.data as { code: string }).code);
    expect(codes).toEqual(expect.arrayContaining(['E104', 'E201', 'E301']));
  });

  it('[SR10][IR5.8] redundant lane-position sources that disagree by more than 0.3 m raise E106', () => {
    const e = engaged();
    e.hfds.vehiclePosition.injectedDisagreementM = 0.4;
    runFor(e, 0.1);
    expect(e.hfds.faults.has('E106')).toBe(true);
    expect(e.hfds.activeClassA?.reason).toBe('SENSOR_FAULT');
  });

  it('[R10] an unmapped construction zone is detected within the forward sensor range only', () => {
    const e = engaged(
      (s) =>
        (s.road.segments = [{ fromFt: 1500, toFt: 2500, constructionZone: true, inMap: false }]),
    );
    expect(e.hfds.faults.has('E203')).toBe(false); // 1500 − ego s > 800 ft
    runFor(e, 6);
    expect(e.hfds.faults.has('E203')).toBe(true);
    expect(e.hfds.activeClassA?.reason).toBe('MAP_MISMATCH');
    const mapped = engaged(
      (s) => (s.road.segments = [{ fromFt: 1500, toFt: 2500, constructionZone: true }]),
    );
    runFor(mapped, 6);
    expect(mapped.hfds.faults.has('E203')).toBe(false);
  });
});

describe('redundancy (SR4, SR4.4) and single points of failure (SR3, SR5, IR24)', () => {
  it.each([
    ['RADAR_FRONT', 'lead distance → front camera'],
    ['CAM_FRONT', 'lane position → LiDAR map + GPS, lead distance → radar'],
    ['LIDAR_1', 'lane position → front camera'],
    ['GPS_1', 'lane position → front camera'],
  ] as Array<[SensorId, string]>)(
    '[SR4.4][SR4.1][SR4.2] %s fails with a working partner (%s): HFDS stays solid green',
    (id) => {
      const e = engaged(
        (s) => (s.traffic = [{ id: 1, sizeClass: 'Car', laneId: 2, sFt: 300, speedMph: 62 }]),
      );
      fail(e, id);
      runFor(e, 5, (x) => {
        expect(x.hfds.mode).toBe('HANDS_FREE');
        expect(x.hfds.hmi.current.lightBarStatus).toBe('SolidGreen');
      });
      expect(e.eventLog.entries.some((x) => x.reqs.includes('SR4.4'))).toBe(true);
    },
  );

  it('[SR3][IR14][SR4.2] losing both lead-distance sources is a single point of failure → Class A', () => {
    const e = engaged();
    fail(e, 'RADAR_FRONT');
    expect(e.hfds.mode).toBe('HANDS_FREE');
    fail(e, 'CAM_FRONT', 'Obstructed');
    expect(e.hfds.activeClassA?.reason).toBe('SENSOR_FAULT');
    expect(e.eventLog.entries.find((x) => x.type === 'takeover_request')?.reqs).toContain('SR3');
  });

  it('[SR3][SR4.1] losing both lane-position sources → Class A', () => {
    const e = engaged();
    fail(e, 'GPS_1');
    expect(e.hfds.mode).toBe('HANDS_FREE');
    fail(e, 'CAM_FRONT');
    expect(e.hfds.activeClassA?.reason).toBe('SENSOR_FAULT');
  });

  it('[IR24] no hands-free driving on degraded map data: a map error hands control back', () => {
    const e = engaged();
    inject(e, { kind: 'mapError' });
    expect(e.hfds.mode).toBe('TAKEOVER_REQUESTED');
    expect(e.hfds.activeClassA?.reason).toBe('SENSOR_FAULT');
  });

  it('[SR5] a failed driver camera is a loss of the attention system → Class A DATS_LOSS', () => {
    const e = engaged();
    fail(e, 'CAM_DRIVER', 'Obstructed');
    expect(e.hfds.activeClassA?.reason).toBe('DATS_LOSS');
    expect(e.hfds.faults.has('E401')).toBe(true);
  });

  it('[SR2][SR5] camera tampering is detected and treated as DATS loss', () => {
    const e = engaged();
    inject(e, { kind: 'tamperDriverCamera' });
    expect(e.hfds.faults.has('E402')).toBe(true);
    expect(e.hfds.activeClassA?.reason).toBe('DATS_LOSS');
  });

  it('[SR4.3] a primary compute failure: the backup holds the lane while requesting a takeover', () => {
    const e = engaged();
    inject(e, { kind: 'primaryComputeFailure' });
    expect(e.hfds.faults.has('E601')).toBe(true);
    expect(e.hfds.mode).toBe('TAKEOVER_REQUESTED');
    const lane = e.road.laneCenterY(2);
    runFor(e, 5, (x) => expect(Math.abs(x.vehicleControl.ego.y - lane)).toBeLessThan(0.05));
  });

  it('[R35][A-58] a failed grip sensor does not count towards the two-area takeover grip', () => {
    const e = build(
      (s) =>
        (s.road.segments = [
          { fromFt: 1500, toFt: 2500, curvatureRadiusFt: 700, direction: 'left' },
        ]),
    );
    runFor(e, 12);
    expect(e.hfds.mode).toBe('TAKEOVER_REQUESTED');
    fail(e, 'GRIP_R');
    e.enqueueInput({ kind: 'setGrip', L: true, R: true });
    runFor(e, 0.2);
    expect(e.hfds.mode).toBe('TAKEOVER_REQUESTED'); // only GRIP_L counts
    e.enqueueInput({ kind: 'setGrip', TOP: true });
    runFor(e, 0.1);
    expect(e.hfds.mode).toBe('UNAVAILABLE');
  });
});

describe('re-engagement after a fault (R38, IR23; A-59)', () => {
  const available = (e: Engine) => e.hfds.available;

  it('[R38.1] low severity: available again as soon as the constraints are met', () => {
    const e = engaged();
    inject(e, { kind: 'staleGpsCorrection', args: { ageS: 6 } }); // E105 low → Class A
    e.enqueueInput({ kind: 'setGrip', L: true, R: true });
    runFor(e, 0.1); // takeover; R38.4 recheck runs 20 s
    inject(e, { kind: 'clearFault', args: { code: 'E105' } });
    runFor(e, POST_TAKEOVER_RECHECK_S);
    expect(available(e)).toBe(true); // no extra R38.2 buffer for a low code
  });

  it('[R38.2] middle severity: cleared, then a 30 s buffer, then the checks', () => {
    const e = engaged();
    fail(e, 'RADAR_FRONT');
    fail(e, 'CAM_FRONT'); // no lead source → Class A
    e.enqueueInput({ kind: 'setGrip', L: true, R: true });
    runFor(e, 25);
    expect(available(e)).toBe(false); // faults still active
    inject(e, { kind: 'clearAllFaults' });
    runFor(e, REACTIVATION_BUFFER_S - 0.3);
    expect(available(e)).toBe(false);
    expect(e.hfds.availabilityChecks.find((c) => c.id === 'R38')?.detail).toMatch(/R38.2/);
    runFor(e, 0.5);
    expect(available(e)).toBe(true);
  });

  it('[R38.3][IR23] high severity: blocked until cleared, then the 30 s buffer', () => {
    const e = engaged();
    inject(e, { kind: 'tamperDriverCamera' });
    e.enqueueInput({ kind: 'setGrip', L: true, R: true });
    runFor(e, 40);
    expect(e.hfds.availabilityChecks.find((c) => c.id === 'IR23')?.pass).toBe(false);
    inject(e, { kind: 'clearAllFaults' });
    expect(e.hfds.availabilityChecks.find((c) => c.id === 'IR23')?.pass).toBe(true);
    expect(available(e)).toBe(false);
    runFor(e, REACTIVATION_BUFFER_S + 0.2);
    expect(available(e)).toBe(true);
  });

  it('[R38][A-59] a fault that never interrupted an engagement needs no buffer after clearing', () => {
    const e = build((s) => (s.timeline = [])); // never engaged
    fail(e, 'RADAR_FRONT');
    runFor(e, 1);
    expect(available(e)).toBe(false);
    inject(e, { kind: 'clearAllFaults' }, 0.2);
    expect(available(e)).toBe(true);
  });
});

describe('repeated reclaims (R41) and corruption (R44)', () => {
  const dropAt = (t: number) =>
    ({ t, kind: 'inject', action: 'dropLaneMarkings', args: { durationS: 1 } }) as const;
  const gripAt = (t: number, on: boolean) =>
    ({ t, kind: 'driver', action: 'setGrip', args: { L: on, R: on } }) as const;
  const press = (t: number) => ({ t, kind: 'driver', action: 'pressHfdsButton' }) as const;

  it('[R41][R41.1][R41.2] the third reclaim request within 5 minutes deactivates HFDS for 30 s after handover', () => {
    const e = build((s) => {
      s.timeline.push(dropAt(5), gripAt(5.5, true), gripAt(6, false), press(27));
      s.timeline.push(dropAt(32), gripAt(32.5, true), gripAt(33, false), press(54));
      s.timeline.push(dropAt(60), gripAt(60.5, true));
    });
    runFor(e, 60.2);
    expect(
      e.eventLog.entries.some((x) => x.type === 'disengagement' && x.reqs.includes('R41.1')),
    ).toBe(true);
    runFor(e, 25);
    expect(e.hfds.available).toBe(false);
    expect(e.hfds.availabilityChecks.find((c) => c.id === 'R38')?.detail).toMatch(/R41.2/);
    runFor(e, 6);
    expect(e.hfds.available).toBe(true);
  });

  it('[R41] reclaim requests more than 5 minutes apart do not deactivate HFDS', () => {
    const e = build((s) => {
      s.durationS = 800;
      s.timeline.push(dropAt(5), gripAt(5.5, true), gripAt(6, false), press(30));
      s.timeline.push(dropAt(200), gripAt(200.5, true), gripAt(201, false), press(230));
      s.timeline.push(dropAt(400), gripAt(400.5, true));
    });
    runFor(e, 401);
    expect(e.hfds.reclaimHistory).toHaveLength(3);
    expect(e.eventLog.entries.some((x) => x.reqs.includes('R41.1'))).toBe(false);
  });

  it('[R44][R44.1][R44.2][R40] a corrupted control process resets HFDS and blocks reactivation for 20 s', () => {
    const e = engaged();
    inject(e, { kind: 'corruptControlProcess' });
    expect(e.hfds.mode).toBe('UNAVAILABLE');
    expect(e.hfds.speedManagement.active).toBe(false);
    expect(e.hfds.hmi.current.controlTransferBanner).toBe('You are in control');
    expect(e.hfds.faults.has('E501')).toBe(false); // resolved by the reset
    expect(errors(e).some((x) => (x.data as { code: string }).code === 'E501')).toBe(true);
    runFor(e, CORRUPTION_BLOCK_S - 0.3);
    expect(e.hfds.available).toBe(false);
    runFor(e, 0.5);
    expect(e.hfds.available).toBe(true);
  });

  it('[R38] clearFault clears just the named code', () => {
    const e = engaged();
    fail(e, 'RADAR_FRONT');
    fail(e, 'LIDAR_1');
    inject(e, { kind: 'clearFault', args: { code: 'E102' } });
    expect(e.hfds.faults.has('E102')).toBe(false);
    expect(e.hfds.faults.has('E103')).toBe(true);
  });
});
