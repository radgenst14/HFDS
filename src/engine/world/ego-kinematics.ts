/**
 * Ego kinematic model (A-36): a point mass in the road frame. Longitudinal speed follows
 * the commanded acceleration (never below 0); lateral position follows the commanded
 * lateral speed and is clamped to the paved road (shoulder edge to median).
 * Vehicle-dynamics fidelity is out of scope (CLAUDE.md "Out of scope").
 */
export interface EgoState {
  /** front bumper along road, ft */
  s: number;
  /** lateral centre, ft (+ = left) */
  y: number;
  /** ft/s */
  speed: number;
  /** ft/s², achieved this step */
  accel: number;
  /** rad relative to the lane direction */
  heading: number;
}

export interface EgoCommand {
  /** ft/s² (negative = braking) */
  accel: number;
  /** ft/s, + = left */
  lateralSpeed: number;
}

export function integrateEgo(
  state: EgoState,
  cmd: EgoCommand,
  dt: number,
  bounds: { minY: number; maxY: number },
): EgoState {
  const v1 = Math.max(0, state.speed + cmd.accel * dt);
  const s = state.s + ((state.speed + v1) / 2) * dt;
  const y = Math.min(bounds.maxY, Math.max(bounds.minY, state.y + cmd.lateralSpeed * dt));
  const vy = (y - state.y) / dt;
  return {
    s,
    y,
    speed: v1,
    accel: (v1 - state.speed) / dt,
    heading: v1 > 0 ? Math.atan2(vy, v1) : 0,
  };
}
