/**
 * Driver (doc 12). Holds the inputs the Driver panel, keyboard and scenario timeline
 * produce. The engine reads them each tick; the driver always has authority (IR25).
 */
import { DRIVER_DEFAULT_BRAKE_FTPS2 } from '../../shared/constants';
import {
  AttentionLevel,
  EyeDirection,
  HeadPosition,
  type GapSetting,
  type GripState,
} from '../../shared/domain';
import type { DriverAction } from '../../shared/protocol';
import type { Scenario } from '../../shared/scenario-schema';

export class Driver {
  attentionLevel: AttentionLevel = AttentionLevel.Engaged;
  headPosition: HeadPosition = HeadPosition.Forward;
  eyeDirection: EyeDirection;
  brakePressed = false;
  /** ft/s² requested while the brake is pressed (A-36 default). */
  brakeRate = DRIVER_DEFAULT_BRAKE_FTPS2;
  /** −1..1, + = left (A-36). */
  steeringInput = 0;
  /** 0..1 */
  throttleInput = 0;
  selectedGap: GapSetting;
  /** [proposed] grip sensing areas (R35). */
  gripAreas: GripState;
  /** ACC set speed request (mph); applied by SpeedManagement in M3 (IR27 cap). */
  requestedSetSpeedMph: number | null;
  /** Sim times of HFDS button presses not yet handled (IR7, R12; consumed from M2). */
  pendingButtonPresses: number[] = [];

  constructor(scenario: Scenario) {
    this.eyeDirection = scenario.driver.eyesOnRoad ? EyeDirection.OnRoad : EyeDirection.OffRoad;
    this.gripAreas = { ...scenario.driver.grip };
    this.selectedGap = scenario.ego.gapSetting;
    this.requestedSetSpeedMph = scenario.ego.setSpeedMph;
  }

  get eyesOnRoad(): boolean {
    return this.eyeDirection === EyeDirection.OnRoad;
  }

  requestHFDS(simTime: number): void {
    this.pendingButtonPresses.push(simTime);
  }

  setFollowGap(gap: GapSetting): void {
    this.selectedGap = gap;
  }

  applyBrake(pressed: boolean, rate?: number): void {
    this.brakePressed = pressed;
    if (rate !== undefined) this.brakeRate = rate;
    else if (pressed) this.brakeRate = DRIVER_DEFAULT_BRAKE_FTPS2;
  }

  steer(input: number): void {
    this.steeringInput = Math.max(-1, Math.min(1, input));
  }

  hitGas(input: number): void {
    this.throttleInput = Math.max(0, Math.min(1, input));
  }

  /** Applies one Driver panel / timeline action. */
  apply(action: DriverAction, simTime: number): void {
    switch (action.kind) {
      case 'pressHfdsButton':
        this.requestHFDS(simTime);
        break;
      case 'setBrake':
        this.applyBrake(action.pressed, action.rate);
        break;
      case 'setThrottle':
        this.hitGas(action.value);
        break;
      case 'setSteer':
        this.steer(action.value);
        break;
      case 'setGrip':
        for (const k of ['L', 'R', 'TOP', 'BOTTOM'] as const) {
          const v = action[k];
          if (v !== undefined) this.gripAreas[k] = v;
        }
        break;
      case 'setGaze':
        this.eyeDirection = action.eyesOnRoad ? EyeDirection.OnRoad : EyeDirection.OffRoad;
        // DATS (R27, M4) decides attention; until then the level mirrors gaze.
        this.attentionLevel = action.eyesOnRoad
          ? AttentionLevel.Engaged
          : AttentionLevel.Inattentive;
        break;
      case 'setGap':
        this.setFollowGap(action.gapSetting);
        break;
      case 'setSpeed':
        this.requestedSetSpeedMph = action.mph;
        break;
    }
  }
}
