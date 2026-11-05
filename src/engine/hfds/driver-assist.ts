/**
 * DriverAssistSystem (doc 12): the decision maker. M2 part:
 *   - analyzeSurroundings() (R19): tracks surrounding vehicles within sensor range,
 *     selects the lead (R4, R4.3) and keeps the IR8 sliding windows;
 *   - trafficStability() (IR8.1–IR8.3);
 *   - gatherConditions() (R13) and validateEngagement() (R15, R47) for the start sequence.
 * Lane keeping, zones and braking (R5, R18–R24) are M3. ACC state lives in
 * SpeedManagement (ISSUE-24).
 *
 * A-48: a vehicle is tracked while it is within the forward sensor range ahead of or
 * behind the ego. IR8.3 uses the gap history of the current lead only (a new lead starts
 * a new history, so a cut-in is a lead change, not a gap change).
 */
import {
  EGO_SIZE_CLASS,
  UNSTABLE_ACCEL_CHANGE_FTPS2,
  UNSTABLE_ACCEL_WINDOW_S,
  UNSTABLE_GAP_CHANGE_FRAC,
  UNSTABLE_GAP_WINDOW_S,
  UNSTABLE_MIN_TIME_HEADWAY_S,
  VEHICLE_DIMENSIONS_FT,
} from '../../shared/constants';
import { SubsystemStatus, type Environment, type GapSetting } from '../../shared/domain';
import type { EnvironmentState } from '../world/environment';
import type { SurroundingVehicle, TrafficModel } from '../world/traffic';
import type { PathPrediction } from './path-prediction';
import { SpeedManagement } from './speed-management';

const EPS = 1e-9;

export interface StabilityResult {
  stable: boolean;
  /** failing sub-requirements with a reason, e.g. { id: 'IR8.1', detail: '…' } */
  problems: Array<{ id: 'IR8.1' | 'IR8.2' | 'IR8.3'; detail: string }>;
}

interface Sample {
  t: number;
  v: number;
}

export class DriverAssistSystem {
  status: SubsystemStatus = SubsystemStatus.OK;
  trackedVehicles: SurroundingVehicle[] = [];
  leadVehicle: SurroundingVehicle | null = null;
  /** ft, ego front bumper to lead rear bumper (null without a lead) */
  leadGap: number | null = null;
  readonly speedManagement: SpeedManagement;
  private readonly accelHistory = new Map<number, Sample[]>();
  private gapHistory: { leadId: number; samples: Sample[] } | null = null;

  constructor(
    config: { maxBrakingDecelFtps2: number; forwardSensorRangeFt: number },
    gap: GapSetting,
    initialSetSpeedMph: number | null,
  ) {
    this.speedManagement = new SpeedManagement(config, gap, initialSetSpeedMph);
  }

  /** R13 (UC2): weather and road conditions. */
  gatherConditions(env: EnvironmentState): Environment {
    return env.value;
  }

  /**
   * R4.3: in the ego's lane when the other vehicle's lateral extent overlaps the ego
   * corridor along the blue path (ego width centred on the path).
   */
  isInEgoPath(v: SurroundingVehicle, path: PathPrediction): boolean {
    const pathY = path.pathYAt(v.s);
    if (pathY === null) return false;
    const egoHalf = VEHICLE_DIMENSIONS_FT[EGO_SIZE_CLASS].width / 2;
    return v.y + v.width / 2 > pathY - egoHalf && v.y - v.width / 2 < pathY + egoHalf;
  }

  /**
   * R4: lead = nearest in-path vehicle ahead with 0 < gap ≤ selection distance, where
   * selection distance uses that vehicle's size factor (R4.1, R25).
   */
  selectLeadVehicle(
    egoS: number,
    egoSpeed: number,
    path: PathPrediction,
  ): SurroundingVehicle | null {
    let best: { v: SurroundingVehicle; gap: number } | null = null;
    for (const v of this.trackedVehicles) {
      const gap = v.s - v.length - egoS;
      if (gap <= 0 || !this.isInEgoPath(v, path)) continue;
      if (gap > this.speedManagement.selectionDistance(egoSpeed, v.sizeClass) + EPS) continue;
      if (!best || gap < best.gap) best = { v, gap };
    }
    this.leadVehicle = best?.v ?? null;
    this.leadGap = best?.gap ?? null;
    return this.leadVehicle;
  }

  /** Doc 13 §11 step 5 (R19, R7): tracks, lead selection, IR8 windows. */
  analyzeSurroundings(
    t: number,
    ego: { s: number; speed: number },
    traffic: TrafficModel,
    path: PathPrediction,
  ): void {
    const range = this.speedManagement.forwardSensorRange;
    this.trackedVehicles = traffic.vehicles.filter((v) => Math.abs(v.s - ego.s) <= range + EPS);

    // IR8.2 window: acceleration samples over the last 1 s per tracked vehicle.
    const tracked = new Set(this.trackedVehicles.map((v) => v.vehicleId));
    for (const id of [...this.accelHistory.keys()])
      if (!tracked.has(id)) this.accelHistory.delete(id);
    for (const v of this.trackedVehicles) {
      const h = this.accelHistory.get(v.vehicleId) ?? [];
      h.push({ t, v: v.acceleration });
      while (h.length && (h[0]?.t ?? t) < t - UNSTABLE_ACCEL_WINDOW_S - EPS) h.shift();
      this.accelHistory.set(v.vehicleId, h);
    }

    // R4 lead and the IR8.3 gap window (3 s, current lead only).
    const lead = this.selectLeadVehicle(ego.s, ego.speed, path);
    if (!lead || this.leadGap === null) {
      this.gapHistory = null;
    } else {
      if (!this.gapHistory || this.gapHistory.leadId !== lead.vehicleId) {
        this.gapHistory = { leadId: lead.vehicleId, samples: [] };
      }
      const g = this.gapHistory.samples;
      g.push({ t, v: this.leadGap });
      while (g.length && (g[0]?.t ?? t) < t - UNSTABLE_GAP_WINDOW_S - EPS) g.shift();
    }
  }

  /** IR8: surrounding traffic is stable when none of IR8.1–IR8.3 holds. */
  trafficStability(egoSpeed: number): StabilityResult {
    const problems: StabilityResult['problems'] = [];
    const maxDecel = this.speedManagement.maxBrakingDecel;
    for (const v of this.trackedVehicles) {
      // IR8.1: decelerates at more than maxBrakingDecel.
      if (-v.acceleration > maxDecel + EPS) {
        problems.push({
          id: 'IR8.1',
          detail: `vehicle ${v.vehicleId} braking at ${(-v.acceleration).toFixed(1)} ft/s² > ${maxDecel}`,
        });
      }
      // IR8.2: acceleration changes by more than 10 ft/s² within 1 s.
      const h = this.accelHistory.get(v.vehicleId) ?? [];
      if (h.length > 1) {
        const values = h.map((x) => x.v);
        const change = Math.max(...values) - Math.min(...values);
        if (change > UNSTABLE_ACCEL_CHANGE_FTPS2 + EPS) {
          problems.push({
            id: 'IR8.2',
            detail: `vehicle ${v.vehicleId} acceleration changed ${change.toFixed(1)} ft/s² within 1 s`,
          });
        }
      }
    }
    // IR8.3: lead gap changes by > 30 % of trail distance within 3 s, or headway < 1.0 s.
    const lead = this.leadVehicle;
    if (lead && this.leadGap !== null) {
      const trail = this.speedManagement.computeTrailDistance(egoSpeed, lead.sizeClass);
      const g = this.gapHistory?.samples.map((x) => x.v) ?? [];
      const change = g.length > 1 ? Math.max(...g) - Math.min(...g) : 0;
      if (trail > 0 && change > UNSTABLE_GAP_CHANGE_FRAC * trail + EPS) {
        problems.push({
          id: 'IR8.3',
          detail: `gap to vehicle ${lead.vehicleId} changed ${change.toFixed(0)} ft (> 30 % of ${trail.toFixed(0)} ft) within 3 s`,
        });
      }
      const headway = egoSpeed > 0 ? this.leadGap / egoSpeed : Infinity;
      if (headway < UNSTABLE_MIN_TIME_HEADWAY_S - EPS) {
        problems.push({
          id: 'IR8.3',
          detail: `time headway to vehicle ${lead.vehicleId} is ${headway.toFixed(2)} s < 1.0 s`,
        });
      }
    }
    return { stable: problems.length === 0, problems };
  }
}
