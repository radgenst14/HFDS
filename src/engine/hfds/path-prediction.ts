/**
 * PathPrediction (doc 12): calculates the blue path from VehiclePosition and the LiDAR
 * map (R2). M2 part: the path along the current lane centre + targetOffset, its
 * confidence and isPathValid() (doc 13 §4, UC5) for engagement (R15.4). Lane keeping,
 * curves and the UC12 offset are M3.
 *
 * A-47: path length 800 ft, points every 25 ft. pathConfidence = (lane-position sources
 * available / 2) × (1 if both lane lines are visible, else 0.4). Valid needs ≥ 0.5
 * (A-31), so one lost source still gives a valid path (SR4.4) but missing lane lines
 * do not.
 */
import {
  BLUE_PATH_LENGTH_FT,
  BLUE_PATH_POINT_SPACING_FT,
  PATH_CONFIDENCE_MIN,
  PATH_CONFIDENCE_NO_MARKINGS_FACTOR,
} from '../../shared/constants';
import { SubsystemStatus, type Point } from '../../shared/domain';
import type { LiDARMap } from '../world/lidar-map';
import type { Road } from '../world/road';
import type { VehiclePosition } from './vehicle-position';

export class PathPrediction {
  status: SubsystemStatus = SubsystemStatus.OK;
  /** Sim time of the last calculation. */
  lastCalculated = 0;
  bluePath: Point[] = [];
  pathConfidence = 0;
  targetOffset = 0;

  /** Doc 13 §11 step 4 (R2). */
  calculateBluePath(
    pos: VehiclePosition,
    map: LiDARMap,
    road: Road,
    t: number,
    simDate: string,
  ): Point[] {
    this.lastCalculated = t;
    const s0 = pos.currentPosition.x;
    const usable =
      this.status !== SubsystemStatus.Faulted &&
      !map.dataError &&
      map.isEnabled() &&
      !map.isOutdated(simDate) &&
      road.isEnabledForHfds(s0) &&
      pos.currentLane >= 1;
    if (!usable) {
      this.bluePath = [];
      this.pathConfidence = 0;
      return this.bluePath;
    }
    const y = road.laneCenterY(pos.currentLane) + this.targetOffset;
    const points: Point[] = [];
    const end = Math.min(s0 + BLUE_PATH_LENGTH_FT, road.lengthFt);
    for (let s = s0; s <= end + 1e-9; s += BLUE_PATH_POINT_SPACING_FT) points.push({ s, y });
    this.bluePath = points;
    const m = road.markingsAt(s0, t);
    const markings = m.left && m.right ? 1 : PATH_CONFIDENCE_NO_MARKINGS_FACTOR;
    this.pathConfidence = (pos.sourceCount() / 2) * markings;
    return this.bluePath;
  }

  /** UC5, IR14: a path exists and its confidence is at least 0.5 (A-31). */
  isPathValid(): boolean {
    return this.bluePath.length > 1 && this.pathConfidence >= PATH_CONFIDENCE_MIN - 1e-9;
  }

  /** Lateral position of the path at s (straight in the road frame, A-36). */
  pathYAt(_s: number): number | null {
    return this.bluePath[0]?.y ?? null;
  }
}
