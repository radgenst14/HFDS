/**
 * Simulation clock and time-scale stepping. Pure: the Worker host (worker.ts, A-35)
 * owns the real-time interval and asks this module how many fixed steps to run.
 */
import { DT_S, type TimeScale } from '../shared/constants';

/** Sim time (s) at the start of a tick. Ticks are integers so time never drifts. */
export function simTimeOf(tick: number): number {
  return tick * DT_S;
}

/**
 * A-11 / A-34: each real tick adds `scale` to an accumulator and runs its whole part as
 * fixed 0.05 s steps. 2× and 4× run 2 and 4 steps; 0.5× runs one step every other tick.
 * dt never changes.
 */
export function stepsForRealTick(
  scale: TimeScale,
  accumulator: number,
): { steps: number; accumulator: number } {
  const total = accumulator + scale;
  const steps = Math.floor(total + 1e-9);
  return { steps, accumulator: total - steps };
}
