import { describe, expect, it } from 'vitest';
import { requiredDeceleration, SpeedManagement } from '../../src/engine/hfds/speed-management';
import { MPH_TO_FTPS } from '../../src/shared/constants';

/** Doc 13 §2 test vectors T1–T9 (R4, R22, R23, R25, IR9). */
const sm = () =>
  new SpeedManagement({ maxBrakingDecelFtps2: 11.5, forwardSensorRangeFt: 800 }, 'Near', null);
const V60 = 60 * MPH_TO_FTPS; // 88 ft/s

describe('doc 13 §2 formulas', () => {
  it('[R25][IR9] T1: 60 mph, gap 2.0 s, lead car → trail distance 176 ft', () => {
    expect(V60).toBeCloseTo(88, 9);
    expect(sm().computeTrailDistance(V60, 'Car')).toBeCloseTo(176, 6);
  });

  it('[IR9] T2: a driver gap of 1.5 s is raised to the 2.0 s minimum → 176 ft', () => {
    const s = sm();
    s.driverSelectedGap = 1.5;
    expect(s.timeGap()).toBe(2.0);
    expect(s.computeTrailDistance(V60, 'Car')).toBeCloseTo(176, 6);
  });

  it('[R25] T3: truck / bus / semi-truck size factors → 220 / 264 / 352 ft', () => {
    const s = sm();
    expect(s.computeTrailDistance(V60, 'Truck')).toBeCloseTo(220, 6);
    expect(s.computeTrailDistance(V60, 'Bus')).toBeCloseTo(264, 6);
    expect(s.computeTrailDistance(V60, 'SemiTruck')).toBeCloseTo(352, 6);
    expect(s.computeTrailDistance(V60, 'SUV')).toBeCloseTo(176, 6); // ISSUE-06
  });

  it('[R4.1][R4.1.1] T4: braking distance ≈ 336.7 ft, selection distance ≈ 512.7 ft', () => {
    const s = sm();
    expect(s.brakingDistance(V60)).toBeCloseTo(336.7, 1);
    expect(s.selectionDistance(V60, 'Car')).toBeCloseTo(512.7, 1);
  });

  it('[R4.2] T5: at 85 mph trail + braking ≈ 925 ft is clamped to the 800 ft sensor range (A-04)', () => {
    const s = sm();
    const v = 85 * MPH_TO_FTPS;
    expect(s.computeTrailDistance(v, 'Car') + s.brakingDistance(v)).toBeCloseTo(925, -1);
    expect(s.selectionDistance(v, 'Car')).toBe(800);
  });

  it('[R22][R22.1][R22.2] T6: gap 100 ft, closing 20 mph, cushion 44 ft → a_req ≈ 7.7 ft/s², brake', () => {
    const s = sm();
    expect(s.safetyCushion(V60, 'Car')).toBeCloseTo(44, 6); // A-03 reproduces the R22 example
    const r = s.brakeForClosingSpeed(V60, {
      vehicleId: 1,
      speed: V60 - 20 * MPH_TO_FTPS,
      gap: 100,
      sizeClass: 'Car',
    });
    expect(r.aReq).toBeCloseTo(7.68, 2);
    expect(r.ok).toBe(true);
  });

  it('[R23][R22.3] T7: same, closing 30 mph → a_req ≈ 17.3 ft/s² > 11.5 → reclaim warning', () => {
    const r = sm().brakeForClosingSpeed(V60, {
      vehicleId: 1,
      speed: V60 - 44,
      gap: 100,
      sizeClass: 'Car',
    });
    expect(r.aReq).toBeCloseTo(17.29, 2);
    expect(r.ok).toBe(false);
  });

  it('[R22.3] T8: gap 40 ft inside the 44 ft cushion → a_req = ∞ → reclaim warning', () => {
    expect(requiredDeceleration(29.33, 40, 44)).toBe(Infinity);
    const r = sm().brakeForClosingSpeed(V60, {
      vehicleId: 1,
      speed: V60 - 10,
      gap: 40,
      sizeClass: 'Car',
    });
    expect(r.ok).toBe(false);
  });

  it('[R22.1] T9: a faster lead gives closing speed 0, a_req 0, no braking', () => {
    const s = sm();
    const r = s.brakeForClosingSpeed(V60, {
      vehicleId: 1,
      speed: V60 + 5,
      gap: 60,
      sizeClass: 'Car',
    });
    expect(s.closingSpeed).toBe(0);
    expect(r.aReq).toBe(0);
    expect(r.ok).toBe(true);
  });
});
