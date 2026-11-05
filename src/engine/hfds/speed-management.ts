/**
 * SpeedManagement (doc 12, part of DriverAssistSystem; ISSUE-24): ACC state and the
 * doc 13 §2 distance formulas. M2 part: R17 activation, cancelCruise(), and the trail /
 * selection distances needed for lead selection (R4) and IR8.3. Zones, coasting and
 * braking (R5, R21–R24) are M3.
 */
import {
  FORWARD_SENSOR_RANGE_FT,
  GAP_SETTINGS_S,
  MAX_COMMAND_SPEED_MPH,
  MIN_TIME_GAP_S,
  NO_LEAD_SIZE_FACTOR,
  SAFETY_CUSHION_S,
  SIZE_FACTOR,
} from '../../shared/constants';
import type { FollowingZone, GapSetting, VehicleSizeClass } from '../../shared/domain';

export class SpeedManagement {
  /** mph; null until set (R17) */
  setSpeed: number | null = null;
  /** s, from the driver's gap setting (A-08) */
  driverSelectedGap: number;
  /** IR9, R25 */
  readonly minimumGap = MIN_TIME_GAP_S;
  currentZone: FollowingZone | null = null;
  /** ft/s */
  closingSpeed = 0;
  /** ft/s², vehicle-specific (site adaptation) */
  readonly maxBrakingDecel: number;
  readonly forwardSensorRange: number;
  /** ACC state engaged (R17). */
  active = false;

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
  }
}
