/**
 * SpeedManagement (doc 12, part of DriverAssistSystem; ISSUE-24): ACC state, the doc 13 §2
 * formulas and the following-zone control (doc 13 §3).
 *
 * Formulas (R4.1, R4.2, R22, R25, IR9; test vectors T1–T9 in formulas.test.ts):
 *   timeGap        = max(driver gap, 2.0 s)
 *   trailDistance  = v × timeGap × sizeFactor(lead)
 *   brakingDist    = v² / (2 · maxBrakingDecel)                (ISSUE-03)
 *   selectionDist  = min(trail + braking, forward sensor range)
 *   safetyCushion  = 0.5 s × v × sizeFactor(lead)               (A-03)
 *   closingSpeed   = max(0, v − v_lead)                        (R22.1)
 *   a_req          = closing² / (2 (gap − cushion)), ∞ if gap ≤ cushion (R22.1, R22.3)
 *
 * Zones (A-05, revised in M3 — ISSUE-40): coasting starts early enough to finish at the
 * trail distance, so following never settles inside the trail distance (IR9):
 *   Safety   gap ≤ cushion                                          → Class A (R22.3, R23)
 *   Coast    gap ≤ max(trail, trail(v_lead) + closing² / (2·coastDecel)), or still coasting
 *            towards the current lead's speed                          → coast, then follow (R21)
 *   Closing  otherwise (lead within the selection distance)            → hold speed (R5, A-05b)
 * R22 runs every tick in every zone: when coasting cannot remove the closing speed
 * before the cushion (a_req > coastDecel), brake at a_req if a_req ≤ maxBrakingDecel
 * (R22.2); otherwise issue the reclaim warning (R23). With no lead: resume the set speed
 * (R24), never above 85 mph (IR27).
 */
import {
  ACC_GAP_GAIN_PER_S,
  ACC_MAX_ACCEL_FTPS2,
  ACC_SPEED_MATCH_TOL_MPH,
  ACC_SPEED_TRACK_TAU_S,
  COAST_DECEL_FTPS2,
  FORWARD_SENSOR_RANGE_FT,
  GAP_SETTINGS_S,
  MAX_COMMAND_SPEED_MPH,
  MIN_TIME_GAP_S,
  MPH_TO_FTPS,
  NO_LEAD_SIZE_FACTOR,
  SAFETY_CUSHION_S,
  SIZE_FACTOR,
} from '../../shared/constants';
import { FollowingZone, type GapSetting, type VehicleSizeClass } from '../../shared/domain';

const EPS = 1e-9;

/** What SpeedManagement needs to know about the lead vehicle (R4). */
export interface LeadInfo {
  vehicleId: number;
  /** ft/s */
  speed: number;
  /** ft, ego front bumper to lead rear bumper */
  gap: number;
  sizeClass: VehicleSizeClass;
}

/** Result of one longitudinal update (doc 13 §11 step 5). */
export interface LongitudinalResult {
  /** HFDS acceleration command, ft/s² (negative = brake / coast) */
  accel: number;
  zone: FollowingZone | null;
  /** ft/s² or null without a lead / without closing speed */
  aReq: number | null;
  /** R23 / R22.3: braking capability exceeded → Class A reclaim warning */
  reclaim: boolean;
  /** R22.2 braking at a_req this tick */
  braking: boolean;
}

/** R22.1, R22.3: required deceleration (Infinity when gap ≤ cushion and closing). */
export function requiredDeceleration(closing: number, gap: number, cushion: number): number {
  if (closing <= 0) return 0;
  if (gap <= cushion + EPS) return Infinity;
  return (closing * closing) / (2 * (gap - cushion));
}

export class SpeedManagement {
  /** mph; null until set (R17) */
  setSpeed: number | null = null;
  /** s, from the driver's gap setting (A-08) */
  driverSelectedGap: number;
  /** IR9, R25 */
  readonly minimumGap = MIN_TIME_GAP_S;
  currentZone: FollowingZone | null = null;
  /** ft/s (R22.1) */
  closingSpeed = 0;
  /** ft/s², last computed a_req (null without a closing lead) */
  aReq: number | null = null;
  /** ft/s², vehicle-specific (site adaptation) */
  readonly maxBrakingDecel: number;
  readonly forwardSensorRange: number;
  /** ACC state engaged (R17). */
  active = false;
  /** R21: coasting towards this lead's speed until matched (A-05). */
  private coastingFor: number | null = null;

  constructor(
    config: { maxBrakingDecelFtps2: number; forwardSensorRangeFt?: number },
    gap: GapSetting,
    initialSetSpeedMph: number | null,
  ) {
    this.maxBrakingDecel = config.maxBrakingDecelFtps2;
    this.forwardSensorRange = config.forwardSensorRangeFt ?? FORWARD_SENSOR_RANGE_FT;
    this.driverSelectedGap = GAP_SETTINGS_S[gap];
    if (initialSetSpeedMph !== null) this.requestSetSpeed(initialSetSpeedMph);
  }

  // -------------------------------------------------------------------------
  // Formulas (doc 13 §2)
  // -------------------------------------------------------------------------

  /** R25, IR9: timeGap = max(driver gap, 2.0 s). */
  timeGap(): number {
    return Math.max(this.driverSelectedGap, this.minimumGap);
  }

  /** R25: trailDistance = v × timeGap × sizeFactor (no lead → 1.00, doc 13 §2). */
  computeTrailDistance(speedFtps: number, lead: VehicleSizeClass | null): number {
    const factor = lead ? SIZE_FACTOR[lead] : NO_LEAD_SIZE_FACTOR;
    return speedFtps * this.timeGap() * factor;
  }

  /** R4.1.1 (ISSUE-03): v² / (2 · maxBrakingDecel). */
  brakingDistance(speedFtps: number): number {
    return (speedFtps * speedFtps) / (2 * this.maxBrakingDecel);
  }

  /** R4.1, R4.2: min(trail + braking, forward sensor range). */
  selectionDistance(speedFtps: number, lead: VehicleSizeClass | null): number {
    return Math.min(
      this.computeTrailDistance(speedFtps, lead) + this.brakingDistance(speedFtps),
      this.forwardSensorRange,
    );
  }

  /** A-03: 0.5 s × v × sizeFactor. */
  safetyCushion(speedFtps: number, lead: VehicleSizeClass | null): number {
    const factor = lead ? SIZE_FACTOR[lead] : NO_LEAD_SIZE_FACTOR;
    return SAFETY_CUSHION_S * speedFtps * factor;
  }

  /** A-05 (revised): gap at which coasting must start to match the lead at its trail distance. */
  coastStartDistance(speedFtps: number, lead: LeadInfo): number {
    const closing = Math.max(0, speedFtps - lead.speed);
    const trailAtLead = this.computeTrailDistance(lead.speed, lead.sizeClass);
    return Math.max(
      this.computeTrailDistance(speedFtps, lead.sizeClass),
      trailAtLead + (closing * closing) / (2 * COAST_DECEL_FTPS2),
    );
  }

  /** IR27: the highest speed HFDS may command (ft/s). */
  commandSpeedLimit(): number {
    const mph = Math.min(this.setSpeed ?? MAX_COMMAND_SPEED_MPH, MAX_COMMAND_SPEED_MPH);
    return mph * MPH_TO_FTPS;
  }

  // -------------------------------------------------------------------------
  // Zones and control (doc 13 §3)
  // -------------------------------------------------------------------------

  /** updateZone(gap) (doc 12): the following zone for this lead, or null without one. */
  updateZone(speedFtps: number, lead: LeadInfo | null): FollowingZone | null {
    if (!lead) {
      this.coastingFor = null;
      this.currentZone = null;
      return null;
    }
    const cushion = this.safetyCushion(speedFtps, lead.sizeClass);
    const matched = speedFtps <= lead.speed + ACC_SPEED_MATCH_TOL_MPH * MPH_TO_FTPS;
    if (this.coastingFor !== lead.vehicleId || matched) this.coastingFor = null;
    let zone: FollowingZone;
    if (lead.gap <= cushion + EPS) zone = FollowingZone.Safety;
    else if (
      this.coastingFor !== null ||
      lead.gap <= this.coastStartDistance(speedFtps, lead) + EPS
    ) {
      zone = FollowingZone.Coast;
      if (!matched) this.coastingFor = lead.vehicleId; // R21: coast until the speeds match
    } else zone = FollowingZone.Closing;
    this.currentZone = zone;
    return zone;
  }

  /** Speed tracking towards a target, within the comfort limits (A-09, A-51). */
  private track(speedFtps: number, targetFtps: number): number {
    const a = (targetFtps - speedFtps) / ACC_SPEED_TRACK_TAU_S;
    return Math.max(-COAST_DECEL_FTPS2, Math.min(ACC_MAX_ACCEL_FTPS2, a));
  }

  /** R5 holdSpeed(): keep the current speed (A-05b), but never above the set speed. */
  holdSpeed(speedFtps: number): number {
    const limit = this.commandSpeedLimit();
    return speedFtps > limit + EPS ? this.track(speedFtps, limit) : 0;
  }

  /** R21 coastToMatchLead(): zero throttle while faster; then follow at the trail distance. */
  coastToMatchLead(speedFtps: number, lead: LeadInfo): number {
    if (this.coastingFor === lead.vehicleId) return -COAST_DECEL_FTPS2;
    const trail = this.computeTrailDistance(speedFtps, lead.sizeClass);
    const target = Math.max(
      0,
      Math.min(this.commandSpeedLimit(), lead.speed + ACC_GAP_GAIN_PER_S * (lead.gap - trail)),
    );
    return this.track(speedFtps, target);
  }

  /** R24 resumeSetSpeed(): accelerate ≤ 3 ft/s² towards min(set speed, 85 mph) (IR27). */
  resumeSetSpeed(speedFtps: number): number {
    return this.track(speedFtps, this.commandSpeedLimit());
  }

  /**
   * R22 brakeForClosingSpeed(): a_req for this lead. Returns whether braking at a_req is
   * within capability (R22.2); false means the R23 reclaim warning.
   */
  brakeForClosingSpeed(speedFtps: number, lead: LeadInfo): { aReq: number; ok: boolean } {
    this.closingSpeed = Math.max(0, speedFtps - lead.speed);
    const cushion = this.safetyCushion(speedFtps, lead.sizeClass);
    const aReq = requiredDeceleration(this.closingSpeed, lead.gap, cushion);
    this.aReq = this.closingSpeed > 0 ? aReq : null;
    return { aReq, ok: aReq <= this.maxBrakingDecel + EPS };
  }

  /** One ACC update while HFDS is engaged (doc 13 §3, §11 step 5). */
  longitudinal(speedFtps: number, lead: LeadInfo | null): LongitudinalResult {
    const zone = this.updateZone(speedFtps, lead);
    if (!lead) {
      this.closingSpeed = 0;
      this.aReq = null;
      return {
        accel: this.resumeSetSpeed(speedFtps),
        zone,
        aReq: null,
        reclaim: false,
        braking: false,
      };
    }
    const { aReq, ok } = this.brakeForClosingSpeed(speedFtps, lead);
    if (zone === FollowingZone.Safety || !ok) {
      // R22.3 / R23: beyond the braking capability → reclaim warning; HFDS coasts (IR13).
      return { accel: -COAST_DECEL_FTPS2, zone, aReq, reclaim: true, braking: false };
    }
    let accel =
      zone === FollowingZone.Coast
        ? this.coastToMatchLead(speedFtps, lead)
        : this.holdSpeed(speedFtps);
    let braking = false;
    if (aReq > COAST_DECEL_FTPS2 + EPS && -aReq < accel) {
      accel = -aReq; // R22.2: brake at the required deceleration
      braking = true;
    }
    return { accel, zone, aReq: this.aReq, reclaim: false, braking };
  }

  /** Driver.setFollowGap (A-08). */
  setGap(gap: GapSetting): void {
    this.driverSelectedGap = GAP_SETTINGS_S[gap];
  }

  /**
   * R17: on engagement enter the ACC state; use the current speed as the set speed if
   * none was set before (preset `ego.setSpeedMph`, a driver `setSpeed`, or an earlier
   * engagement). IR27: never above 85 mph.
   */
  activate(currentSpeedMph: number): void {
    this.active = true;
    this.setSpeed = Math.min(this.setSpeed ?? currentSpeedMph, MAX_COMMAND_SPEED_MPH);
  }

  /** Driver `setSpeed` (IR27 cap). Kept while ACC is off and used on the next engagement. */
  requestSetSpeed(mph: number): void {
    this.setSpeed = Math.min(mph, MAX_COMMAND_SPEED_MPH);
  }

  /** R50.1, IR15: cancel ACC (the set speed is kept for the next engagement). */
  cancelCruise(): void {
    this.active = false;
    this.currentZone = null;
    this.closingSpeed = 0;
    this.aReq = null;
    this.coastingFor = null;
  }
}
