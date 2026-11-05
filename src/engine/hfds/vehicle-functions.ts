/**
 * Vehicle functions HFDS depends on but does not own: motion forecasting, self-
 * supervision and dynamic-environment functions (IR5.9), the real-time positioning data
 * service (IR17), the Forward Collision System (IR5.10, IR22; full model A-25 in M5) and
 * the trailer state (IR5.5). Director `setSubsystemFlag`, `fcwEscalation` and
 * `setTrailer` change them; `clearAllFaults` restores the functions.
 *
 * A-50: a forward-collision takeover escalation (IR5.10) stays active until the Director
 * clears faults.
 */
import { FcsMode, type SubsystemFlag } from '../../shared/domain';

export class VehicleFunctions {
  motionForecasting = true;
  selfSupervision = true;
  dynamicEnvironment = true;
  positioningDataService = true;
  /** IR5.10 */
  fcwEscalated = false;
  /** IR22: "Alert and Brake" while HFDS is engaged. */
  fcsMode: FcsMode = FcsMode.Default;
  trailerAttached: boolean;
  trailerCapable: boolean;

  constructor(config: { trailerAttached: boolean; trailerCapable: boolean }) {
    this.trailerAttached = config.trailerAttached;
    this.trailerCapable = config.trailerCapable;
  }

  setFlag(name: SubsystemFlag, ok: boolean): void {
    this[name] = ok;
  }

  /** IR5.9: names of unavailable functions. */
  unavailableFunctions(): string[] {
    const out: string[] = [];
    if (!this.motionForecasting) out.push('motion forecasting');
    if (!this.selfSupervision) out.push('self-supervision');
    if (!this.dynamicEnvironment) out.push('dynamic environment');
    return out;
  }

  /** IR5.5: a trailer is attached and the vehicle lacks trailering capability. */
  trailerProblem(): boolean {
    return this.trailerAttached && !this.trailerCapable;
  }

  clearFaults(): void {
    this.motionForecasting = true;
    this.selfSupervision = true;
    this.dynamicEnvironment = true;
    this.positioningDataService = true;
    this.fcwEscalated = false;
  }
}
