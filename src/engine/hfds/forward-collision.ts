/**
 * Forward Collision System (A-25; IR22, ISSUE-21). The SRS assumes the vehicle's FCS but
 * does not specify it. Minimal model so HFDS coasting (IR13) cannot drive into an object:
 * when an in-lane object ahead (the lead, including a vehicle entering the lane, or a
 * hazard in the ego lane) has a time-to-collision below 2.0 s, the FCS brakes at
 * maxBrakingDecel, independent of the HFDS mode, and shows "Forward collision alert".
 * Once triggered it keeps braking until the ego no longer closes on that object (or the
 * object is gone), so it does not switch on and off around the threshold.
 */
import { FCS_TTC_THRESHOLD_S } from '../../shared/constants';

export interface CollisionObject {
  /** stable identity (e.g. "vehicle 2", "hazard 1") */
  label: string;
  /** ft ahead (front bumper to the object's rear) */
  gap: number;
  /** ft/s the ego approaches it (≤ 0: not approaching) */
  closing: number;
}

export class ForwardCollisionSystem {
  braking = false;
  /** Object that triggered the current intervention. */
  cause: CollisionObject | null = null;
  private readonly maxBrakingDecel: number;

  constructor(maxBrakingDecelFtps2: number) {
    this.maxBrakingDecel = maxBrakingDecelFtps2;
  }

  /** Time to collision (s), Infinity when not approaching. */
  static ttc(o: CollisionObject): number {
    return o.closing > 0 ? Math.max(0, o.gap) / o.closing : Infinity;
  }

  /**
   * Doc 13 §11 step 8. Returns the FCS deceleration request (ft/s², positive) and
   * whether the intervention just started (for the log).
   */
  evaluate(objects: readonly CollisionObject[]): { decel: number; started: boolean } {
    const held = this.cause
      ? objects.find((o) => o.label === this.cause?.label && o.closing > 0)
      : undefined;
    let worst: CollisionObject | null = held ?? null;
    for (const o of objects) {
      const ttc = ForwardCollisionSystem.ttc(o);
      if (ttc < FCS_TTC_THRESHOLD_S && (!worst || ttc < ForwardCollisionSystem.ttc(worst)))
        worst = o;
    }
    const started = worst !== null && !this.braking;
    this.braking = worst !== null;
    this.cause = worst;
    return { decel: this.braking ? this.maxBrakingDecel : 0, started };
  }
}
