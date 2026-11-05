/**
 * DriverAttentionSystem (DATS, doc 12). M2 part: monitorDriver() and isDriverEngaged()
 * for the IR3 availability check. Attention-loss detection (A-06), Class B escalation
 * (R29–R32, R36) and tamper handling (SR2, SR5) are added in M4/M5.
 */
import { AttentionLevel, SensorId, SubsystemStatus, type HeadPosition } from '../../shared/domain';
import type { Driver } from '../world/driver';
import type { SensorSuite } from './sensors';

export class DriverAttentionSystem {
  status: SubsystemStatus = SubsystemStatus.OK;
  eyesOnRoad = true;
  headPosition: HeadPosition = 'Forward';
  /** Continuous eyes-off-road time (s). */
  inattentionDuration = 0;
  cameraTamperDetected = false;

  /** Doc 13 §11 step 6. Uses the driver-facing camera (CAM_DRIVER). */
  monitorDriver(driver: Driver, sensors: SensorSuite, dt: number): void {
    const cameraOk = sensors.ok(SensorId.CAM_DRIVER);
    // SR5: without a working driver camera DATS cannot monitor the driver.
    this.status = cameraOk ? SubsystemStatus.OK : SubsystemStatus.Faulted;
    this.eyesOnRoad = driver.eyesOnRoad;
    this.headPosition = driver.headPosition;
    this.inattentionDuration = this.eyesOnRoad ? 0 : this.inattentionDuration + dt;
    // A-40: until escalation exists (M4) the attention level follows isDriverEngaged().
    driver.attentionLevel = this.isDriverEngaged()
      ? AttentionLevel.Engaged
      : AttentionLevel.Inattentive;
  }

  /** IR3: DATS detects an engaged driver (eyes on road, camera working, no tampering). */
  isDriverEngaged(): boolean {
    return this.status === SubsystemStatus.OK && !this.cameraTamperDetected && this.eyesOnRoad;
  }

  /** SR2 tamper detection (M5 sets cameraTamperDetected from the Director injection). */
  detectTampering(): boolean {
    return this.cameraTamperDetected;
  }
}
