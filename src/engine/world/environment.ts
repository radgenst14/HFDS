/**
 * Environment (Road Conditions, doc 12). Holds the current weather, light, moisture and
 * visibility. `isWithinODD()` (IR5.1, IR5.4, A-10) is added with availability in M2.
 */
import type { Environment } from '../../shared/domain';

export class EnvironmentState {
  private current: Environment;

  constructor(initial: Environment) {
    this.current = { ...initial };
  }

  get value(): Environment {
    return { ...this.current };
  }

  /** Director `setEnvironment` (R13): change any subset of fields. */
  apply(change: Partial<Environment>): void {
    this.current = { ...this.current, ...change };
  }
}
