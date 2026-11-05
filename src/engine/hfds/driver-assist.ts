/**
 * DriverAssistSystem (doc 12): the decision maker. It combines VehiclePosition, the blue
 * path and the surrounding vehicles and decides steer / accelerate / brake.
 *
 *   analyzeSurroundings()  R19, R7, R6, UC11 lane intrusion, R4 lead selection, IR8 windows
 *   nearSurroundings()     R8
 *   updateTargetOffset()   UC12 large-vehicle offset (A-15)
 *   navigateCurve()        UC9 curve check (A-14)
 *   keepLaneCentered()     R20, R18 lateral command (A-51)
 *   speedCommand()         R5, R21–R25, IR9, IR27 via SpeedManagement (ISSUE-24)
 *   classACauses()         R23 braking insufficient, UC9 curve too sharp (M3 causes)
 *   trafficStability()     IR8.1–IR8.3
 *
 * A-48: a vehicle is tracked while within the forward sensor range ahead of or behind
 * the ego. IR8.3 uses the gap history of the current lead only.
 * A-52: a vehicle moving towards the ego path is "entering the lane" (UC11) when its
 * extent will overlap the path within 1.0 s; it can then become the lead.
 */
import {
  CURVE_LOOKAHEAD_S,
  DRIVER_MAX_LATERAL_SPEED_FTPS,
  EGO_SIZE_CLASS,
  LANE_INTRUSION_PREDICTION_S,
  LANE_KEEP_GAIN_PER_S,
  LARGE_VEHICLE_OFFSET_FT,
  LARGE_VEHICLE_RANGE_LENGTHS,
  MAX_LATERAL_ACCEL_FTPS2,
  MAX_STEERING_ANGLE_DEG,
  UNSTABLE_ACCEL_CHANGE_FTPS2,
  UNSTABLE_ACCEL_WINDOW_S,
  UNSTABLE_GAP_CHANGE_FRAC,
  UNSTABLE_GAP_WINDOW_S,
  UNSTABLE_MIN_TIME_HEADWAY_S,
  VEHICLE_DIMENSIONS_FT,
} from '../../shared/constants';
import {
  enumValues,
  SubsystemStatus,
  VehicleSizeClass,
  WarningReason,
  type ControlCommand,
  type Environment,
  type GapSetting,
  type Hazard,
} from '../../shared/domain';
import type { EnvironmentState } from '../world/environment';
import type { Road } from '../world/road';
import type { SurroundingVehicle, TrafficModel } from '../world/traffic';
import type { PathPrediction } from './path-prediction';
import { SpeedManagement, type LeadInfo, type LongitudinalResult } from './speed-management';

const EPS = 1e-9;
const EGO = VEHICLE_DIMENSIONS_FT[EGO_SIZE_CLASS];
const LARGE: readonly VehicleSizeClass[] = [
  VehicleSizeClass.Truck,
  VehicleSizeClass.SemiTruck,
  VehicleSizeClass.Bus,
];

export interface StabilityResult {
  stable: boolean;
  /** failing sub-requirements with a reason, e.g. { id: 'IR8.1', detail: '…' } */
  problems: Array<{ id: 'IR8.1' | 'IR8.2' | 'IR8.3'; detail: string }>;
}

/** R7 per-vehicle estimates. */
export interface Track {
  /** ft/s, + = faster than the ego */
  relativeSpeed: number;
  /** ft/s² */
  relativeAcceleration: number;
  /** ft along the road, front-to-front, + = ahead */
  distance: number;
  /** R6 */
  sizeClass: VehicleSizeClass;
  /** UC11 */
  isIntruding: boolean;
}

/** A reason to issue a Class A reclaim warning (R28.1). */
export interface ClassACause {
  reason: WarningReason;
  reqs: string[];
  detail: string;
}

/** R8 near surroundings within the selection distance and the adjacent lanes. */
export interface NearSurroundings {
  vehicles: Array<{ vehicleId: number; s: number; y: number; length: number; width: number }>;
  shoulder: boolean;
  medianBarrier: boolean;
  /** lateral positions (ft) of the ego lane's right and left boundaries */
  laneBoundaries: { right: number; left: number };
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
  /** ft from the lane centre (doc 12) */
  lateralOffset = 0;
  /** UC12 offset requested from PathPrediction (ft) */
  targetOffset = 0;
  readonly tracks = new Map<number, Track>();
  readonly speedManagement: SpeedManagement;
  /** Last ACC result (R22 / R23), null while ACC is off. */
  lastLongitudinal: LongitudinalResult | null = null;
  /** UC10: the in-lane hazard detected this tick (IR26). */
  hazard: Hazard | null = null;
  /** Last UC9 look-ahead result. */
  curve: { tooSharp: boolean; radiusFt: number; lateralAccel: number; atS: number } | null = null;
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

  /** R6: size class from the vehicle's length (the class with the nearest A-18 length). */
  classifyVehicle(lengthFt: number): VehicleSizeClass {
    let best: VehicleSizeClass = VehicleSizeClass.Car;
    for (const c of enumValues(VehicleSizeClass)) {
      if (
        Math.abs(VEHICLE_DIMENSIONS_FT[c].length - lengthFt) <
        Math.abs(VEHICLE_DIMENSIONS_FT[best].length - lengthFt)
      ) {
        best = c;
      }
    }
    return best;
  }

  /** R4.3: the vehicle's width overlaps the ego corridor (ego width on the blue path). */
  overlapsPath(v: { y: number; width: number }, path: PathPrediction): boolean {
    const pathY = path.pathYAt(0);
    if (pathY === null) return false;
    const half = EGO.width / 2;
    return v.y + v.width / 2 > pathY - half + EPS && v.y - v.width / 2 < pathY + half - EPS;
  }

  /** UC11 isEnteringLane(): moving towards the path and overlapping it within 1.0 s (A-52). */
  isEnteringLane(v: SurroundingVehicle, path: PathPrediction): boolean {
    const pathY = path.pathYAt(0);
    if (pathY === null || v.lateralVelocity === 0 || this.overlapsPath(v, path)) return false;
    const towards = Math.sign(pathY - v.y) === Math.sign(v.lateralVelocity);
    if (!towards) return false;
    return this.overlapsPath(
      { y: v.y + v.lateralVelocity * LANE_INTRUSION_PREDICTION_S, width: v.width },
      path,
    );
  }

  /** R4.3 + UC11: in the ego lane, or entering it. */
  isInEgoPath(v: SurroundingVehicle, path: PathPrediction): boolean {
    return this.overlapsPath(v, path) || this.isEnteringLane(v, path);
  }

  /** UC11 detectLaneIntrusion(): the nearest vehicle ahead entering the ego lane, if any. */
  detectLaneIntrusion(): SurroundingVehicle | null {
    let best: SurroundingVehicle | null = null;
    for (const v of this.trackedVehicles) {
      const tr = this.tracks.get(v.vehicleId);
      if (tr?.isIntruding && tr.distance > 0 && (!best || v.s < best.s)) best = v;
    }
    return best;
  }

  /**
   * R4: lead = nearest in-path vehicle ahead with 0 < gap ≤ selection distance, where the
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

  /**
   * UC12 (A-15): a truck, semi-truck or bus in an adjacent lane within ±1 of its length →
   * shift 1 ft away from it, clamped so the ego stays in its lane; large vehicles on both
   * sides cancel out.
   */
  updateTargetOffset(ego: { s: number; y: number }, road: Road, traffic: TrafficModel): number {
    const lane = road.laneIdAt(ego.y);
    let shift = 0;
    for (const v of traffic.vehicles) {
      if (!LARGE.includes(v.sizeClass) || Math.abs(v.laneId - lane) !== 1) continue;
      const reach = LARGE_VEHICLE_RANGE_LENGTHS * v.length;
      const alongside = v.s + reach > ego.s - EGO.length && v.s - v.length - reach < ego.s;
      if (alongside) shift += v.laneId < lane ? 1 : -1;
    }
    const limit = road.laneWidthFt / 2 - EGO.width / 2;
    this.targetOffset = Math.max(
      -limit,
      Math.min(limit, Math.sign(shift) * LARGE_VEHICLE_OFFSET_FT),
    );
    return this.targetOffset;
  }

  /**
   * UC10 detectHazard() (IR26): the nearest debris, pothole, stopped vehicle or pedestrian
   * in the ego lane within the selection distance (R4.1, no-lead size factor).
   */
  detectHazard(
    t: number,
    ego: { s: number; y: number; speed: number },
    road: Road,
    hazards: readonly Hazard[],
  ): Hazard | null {
    const lane = road.laneIdAt(ego.y);
    const reach = this.speedManagement.selectionDistance(ego.speed, null);
    let best: Hazard | null = null;
    for (const h of hazards) {
      const ahead = h.s - ego.s;
      if (h.laneId === lane && ahead >= 0 && ahead <= reach + EPS && (!best || h.s < best.s))
        best = h;
    }
    if (best && best.detectedAt === null) best.detectedAt = t;
    this.hazard = best;
    return best;
  }

  /** UC9 navigateCurve(): is a curve within the next 5 s of travel too sharp (A-14)? */
  navigateCurve(egoS: number, speedFtps: number, road: Road): DriverAssistSystem['curve'] {
    const ahead = egoS + speedFtps * CURVE_LOOKAHEAD_S;
    let worst: DriverAssistSystem['curve'] = null;
    for (const g of road.segments) {
      if (g.curvatureRadiusFt === undefined || g.toFt <= egoS || g.fromFt > ahead) continue;
      const lateralAccel = (speedFtps * speedFtps) / g.curvatureRadiusFt;
      if (!worst || lateralAccel > worst.lateralAccel) {
        worst = {
          tooSharp: lateralAccel > MAX_LATERAL_ACCEL_FTPS2 + EPS,
          radiusFt: g.curvatureRadiusFt,
          lateralAccel,
          atS: g.fromFt,
        };
      }
    }
    this.curve = worst;
    return worst;
  }

  /** R20 keepLaneCentered(): steer towards the blue path (A-51). */
  keepLaneCentered(egoY: number, path: PathPrediction): ControlCommand | null {
    const pathY = path.pathYAt(0);
    if (pathY === null) return null;
    const lateralSpeed = Math.max(
      -DRIVER_MAX_LATERAL_SPEED_FTPS,
      Math.min(DRIVER_MAX_LATERAL_SPEED_FTPS, LANE_KEEP_GAIN_PER_S * (pathY - egoY)),
    );
    return {
      kind: 'steer',
      value: (lateralSpeed / DRIVER_MAX_LATERAL_SPEED_FTPS) * MAX_STEERING_ANGLE_DEG,
      source: 'DriverAssistSystem',
      authenticated: true,
      reqs: ['R1', 'R18', 'R20'],
    };
  }

  /** Doc 13 §11 step 5 (R19, R7, R6, UC11, R4) and the IR8 windows. */
  analyzeSurroundings(
    t: number,
    ego: { s: number; y: number; speed: number; accel: number },
    traffic: TrafficModel,
    path: PathPrediction,
    road: Road,
  ): void {
    const range = this.speedManagement.forwardSensorRange;
    this.trackedVehicles = traffic.vehicles.filter((v) => Math.abs(v.s - ego.s) <= range + EPS);
    const pathY = path.pathYAt(0);
    this.lateralOffset = ego.y - road.laneCenterY(road.laneIdAt(ego.y));

    this.tracks.clear();
    for (const v of this.trackedVehicles) {
      const entering = this.isEnteringLane(v, path);
      const movingIn =
        pathY !== null &&
        v.lateralVelocity !== 0 &&
        Math.sign(pathY - v.y) === Math.sign(v.lateralVelocity) &&
        this.overlapsPath(v, path);
      this.tracks.set(v.vehicleId, {
        relativeSpeed: v.speed - ego.speed,
        relativeAcceleration: v.acceleration - ego.accel,
        distance: v.s - ego.s,
        sizeClass: this.classifyVehicle(v.length),
        isIntruding: entering || movingIn,
      });
    }

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

  /** R8: near surroundings for the given ego position. */
  nearSurroundings(ego: { s: number; y: number; speed: number }, road: Road): NearSurroundings {
    const lane = road.laneIdAt(ego.y);
    const lead = this.leadVehicle?.sizeClass ?? null;
    const reach = this.speedManagement.selectionDistance(ego.speed, lead);
    const centre = road.laneCenterY(lane);
    return {
      vehicles: this.trackedVehicles
        .filter(
          (v) =>
            v.s - v.length < ego.s + reach &&
            v.s > ego.s - EGO.length &&
            Math.abs(v.laneId - lane) <= 1,
        )
        .map((v) => ({ vehicleId: v.vehicleId, s: v.s, y: v.y, length: v.length, width: v.width })),
      shoulder: road.rightShoulder,
      medianBarrier: road.medianBarrier,
      laneBoundaries: { right: centre - road.laneWidthFt / 2, left: centre + road.laneWidthFt / 2 },
    };
  }

  /** The lead as SpeedManagement sees it. */
  leadInfo(): LeadInfo | null {
    const v = this.leadVehicle;
    if (!v || this.leadGap === null) return null;
    return { vehicleId: v.vehicleId, speed: v.speed, gap: this.leadGap, sizeClass: v.sizeClass };
  }

  /** ACC update while engaged (R5, R21–R25, IR9, IR27); null while ACC is off. */
  speedCommand(speedFtps: number): LongitudinalResult | null {
    this.lastLongitudinal = this.speedManagement.active
      ? this.speedManagement.longitudinal(speedFtps, this.leadInfo())
      : null;
    return this.lastLongitudinal;
  }

  /** Class A causes the DriverAssistSystem found this tick (R28.1); HFDS adds ODD, path and FCW causes. */
  classACauses(): ClassACause[] {
    const out: ClassACause[] = [];
    const lon = this.lastLongitudinal;
    if (lon?.reclaim) {
      const lead = this.leadVehicle;
      const aReq = lon.aReq;
      out.push({
        reason: WarningReason.BRAKING_INSUFFICIENT,
        reqs: ['R23', 'R22.3', 'R28.1', 'UC14'],
        detail:
          aReq === null || !Number.isFinite(aReq)
            ? `gap to vehicle ${lead?.vehicleId ?? '?'} inside the safety cushion`
            : `a_req ${aReq.toFixed(1)} ft/s² > maxBrakingDecel ${this.speedManagement.maxBrakingDecel} ft/s²`,
      });
    }
    if (this.hazard) {
      out.push({
        reason: WarningReason.HAZARD_IN_LANE,
        reqs: ['IR26', 'UC10', 'R28.1'],
        detail: `${this.hazard.type} in lane ${this.hazard.laneId} ahead; HFDS does not steer around objects`,
      });
    }
    if (this.curve?.tooSharp) {
      out.push({
        reason: WarningReason.CURVE_TOO_SHARP,
        reqs: ['UC9', 'R28.1'],
        detail: `curve radius ${this.curve.radiusFt} ft ahead needs ${this.curve.lateralAccel.toFixed(1)} ft/s² lateral acceleration (limit ${MAX_LATERAL_ACCEL_FTPS2})`,
      });
    }
    return out;
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
