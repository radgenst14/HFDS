/**
 * Page <-> engine messages (doc 15 Part A "Architecture", Part B B4). All communication
 * goes through the Transport interface (src/transport/transport.ts); the client sends
 * intents and renders snapshots, the engine owns every HFDS decision (CLAUDE.md rule 5).
 */
import type { TimeScale } from './constants';
import type {
  AttentionLevel,
  Environment,
  ErrorCode,
  FollowingZone,
  GapSetting,
  GripState,
  HazardType,
  HfdsMode,
  HmiState,
  LogEntry,
  LogFile,
  SensorId,
  SensorStatus,
  SensorType,
  VehicleSizeClass,
} from './domain';
import type { InjectAction } from './scenario-schema';

// ---------------------------------------------------------------------------
// Page → engine
// ---------------------------------------------------------------------------

/** Driver panel / keyboard intents (B4). Same vocabulary as timeline `driver` events. */
export type DriverAction =
  | { kind: 'pressHfdsButton' }
  | { kind: 'setBrake'; pressed: boolean; rate?: number }
  | { kind: 'setThrottle'; value: number }
  | { kind: 'setSteer'; value: number }
  | { kind: 'setGrip'; L?: boolean; R?: boolean; TOP?: boolean; BOTTOM?: boolean }
  | { kind: 'setGaze'; eyesOnRoad: boolean }
  | { kind: 'setGap'; gapSetting: GapSetting }
  | { kind: 'setSpeed'; mph: number };

/** Director panel injections; `kind` is a timeline `inject` action from doc 14. */
export interface DirectorAction {
  kind: InjectAction;
  args?: Record<string, unknown>;
}

export type ClientMessage =
  | { type: 'load_scenario'; id: string }
  | { type: 'input'; action: DriverAction }
  | { type: 'inject'; action: DirectorAction }
  | { type: 'reset' }
  | { type: 'pause' }
  | { type: 'resume' }
  /** Advance one tick while paused (debugging, screenshots). */
  | { type: 'step' }
  /** Fixed-dt steps per real tick; dt stays 0.05 s (A-11, A-34). */
  | { type: 'set_time_scale'; scale: TimeScale }
  /** EventLog.exportLog(). */
  | { type: 'export_log' };

// ---------------------------------------------------------------------------
// Engine → page
// ---------------------------------------------------------------------------

export interface AvailabilityCheck {
  id: string;
  label: string;
  pass: boolean;
  reqs: string[];
  /** Why the line fails (only when pass is false). */
  detail?: string;
}

export interface AccSnapshot {
  active: boolean;
  setSpeedMph: number | null;
  timeGapS: number;
  trailDistanceFt: number;
  selectionDistanceFt: number;
  safetyCushionFt: number;
  zone: FollowingZone | null;
  gapFt: number | null;
  closingSpeedFtps: number;
  aReqFtps2: number | null;
  maxBrakingDecelFtps2: number;
}

export interface HfdsTimers {
  alertElapsedS?: number;
  takeoverRemainingS?: number;
  resumeProgressS?: number;
  cooldownRemainingS?: number;
  mrmElapsedS?: number;
}

export interface SensorSnapshot {
  sensorId: SensorId;
  type: SensorType;
  status: SensorStatus;
  activeForLane: boolean;
  activeForLead: boolean;
}

/** Road geometry near the ego (B4 leaves this `unknown`; shape proposed here). */
export interface RoadSegmentView {
  fromFt: number;
  toFt: number;
  curvatureRadiusFt?: number;
  direction?: 'left' | 'right';
  constructionZone?: boolean;
  tunnel?: boolean;
  markings?: { left: boolean; right: boolean };
}

export interface Snapshot {
  tick: number;
  simTime: number;
  scenarioId: string;
  paused: boolean;
  timeScale: TimeScale;
  ego: {
    s: number;
    lateral: number;
    laneId: number;
    heading: number;
    speedMph: number;
    accel: number;
    steeringAngle: number;
  };
  traffic: Array<{
    id: number;
    sizeClass: VehicleSizeClass;
    s: number;
    lateral: number;
    laneId: number;
    speedMph: number;
    length: number;
    width: number;
    isLead: boolean;
    isIntruding: boolean;
  }>;
  hazards: Array<{ id: number; type: HazardType; s: number; laneId: number }>;
  road: {
    visibleSegments: RoadSegmentView[];
    laneWidthFt: number;
    travelLanes: number;
    rightShoulder: boolean;
  };
  hfds: {
    mode: HfdsMode;
    available: boolean;
    availabilityChecks: AvailabilityCheck[];
    bluePath: Array<{ s: number; y: number }>;
    targetOffset: number;
    lateralOffset: number;
    pathConfidence: number;
    acc: AccSnapshot;
    timers: HfdsTimers;
    reclaimsInWindow: number;
    sensors: SensorSnapshot[];
    errors: ErrorCode[];
  };
  hmi: HmiState;
  driver: {
    eyesOnRoad: boolean;
    grip: GripState;
    brake: boolean;
    throttle: number;
    steer: number;
    attentionLevel: AttentionLevel;
  };
  environment: Environment;
  /** SRS IDs exercised since scenario start (trace panel). */
  traceReqs: string[];
}

export type EngineMessage =
  | { type: 'state'; snapshot: Snapshot }
  /** Every log entry is also an event (B4). */
  | { type: 'event'; name: string; t: number; reqs: string[]; data?: unknown }
  | { type: 'error'; message: string }
  | { type: 'log_export'; file: LogFile };

/** Convenience: an event message built from a log entry. */
export function eventFromLog(entry: LogEntry): EngineMessage {
  return { type: 'event', name: entry.type, t: entry.t, reqs: entry.reqs, data: entry };
}
