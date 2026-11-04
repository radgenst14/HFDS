import { describe, expect, it } from 'vitest';
import * as C from '../../src/shared/constants';

// Guards the SRS numbers (CLAUDE.md rule 3) against accidental edits.
describe('SRS constants', () => {
  it('[IR29] fixed 20 Hz tick, dt = 0.05 s', () => {
    expect(C.TICK_HZ).toBe(20);
    expect(C.DT_S).toBeCloseTo(0.05, 12);
    expect(C.SENSOR_CHECK_INTERVAL_MS).toBe(1000 / C.TICK_HZ);
  });
  it('[R43] 0.5 s button debounce', () => expect(C.BUTTON_DEBOUNCE_S).toBe(0.5));
  it('[IR28] engage only above 3 mph', () => expect(C.MIN_ENGAGE_SPEED_MPH).toBe(3));
  it('[IR27] never command above 85 mph', () => expect(C.MAX_COMMAND_SPEED_MPH).toBe(85));
  it('[IR9][R25] 2.0 s minimum gap', () => expect(C.MIN_TIME_GAP_S).toBe(2.0));
  it('[R25] size factors 1.00 / 1.25 / 1.50 / 2.00 (SUV 1.00, ISSUE-06)', () => {
    expect(C.SIZE_FACTOR).toEqual({ Car: 1.0, SUV: 1.0, Truck: 1.25, Bus: 1.5, SemiTruck: 2.0 });
  });
  it('[R29.3][R30.4][R36] alert escalation 30 s / 5 s / 2 s', () => {
    expect([C.FIRST_TO_SECOND_ALERT_S, C.SECOND_TO_FINAL_ALERT_S, C.FINAL_TO_INACTIVE_S]).toEqual([
      30, 5, 2,
    ]);
  });
  it('[SR7] 30 s takeover period', () => expect(C.TAKEOVER_PERIOD_S).toBe(30));
  it('[SR1.1.1][SR1.1.2] 60 s shoulder limit, 2 s lane dwell', () => {
    expect(C.MRM_SHOULDER_TIME_LIMIT_S).toBe(60);
    expect(C.MRM_MIN_LANE_DWELL_S).toBe(2);
  });
  it('[R39.2] 3 s / 1.0 mph resume', () => {
    expect(C.STEER_RESUME_STABLE_S).toBe(3);
    expect(C.STEER_RESUME_SPEED_BAND_MPH).toBe(1.0);
  });
  it('[R35] firm grip = at least 2 areas', () => expect(C.GRIP_MIN_AREAS).toBe(2));
  it('[R38.4][R38.2][R41.2] 20 s recheck, 30 s buffer', () => {
    expect(C.POST_TAKEOVER_RECHECK_S).toBe(20);
    expect(C.REACTIVATION_BUFFER_S).toBe(30);
  });
  it('[R41] 3 reclaims within 5 min', () => {
    expect(C.RECLAIM_LIMIT_COUNT).toBe(3);
    expect(C.RECLAIM_WINDOW_S).toBe(300);
  });
  it('[R44.2] 20 s corruption block', () => expect(C.CORRUPTION_BLOCK_S).toBe(20));
  it('[IR16] 7-month map age', () => expect(C.MAP_MAX_AGE_MONTHS).toBe(7));
  it('[IR5.8] 100 ms / 5 s / 0.3 m health limits', () => {
    expect(C.SENSOR_DATA_MAX_AGE_MS).toBe(100);
    expect(C.GPS_CORRECTION_MAX_AGE_S).toBe(5);
    expect(C.REDUNDANT_AGREEMENT_M).toBe(0.3);
  });
  it('[R37.2] severity bands cover 0–100 without gaps', () => {
    const b = C.SEVERITY_BANDS;
    expect([b.low.min, b.low.max, b.middle.min, b.middle.max, b.high.min, b.high.max]).toEqual([
      0, 24, 25, 74, 75, 100,
    ]);
  });
  it('[R29.2][R30.3][IR6][IR16] exact HMI strings', () => {
    expect(C.HMI_TEXT).toEqual({
      PAY_ATTENTION: 'Pay attention to the road.',
      TAKE_CONTROL: 'Take steering control immediately.',
      HFDS_AVAILABLE: 'HFDS available',
      UPDATE_NEEDED: 'Update needed',
    });
  });
  it('[R22] A-03 cushion reproduces the SRS example: 44 ft at 60 mph behind a car', () => {
    const v = 60 * C.MPH_TO_FTPS;
    expect(C.SAFETY_CUSHION_S * v * C.SIZE_FACTOR.Car).toBeCloseTo(44, 6);
  });
  it('[A-11] time scales are 0.5×, 1×, 2×, 4×', () =>
    expect(C.TIME_SCALES).toEqual([0.5, 1, 2, 4]));
});
