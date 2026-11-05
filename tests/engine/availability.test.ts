import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine/engine';
import { MPH_TO_FTPS } from '../../src/shared/constants';
import { SubsystemStatus, type SensorId, type SensorStatus } from '../../src/shared/domain';
import type { DirectorAction } from '../../src/shared/protocol';
import type { Scenario } from '../../src/shared/scenario-schema';
import { readPreset } from './helpers';

/** Doc 17: "Each IR1–IR8, IR16, IR28 check in isolation" (doc 13 §5.1). */
const base: Scenario = {
  ...readPreset('s01-activation-success'),
  timeline: [],
  expect: [],
  traffic: [],
};

type Change = (s: Scenario) => void;

function engine(change?: Change): Engine {
  const s = structuredClone(base);
  change?.(s);
  return new Engine(s);
}

function run(e: Engine, ticks: number, inject?: DirectorAction): Engine {
  if (inject) e.enqueueInject(inject);
  for (let i = 0; i < ticks; i++) e.step();
  return e;
}

const check = (e: Engine, id: string) => {
  const c = e.hfds.availabilityChecks.find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
};

/** Only `id` fails (plus the lines that necessarily fail with it). */
function failsOnly(e: Engine, ids: string[]): void {
  const failing = e.hfds.availabilityChecks.filter((c) => !c.pass).map((c) => c.id);
  expect(failing.sort()).toEqual([...ids].sort());
  expect(e.hfds.available).toBe(false);
  expect(e.hfds.hmi.current.availableIndicator).toBe(false);
}

describe('baseline', () => {
  it('[IR6] all lines pass on the S01 highway, so "HFDS available" is shown', () => {
    const e = run(engine(), 5);
    expect(e.hfds.availabilityChecks.filter((c) => !c.pass)).toEqual([]);
    expect(e.hfds.available).toBe(true);
    expect(e.hfds.hmi.current.availableIndicator).toBe(true);
    expect(e.hfds.mode).toBe('AVAILABLE');
  });
});

describe('IR1 / UC17 road enabled', () => {
  it('[IR1] fails on an undivided road', () => {
    failsOnly(
      run(
        engine((s) => (s.road.roadType = 'Undivided')),
        2,
      ),
      ['IR1'],
    );
  });
  it('[IR1] fails when the map does not enable the road', () => {
    const e = run(
      engine((s) => (s.map.enabled = false)),
      2,
    );
    expect(check(e, 'IR1').pass).toBe(false);
  });
  it('[IR1] fails in a segment with enabledForHfds = false', () => {
    const e = run(
      engine((s) => (s.road.segments = [{ fromFt: 0, toFt: 5000, enabledForHfds: false }])),
      2,
    );
    expect(check(e, 'IR1').pass).toBe(false);
  });
  it('[IR1][UC17] needs at least 10 s of enabled road ahead (A-20)', () => {
    const v = 62 * MPH_TO_FTPS;
    const near = run(
      engine((s) => (s.road.segments = [{ fromFt: 9 * v, toFt: 40000, enabledForHfds: false }])),
      1,
    );
    failsOnly(near, ['UC17']);
    const far = run(
      engine((s) => (s.road.segments = [{ fromFt: 11 * v, toFt: 40000, enabledForHfds: false }])),
      1,
    );
    expect(far.hfds.available).toBe(true);
  });
});

describe('IR2 lane lines', () => {
  it('[IR2] fails where a segment hides a lane line', () => {
    const e = run(
      engine(
        (s) =>
          (s.road.segments = [{ fromFt: 0, toFt: 3000, markings: { left: false, right: true } }]),
      ),
      2,
    );
    expect(check(e, 'IR2').pass).toBe(false);
    expect(check(e, 'IR2').detail).toMatch(/left/);
  });
  it('[IR2] Director dropLaneMarkings hides the lines for durationS', () => {
    const e = run(engine(), 1, { kind: 'dropLaneMarkings', args: { durationS: 2 } });
    expect(check(e, 'IR2').pass).toBe(false);
    run(e, 40);
    expect(check(e, 'IR2').pass).toBe(true);
  });
});

describe('IR3 driver engaged (DATS)', () => {
  it('[IR3] fails with eyes off the road', () => {
    failsOnly(
      run(
        engine((s) => (s.driver.eyesOnRoad = false)),
        2,
      ),
      ['IR3'],
    );
  });
  it('[IR3][IR4] fails when the driver camera has failed (DATS faulted)', () => {
    const e = run(
      engine((s) => (s.sensorOverrides = { CAM_DRIVER: 'Failed' })),
      2,
    );
    failsOnly(e, ['IR3', 'IR4', 'IR5.8']);
  });
});

describe('IR4 subsystems', () => {
  it('[IR4] fails when an assist subsystem is not OK', () => {
    const e = engine();
    e.hfds.pathPrediction.status = SubsystemStatus.Degraded;
    run(e, 2);
    expect(check(e, 'IR4').pass).toBe(false);
    expect(check(e, 'IR4').detail).toMatch(/PathPrediction Degraded/);
  });
});

describe('IR5 operating design domain', () => {
  it.each(['Night', 'LowAngleSun'] as const)('[IR5.1] fails in %s', (light) => {
    failsOnly(
      run(
        engine((s) => (s.environment.lightCondition = light)),
        2,
      ),
      ['IR5.1'],
    );
  });

  it('[IR5.2] fails in a construction zone or tunnel', () => {
    failsOnly(
      run(
        engine((s) => (s.road.segments = [{ fromFt: 0, toFt: 3000, constructionZone: true }])),
        2,
      ),
      ['IR5.2'],
    );
    failsOnly(
      run(
        engine((s) => (s.road.segments = [{ fromFt: 0, toFt: 3000, tunnel: true }])),
        2,
      ),
      ['IR5.2'],
    );
    failsOnly(run(engine(), 1, { kind: 'setRoadFlags', args: { tunnel: true } }), ['IR5.2']);
  });

  it('[IR5.3] fails on the shoulder, in an exit lane or on a service drive', () => {
    const shoulder = run(
      engine((s) => (s.ego.laneId = 0)),
      2,
    );
    expect(check(shoulder, 'IR5.3').pass).toBe(false);
    const exit = run(engine(), 1, { kind: 'setEgoLane', args: { laneType: 'ExitLane' } });
    failsOnly(exit, ['IR5.3']);
    run(exit, 1, { kind: 'setEgoLane', args: { laneId: 2 } });
    expect(exit.hfds.available).toBe(true);
    const service = run(
      engine((s) => (s.road.segments = [{ fromFt: 0, toFt: 3000, roadType: 'ServiceDrive' }])),
      2,
    );
    expect(check(service, 'IR5.3').pass).toBe(false);
  });

  it.each(['Rain', 'Sleet', 'Snow', 'Fog', 'Ice'] as const)('[IR5.4] fails in %s', (weather) => {
    failsOnly(
      run(
        engine((s) => (s.environment.weather = weather)),
        2,
      ),
      ['IR5.4'],
    );
  });

  it('[IR5.4] road moisture above 0.3 and visibility below 150 m are outside the ODD (A-10)', () => {
    expect(
      run(
        engine((s) => (s.environment.roadMoisture = 0.3)),
        2,
      ).hfds.available,
    ).toBe(true);
    failsOnly(
      run(
        engine((s) => (s.environment.roadMoisture = 0.31)),
        2,
      ),
      ['IR5.4'],
    );
    expect(
      run(
        engine((s) => (s.environment.visibilityM = 150)),
        2,
      ).hfds.available,
    ).toBe(true);
    failsOnly(
      run(
        engine((s) => (s.environment.visibilityM = 149)),
        2,
      ),
      ['IR5.4'],
    );
  });

  it('[IR5.5] fails with a trailer only when the vehicle cannot tow', () => {
    failsOnly(run(engine(), 1, { kind: 'setTrailer', args: { attached: true, capable: false } }), [
      'IR5.5',
    ]);
    expect(
      run(engine(), 1, { kind: 'setTrailer', args: { attached: true, capable: true } }).hfds
        .available,
    ).toBe(true);
  });

  it.each([
    ['CAM_FRONT', 'Obstructed'],
    ['CAM_REAR', 'Failed'],
    ['LIDAR_1', 'Damaged'],
    ['RADAR_FRONT', 'Failed'],
  ] as Array<[SensorId, SensorStatus]>)('[IR5.6] fails when %s is %s', (sensorId, status) => {
    const e = run(engine(), 4, { kind: 'failSensor', args: { sensorId, status } });
    expect(check(e, 'IR5.6').pass).toBe(false);
    expect(check(e, 'IR5.6').detail).toContain(sensorId);
  });

  it('[IR5.7] fails on a map error, a navigation/GPS data error or a failed GPS receiver', () => {
    expect(check(run(engine(), 1, { kind: 'mapError' }), 'IR5.7').pass).toBe(false);
    expect(check(run(engine(), 1, { kind: 'gpsError' }), 'IR5.7').pass).toBe(false);
    const gps = run(engine(), 1, {
      kind: 'failSensor',
      args: { sensorId: 'GPS_1', status: 'Failed' },
    });
    expect(check(gps, 'IR5.7').pass).toBe(false);
    expect(check(gps, 'IR5.6').pass).toBe(true); // GPS is not "camera, LiDAR or radar"
  });

  it('[IR5.8] GPS correction older than 5 s fails the health level', () => {
    const e = run(engine(), 1, { kind: 'staleGpsCorrection', args: { ageS: 4.5 } });
    expect(check(e, 'IR5.8').pass).toBe(true); // 4.5 s
    run(e, 10); // 5.0 s: still within the limit
    expect(check(e, 'IR5.8').pass).toBe(true);
    run(e, 1); // 5.05 s
    failsOnly(e, ['IR5.8']);
    run(e, 1, { kind: 'clearAllFaults' });
    expect(e.hfds.available).toBe(true);
  });

  it('[IR5.8] sensor data older than 100 ms fails the health level', () => {
    const e = run(engine(), 1, {
      kind: 'failSensor',
      args: { sensorId: 'CAM_REAR', status: 'Failed' },
    });
    expect(check(e, 'IR5.8').pass).toBe(true); // checked at t = 0: last good reading 0 ms ago
    run(e, 2); // checked at t = 0.10 s: exactly 100 ms is still "no older than 100 ms"
    expect(check(e, 'IR5.8').pass).toBe(true);
    run(e, 1); // t = 0.15 s
    expect(check(e, 'IR5.8').pass).toBe(false);
    expect(check(e, 'IR5.8').detail).toMatch(/CAM_REAR data older than 100 ms/);
  });

  it('[IR5.8] redundant lane-position sources must agree within 0.3 m', () => {
    const ok = engine();
    ok.hfds.vehiclePosition.injectedDisagreementM = 0.29;
    expect(run(ok, 2).hfds.available).toBe(true);
    const bad = engine();
    bad.hfds.vehiclePosition.injectedDisagreementM = 0.31;
    failsOnly(run(bad, 2), ['IR5.8']);
  });

  it('[IR5.9] fails when motion forecasting, self-supervision or dynamic environment is off', () => {
    for (const name of ['motionForecasting', 'selfSupervision', 'dynamicEnvironment'] as const) {
      failsOnly(run(engine(), 1, { kind: 'setSubsystemFlag', args: { name, ok: false } }), [
        'IR5.9',
      ]);
    }
  });

  it('[IR5.10] fails after a forward-collision escalation until faults clear (A-50)', () => {
    const e = run(engine(), 1, { kind: 'fcwEscalation' });
    failsOnly(e, ['IR5.10']);
    run(e, 1, { kind: 'clearAllFaults' });
    expect(e.hfds.available).toBe(true);
  });

  it('[IR17] fails without the real-time positioning data service', () => {
    failsOnly(
      run(engine(), 1, {
        kind: 'setSubsystemFlag',
        args: { name: 'positioningDataService', ok: false },
      }),
      ['IR17'],
    );
  });
});

describe('IR8 traffic stability', () => {
  const withLead = (rel: { sFt?: number; speedMph?: number } = {}) =>
    engine((s) => {
      s.traffic = [
        { id: 7, sizeClass: 'Car', laneId: 2, sFt: rel.sFt ?? 300, speedMph: rel.speedMph ?? 62 },
      ];
    });

  it('[IR8] a lead at constant speed and distance is stable', () => {
    const e = run(withLead(), 100);
    expect(e.hfds.driverAssist.leadVehicle?.vehicleId).toBe(7);
    expect(e.hfds.available).toBe(true);
  });

  it('[IR8.1] braking harder than maxBrakingDecel (11.5 ft/s²) is unstable', () => {
    const hard = run(withLead(), 2, {
      kind: 'trafficHardBrake',
      args: { vehicleId: 7, decelFtps2: 12, durationS: 1 },
    });
    failsOnly(hard, ['IR8']);
    expect(check(hard, 'IR8').reqs).toContain('IR8.1');
    const firm = run(withLead(), 2, {
      kind: 'trafficHardBrake',
      args: { vehicleId: 7, decelFtps2: 11, durationS: 0.3 },
    });
    expect(check(firm, 'IR8').reqs).not.toContain('IR8.1');
  });

  it('[IR8.2] an acceleration change above 10 ft/s² within 1 s is unstable', () => {
    const e = run(withLead({ sFt: 600 }), 15, {
      kind: 'trafficErraticAccel',
      args: { vehicleId: 7 },
    });
    expect(check(e, 'IR8').pass).toBe(false);
    expect(check(e, 'IR8').reqs).toContain('IR8.2');
    run(e, 60); // window has passed
    expect(check(e, 'IR8').pass).toBe(true);
  });

  it('[IR8.3] time headway under 1.0 s is unstable', () => {
    const close = run(withLead({ sFt: 2000 }), 2, {
      kind: 'trafficTailgateGap',
      args: { vehicleId: 7, headwayS: 0.9 },
    });
    expect(check(close, 'IR8').reqs).toContain('IR8.3');
    const ok = run(withLead({ sFt: 2000 }), 2, {
      kind: 'trafficTailgateGap',
      args: { vehicleId: 7, headwayS: 1.1 },
    });
    expect(check(ok, 'IR8').pass).toBe(true);
  });

  it('[IR8.3] a lead gap change above 30 % of the trail distance within 3 s is unstable', () => {
    // 20 mph faster lead: the gap grows ~88 ft in 3 s; 30 % of the 182 ft trail is ~55 ft.
    const e = run(withLead({ sFt: 250, speedMph: 82 }), 50);
    expect(check(e, 'IR8').reqs).toContain('IR8.3');
  });
});

describe('IR16 map age', () => {
  it('[IR16] a map exactly 7 months old is current; one day more is outdated ("Update needed")', () => {
    const current = run(
      engine((s) => ((s.simDate = '2026-11-04'), (s.map.lastUpdated = '2026-04-04'))),
      1,
    );
    expect(current.hfds.available).toBe(true);
    const old = run(
      engine((s) => ((s.simDate = '2026-11-04'), (s.map.lastUpdated = '2026-04-03'))),
      1,
    );
    failsOnly(old, ['IR16']);
    expect(check(old, 'IR16').detail).toContain('Update needed');
    expect(old.hfds.hmi.current.updateNeeded).toBe(true);
  });

  it('[R11][IR16] a downloaded map update clears it', () => {
    const e = run(
      engine((s) => (s.map.lastUpdated = '2026-01-01')),
      1,
    );
    expect(e.hfds.available).toBe(false);
    run(e, 1, { kind: 'applyMapUpdate', args: { version: 'v2', lastUpdated: '2026-10-01' } });
    expect(e.hfds.available).toBe(true);
    expect(e.hfds.hmi.current.updateNeeded).toBe(false);
  });
});

describe('IR28 speed', () => {
  it('[IR28] 3 mph is not enough; above 3 mph is', () => {
    failsOnly(
      run(
        engine((s) => (s.ego.speedMph = 3)),
        2,
      ),
      ['IR28'],
    );
    expect(
      run(
        engine((s) => (s.ego.speedMph = 3.1)),
        2,
      ).hfds.available,
    ).toBe(true);
  });
});
