import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/engine/engine';
import {
  CONTROL_TRANSFER_BANNER_S,
  DT_S,
  LIGHT_BAR_ERROR_FLASH_S,
  REJECTION_DISPLAY_S,
  START_SEQUENCE_S,
} from '../../src/shared/constants';
import type { TimelineEvent, Scenario } from '../../src/shared/scenario-schema';
import { readPreset } from './helpers';

/**
 * Doc 13 §5.2 and the §6 rows implemented in M2 (availability ⇄, button, STARTING →
 * HANDS_FREE, button while engaged). Later rows are added in M4/M5.
 */
const base: Scenario = {
  ...readPreset('s01-activation-success'),
  timeline: [],
  expect: [],
  traffic: [],
};
const press = (t: number): TimelineEvent => ({ t, kind: 'driver', action: 'pressHfdsButton' });
const ticks = (s: number) => Math.round(s / DT_S);

function runFor(seconds: number, change: (s: Scenario) => void): Engine {
  const s = structuredClone(base);
  change(s);
  const e = new Engine(s);
  for (let i = 0; i < ticks(seconds); i++) e.step();
  return e;
}

/** Runs and records the mode after every tick. */
function modes(
  seconds: number,
  change: (s: Scenario) => void,
): { e: Engine; at: (t: number) => string } {
  const s = structuredClone(base);
  change(s);
  const e = new Engine(s);
  const seen: string[] = [];
  for (let i = 0; i < ticks(seconds); i++) {
    e.step();
    seen.push(e.hfds.mode);
  }
  return { e, at: (t) => seen[ticks(t) - 1] ?? 'none' };
}

const entries = (e: Engine, type: string) => e.eventLog.entries.filter((x) => x.type === type);

describe('engagement (doc 13 §5.2)', () => {
  it('[IR7] HFDS never engages without the button, even when available', () => {
    const { e } = modes(20, () => {});
    expect(e.hfds.mode).toBe('AVAILABLE');
    expect(entries(e, 'engagement')).toHaveLength(0);
  });

  it('[R14][R42][A-07] the start sequence takes 1.0 s, then HANDS_FREE', () => {
    const { at } = modes(5, (s) => (s.timeline = [press(2)]));
    expect(at(2.05)).toBe('STARTING');
    expect(at(2 + START_SEQUENCE_S)).toBe('STARTING'); // the tick that started at 2.95 s
    expect(at(2 + START_SEQUENCE_S + DT_S)).toBe('HANDS_FREE'); // decided in the tick at 3.0 s
  });

  it('[R45.1][R48.2] engagement is logged with a timestamp and VehicleControl confirms it', () => {
    const e = runFor(4, (s) => (s.timeline = [press(2)]));
    const [eng] = entries(e, 'engagement');
    expect(eng?.t).toBeCloseTo(3.0, 9);
    expect(eng?.reqs).toEqual(expect.arrayContaining(['R45.1', 'R48.2', 'R17', 'IR22']));
  });

  it('[R17] the set speed is the current speed when none was set', () => {
    const e = runFor(4, (s) => (s.timeline = [press(2)]));
    expect(e.hfds.speedManagement.active).toBe(true);
    expect(e.hfds.speedManagement.setSpeed).toBeCloseTo(62, 9);
  });

  it('[R17] a previously set speed is kept; [IR27] set speeds are capped at 85 mph', () => {
    expect(
      runFor(4, (s) => ((s.ego.setSpeedMph = 70), (s.timeline = [press(2)]))).hfds.speedManagement
        .setSpeed,
    ).toBe(70);
    const capped = runFor(4, (s) => {
      s.timeline = [{ t: 1, kind: 'driver', action: 'setSpeed', args: { mph: 90 } }, press(2)];
    });
    expect(capped.hfds.speedManagement.setSpeed).toBe(85);
  });

  it('[IR22][R33][R46.1] FCS "Alert and Brake", solid green and the state badge while engaged', () => {
    const before = runFor(1, (s) => (s.timeline = [press(2)]));
    expect(before.hfds.hmi.current).toMatchObject({
      fcsMode: 'Default',
      lightBarStatus: 'Off',
      displayedState: 'AVAILABLE',
    });
    const after = runFor(4, (s) => (s.timeline = [press(2)]));
    expect(after.hfds.hmi.current).toMatchObject({
      fcsMode: 'AlertAndBrake',
      lightBarStatus: 'SolidGreen',
      displayedState: 'HANDS_FREE',
    });
  });

  it('[R40] engaging shows the "HFDS steering" banner for 5 s (A-44)', () => {
    const e = runFor(3.5, (s) => (s.timeline = [press(2)]));
    expect(e.hfds.hmi.current.controlTransferBanner).toBe('HFDS steering');
    const later = runFor(3 + CONTROL_TRANSFER_BANNER_S + 0.1, (s) => (s.timeline = [press(2)]));
    expect(later.hfds.hmi.current.controlTransferBanner).toBeUndefined();
  });
});

describe('R43 debounce (A-43)', () => {
  it('[R43] a press exactly 0.5 s after the previous one is ignored', () => {
    const e = runFor(5, (s) => (s.timeline = [press(2), press(2.5)]));
    expect(e.hfds.mode).toBe('HANDS_FREE');
    expect(entries(e, 'info').some((x) => x.reqs.includes('R43'))).toBe(true);
  });

  it('[R43] a press 0.55 s later is accepted (here: a stop request during the start sequence)', () => {
    const e = runFor(5, (s) => (s.timeline = [press(2), press(2.55)]));
    expect(entries(e, 'info').some((x) => x.reqs.includes('R43'))).toBe(false);
    expect(entries(e, 'info').some((x) => x.reqs.includes('R42'))).toBe(true);
  });

  it('[R43] "previous press" includes ignored presses: rapid presses keep being ignored', () => {
    const e = runFor(5, (s) => (s.timeline = [press(2), press(2.3), press(2.6)]));
    expect(entries(e, 'info').filter((x) => x.reqs.includes('R43'))).toHaveLength(2);
    expect(e.hfds.mode).toBe('HANDS_FREE'); // no stop request was taken
  });
});

describe('R42 stop request during the start sequence', () => {
  it('[R42][R12] is queued and processed once the sequence finishes', () => {
    const e = runFor(5, (s) => (s.timeline = [press(2), press(2.6)]));
    const eng = entries(e, 'engagement')[0];
    const dis = entries(e, 'disengagement')[0];
    expect(eng?.t).toBeCloseTo(3.0, 9);
    expect(dis?.t).toBeCloseTo(3.0, 9);
    expect(dis?.reqs).toContain('R42');
    expect(e.hfds.mode).toBe('AVAILABLE');
  });
});

describe('R12 button while engaged', () => {
  it('[R12][R45.2][R40] turns HFDS off, logs it, cancels ACC and announces driver control', () => {
    const e = runFor(6.5, (s) => (s.timeline = [press(2), press(6)]));
    expect(e.hfds.mode).toBe('AVAILABLE');
    const [dis] = entries(e, 'disengagement');
    expect(dis?.t).toBeCloseTo(6.0, 9);
    expect(dis?.reqs).toEqual(expect.arrayContaining(['R12', 'R45.2', 'R40']));
    expect(e.hfds.speedManagement.active).toBe(false);
    expect(e.hfds.hmi.current).toMatchObject({
      fcsMode: 'Default',
      lightBarStatus: 'Off',
      controlTransferBanner: 'You are in control',
    });
  });

  it('[R12] can turn HFDS on again afterwards', () => {
    const e = runFor(9, (s) => (s.timeline = [press(2), press(5), press(7)]));
    expect(entries(e, 'engagement')).toHaveLength(2);
    expect(e.hfds.mode).toBe('HANDS_FREE');
  });
});

describe('R16 / R49 rejection (ISSUE-29)', () => {
  const night = (s: Scenario) => {
    s.environment.lightCondition = 'Night';
    s.timeline = [press(2)];
  };

  it('[R16.1][R16.2][R16.3] dashboard error, HUD line and light-bar flash when fitted', () => {
    const e = runFor(2.1, night);
    const hmi = e.hfds.hmi.current;
    expect(hmi.dashboardError).toMatch(/Daylight/);
    expect(hmi.hudMessage).toBe(hmi.dashboardError);
    expect(hmi.lightBarError).toBe(true);
  });

  it('[R16.2][R16.3] no HUD line or light-bar flash on a vehicle without them', () => {
    const e = runFor(2.1, (s) => {
      night(s);
      s.vehicleConfig.hasHUD = false;
      s.vehicleConfig.hasLightBar = false;
    });
    const hmi = e.hfds.hmi.current;
    expect(hmi.dashboardError).toBeTruthy();
    expect(hmi.hudMessage).toBeUndefined();
    expect(hmi.lightBarError).toBe(false);
  });

  it('[R16][A-44] the flash lasts 2 s and the messages 5 s', () => {
    const flashGone = runFor(2 + LIGHT_BAR_ERROR_FLASH_S + 0.1, night).hfds.hmi.current;
    expect(flashGone.lightBarError).toBe(false);
    expect(flashGone.dashboardError).toBeTruthy();
    const allGone = runFor(2 + REJECTION_DISPLAY_S + 0.1, night).hfds.hmi.current;
    expect(allGone.dashboardError).toBeUndefined();
    expect(allGone.activationWarning).toBeUndefined();
  });

  it('[R49] the activation warning names every failed check and is logged as a warning', () => {
    const e = runFor(2.1, (s) => {
      night(s);
      s.environment.weather = 'Rain';
    });
    expect(e.hfds.hmi.current.activationWarning).toMatch(/Daylight.*Weather/);
    expect(e.hfds.hmi.current.displayedMessage).toBe(e.hfds.hmi.current.activationWarning);
    const [w] = entries(e, 'warning');
    expect(w?.reqs).toEqual(expect.arrayContaining(['R16', 'R49', 'IR5.1', 'IR5.4']));
    expect(e.hfds.mode).toBe('UNAVAILABLE');
  });

  it('[IR28] a press at 2 mph is rejected for speed', () => {
    const e = runFor(2.1, (s) => ((s.ego.speedMph = 2), (s.timeline = [press(2)])));
    expect(entries(e, 'warning')[0]?.reqs).toContain('IR28');
  });

  it('[R15][R49] losing a condition during the start sequence rejects the activation', () => {
    const e = runFor(4, (s) => {
      s.timeline = [
        press(2),
        { t: 2.5, kind: 'driver', action: 'setGaze', args: { eyesOnRoad: false } },
      ];
    });
    expect(entries(e, 'engagement')).toHaveLength(0);
    expect(entries(e, 'warning')[0]?.reqs).toContain('IR3');
    expect(e.hfds.mode).toBe('UNAVAILABLE');
  });

  it('[R48.1][A-42] braking at the end of the start sequence fails the activation conditions', () => {
    const e = runFor(4, (s) => {
      s.timeline = [
        press(2),
        { t: 2.9, kind: 'driver', action: 'setBrake', args: { pressed: true, rate: 1 } },
      ];
    });
    expect(entries(e, 'engagement')).toHaveLength(0);
    const [w] = entries(e, 'warning');
    expect(w?.reqs).toContain('R48.1');
    expect(w?.message).toMatch(/brake pedal pressed/);
  });
});

describe('availability transitions', () => {
  it('[IR6] UNAVAILABLE ⇄ AVAILABLE follows the checklist and is logged once per change', () => {
    const { e, at } = modes(6, (s) => {
      s.timeline = [
        { t: 2, kind: 'inject', action: 'setEnvironment', args: { weather: 'Fog' } },
        { t: 4, kind: 'inject', action: 'setEnvironment', args: { weather: 'Clear' } },
      ];
    });
    expect(at(1)).toBe('AVAILABLE');
    expect(at(3)).toBe('UNAVAILABLE');
    expect(at(5)).toBe('AVAILABLE');
    expect(e.eventLog.entries.filter((x) => x.reqs.includes('IR6'))).toHaveLength(3);
  });
});

describe('start-sequence validation lines (SD1; R14, R15, R47, A-41)', () => {
  const fresh = (change: (s: Scenario) => void = () => {}) => runFor(0.5, change);
  const line = (e: Engine, id: string) => e.hfds.validateStart(e.simTime).find((c) => c.id === id);

  it('[R14][R15][R47][R48.1] all lines pass on the S01 highway', () => {
    const e = fresh();
    expect(e.hfds.validateStart(e.simTime).filter((c) => !c.pass)).toEqual([]);
  });

  it('[R13][R15.1] road conditions come from the environment and fail outside the ODD', () => {
    const e = fresh((s) => (s.environment.weather = 'Snow'));
    expect(e.hfds.driverAssist.gatherConditions(e.environment).weather).toBe('Snow');
    expect(line(e, 'R15.1')?.pass).toBe(false);
  });

  it('[R15.2] the current trajectory must be inside one travel lane', () => {
    const e = fresh();
    e.hfds.vehicleControl.placeInLane(e.road.laneCenterY(2) + 3.5);
    e.step();
    expect(line(e, 'R15.2')?.pass).toBe(false);
  });

  it('[R15.3] sensor input older than 100 ms fails', () => {
    const e = fresh();
    e.enqueueInject({ kind: 'failSensor', args: { sensorId: 'RADAR_FRONT', status: 'Failed' } });
    for (let i = 0; i < 4; i++) e.step();
    expect(line(e, 'R15.3')?.pass).toBe(false);
  });

  it('[R15.4] the blue path must be valid (confidence ≥ 0.5, A-31)', () => {
    const e = fresh();
    expect(e.hfds.pathPrediction.pathConfidence).toBe(1);
    e.hfds.pathPrediction.pathConfidence = 0.4;
    expect(line(e, 'R15.4')?.pass).toBe(false);
  });

  it('[R47] vehicle position must be confirmed by two agreeing sources, and the map valid', () => {
    const e = fresh();
    e.hfds.vehiclePosition.injectedDisagreementM = 0.4;
    e.step();
    expect(e.hfds.vehiclePosition.positionValid).toBe(false);
    expect(line(e, 'R47')?.pass).toBe(false);
    const old = fresh((s) => (s.map.lastUpdated = '2025-01-01'));
    expect(line(old, 'R47')?.pass).toBe(false);
    expect(line(old, 'R14')?.pass).toBe(false); // map data fails its self-test
  });

  it('[R15.2][R49] drifting across the lane line during the start sequence rejects the activation', () => {
    const e = runFor(4, (s) => {
      s.timeline = [
        press(2),
        { t: 2.1, kind: 'driver', action: 'setSteer', args: { value: 1 } },
        { t: 2.95, kind: 'driver', action: 'setSteer', args: { value: 0 } },
      ];
    });
    expect(entries(e, 'engagement')).toHaveLength(0);
    expect(entries(e, 'warning')[0]?.reqs).toContain('R15.2');
  });
});
