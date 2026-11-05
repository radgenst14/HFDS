/**
 * Sensor (doc 12) and the prototype sensor set (A-27).
 *
 * IR29: every sensor runs selfTest() and read() once per 50 ms tick (doc 13 §11 step 3).
 * A sensor's data age is the time since its last good reading; IR5.8 needs ≤ 100 ms.
 * Faults are injected by the Director (`failSensor`); ErrorCodes for them (R9, R37,
 * IR29b) are raised from M5.
 *
 * GPS correction (R11, IR5.8, A-46): corrections download continuously (age 0) unless
 * the Director stops them with `staleGpsCorrection`; the age then grows from `ageS`.
 */
import type { SensorType } from '../../shared/domain';
import {
  enumValues,
  SENSOR_TYPES,
  SensorId,
  SensorStatus,
  type SensorData,
  type SensorMetadata,
} from '../../shared/domain';

export class Sensor {
  readonly sensorId: SensorId;
  readonly type: SensorType;
  status: SensorStatus;
  lastReading: SensorData | null = null;

  constructor(sensorId: SensorId, status: SensorStatus = SensorStatus.OK) {
    this.sensorId = sensorId;
    this.type = SENSOR_TYPES[sensorId];
    this.status = status;
  }

  /** IR29: validate working capability. */
  selfTest(): boolean {
    return this.status === SensorStatus.OK;
  }

  /** Returns a reading; only a healthy sensor produces fresh data. */
  read(t: number): SensorData {
    const ok = this.selfTest();
    const reading: SensorData = { sensorId: this.sensorId, t, ok, payload: null };
    if (ok) this.lastReading = reading;
    return reading;
  }

  /** Seconds since the last good reading (Infinity if never read). */
  dataAgeS(t: number): number {
    return this.lastReading ? t - this.lastReading.t : Infinity;
  }

  /** IR29b metadata for error log entries. */
  metadata(): SensorMetadata {
    return {
      sensorId: this.sensorId,
      type: this.type,
      status: this.status,
      lastReadingAt: this.lastReading?.t ?? null,
    };
  }
}

/** The sensors the forward-looking functions use (cameras, radar, LiDAR, GPS). */
export const PERCEPTION_SENSORS: readonly SensorId[] = [
  SensorId.CAM_FRONT,
  SensorId.CAM_REAR,
  SensorId.RADAR_FRONT,
  SensorId.LIDAR_1,
  SensorId.GPS_1,
];

/** IR5.6: "a camera, LiDAR, or radar sensor" (the driver camera is DATS, IR3/SR5). */
export const IR5_6_SENSORS: readonly SensorId[] = [
  SensorId.CAM_FRONT,
  SensorId.CAM_REAR,
  SensorId.RADAR_FRONT,
  SensorId.LIDAR_1,
];

export class SensorSuite {
  readonly sensors: ReadonlyMap<SensorId, Sensor>;
  /** IR5.7 "navigation or GPS data is in error" (Director `gpsError`). */
  gpsDataError = false;
  private gpsCorrectionStoppedAt: number | null = null;
  private gpsCorrectionStartAgeS = 0;

  constructor(overrides: Partial<Record<SensorId, SensorStatus>>) {
    this.sensors = new Map(enumValues(SensorId).map((id) => [id, new Sensor(id, overrides[id])]));
  }

  get(id: SensorId): Sensor {
    const s = this.sensors.get(id);
    if (!s) throw new Error(`unknown sensor ${id}`);
    return s;
  }

  ok(id: SensorId): boolean {
    return this.get(id).selfTest();
  }

  /** Doc 13 §11 step 3: selfTest() + read() for every sensor (IR29, SR10). */
  checkAll(t: number): void {
    for (const s of this.sensors.values()) s.read(t);
  }

  /** IR5.8: GPS correction age (s). */
  gpsCorrectionAgeS(t: number): number {
    if (this.gpsCorrectionStoppedAt === null) return 0;
    return this.gpsCorrectionStartAgeS + (t - this.gpsCorrectionStoppedAt);
  }

  /** Director `staleGpsCorrection` (IR5.8): downloads stop; age starts at `ageS`. */
  stopGpsCorrection(t: number, ageS: number): void {
    this.gpsCorrectionStoppedAt = t;
    this.gpsCorrectionStartAgeS = ageS;
  }

  /** GPS corrections download again (Director `clearFault E105`). */
  restoreGpsCorrection(): void {
    this.gpsCorrectionStoppedAt = null;
    this.gpsCorrectionStartAgeS = 0;
  }

  /** Director `failSensor` (R9, IR5.6). */
  setStatus(id: SensorId, status: SensorStatus): void {
    this.get(id).status = status;
  }

  /** Director `clearAllFaults` (R38): sensors OK, GPS data and corrections restored. */
  clearAll(): void {
    for (const s of this.sensors.values()) s.status = SensorStatus.OK;
    this.gpsDataError = false;
    this.gpsCorrectionStoppedAt = null;
    this.gpsCorrectionStartAgeS = 0;
  }
}
