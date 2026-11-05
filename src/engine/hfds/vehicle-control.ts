/**
 * VehicleControl (doc 12). Owns the ego kinematic model, executes the DriverAssistSystem's
 * ControlCommands (R1) and arbitrates driver input over them (IR25; doc 13 §10).
 *
 * Arbitration each tick (doc 13 §11 step 8):
 *   longitudinal  driver brake > Forward Collision System > driver throttle (A-24) > HFDS
 *                 command > hold speed (A-26). The FCS (A-25) and the driver brake combine
 *                 as the stronger deceleration.
 *   lateral       driver steering ≥ threshold (A-17) > HFDS steering > driver input.
 * Steering angle and lateral speed map linearly: ±15° ↔ ±4 ft/s (A-36).
 */
import {
  DRIVER_MAX_ACCEL_FTPS2,
  DRIVER_MAX_LATERAL_SPEED_FTPS,
  MAX_STEERING_ANGLE_DEG,
  MIN_ENGAGE_SPEED_MPH,
  MPH_TO_FTPS,
  STEER_INPUT_THRESHOLD,
} from '../../shared/constants';
import { SubsystemStatus, type ControlCommand, type VehicleState } from '../../shared/domain';
import { integrateEgo, type EgoCommand, type EgoState } from '../world/ego-kinematics';
import type { Driver } from '../world/driver';
import type { Road } from '../world/road';

/** Who decided the longitudinal command this tick (for the snapshot / tests). */
export type LongitudinalSource = 'driverBrake' | 'fcs' | 'driverThrottle' | 'hfds' | 'hold';

export class VehicleControl {
  status: SubsystemStatus = SubsystemStatus.OK;
  ego: EgoState;
  /** deg (display) */
  currentSteeringAngle = 0;
  driverBrakeApplied = false;
  /** Commands from the DriverAssistSystem for this tick (R1). */
  private pending: { steerDeg: number | null; accel: number | null } = {
    steerDeg: null,
    accel: null,
  };
  /** Last arbitration result. */
  lastSource: LongitudinalSource = 'hold';
  /** HFDS longitudinal command actually applied this tick (IR12 invariant), ft/s². */
  appliedHfdsAccel = 0;

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

  /** A-17: the driver is steering when |input| ≥ 0.05. */
  detectDriverSteering(driver: Driver, threshold = STEER_INPUT_THRESHOLD): boolean {
    return Math.abs(driver.steeringInput) >= threshold;
  }

  /** R1 steer(angle), deg. */
  steer(angleDeg: number): void {
    this.pending.steerDeg = Math.max(
      -MAX_STEERING_ANGLE_DEG,
      Math.min(MAX_STEERING_ANGLE_DEG, angleDeg),
    );
  }

  /** R1 accelerate(rate), ft/s². */
  accelerate(rate: number): void {
    this.pending.accel = rate;
  }

  /** R1 brake(rate), ft/s² (positive number = deceleration). */
  brake(rate: number): void {
    this.pending.accel = -Math.abs(rate);
  }

  /** UC7 sendCommand(): route a ControlCommand to the matching operation. */
  execute(cmd: ControlCommand): void {
    switch (cmd.kind) {
      case 'steer':
        this.steer(cmd.value);
        break;
      case 'accelerate':
        this.accelerate(cmd.value);
        break;
      case 'brake':
      case 'coast':
      case 'phantomBrake':
        this.brake(cmd.value);
        break;
    }
  }

  /** Doc 13 §11 step 8: driver input (IR25), FCS (A-25), then HFDS (R1), else hold (A-26). */
  arbitrate(driver: Driver, fcsDecel = 0): EgoCommand {
    const hfds = this.pending;
    this.pending = { steerDeg: null, accel: null };
    this.driverBrakeApplied = driver.brakePressed;

    let accel = 0;
    let source: LongitudinalSource = 'hold';
    if (driver.brakePressed) {
      accel = -Math.max(driver.brakeRate, fcsDecel);
      source = 'driverBrake';
    } else if (fcsDecel > 0) {
      accel = -fcsDecel;
      source = 'fcs';
    } else if (driver.throttleInput > 0) {
      accel = driver.throttleInput * DRIVER_MAX_ACCEL_FTPS2; // A-24: overrides ACC
      source = 'driverThrottle';
    } else if (hfds.accel !== null) {
      accel = hfds.accel;
      source = 'hfds';
    }
    this.lastSource = source;
    this.appliedHfdsAccel = source === 'hfds' ? accel : 0;

    let steerDeg = driver.steeringInput * MAX_STEERING_ANGLE_DEG;
    if (!this.detectDriverSteering(driver) && hfds.steerDeg !== null) steerDeg = hfds.steerDeg;
    this.currentSteeringAngle = steerDeg;
    return {
      accel,
      lateralSpeed: (steerDeg / MAX_STEERING_ANGLE_DEG) * DRIVER_MAX_LATERAL_SPEED_FTPS,
    };
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
