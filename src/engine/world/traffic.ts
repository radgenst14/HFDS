/**
 * Scripted surrounding traffic (doc 12 SurroundingVehicle; doc 14 traffic `behavior`).
 * Each vehicle follows its script exactly; there is no traffic AI (out of scope).
 * Positions: `s` = front bumper along the road (ft), `y` = lateral centre (ft).
 * Ego-relative fields (distance, relativeSpeed, isInLane …) are computed by the
 * DriverAssistSystem in M3.
 */
import {
  ERRATIC_ACCEL_PULSE_FTPS2,
  ERRATIC_ACCEL_PULSE_S,
  MPH_TO_FTPS,
  TRAFFIC_DEFAULT_SPEED_CHANGE_FTPS2,
  VEHICLE_DIMENSIONS_FT,
} from '../../shared/constants';
import type { VehicleSizeClass } from '../../shared/domain';
import type { TrafficVehicleSpec } from '../../shared/scenario-schema';
import type { Road } from './road';

type Behavior = NonNullable<TrafficVehicleSpec['behavior']>[number];
const T_EPS = 1e-9;

export class SurroundingVehicle {
  readonly vehicleId: number;
  readonly sizeClass: VehicleSizeClass;
  /** A-18 */
  readonly length: number;
  /** A-18 */
  readonly width: number;
  laneId: number;
  s: number;
  y: number;
  /** ft/s */
  speed: number;
  /** ft/s², last step */
  acceleration = 0;
  /** ft/s, + = left */
  lateralVelocity = 0;

  private targetSpeed: number;
  private speedRate = TRAFFIC_DEFAULT_SPEED_CHANGE_FTPS2; // A-33
  private hardBrake: { decel: number; remaining: number } | null = null;
  /** Director `trafficErraticAccel` (IR8.2, A-48): scripted acceleration pulses. */
  private pulses: Array<{ accel: number; remaining: number }> = [];
  private laneChange: {
    fromY: number;
    toY: number;
    toLane: number;
    elapsed: number;
    duration: number;
  } | null = null;
  private readonly script: Behavior[];
  private nextBehavior = 0;

  constructor(
    spec: TrafficVehicleSpec,
    egoS: number,
    private readonly road: Road,
  ) {
    this.vehicleId = spec.id;
    this.sizeClass = spec.sizeClass;
    const dims = VEHICLE_DIMENSIONS_FT[spec.sizeClass];
    this.length = dims.length;
    this.width = dims.width;
    this.laneId = spec.laneId;
    this.s = egoS + spec.sFt; // sFt is front-to-front relative to the ego (doc 14)
    this.y = road.laneCenterY(spec.laneId);
    this.speed = spec.speedMph * MPH_TO_FTPS;
    this.targetSpeed = this.speed;
    this.script = [...(spec.behavior ?? [])].sort((a, b) => a.t - b.t);
  }

  /** Doc 14 `brakeHard` / Director `trafficHardBrake` (IR8.1): decelerate for durationS, then hold. */
  brakeHard(decelFtps2: number, durationS: number): void {
    this.hardBrake = { decel: decelFtps2, remaining: durationS };
  }

  /** A-48 (IR8.2): +6 ft/s² for 0.5 s, then −6 ft/s² for 0.5 s, then hold speed. */
  erraticAccel(): void {
    this.hardBrake = null;
    this.pulses = [
      { accel: ERRATIC_ACCEL_PULSE_FTPS2, remaining: ERRATIC_ACCEL_PULSE_S },
      { accel: -ERRATIC_ACCEL_PULSE_FTPS2, remaining: ERRATIC_ACCEL_PULSE_S },
    ];
  }

  /**
   * A-48 (IR8.3, Director `trafficTailgateGap`): move this vehicle into `laneId` directly
   * ahead of the ego so that the ego's time headway to it is `headwayS`, at the ego's speed.
   */
  placeAhead(egoS: number, laneId: number, headwayS: number, egoSpeed: number): void {
    this.hardBrake = null;
    this.pulses = [];
    this.laneChange = null;
    this.laneId = laneId;
    this.y = this.road.laneCenterY(laneId);
    this.speed = egoSpeed;
    this.targetSpeed = egoSpeed;
    this.s = egoS + headwayS * egoSpeed + this.length;
  }

  private apply(b: Behavior): void {
    switch (b.action) {
      case 'setSpeed': {
        this.hardBrake = null;
        this.targetSpeed = b.speedMph * MPH_TO_FTPS;
        const faster = this.targetSpeed > this.speed;
        this.speedRate =
          (faster ? b.accelFtps2 : b.decelFtps2) ?? TRAFFIC_DEFAULT_SPEED_CHANGE_FTPS2;
        break;
      }
      case 'changeLane':
        this.laneChange = {
          fromY: this.y,
          toY: this.road.laneCenterY(b.toLaneId),
          toLane: b.toLaneId,
          elapsed: 0,
          duration: b.durationS,
        };
        break;
      case 'brakeHard':
        this.brakeHard(b.decelFtps2, b.durationS);
        break;
    }
  }

  /** Doc 13 §11 step 2. `simTime` is the start time of this tick. */
  advance(dt: number, simTime: number): void {
    while (this.nextBehavior < this.script.length) {
      const b = this.script[this.nextBehavior];
      if (!b || b.t > simTime + T_EPS) break;
      this.apply(b);
      this.nextBehavior++;
    }

    const v0 = this.speed;
    const pulse = this.pulses[0];
    if (pulse) {
      this.speed = Math.max(0, this.speed + pulse.accel * dt);
      pulse.remaining -= dt;
      if (pulse.remaining <= T_EPS) this.pulses.shift();
      if (this.pulses.length === 0) this.targetSpeed = this.speed;
    } else if (this.hardBrake) {
      this.speed = Math.max(0, this.speed - this.hardBrake.decel * dt);
      this.hardBrake.remaining -= dt;
      if (this.hardBrake.remaining <= T_EPS) {
        this.hardBrake = null;
        this.targetSpeed = this.speed;
      }
    } else if (this.speed !== this.targetSpeed) {
      const step = this.speedRate * dt;
      const diff = this.targetSpeed - this.speed;
      this.speed = Math.abs(diff) <= step ? this.targetSpeed : this.speed + Math.sign(diff) * step;
    }
    this.acceleration = (this.speed - v0) / dt;
    this.s += ((v0 + this.speed) / 2) * dt;

    if (this.laneChange) {
      const lc = this.laneChange;
      lc.elapsed = Math.min(lc.duration, lc.elapsed + dt);
      const y0 = this.y;
      const f = lc.elapsed / lc.duration;
      this.y = lc.fromY + (lc.toY - lc.fromY) * f;
      this.lateralVelocity = (this.y - y0) / dt;
      if (lc.elapsed >= lc.duration - T_EPS) {
        this.y = lc.toY;
        this.laneChange = null;
      }
    } else {
      this.lateralVelocity = 0;
    }
    this.laneId = this.road.laneIdAt(this.y);
  }
}

export class TrafficModel {
  readonly vehicles: SurroundingVehicle[];

  constructor(spec: readonly TrafficVehicleSpec[], egoS: number, road: Road) {
    this.vehicles = spec.map((v) => new SurroundingVehicle(v, egoS, road));
  }

  byId(id: number): SurroundingVehicle | undefined {
    return this.vehicles.find((v) => v.vehicleId === id);
  }

  advance(dt: number, simTime: number): void {
    for (const v of this.vehicles) v.advance(dt, simTime);
  }
}
