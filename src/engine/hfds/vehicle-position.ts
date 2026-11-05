/**
 * VehiclePosition (doc 12). Holds two independent lane-position estimates (SR4.1):
 *   - camera: lane position from the front camera's lane-line detection,
 *   - map: LiDAR map + GPS (needs LIDAR_1, GPS_1, GPS data and map data).
 * A-46: simulated sources report the true position, so they agree unless a fault is
 * injected (M5, E106). validatePosition() (R3, R47) needs both sources and agreement
 * within 0.3 m (IR5.8).
 */
import { M_TO_FT, REDUNDANT_AGREEMENT_M } from '../../shared/constants';
import { SensorId, SubsystemStatus, type Vector3 } from '../../shared/domain';
import type { LiDARMap } from '../world/lidar-map';
import type { Road } from '../world/road';
import type { SensorSuite } from './sensors';

export interface PositionSources {
  /** lateral offset from lane centre (ft) or null if the source is unavailable */
  camera: number | null;
  map: number | null;
}

export class VehiclePosition {
  status: SubsystemStatus = SubsystemStatus.OK;
  currentPosition: Vector3 = { x: 0, y: 0, z: 0 };
  currentLane = 1;
  positionValid = false;
  sources: PositionSources = { camera: null, map: null };
  /** Injected disagreement between the two sources (m); M5 uses it for E106. */
  injectedDisagreementM = 0;

  /** Doc 13 §11 step 4. */
  updatePosition(
    ego: { s: number; y: number },
    road: Road,
    sensors: SensorSuite,
    map: LiDARMap,
  ): void {
    this.currentPosition = { x: ego.s, y: ego.y, z: 0 };
    this.currentLane = road.laneIdAt(ego.y);
    const offset = ego.y - road.laneCenterY(this.currentLane);
    const cameraOk = sensors.ok(SensorId.CAM_FRONT);
    const mapOk =
      sensors.ok(SensorId.LIDAR_1) &&
      sensors.ok(SensorId.GPS_1) &&
      !sensors.gpsDataError &&
      !map.dataError;
    this.sources = {
      camera: cameraOk ? offset : null,
      map: mapOk ? offset + this.injectedDisagreementM * M_TO_FT : null,
    };
    this.positionValid = this.validatePosition();
  }

  /** |camera − map| in metres, or null when a source is missing. */
  sourceDisagreementM(): number | null {
    const { camera, map } = this.sources;
    if (camera === null || map === null) return null;
    return Math.abs(camera - map) / M_TO_FT;
  }

  /** Number of available lane-position sources (SR4.1 needs 2). */
  sourceCount(): number {
    return (this.sources.camera !== null ? 1 : 0) + (this.sources.map !== null ? 1 : 0);
  }

  /** R3, R47: position confirmed by two sources that agree within 0.3 m. */
  validatePosition(): boolean {
    const d = this.sourceDisagreementM();
    return d !== null && d <= REDUNDANT_AGREEMENT_M + 1e-9;
  }

  getPosition(): Vector3 {
    return { ...this.currentPosition };
  }
}
