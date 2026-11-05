import { describe, expect, it } from 'vitest';
import { validateClientAction, type Engine } from '../../src/engine/engine';
import { ERROR_CATALOG } from '../../src/engine/hfds/error-codes';
import {
  MAX_COMMAND_SPEED_MPH,
  ONSTAR_CONNECT_S,
  POST_TAKEOVER_RECHECK_S,
} from '../../src/shared/constants';
import type { ControlCommand } from '../../src/shared/domain';
import type { DirectorAction } from '../../src/shared/protocol';
import { build, runFor } from './m3-helpers';

/**
 * M6 optional scenarios S18 / S19: SR8 collision → OnStar emergency call (A-61) and
 * external network commands (IR18, IR19, IR21, SR9; ISSUE-43, A-62).
 */
const engaged = (): Engine => {
  const e = build();
  runFor(e, 2);
  expect(e.hfds.mode).toBe('HANDS_FREE');
  return e;
};
const inject = (e: Engine, action: DirectorAction, seconds = 0.1) => {
  e.enqueueInject(action);
  return runFor(e, seconds);
};
const collide = (e: Engine, airbag = true) =>
  inject(e, { kind: 'collision', args: { airbag } }, 0.05);
const external = (e: Engine, kind: string, value: number, authenticated: boolean) =>
  inject(e, { kind: 'externalCommand', args: { kind, value, authenticated } }, 0.05);
const logged = (e: Engine, re: RegExp) => e.eventLog.entries.filter((x) => re.test(x.message));
const speedMph = (e: Engine) => e.vehicleControl.currentSpeed;

describe('collision → OnStar emergency call (SR8, A-61)', () => {
  it('[SR8][A-55] places an OnStar call at once; the advisor connects 3 s later', () => {
    const e = engaged();
    collide(e);
    const t0 = e.simTime - 0.05;
    expect(e.hfds.hmi.current.onStar).toBe('connecting');
    const placed = logged(e, /placing an OnStar emergency call/);
    expect(placed).toHaveLength(1);
    expect(placed[0]?.reqs).toContain('SR8');
    runFor(e, ONSTAR_CONNECT_S);
    expect(e.hfds.hmi.current.onStar).toBe('connected');
    const connected = logged(e, /advisor connected/)[0];
    expect(connected?.reqs).toEqual(['SR8']);
    expect((connected?.t ?? 0) - t0).toBeCloseTo(ONSTAR_CONNECT_S, 5);
  });

  it('[SR8] the call is placed even when HFDS is not engaged', () => {
    const e = build((s) => (s.timeline = []));
    runFor(e, 1);
    expect(e.hfds.engaged).toBe(false);
    collide(e, false);
    expect(e.hfds.hmi.current.onStar).toBe('connecting');
    expect(logged(e, /^Collision detected: placing an OnStar/)).toHaveLength(1);
  });

  it('[SR8][R37] records E701 (severity 100, high band)', () => {
    const e = engaged();
    collide(e);
    expect(ERROR_CATALOG.E701?.severity).toBe(100);
    const code = e.hfds.faults.active.get('E701');
    expect(code?.band).toBe('high');
    expect(code?.description).toMatch(/airbag deployed/);
  });

  it('[IR24][R28.1] while engaged a collision is a Class A takeover request', () => {
    const e = engaged();
    collide(e);
    expect(e.hfds.mode).toBe('TAKEOVER_REQUESTED');
    expect(e.hfds.activeClassA?.reason).toBe('COLLISION');
    const request = e.eventLog.entries.find((x) => x.type === 'takeover_request');
    expect(request?.reqs).toEqual(expect.arrayContaining(['SR8', 'IR24', 'R28.1']));
  });

  it('[IR23] HFDS stays unavailable after the driver takes over until an ignition cycle', () => {
    const e = engaged();
    collide(e);
    e.enqueueInput({ kind: 'setGrip', L: true, R: true });
    runFor(e, 1);
    expect(e.hfds.engaged).toBe(false);
    runFor(e, POST_TAKEOVER_RECHECK_S + 30);
    expect(e.hfds.available).toBe(false);
    e.enqueueInput({ kind: 'pressHfdsButton' });
    runFor(e, 1);
    expect(e.hfds.engaged).toBe(false);
  });

  it('[IR10][A-61] an ignition cycle clears E701 and the OnStar call without a buffer', () => {
    const e = engaged();
    collide(e);
    e.enqueueInput({ kind: 'setGrip', L: true, R: true });
    runFor(e, 1);
    inject(e, { kind: 'ignitionCycle' }, 0.5);
    expect(e.hfds.faults.has('E701')).toBe(false);
    expect(e.hfds.hmi.current.onStar).toBe('idle');
    expect(e.hfds.activeCooldown(e.simTime)).toBeNull();
    expect(logged(e, /R38\.2 reactivation buffer after E701/)).toHaveLength(0);
  });

  it('[R38][R38.2][A-59] clearing E701 from the Director starts the 30 s buffer', () => {
    const e = engaged();
    collide(e);
    e.enqueueInput({ kind: 'setGrip', L: true, R: true });
    runFor(e, 1);
    inject(e, { kind: 'clearFault', args: { code: 'E701' } }, 0.2);
    expect(e.hfds.faults.has('E701')).toBe(false);
    expect(e.hfds.activeCooldown(e.simTime)?.reason).toMatch(/after E701/);
  });

  it('[SR1.3][SR8] a later minimal-risk stop keeps the call already placed', () => {
    const e = engaged();
    collide(e);
    runFor(e, 120); // no takeover: SR7 → SR1 controlled stop
    expect(e.hfds.mode).toBe('STOPPED_LOCKOUT');
    expect(logged(e, /OnStar advisor already connected/)).toHaveLength(1);
    expect(logged(e, /advisor connected/)).toHaveLength(1);
  });
});

describe('external network commands (IR18, IR19, IR21, SR9; A-62)', () => {
  it('[IR19][IR21][SR9] an unauthenticated command is rejected and logged; speed unchanged', () => {
    const e = engaged();
    const before = speedMph(e);
    external(e, 'accelerate', 5, false);
    runFor(e, 2);
    const [w] = e.eventLog.entries.filter((x) => x.type === 'warning');
    expect(w?.message).toMatch(/rejected: .*no authenticated service provider/);
    expect(w?.reqs).toEqual(expect.arrayContaining(['IR19', 'IR18', 'IR21', 'SR9']));
    expect(speedMph(e)).toBeCloseTo(before, 1);
  });

  it('[IR18] authenticated steer / accelerate / brake from outside the car are rejected', () => {
    const e = engaged();
    const before = { speed: speedMph(e), y: e.vehicleControl.ego.y };
    external(e, 'accelerate', 5, true);
    external(e, 'brake', 8, true);
    external(e, 'steer', 10, true);
    runFor(e, 2);
    const rejected = logged(e, /in-car Driver Assist System or the driver's own controls/);
    expect(rejected).toHaveLength(3);
    rejected.forEach((x) => expect(x.reqs).toContain('IR18'));
    expect(speedMph(e)).toBeCloseTo(before.speed, 1);
    expect(e.vehicleControl.ego.y).toBeCloseTo(before.y, 1);
  });

  it('[IR19] an unauthenticated set-speed request is rejected', () => {
    const e = engaged();
    const before = e.hfds.speedManagement.setSpeed;
    external(e, 'setSpeed', 40, false);
    expect(e.hfds.speedManagement.setSpeed).toBe(before);
  });

  it('[IR19][IR27] an authenticated set-speed request is applied by HFDS, capped at 85 mph', () => {
    const e = engaged();
    external(e, 'setSpeed', 60, true);
    expect(e.hfds.speedManagement.setSpeed).toBe(60);
    runFor(e, 10);
    expect(speedMph(e)).toBeCloseTo(60, 0);
    external(e, 'setSpeed', 95, true);
    expect(e.hfds.speedManagement.setSpeed).toBe(MAX_COMMAND_SPEED_MPH);
  });

  it('[IR18] VehicleControl authorizes only the authenticated in-car DAS and the driver', () => {
    const e = engaged();
    const vc = e.vehicleControl;
    const cmd = (source: ControlCommand['source'], authenticated: boolean): ControlCommand => ({
      kind: 'accelerate',
      value: 1,
      source,
      authenticated,
      reqs: [],
    });
    expect(vc.authorize(cmd('DriverAssistSystem', true))).toBeNull();
    expect(vc.authorize(cmd('Driver', false))).toBeNull();
    expect(vc.authorize(cmd('DriverAssistSystem', false))?.reqs).toEqual(['IR18']);
    expect(vc.authorize(cmd('External', true))?.reqs).toEqual(['IR18']);
    expect(vc.authorize(cmd('External', false))?.reqs).toEqual(['IR19', 'IR18']);
  });

  it('[IR19] the Director vocabulary only admits steer, accelerate, brake and setSpeed', () => {
    const command = (kind: string): DirectorAction => ({
      kind: 'externalCommand',
      args: { kind, value: 1, authenticated: true },
    });
    expect(validateClientAction('inject', command('unlockDoors'))).not.toBeNull();
    expect(validateClientAction('inject', command('brake'))).toBeNull();
  });
});
