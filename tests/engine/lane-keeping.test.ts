import { describe, expect, it } from 'vitest';
import { DriverAssistSystem } from '../../src/engine/hfds/driver-assist';
import { Road } from '../../src/engine/world/road';
import {
  EGO_SIZE_CLASS,
  LARGE_VEHICLE_OFFSET_FT,
  MPH_TO_FTPS,
  VEHICLE_DIMENSIONS_FT,
} from '../../src/shared/constants';
import type { Scenario } from '../../src/shared/scenario-schema';
import { build, m3Base, runFor } from './m3-helpers';

const EGO_HALF = VEHICLE_DIMENSIONS_FT[EGO_SIZE_CLASS].width / 2;
const inLane = (y: number, center: number, laneWidth: number) =>
  Math.abs(y - center) + EGO_HALF <= laneWidth / 2 + 1e-9;

describe('lane keeping (R20, R18)', () => {
  it('[R20][R1] steers back to the blue path and stays centred', () => {
    const e = build();
    runFor(e, 1.5); // engaged at 1.1 s
    const center = e.road.laneCenterY(2);
    e.vehicleControl.placeInLane(center + 2);
    runFor(e, 6);
    expect(Math.abs(e.vehicleControl.ego.y - center)).toBeLessThan(0.05);
    expect(e.vehicleControl.lastSource).toBe('hfds');
  });

  it('[R18] keeps the vehicle inside its lane every tick through a gentle curve', () => {
    const e = build(
      (s) =>
        (s.road.segments = [
          { fromFt: 200, toFt: 3000, curvatureRadiusFt: 2500, direction: 'left' },
        ]),
    );
    runFor(e, 30, (x) => {
      if (x.hfds.mode === 'HANDS_FREE') {
        expect(inLane(x.vehicleControl.ego.y, x.road.laneCenterY(2), x.road.laneWidthFt)).toBe(
          true,
        );
      }
    });
    expect(e.hfds.mode).toBe('HANDS_FREE');
  });

  it('[R2] the blue path follows the lane centre plus the target offset', () => {
    const e = build();
    runFor(e, 2);
    const path = e.hfds.pathPrediction.bluePath;
    expect(path.length).toBeGreaterThan(10);
    for (const p of path)
      expect(p.y).toBeCloseTo(e.road.laneCenterY(2) + e.hfds.pathPrediction.targetOffset, 9);
  });
});

describe('large vehicles (UC12, A-15)', () => {
  const beside = (sizeClass: 'SemiTruck' | 'Bus' | 'Car', laneId: number) =>
    ({ id: 9, sizeClass, laneId, sFt: 40, speedMph: 62 }) as Scenario['traffic'][number];

  it('[UC12][R20] shifts 1 ft away from a semi-truck in the right lane, still inside the lane', () => {
    const e = build((s) => (s.traffic = [beside('SemiTruck', 1)]));
    runFor(e, 8);
    expect(e.hfds.pathPrediction.targetOffset).toBe(LARGE_VEHICLE_OFFSET_FT);
    expect(e.vehicleControl.ego.y - e.road.laneCenterY(2)).toBeCloseTo(1, 1);
  });

  it('[UC12] shifts right for a bus on the left; vehicles on both sides cancel; cars do not count', () => {
    expect(
      runFor(
        build((s) => (s.traffic = [beside('Bus', 3)])),
        2,
      ).hfds.pathPrediction.targetOffset,
    ).toBe(-1);
    const both = build(
      (s) => (s.traffic = [beside('Bus', 3), { ...beside('SemiTruck', 1), id: 8 }]),
    );
    expect(runFor(both, 2).hfds.pathPrediction.targetOffset).toBe(0);
    expect(
      runFor(
        build((s) => (s.traffic = [beside('Car', 1)])),
        2,
      ).hfds.pathPrediction.targetOffset,
    ).toBe(0);
  });

  it('[UC12][R18] the offset is clamped so a narrow lane still contains the vehicle', () => {
    const e = build((s) => {
      s.road.laneWidthM = 2.4; // 7.87 ft: room for only 0.94 ft of offset
      s.traffic = [beside('SemiTruck', 1)];
    });
    runFor(e, 8);
    const limit = e.road.laneWidthFt / 2 - EGO_HALF;
    expect(e.hfds.pathPrediction.targetOffset).toBeCloseTo(limit, 9);
    expect(inLane(e.vehicleControl.ego.y, e.road.laneCenterY(2), e.road.laneWidthFt)).toBe(true);
  });
});

describe('curves (UC9, A-14)', () => {
  const das = () =>
    new DriverAssistSystem({ maxBrakingDecelFtps2: 11.5, forwardSensorRangeFt: 800 }, 'Near', null);
  const road = (radius: number) =>
    new Road({
      ...m3Base.road,
      segments: [{ fromFt: 400, toFt: 1400, curvatureRadiusFt: radius, direction: 'right' }],
    });
  const v60 = 60 * MPH_TO_FTPS;

  it('[UC9] a curve needing more than 8 ft/s² of lateral acceleration within 5 s is too sharp', () => {
    expect(das().navigateCurve(0, v60, road(960))?.tooSharp).toBe(true); // 8.07 ft/s²
    expect(das().navigateCurve(0, v60, road(1100))?.tooSharp).toBe(false); // 7.04 ft/s²
  });

  it('[UC9] only curves within the next 5 s of travel count', () => {
    // 5 s at 60 mph = 440 ft of look-ahead.
    const far = new Road({
      ...m3Base.road,
      segments: [{ fromFt: 450, toFt: 1400, curvatureRadiusFt: 500, direction: 'left' }],
    });
    expect(das().navigateCurve(0, v60, far)).toBeNull();
    expect(das().navigateCurve(20, v60, far)?.tooSharp).toBe(true);
  });

  it('[UC9][R28.1] engaged HFDS requests a takeover before a curve that is too sharp', () => {
    const e = build(
      (s) =>
        (s.road.segments = [
          { fromFt: 1500, toFt: 2500, curvatureRadiusFt: 700, direction: 'right' },
        ]),
    );
    runFor(e, 15);
    expect(e.hfds.mode).toBe('TAKEOVER_REQUESTED');
    expect(e.hfds.activeClassA?.reason).toBe('CURVE_TOO_SHARP');
    expect(e.anchors.classA).toBeDefined();
    expect(e.vehicleControl.ego.s).toBeLessThan(1500);
  });
});

describe('surroundings (R4.3, R6, R7, R8, UC11)', () => {
  it('[R6] classifies vehicles by length', () => {
    const d = new DriverAssistSystem(
      { maxBrakingDecelFtps2: 11.5, forwardSensorRangeFt: 800 },
      'Near',
      null,
    );
    for (const c of ['Car', 'SUV', 'Truck', 'Bus', 'SemiTruck'] as const) {
      expect(d.classifyVehicle(VEHICLE_DIMENSIONS_FT[c].length)).toBe(c);
    }
    expect(d.classifyVehicle(62)).toBe('SemiTruck');
  });

  it('[R7] estimates relative speed and relative acceleration', () => {
    const e = build(
      (s) => (s.traffic = [{ id: 3, sizeClass: 'Car', laneId: 3, sFt: 200, speedMph: 70 }]),
    );
    runFor(e, 0.5);
    const tr = e.hfds.driverAssist.tracks.get(3);
    expect(tr?.relativeSpeed).toBeCloseTo((70 - 62) * MPH_TO_FTPS, 6);
    expect(tr?.relativeAcceleration).toBeCloseTo(0, 6);
  });

  it('[R8] near surroundings: adjacent-lane vehicles within the selection distance, shoulder, median, lane edges', () => {
    const e = build((s) => {
      s.traffic = [
        { id: 1, sizeClass: 'Car', laneId: 1, sFt: 150, speedMph: 62 },
        { id: 2, sizeClass: 'Car', laneId: 3, sFt: 2000, speedMph: 62 }, // beyond the selection distance
      ];
    });
    runFor(e, 0.2);
    const ego = e.vehicleControl.ego;
    const near = e.hfds.driverAssist.nearSurroundings(ego, e.road);
    expect(near.vehicles.map((v) => v.vehicleId)).toEqual([1]);
    expect(near).toMatchObject({ shoulder: true, medianBarrier: true });
    expect(near.laneBoundaries.left - near.laneBoundaries.right).toBeCloseTo(e.road.laneWidthFt, 9);
  });

  it('[R4.3] a vehicle overlapping the ego path by any part of its width is in the lane', () => {
    const e = build(
      (s) => (s.traffic = [{ id: 4, sizeClass: 'Car', laneId: 1, sFt: 200, speedMph: 62 }]),
    );
    runFor(e, 0.1);
    const car = e.traffic.byId(4);
    if (!car) throw new Error('no car');
    const pathY = e.road.laneCenterY(2);
    const touching = pathY - EGO_HALF - car.width / 2; // edges just meet
    car.y = touching + 0.5; // 0.5 ft of the car's width inside the ego corridor
    expect(e.hfds.driverAssist.overlapsPath(car, e.hfds.pathPrediction)).toBe(true);
    car.y = touching - 0.1;
    expect(e.hfds.driverAssist.overlapsPath(car, e.hfds.pathPrediction)).toBe(false);
  });

  it('[UC11][R4] a vehicle entering the lane is detected before it overlaps and becomes the lead', () => {
    const e = build((s) => {
      s.traffic = [
        {
          id: 5,
          sizeClass: 'Car',
          laneId: 3,
          sFt: 260,
          speedMph: 62,
          behavior: [{ t: 3, action: 'changeLane', toLaneId: 2, durationS: 2 }],
        },
      ];
    });
    runFor(e, 3.05);
    const car = e.traffic.byId(5);
    if (!car) throw new Error('no car');
    expect(e.hfds.driverAssist.overlapsPath(car, e.hfds.pathPrediction)).toBe(false);
    expect(e.hfds.driverAssist.isEnteringLane(car, e.hfds.pathPrediction)).toBe(true);
    expect(e.hfds.driverAssist.detectLaneIntrusion()?.vehicleId).toBe(5);
    expect(e.hfds.driverAssist.leadVehicle?.vehicleId).toBe(5);
  });

  it('[UC11] a vehicle moving away, or too slowly to arrive within 1 s, is not entering', () => {
    const away = build((s) => {
      s.traffic = [
        {
          id: 6,
          sizeClass: 'Car',
          laneId: 1,
          sFt: 260,
          speedMph: 62,
          behavior: [{ t: 1, action: 'changeLane', toLaneId: 0, durationS: 2 }],
        },
      ];
    });
    runFor(away, 1.5);
    expect(away.traffic.byId(6)?.lateralVelocity).toBeLessThan(0);
    expect(away.hfds.driverAssist.detectLaneIntrusion()).toBeNull();
    const slow = build((s) => {
      s.traffic = [
        {
          id: 7,
          sizeClass: 'Car',
          laneId: 3,
          sFt: 260,
          speedMph: 62,
          behavior: [{ t: 1, action: 'changeLane', toLaneId: 2, durationS: 12 }],
        },
      ];
    });
    runFor(slow, 1.1);
    expect(slow.hfds.driverAssist.detectLaneIntrusion()).toBeNull();
  });
});
