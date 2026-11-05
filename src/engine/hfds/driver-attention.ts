/**
 * DriverAttentionSystem (DATS, doc 12).
 *
 *   monitorDriver()        R27: eye / head state every tick; driver camera status (SR5)
 *   isDriverEngaged()      IR3
 *   attentionLossDetected  A-06: 3.0 s of continuous eyes-off-road
 *   escalateAlert()        R29 first → R30 second → R31 final (Class B, R28.2)
 *   cancelAlert()          R32
 *   markDriverInactive()   R36 (→ SR6 minimal risk maneuver, IR11)
 *   detectTampering()      SR2 (the tamper injection is wired in M5)
 *
 * Attention loss is timed from the first tick with the eyes off the road, so the first
 * alert starts exactly 3.0 s later; the HFDS mode machine applies the 30 s / 5 s / 2 s
 * escalation times (R29.3, R30.4, R36).
 */
import { ATTENTION_LOSS_DETECT_S, DT_S } from '../../shared/constants';
import {
  AlertLevel,
  AttentionLevel,
  SensorId,
  SubsystemStatus,
  type HeadPosition,
} from '../../shared/domain';
import type { Driver } from '../world/driver';
import type { SensorSuite } from './sensors';

const ticksOf = (s: number) => Math.round(s / DT_S);

export class DriverAttentionSystem {
  status: SubsystemStatus = SubsystemStatus.OK;
  eyesOnRoad = true;
  headPosition: HeadPosition = 'Forward';
  /** Continuous eyes-off-road time (s). */
  inattentionDuration = 0;
  cameraTamperDetected = false;
  /** Class B alert in force (null: none). */
  alertLevel: AlertLevel | null = null;
  /** Sim time the current alert level started. */
  alertStartedAt: number | null = null;
  /** R36 */
  driverInactive = false;
  private eyesOffSince: number | null = null;

  /** Doc 13 §11 step 6 (R27). Uses the driver-facing camera (CAM_DRIVER). */
  monitorDriver(driver: Driver, sensors: SensorSuite, t: number): void {
    const cameraOk = sensors.ok(SensorId.CAM_DRIVER);
    // SR5: without a working driver camera DATS cannot monitor the driver.
    this.status = cameraOk ? SubsystemStatus.OK : SubsystemStatus.Faulted;
    this.eyesOnRoad = driver.eyesOnRoad;
    this.headPosition = driver.headPosition;
    if (this.eyesOnRoad) this.eyesOffSince = null;
    else this.eyesOffSince ??= t;
    this.inattentionDuration = this.eyesOffSince === null ? 0 : t - this.eyesOffSince;
    driver.attentionLevel = this.driverInactive
      ? AttentionLevel.Inactive
      : this.isDriverEngaged()
        ? AttentionLevel.Engaged
        : AttentionLevel.Inattentive;
  }

  /** IR3: DATS detects an engaged driver (eyes on road, camera working, no tampering). */
  isDriverEngaged(): boolean {
    return this.status === SubsystemStatus.OK && !this.cameraTamperDetected && this.eyesOnRoad;
  }

  /** A-06 (R29): attention loss after 3.0 s of continuous eyes-off-road. */
  attentionLossDetected(): boolean {
    return (
      this.eyesOffSince !== null &&
      ticksOf(this.inattentionDuration) >= ticksOf(ATTENTION_LOSS_DETECT_S)
    );
  }

  /** Seconds the current alert level has been active. */
  alertElapsed(t: number): number {
    return this.alertStartedAt === null ? 0 : t - this.alertStartedAt;
  }

  /** R29 → R30 → R31: start the next alert level and return it. */
  escalateAlert(t: number): AlertLevel {
    this.alertLevel =
      this.alertLevel === null
        ? AlertLevel.First
        : this.alertLevel === AlertLevel.First
          ? AlertLevel.Second
          : AlertLevel.Final;
    this.alertStartedAt = t;
    return this.alertLevel;
  }

  /** R32: the driver re-engaged. */
  cancelAlert(): void {
    this.alertLevel = null;
    this.alertStartedAt = null;
  }

  /** R36: the driver did not re-engage within 2 s of the final alert. */
  markDriverInactive(driver: Driver): void {
    this.driverInactive = true;
    this.cancelAlert();
    driver.attentionLevel = AttentionLevel.Inactive;
  }

  /** IR10: a new ignition cycle starts with a fresh driver state. */
  reset(): void {
    this.cancelAlert();
    this.driverInactive = false;
    this.eyesOffSince = null;
    this.inattentionDuration = 0;
  }

  /** SR2 tamper detection (M5 sets cameraTamperDetected from the Director injection). */
  detectTampering(): boolean {
    return this.cameraTamperDetected;
  }
}
