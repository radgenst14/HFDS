/**
 * Environment (Road Conditions, doc 12): weather, light, road moisture, visibility.
 * `isWithinODD()` implements IR5.1 (light) and IR5.4 (weather / moisture / visibility)
 * with the A-10 thresholds.
 */
import {
  ODD_EXCLUDED_LIGHT,
  ODD_EXCLUDED_WEATHER,
  ODD_MAX_ROAD_MOISTURE,
  ODD_MIN_VISIBILITY_M,
} from '../../shared/constants';
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

  /** IR5.1: night or low-angle sun prevents lane detection (A-10). */
  lightOk(): boolean {
    return !(ODD_EXCLUDED_LIGHT as readonly string[]).includes(this.current.lightCondition);
  }

  /** IR5.4: reasons the weather / road surface is outside the ODD (A-10); empty = inside. */
  weatherProblems(): string[] {
    const e = this.current;
    const out: string[] = [];
    if ((ODD_EXCLUDED_WEATHER as readonly string[]).includes(e.weather)) out.push(e.weather);
    if (e.roadMoisture > ODD_MAX_ROAD_MOISTURE) out.push(`road moisture ${e.roadMoisture}`);
    if (e.visibilityM < ODD_MIN_VISIBILITY_M) out.push(`visibility ${e.visibilityM} m`);
    return out;
  }

  /** Environment.isWithinODD() (IR5.1, IR5.4; A-10). */
  isWithinODD(): boolean {
    return this.lightOk() && this.weatherProblems().length === 0;
  }
}
