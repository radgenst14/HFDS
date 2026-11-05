import { describe, expect, it } from 'vitest';
import type { Engine } from '../../src/engine/engine';
import {
  ATTENTION_LOSS_DETECT_S,
  FINAL_TO_INACTIVE_S,
  FIRST_TO_SECOND_ALERT_S,
  PHANTOM_BRAKE_DECEL_FTPS2,
  PHANTOM_BRAKE_DURATION_S,
  SECOND_TO_FINAL_ALERT_S,
} from '../../src/shared/constants';
import type { Scenario } from '../../src/shared/scenario-schema';
import { build, runFor } from './m3-helpers';

/** Class B escalation (R27–R32, R36; doc 13 §6) — exact timings. Engaged at 1.1 s. */
const EYES_OFF = 5;
const gaze = (t: number, on: boolean) =>
  ({ t, kind: 'driver', action: 'setGaze', args: { eyesOnRoad: on } }) as const;

function eyesOff(change: (s: Scenario) => void = () => {}): Engine {
  return build((s) => {
    s.timeline.push(gaze(EYES_OFF, false));
    change(s);
  });
}

/** Mode after the tick that starts at sim time t. */
function modeAt(e: Engine, t: number): string {
  runFor(e, t + 0.05 - e.simTime);
  return e.hfds.mode;
}

const FIRST = EYES_OFF + ATTENTION_LOSS_DETECT_S;
const SECOND = FIRST + FIRST_TO_SECOND_ALERT_S;
const FINAL = SECOND + SECOND_TO_FINAL_ALERT_S;
const INACTIVE = FINAL + FINAL_TO_INACTIVE_S;

describe('escalation timing', () => {
  it(`[R27][R29][A-06] the first alert starts ${ATTENTION_LOSS_DETECT_S} s after the eyes leave the road`, () => {
    const e = eyesOff();
    expect(modeAt(e, FIRST - 0.05)).toBe('HANDS_FREE');
    expect(modeAt(e, FIRST)).toBe('ALERT_FIRST');
  });

  it('[R29.3] the second alert starts 30 s after the first', () => {
    const e = eyesOff();
    expect(modeAt(e, SECOND - 0.05)).toBe('ALERT_FIRST');
    expect(modeAt(e, SECOND)).toBe('ALERT_SECOND');
  });

  it('[R30.4] the final alert starts 5 s after the second', () => {
    const e = eyesOff();
    expect(modeAt(e, FINAL - 0.05)).toBe('ALERT_SECOND');
    expect(modeAt(e, FINAL)).toBe('ALERT_FINAL');
  });

  it('[R36][SR6][IR11] the driver is inactive 2 s after the final alert → minimal risk maneuver', () => {
    const e = eyesOff();
    expect(modeAt(e, INACTIVE - 0.05)).toBe('ALERT_FINAL');
    expect(modeAt(e, INACTIVE)).toBe('MINIMAL_RISK_MANEUVER');
    expect(e.hfds.driverAttention.driverInactive).toBe(true);
    expect(e.driver.attentionLevel).toBe('Inactive');
  });
});

describe('alert channels', () => {
  it('[R29.1][R29.2][R34.1][R28.2] first alert: flashing green, "Pay attention to the road.", Class B', () => {
    const e = eyesOff();
    modeAt(e, FIRST + 1);
    const hmi = e.hfds.hmi.current;
    expect(hmi.lightBarStatus).toBe('FlashingGreen');
    expect(hmi.displayedMessage).toBe('Pay attention to the road.');
    expect(hmi.activeWarnings).toEqual([
      expect.objectContaining({ warningClass: 'B', level: 'First' }),
    ]);
  });

  it('[R30.1][R30.2][R30.3] second alert: flashing red, the message, and a seat pulse or chime', () => {
    const seat = eyesOff();
    modeAt(seat, SECOND + 1);
    expect(seat.hfds.hmi.current).toMatchObject({
      lightBarStatus: 'FlashingRed',
      displayedMessage: 'Take steering control immediately.',
      seatVibration: 'pulse',
    });
    const chime = eyesOff((s) => (s.vehicleConfig.secondAlertMode = 'chime'));
    modeAt(chime, SECOND + 1);
    expect(chime.hfds.hmi.current.audibleAlert).toBe(true);
  });

  it('[R31.1][R31.2] final alert: continuous seat vibration and a voice prompt', () => {
    const e = eyesOff();
    modeAt(e, FINAL + 0.5);
    expect(e.hfds.hmi.current.seatVibration).toBe('continuous');
    expect(e.hfds.hmi.current.voicePrompt).toBe('Take steering control immediately.');
  });

  it(`[R31.3] final alert: a phantom brake of ${PHANTOM_BRAKE_DECEL_FTPS2} ft/s² for ${PHANTOM_BRAKE_DURATION_S} s (A-13)`, () => {
    const e = eyesOff();
    modeAt(e, FINAL);
    const decels: number[] = [];
    runFor(e, 1, (x) => decels.push(x.vehicleControl.appliedHfdsAccel));
    expect(decels.filter((a) => Math.abs(a + PHANTOM_BRAKE_DECEL_FTPS2) < 1e-9).length).toBe(
      Math.round(PHANTOM_BRAKE_DURATION_S / 0.05) - 1,
    );
    expect(e.eventLog.entries.some((x) => x.reqs.includes('R31.3'))).toBe(true);
  });

  it('[IR12] no HFDS acceleration during the second and final alerts', () => {
    const e = eyesOff((s) => (s.ego.speedMph = 55));
    e.enqueueInput({ kind: 'setSpeed', mph: 70 }); // ACC would like to accelerate
    runFor(e, SECOND + 0.05);
    runFor(e, 6, (x) => expect(x.vehicleControl.appliedHfdsAccel).toBeLessThanOrEqual(0));
  });

  it('[R45.3] each alert is logged with a timestamp', () => {
    const e = eyesOff();
    modeAt(e, FINAL);
    const alerts = e.eventLog.entries.filter(
      (x) => x.type === 'warning' && x.source === 'DriverAttentionSystem',
    );
    expect(alerts.map((x) => x.t)).toEqual([FIRST, SECOND, FINAL].map((t) => expect.closeTo(t, 6)));
  });
});

describe('cancel and takeover', () => {
  it.each([
    ['first', FIRST + 2],
    ['second', SECOND + 2],
    ['final', FINAL + 1],
  ])(
    '[R32] looking back during the %s alert cancels it and restores solid green',
    (_name, back) => {
      const e = eyesOff((s) => s.timeline.push(gaze(back, true)));
      modeAt(e, back);
      expect(e.hfds.mode).toBe('HANDS_FREE');
      expect(e.hfds.hmi.current.lightBarStatus).toBe('SolidGreen');
      expect(e.hfds.hmi.current.activeWarnings).toEqual([]);
      expect(
        e.eventLog.entries.some((x) => x.reqs.includes('R32') && /cancel/.test(x.message)),
      ).toBe(true);
    },
  );

  it('[R32] the attention timer restarts after a cancel', () => {
    const e = eyesOff((s) => s.timeline.push(gaze(FIRST + 1, true), gaze(FIRST + 2, false)));
    expect(modeAt(e, FIRST + 2 + ATTENTION_LOSS_DETECT_S - 0.05)).toBe('HANDS_FREE');
    expect(modeAt(e, FIRST + 2 + ATTENTION_LOSS_DETECT_S)).toBe('ALERT_FIRST');
  });

  it('[UC18][IR25] steering during an alert is a takeover', () => {
    const e = eyesOff((s) =>
      s.timeline.push({ t: SECOND + 1, kind: 'driver', action: 'setSteer', args: { value: 0.2 } }),
    );
    modeAt(e, SECOND + 1);
    expect(e.hfds.mode).toBe('UNAVAILABLE');
    expect(e.anchors.takeover).toBeCloseTo(SECOND + 1, 6);
  });

  it('[R28][A-22] a Class A warning supersedes an active Class B alert', () => {
    const e = eyesOff((s) => {
      s.road.segments = [{ fromFt: 2500, toFt: 3500, curvatureRadiusFt: 700, direction: 'left' }];
    });
    runFor(e, 25);
    expect(e.hfds.mode).toBe('TAKEOVER_REQUESTED');
    expect(e.hfds.hmi.current.activeWarnings.map((w) => w.warningClass)).toEqual(['A']);
    expect(e.eventLog.entries.some((x) => /superseded/.test(x.message))).toBe(true);
  });

  it('[R29][R39] alerts also escalate while the driver steers; a cancel returns to driver steering', () => {
    const e = build((s) => {
      s.timeline.push(
        { t: 2, kind: 'driver', action: 'setSteer', args: { value: 0.06 } },
        { t: 2.5, kind: 'driver', action: 'setSteer', args: { value: 0 } },
        gaze(3, false),
        gaze(8, true),
      );
    });
    runFor(e, 7);
    expect(e.hfds.mode).toBe('ALERT_FIRST');
    runFor(e, 1.1);
    expect(e.hfds.mode).toBe('DRIVER_STEERING');
  });
});
