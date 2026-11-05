/**
 * Reactive driver script (doc 14 `takeoverOnClassA`): `delayS` after every takeover
 * request the scripted driver grips the listed areas, optionally sets a steering input,
 * and optionally steers into `steerToLaneId` (A-53: steering ∝ lateral error, at most
 * full input, done within 0.3 ft of the lane centre). This is the scenario's *driver*,
 * not HFDS logic; HFDS sees only the resulting grip and steering inputs.
 */
import { SCRIPTED_STEER_DONE_FT, SCRIPTED_STEER_GAIN_PER_FT } from '../../shared/constants';
import type { Driver } from '../world/driver';
import type { Road } from '../world/road';
import type { ReactiveEvent } from './timeline';

type TakeoverArgs = ReactiveEvent['args'];

export class ReactiveDriverScript {
  private pending: Array<{ t: number; args: TakeoverArgs }> = [];
  private steerTargetLane: number | null = null;

  constructor(private readonly events: readonly ReactiveEvent[]) {}

  get active(): boolean {
    return this.pending.length > 0 || this.steerTargetLane !== null;
  }

  /** Called by HFDS on every takeover request. */
  onTakeoverRequest(t: number): void {
    for (const e of this.events) this.pending.push({ t: t + e.args.delayS, args: e.args });
  }

  /** Doc 13 §11 step 1: apply the due actions and keep any scripted lane change going. */
  apply(t: number, driver: Driver, ego: { y: number }, road: Road): void {
    const due = this.pending.filter((p) => p.t <= t + 1e-9);
    this.pending = this.pending.filter((p) => p.t > t + 1e-9);
    for (const { args } of due) {
      const grip: Record<string, boolean> = {};
      for (const area of args.grip) grip[area] = true;
      driver.apply({ kind: 'setGrip', ...grip }, t);
      if (args.steer !== undefined) driver.steer(args.steer);
      if (args.steerToLaneId !== undefined) this.steerTargetLane = args.steerToLaneId;
    }
    if (this.steerTargetLane !== null) {
      const error = road.laneCenterY(this.steerTargetLane) - ego.y;
      if (Math.abs(error) <= SCRIPTED_STEER_DONE_FT) {
        driver.steer(0);
        this.steerTargetLane = null;
      } else {
        driver.steer(Math.max(-1, Math.min(1, error * SCRIPTED_STEER_GAIN_PER_FT)));
      }
    }
  }
}
