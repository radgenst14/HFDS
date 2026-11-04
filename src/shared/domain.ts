/**
 * Enumerations and shared entity types from the SRS domain model (doc 12).
 *
 * Enums are `as const` objects plus a same-named union type, so code reads like the SRS
 * (`LightBarState.PulsingBlue`) and values stay plain strings in JSON snapshots and
 * scenario files. Shapes marked [proposed] are not defined by the SRS; see doc 12 and
 * doc 16. Engine-internal units: ft, s, ft/s, ft/s² (A-02); fields carry a unit suffix
 * when they use a boundary unit (mph, m).
 *
 * Pure module: no DOM, no runtime dependencies (CLAUDE.md rule 4).
 */

/** Values of an `as const` enum object as a non-empty tuple (for Zod and iteration). */
export function enumValues<T extends Record<string, string>>(e: T): [T[keyof T], ...T[keyof T][]] {
  const values = Object.values(e) as T[keyof T][];
  if (values.length === 0) throw new Error('empty enum');
  return values as [T[keyof T], ...T[keyof T][]];
}

// ---------------------------------------------------------------------------
// Enumerations (doc 12 "Enumerations")
// ---------------------------------------------------------------------------

/** Diagram 05. */
export const SubsystemStatus = { OK: 'OK', Degraded: 'Degraded', Faulted: 'Faulted' } as const;
export type SubsystemStatus = (typeof SubsystemStatus)[keyof typeof SubsystemStatus];

/** Data dictionary. */
export const SensorType = {
  Camera: 'Camera',
  DriverCamera: 'DriverCamera',
  Radar: 'Radar',
  LiDAR: 'LiDAR',
  GPS: 'GPS',
  GripSensor: 'GripSensor',
} as const;
export type SensorType = (typeof SensorType)[keyof typeof SensorType];

/** Data dictionary (IR5.6). */
export const SensorStatus = {
  OK: 'OK',
  Obstructed: 'Obstructed',
  Damaged: 'Damaged',
  Failed: 'Failed',
} as const;
export type SensorStatus = (typeof SensorStatus)[keyof typeof SensorStatus];

/** Diagram 02. */
export const WeatherType = {
  Clear: 'Clear',
  Rain: 'Rain',
  Sleet: 'Sleet',
  Snow: 'Snow',
  Fog: 'Fog',
  Ice: 'Ice',
} as const;
export type WeatherType = (typeof WeatherType)[keyof typeof WeatherType];

/** Diagram 02. */
export const LightCondition = { Day: 'Day', Night: 'Night', LowAngleSun: 'LowAngleSun' } as const;
export type LightCondition = (typeof LightCondition)[keyof typeof LightCondition];

/** Diagram 02. */
export const RoadType = {
  DividedHighway: 'DividedHighway',
  Undivided: 'Undivided',
  ServiceDrive: 'ServiceDrive',
} as const;
export type RoadType = (typeof RoadType)[keyof typeof RoadType];

/** Diagram 03. */
export const LaneType = {
  Travel: 'Travel',
  Shoulder: 'Shoulder',
  ExitLane: 'ExitLane',
  ServiceDrive: 'ServiceDrive',
} as const;
export type LaneType = (typeof LaneType)[keyof typeof LaneType];

/** Diagram 03, plus SUV required by R6 and R25 (ISSUE-06). */
export const VehicleSizeClass = {
  Car: 'Car',
  SUV: 'SUV',
  Truck: 'Truck',
  SemiTruck: 'SemiTruck',
  Bus: 'Bus',
} as const;
export type VehicleSizeClass = (typeof VehicleSizeClass)[keyof typeof VehicleSizeClass];

/** Diagram 04. */
export const AlertLevel = { First: 'First', Second: 'Second', Final: 'Final' } as const;
export type AlertLevel = (typeof AlertLevel)[keyof typeof AlertLevel];

/** Data dictionary; boundaries are A-05. */
export const FollowingZone = { Closing: 'Closing', Coast: 'Coast', Safety: 'Safety' } as const;
export type FollowingZone = (typeof FollowingZone)[keyof typeof FollowingZone];

/** R28 (Class A = takeover request, Class B = attention escalation). */
export const WarningClass = { A: 'A', B: 'B' } as const;
export type WarningClass = (typeof WarningClass)[keyof typeof WarningClass];

/** [proposed] R33, R34, R39.1, R29.1, R30.1 (no enum in the SRS). */
export const LightBarState = {
  Off: 'Off',
  SolidGreen: 'SolidGreen',
  FlashingGreen: 'FlashingGreen',
  PulsingBlue: 'PulsingBlue',
  FlashingRed: 'FlashingRed',
} as const;
export type LightBarState = (typeof LightBarState)[keyof typeof LightBarState];

/**
 * [proposed] Derived HFDS mode state machine (doc 13 §6; ISSUE-23). Also used as the
 * HMI DisplayState. ENGAGED sub-states are HANDS_FREE … TAKEOVER_REQUESTED.
 * There is no REJECTED mode: a rejected activation is an event (ISSUE-34).
 */
export const HfdsMode = {
  UNAVAILABLE: 'UNAVAILABLE',
  AVAILABLE: 'AVAILABLE',
  STARTING: 'STARTING',
  HANDS_FREE: 'HANDS_FREE',
  DRIVER_STEERING: 'DRIVER_STEERING',
  ALERT_FIRST: 'ALERT_FIRST',
  ALERT_SECOND: 'ALERT_SECOND',
  ALERT_FINAL: 'ALERT_FINAL',
  TAKEOVER_REQUESTED: 'TAKEOVER_REQUESTED',
  MINIMAL_RISK_MANEUVER: 'MINIMAL_RISK_MANEUVER',
  STOPPED_LOCKOUT: 'STOPPED_LOCKOUT',
} as const;
export type HfdsMode = (typeof HfdsMode)[keyof typeof HfdsMode];
/** HMI.displayedState type (doc 12: DisplayState = HFDS mode). */
export type DisplayState = HfdsMode;

/** Modes in which HFDS is engaged (doc 13 §6 ENGAGED box). */
export const ENGAGED_MODES: readonly HfdsMode[] = [
  HfdsMode.HANDS_FREE,
  HfdsMode.DRIVER_STEERING,
  HfdsMode.ALERT_FIRST,
  HfdsMode.ALERT_SECOND,
  HfdsMode.ALERT_FINAL,
  HfdsMode.TAKEOVER_REQUESTED,
];

/** [proposed] Driver dictionary ("engaged inattentive or inactive"). */
export const AttentionLevel = {
  Engaged: 'Engaged',
  Inattentive: 'Inattentive',
  Inactive: 'Inactive',
} as const;
export type AttentionLevel = (typeof AttentionLevel)[keyof typeof AttentionLevel];

/** [proposed] Driver dictionary (values unstated). */
export const EyeDirection = { OnRoad: 'OnRoad', OffRoad: 'OffRoad' } as const;
export type EyeDirection = (typeof EyeDirection)[keyof typeof EyeDirection];

/** [proposed] Driver dictionary (values unstated). */
export const HeadPosition = { Forward: 'Forward', Turned: 'Turned', Down: 'Down' } as const;
export type HeadPosition = (typeof HeadPosition)[keyof typeof HeadPosition];

/** [proposed] Driver.selectedGap; seconds in GAP_SETTINGS_S (A-08). */
export const GapSetting = { Near: 'Near', Medium: 'Medium', Far: 'Far' } as const;
export type GapSetting = (typeof GapSetting)[keyof typeof GapSetting];

/** [proposed] IR26 list. */
export const HazardType = {
  Debris: 'Debris',
  Pothole: 'Pothole',
  StoppedVehicle: 'StoppedVehicle',
  Pedestrian: 'Pedestrian',
} as const;
export type HazardType = (typeof HazardType)[keyof typeof HazardType];

/** [proposed] Warning.reason (doc 12 Warning; doc 13 §7 Class A causes). */
export const WarningReason = {
  HAZARD_IN_LANE: 'HAZARD_IN_LANE',
  BRAKING_INSUFFICIENT: 'BRAKING_INSUFFICIENT',
  SENSOR_FAULT: 'SENSOR_FAULT',
  MAP_MISMATCH: 'MAP_MISMATCH',
  CURVE_TOO_SHARP: 'CURVE_TOO_SHARP',
  ODD_EXIT: 'ODD_EXIT',
  DATS_LOSS: 'DATS_LOSS',
  ATTENTION_LOSS: 'ATTENTION_LOSS',
  UPDATE_NEEDED: 'UPDATE_NEEDED',
  INVALID_PATH: 'INVALID_PATH',
  END_OF_ENABLED_ROAD: 'END_OF_ENABLED_ROAD',
  FCW_ESCALATION: 'FCW_ESCALATION',
} as const;
export type WarningReason = (typeof WarningReason)[keyof typeof WarningReason];

/** [proposed] LogEntry.type (doc 12). */
export const LogEntryType = {
  engagement: 'engagement',
  disengagement: 'disengagement',
  warning: 'warning',
  error: 'error',
  takeover_request: 'takeover_request',
  info: 'info',
} as const;
export type LogEntryType = (typeof LogEntryType)[keyof typeof LogEntryType];

/** R37.2 severity bands (ranges in SEVERITY_BANDS). */
export const ErrorBand = { low: 'low', middle: 'middle', high: 'high' } as const;
export type ErrorBand = (typeof ErrorBand)[keyof typeof ErrorBand];

/** [proposed] HMI.fcsMode (IR22). */
export const FcsMode = { AlertAndBrake: 'AlertAndBrake', Default: 'Default' } as const;
export type FcsMode = (typeof FcsMode)[keyof typeof FcsMode];

/** [proposed] HMI.onStar (SR1.3, SR8). */
export const OnStarStatus = {
  idle: 'idle',
  connecting: 'connecting',
  connected: 'connected',
} as const;
export type OnStarStatus = (typeof OnStarStatus)[keyof typeof OnStarStatus];

/** [proposed] HMI.seatVibration (R30.2, R31.1). */
export const SeatVibration = { off: 'off', pulse: 'pulse', continuous: 'continuous' } as const;
export type SeatVibration = (typeof SeatVibration)[keyof typeof SeatVibration];

/** R30.2 "audible alert or vibrate the seat" (vehicleConfig.secondAlertMode). */
export const SecondAlertMode = { chime: 'chime', seat: 'seat' } as const;
export type SecondAlertMode = (typeof SecondAlertMode)[keyof typeof SecondAlertMode];

/** Steering-wheel grip sensing areas (R35 needs >= 2). */
export const GripArea = { L: 'L', R: 'R', TOP: 'TOP', BOTTOM: 'BOTTOM' } as const;
export type GripArea = (typeof GripArea)[keyof typeof GripArea];
export type GripState = Record<GripArea, boolean>;

/** Prototype default sensor set (A-27). */
export const SensorId = {
  CAM_FRONT: 'CAM_FRONT',
  CAM_REAR: 'CAM_REAR',
  CAM_DRIVER: 'CAM_DRIVER',
  RADAR_FRONT: 'RADAR_FRONT',
  LIDAR_1: 'LIDAR_1',
  GPS_1: 'GPS_1',
  GRIP_L: 'GRIP_L',
  GRIP_R: 'GRIP_R',
  GRIP_TOP: 'GRIP_TOP',
  GRIP_BOTTOM: 'GRIP_BOTTOM',
} as const;
export type SensorId = (typeof SensorId)[keyof typeof SensorId];

/** Type of each default sensor (A-27). */
export const SENSOR_TYPES: Readonly<Record<SensorId, SensorType>> = {
  CAM_FRONT: SensorType.Camera,
  CAM_REAR: SensorType.Camera,
  CAM_DRIVER: SensorType.DriverCamera,
  RADAR_FRONT: SensorType.Radar,
  LIDAR_1: SensorType.LiDAR,
  GPS_1: SensorType.GPS,
  GRIP_L: SensorType.GripSensor,
  GRIP_R: SensorType.GripSensor,
  GRIP_TOP: SensorType.GripSensor,
  GRIP_BOTTOM: SensorType.GripSensor,
};

/** Subsystem flags a Director can toggle (IR5.9, IR17; doc 14 `setSubsystemFlag`). */
export const SubsystemFlag = {
  motionForecasting: 'motionForecasting',
  selfSupervision: 'selfSupervision',
  dynamicEnvironment: 'dynamicEnvironment',
  positioningDataService: 'positioningDataService',
} as const;
export type SubsystemFlag = (typeof SubsystemFlag)[keyof typeof SubsystemFlag];

// ---------------------------------------------------------------------------
// Entity / value types (doc 12 "Classes"; [proposed] shapes for empty classes)
// ---------------------------------------------------------------------------

/** Position / Point / Vector3 in feet, road frame: x = along-road s, y = lateral offset. */
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}
export type Position = Vector3;
/** Blue-path point: s along road (ft), y lateral (ft). */
export interface Point {
  s: number;
  y: number;
}

/** Environment (Road Conditions). Visibility kept in metres as in the SRS (A-02). */
export interface Environment {
  weather: WeatherType;
  lightCondition: LightCondition;
  roadMoisture: number;
  visibilityM: number;
}

/** [proposed] ControlCommand (doc 12). */
export interface ControlCommand {
  kind: 'steer' | 'accelerate' | 'brake' | 'coast' | 'phantomBrake';
  /** deg for steer, ft/s² otherwise. */
  value: number;
  source: 'DriverAssistSystem' | 'Driver' | 'External';
  /** IR18 / IR19. */
  authenticated: boolean;
  reqs: string[];
}

/** [proposed] Hazard (doc 12). */
export interface Hazard {
  id: number;
  type: HazardType;
  laneId: number;
  /** Distance along road, ft. */
  s: number;
  detectedAt: number | null;
}

/** Sensor metadata carried by error log entries (IR29b). */
export interface SensorMetadata {
  sensorId: SensorId;
  type: SensorType;
  status: SensorStatus;
  /** Sim seconds of the last good reading, or null if none. */
  lastReadingAt: number | null;
}

/** [proposed] ErrorCode (doc 12; catalog A-19 in doc 13 §9). */
export interface ErrorCode {
  code: string;
  description: string;
  /** 0..100 (R37.2). */
  severity: number;
  band: ErrorBand;
  sensor?: SensorMetadata;
  raisedAt: number;
  clearedAt?: number;
}

/** [proposed] LogEntry (doc 12). Every entry has a timestamp (R45). */
export interface LogEntry {
  /** Sim seconds. */
  t: number;
  type: LogEntryType;
  /** Domain class that logged it, e.g. "DriverAttentionSystem". */
  source: string;
  message: string;
  reqs: string[];
  data?: unknown;
}

/** [proposed] LogFile returned by EventLog.exportLog(). */
export interface LogFile {
  scenarioId: string;
  seed: number;
  entries: LogEntry[];
}

/** [proposed] VehicleState (doc 12). speed in ft/s. */
export interface VehicleState {
  speed: number;
  acceleration: number;
  steeringAngle: number;
  s: number;
  lateral: number;
  laneId: number;
  heading: number;
}

/** [proposed] SensorData (doc 12). */
export interface SensorData {
  sensorId: SensorId;
  t: number;
  ok: boolean;
  payload: unknown;
}

/** [proposed] MapUpdate (R11). lastUpdated is an ISO date (YYYY-MM-DD). */
export interface MapUpdate {
  version: string;
  lastUpdated: string;
}

/** Warning (doc 12) with the [proposed] id, reason and reqs fields. */
export interface Warning {
  id: number;
  warningClass: WarningClass;
  level: AlertLevel | null;
  reason: WarningReason;
  message: string;
  issuedAt: number;
  isActive: boolean;
  reqs: string[];
}

/**
 * HumanMachineInterface state (doc 12 + [proposed] output channels). The engine produces
 * it; src/client/ui renders it. `dashboardError` and `activationWarning` are added by
 * ISSUE-34 (s02/s03 check `hmi.dashboardError`; R16.1, R49).
 */
export interface HmiState {
  displayedState: DisplayState;
  displayedMessage: string;
  activeWarnings: Warning[];
  lightBarStatus: LightBarState;
  /** IR6 "HFDS available". */
  availableIndicator: boolean;
  /** R16.1 dashboard error text after a press while unavailable. */
  dashboardError?: string;
  /** R16.2 head-up display line (only if vehicleConfig.hasHUD). */
  hudMessage?: string;
  /** R49 activation warning naming the failed checks. */
  activationWarning?: string;
  seatVibration: SeatVibration;
  audibleAlert: boolean;
  voicePrompt?: string;
  /** R40 control-transfer banner. */
  controlTransferBanner?: string;
  hazardLights: boolean;
  onStar: OnStarStatus;
  doorsUnlocked: boolean;
  /** IR22. */
  fcsMode: FcsMode;
  /** IR16 "Update needed". */
  updateNeeded: boolean;
}

/** HMI fields an expectation may check (doc 14 `hmi` check). */
export const HMI_FIELDS = [
  'displayedState',
  'displayedMessage',
  'activeWarnings',
  'lightBarStatus',
  'availableIndicator',
  'dashboardError',
  'hudMessage',
  'activationWarning',
  'seatVibration',
  'audibleAlert',
  'voicePrompt',
  'controlTransferBanner',
  'hazardLights',
  'onStar',
  'doorsUnlocked',
  'fcsMode',
  'updateNeeded',
] as const satisfies readonly (keyof HmiState)[];
export type HmiField = (typeof HMI_FIELDS)[number];
