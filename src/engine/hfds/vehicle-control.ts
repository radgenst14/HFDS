/**
 * VehicleControl (doc 12). Owns the ego kinematic model and arbitrates driver input over
 * HFDS commands (IR25: driver input always wins; doc 13 §10).
 *
 * M1: only driver input exists. With no pedal input the ego holds its speed (A-26).
 * From M3 the DriverAssistSystem sends ControlCommands here (R1); the arbitration
 * order below stays: brake > throttle > HFDS longitudinal; steering > HFDS lateral.
 */
import {
  DRIVER_MAX_ACCEL_FTPS2,
  DRIVER_MAX_LATERAL_SPEED_FTPS,
  MAX_STEERING_ANGLE_DEG,
  MIN_ENGAGE_SPEED_MPH,
  MPH_TO_FTPS,
} from '../../shared/constants';
import { SubsystemStatus, type VehicleState } from '../../shared/domain';
import { integrateEgo, type EgoCommand, type EgoState } from '../world/ego-kinematics';
import type { Driver } from '../world/driver';
import type { Road } from '../world/road';

export class VehicleControl {
  status: SubsystemStatus = SubsystemStatus.OK;
  ego: EgoState;
  /** deg (display) */
  currentSteeringAngle = 0;
  driverBrakeApplied = false;

  constructor(initial: { s: number; y: number; speedMph: number }) {
    this.ego = {
      s: initial.s,
      y: initial.y,
      speed: initial.speedMph * MPH_TO_FTPS,
      accel: 0,
      heading: 0,
    };
  }

  /** mph */
  get currentSpeed(): number {
    return this.ego.speed / MPH_TO_FTPS;
  }

  /** ft/s² */
  get currentAcceleration(): number {
    return this.ego.accel;
  }

  /**
   * R48.1 (A-42): the vehicle activation conditions are met when VehicleControl is OK,
   * the speed is above 3 mph (IR28) and the driver is not braking (IR15 would disengage
   * at once).
   */
  checkActivationConditions(driver: Driver): { met: boolean; problems: string[] } {
    const problems: string[] = [];
    if (this.status !== SubsystemStatus.OK) problems.push(`VehicleControl ${this.status}`);
    if (this.currentSpeed <= MIN_ENGAGE_SPEED_MPH) {
      problems.push(
        `speed ${this.currentSpeed.toFixed(1)} mph not above ${MIN_ENGAGE_SPEED_MPH} mph`,
      );
    }
    if (driver.brakePressed) problems.push('brake pedal pressed');
    return { met: problems.length === 0, problems };
  }

  /** R48.2: confirm the engagement to the DriverAssistSystem. */
  confirmEngagement(): boolean {
    return this.status === SubsystemStatus.OK;
  }

  detectDriverBraking(driver: Driver): boolean {
    return driver.brakePressed;
  }

  detectDriverSteering(driver: Driver, threshold: number): boolean {
    return Math.abs(driver.steeringInput) >= threshold;
  }

  /** Doc 13 §11 step 8: driver input (IR25), else hold speed (A-26). */
  arbitrate(driver: Driver): EgoCommand {
    this.driverBrakeApplied = driver.brakePressed;
    let accel = 0;
    if (driver.brakePressed) accel = -driver.brakeRate;
    else if (driver.throttleInput > 0) accel = driver.throttleInput * DRIVER_MAX_ACCEL_FTPS2;
    this.currentSteeringAngle = driver.steeringInput * MAX_STEERING_ANGLE_DEG;
    return { accel, lateralSpeed: driver.steeringInput * DRIVER_MAX_LATERAL_SPEED_FTPS };
  }

  /** Doc 13 §11 step 9. */
  integrate(cmd: EgoCommand, dt: number, road: Road): void {
    this.ego = integrateEgo(this.ego, cmd, dt, road.pavedBounds());
  }

  /** Teleport to a lane centre (Director `setEgoLane`, IR5.3). */
  placeInLane(y: number): void {
    this.ego = { ...this.ego, y, heading: 0 };
  }

  getVehicleState(road: Road): VehicleState {
    return {
      speed: this.ego.speed,
      acceleration: this.ego.accel,
      steeringAngle: this.currentSteeringAngle,
      s: this.ego.s,
      lateral: this.ego.y,
      laneId: road.laneIdAt(this.ego.y),
      heading: this.ego.heading,
    };
  }
}
