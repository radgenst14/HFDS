/**
 * Minimal Risk Maneuver (SR1, UC21; doc 13 §8).
 *
 *   SR1.1    move to the right shoulder and stop if it can be reached safely within the
 *            time limit; otherwise stop in the current lane.
 *   SR1.1.1  reachability is checked at fallback initiation and every tick (time,
 *            distance and safe-path checks, A-23); a failed check or 60 s without
 *            reaching the shoulder → stop in the current lane.
 *   SR1.1.2  one adjacent lane at a time, ≥ 2 s in each entered lane before the next
 *            lateral move, including shoulder entry.
 *   SR1.2–1.4 hazards on at entry; at the stop the OnStar advisor connects (stub, A-55)
 *            and the doors unlock.
 *
 * Speed (A-56): coast without accelerating while changing lanes (IR12, IR13), then brake
 * at the A-12 controlled-stop rate on the shoulder or when stopping in lane. The FCS
 * (A-25) still guards against objects ahead.
 */
import {
  COAST_DECEL_FTPS2,
  DRIVER_MAX_LATERAL_SPEED_FTPS,
  DT_S,
  EGO_SIZE_CLASS,
  MRM_DECEL_FTPS2,
  MRM_MIN_LANE_DWELL_S,
  MRM_SAFE_GAP_FT,
  MRM_SAFE_GAP_S,
  MRM_SHOULDER_TIME_LIMIT_S,
  VEHICLE_DIMENSIONS_FT,
} from '../../shared/constants';
import type { EgoState } from '../world/ego-kinematics';
import type { Road } from '../world/road';
import type { TrafficModel } from '../world/traffic';

export type MrmPhase = 'toShoulder' | 'stopping' | 'stopped';

export interface MrmContext {
  t: number;
  ego: EgoState;
  road: Road;
  traffic: TrafficModel;
}

export interface MrmCommand {
  /** lateral position to steer to (ft) */
  targetY: number;
  /** ft/s² */
  accel: number;
}

const EGO_LENGTH = VEHICLE_DIMENSIONS_FT[EGO_SIZE_CLASS].length;
const EPS = 1e-9;
const ticks = (s: number) => Math.round(s / DT_S);

export class MinimalRiskManeuver {
  readonly startedAt: number;
  /** why the maneuver started (SR6 / SR7) */
  readonly cause: string;
  phase: MrmPhase;
  /** SR1.1: true once the stop in the current lane was chosen; `why` explains it */
  stopInLane = false;
  why = '';
  stoppedAt: number | null = null;
  /** lane the vehicle stops in (shoulder = 0) */
  stopLane: number;
  /** lane change history for logs and tests (lane, entered at) */
  readonly lanes: Array<{ lane: number; enteredAt: number }> = [];
  private targetLane: number;
  private laneEnteredAt: number;

  constructor(cause: string, ctx: MrmContext) {
    this.startedAt = ctx.t;
    this.cause = cause;
    const lane = ctx.road.laneIdAt(ctx.ego.y);
    this.targetLane = lane;
    this.stopLane = lane;
    this.laneEnteredAt = -Infinity; // the starting lane was not "entered" during the maneuver
    this.lanes.push({ lane, enteredAt: ctx.t });
    this.phase = lane === 0 ? 'stopping' : 'toShoulder';
    if (this.phase === 'toShoulder') {
      const check = this.reachability(ctx);
      if (!check.ok) this.fallBackToLane(lane, check.why);
    }
  }

  /** Seconds since fallback initiation. */
  elapsed(t: number): number {
    return t - this.startedAt;
  }

  /** A-23: no vehicle in `lane` within ±1.5 s of travel or ±60 ft of the ego. */
  laneIsSafe(lane: number, ctx: MrmContext): boolean {
    const clearance = Math.max(MRM_SAFE_GAP_FT, MRM_SAFE_GAP_S * ctx.ego.speed);
    for (const v of ctx.traffic.vehicles) {
      if (ctx.road.laneIdAt(v.y) !== lane) continue;
      const ahead = v.s - v.length - ctx.ego.s;
      const behind = ctx.ego.s - EGO_LENGTH - v.s;
      const gap = Math.max(ahead, behind);
      if (gap < clearance - EPS) return false;
    }
    return true;
  }

  /** SR1.1.1: time, distance and safe-path checks for reaching the shoulder. */
  reachability(ctx: MrmContext): { ok: boolean; why: string } {
    const { road, ego, t } = ctx;
    if (!road.rightShoulder) return { ok: false, why: 'no right shoulder' };
    const lane = road.laneIdAt(ego.y);
    if (lane === 0) return { ok: true, why: '' };
    for (let l = lane - 1; l >= 0; l--) {
      if (!this.laneIsSafe(l, ctx))
        return { ok: false, why: `lane ${l === 0 ? 'shoulder' : l} not clear` };
    }
    const laneChange = road.laneWidthFt / DRIVER_MAX_LATERAL_SPEED_FTPS;
    const needed = lane * (laneChange + MRM_MIN_LANE_DWELL_S);
    const left = MRM_SHOULDER_TIME_LIMIT_S - this.elapsed(t);
    if (needed > left + EPS)
      return { ok: false, why: `shoulder needs ${needed.toFixed(1)} s, ${left.toFixed(1)} s left` };
    const stopDistance = (ego.speed * ego.speed) / (2 * MRM_DECEL_FTPS2);
    if (ego.s + ego.speed * needed + stopDistance > road.lengthFt)
      return { ok: false, why: 'not enough road ahead' };
    return { ok: true, why: '' };
  }

  private fallBackToLane(lane: number, why: string): void {
    this.phase = 'stopping';
    this.stopInLane = true;
    this.why = why;
    this.stopLane = lane;
    this.targetLane = lane;
  }

  /** Doc 13 §11 step 7/8: advance the maneuver and return this tick's command. */
  update(ctx: MrmContext): MrmCommand {
    const { road, ego, t } = ctx;
    const lane = road.laneIdAt(ego.y);
    const last = this.lanes[this.lanes.length - 1];
    if (last && last.lane !== lane) {
      this.lanes.push({ lane, enteredAt: t });
      this.laneEnteredAt = t;
    }

    if (this.phase === 'toShoulder') {
      if (lane === 0 && Math.abs(ego.y - road.laneCenterY(0)) < 0.5) {
        this.phase = 'stopping';
        this.stopLane = 0;
      } else if (ticks(this.elapsed(t)) >= ticks(MRM_SHOULDER_TIME_LIMIT_S)) {
        this.fallBackToLane(lane, 'shoulder not reached within 60 s');
      } else {
        const check = this.reachability(ctx);
        if (!check.ok && lane !== 0) this.fallBackToLane(lane, check.why);
        else if (
          this.targetLane === lane &&
          lane > 0 &&
          ticks(t - this.laneEnteredAt) >= ticks(MRM_MIN_LANE_DWELL_S) // SR1.1.2
        ) {
          this.targetLane = lane - 1;
        }
      }
    }

    if (this.phase === 'stopping' && ego.speed <= EPS) {
      this.phase = 'stopped';
      this.stoppedAt = t;
    }

    const targetY = road.laneCenterY(this.phase === 'toShoulder' ? this.targetLane : this.stopLane);
    const accel =
      this.phase === 'toShoulder'
        ? -COAST_DECEL_FTPS2
        : this.phase === 'stopping'
          ? -MRM_DECEL_FTPS2
          : 0;
    return { targetY, accel };
  }
}
