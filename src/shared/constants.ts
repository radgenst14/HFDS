/**
 * Single source of every numeric constant (CLAUDE.md rule 7; doc 13 §1).
 *
 * Section 1: values fixed by the SRS — do not change without an SRS change.
 * Section 2: prototype assumptions (A-xx in docs/16_open_issues_and_assumptions.md).
 * Section 3: unit conversions and simulation plumbing.
 *
 * Engine-internal units: ft, s, ft/s, ft/s² (A-02). Each name carries its unit.
 */
import type { GapSetting, VehicleSizeClass } from './domain';

// ===========================================================================
// 1. From the SRS (doc 13 §1.1)
// ===========================================================================

/** Fixed engine tick rate. Tech stack doc; also satisfies IR29 (sensor check every 50 ms). */
export const TICK_HZ = 20;
/** Fixed step (s). Never changes with time scale (A-11). */
export const DT_S = 1 / TICK_HZ;
/** IR29: each sensor validates itself every 50 ms (= one tick). */
export const SENSOR_CHECK_INTERVAL_MS = 50;

/** R43: ignore HFDS button presses within 0.5 s of the previous press. */
export const BUTTON_DEBOUNCE_S = 0.5;
/** IR28: engage only when speed is strictly above 3 mph. */
export const MIN_ENGAGE_SPEED_MPH = 3;
/** IR27: HFDS never commands a speed above 85 mph. */
export const MAX_COMMAND_SPEED_MPH = 85;
/** IR9, R25: minimum time gap (s). */
export const MIN_TIME_GAP_S = 2.0;

/** R25 trail-distance size factors (SUV per ISSUE-06). */
export const SIZE_FACTOR: Readonly<Record<VehicleSizeClass, number>> = {
  Car: 1.0,
  SUV: 1.0,
  Truck: 1.25,
  Bus: 1.5,
  SemiTruck: 2.0,
};
/** doc 13 §2: with no lead, selection distance uses size factor 1.00. */
export const NO_LEAD_SIZE_FACTOR = 1.0;

/** R29.3: second alert 30 s after the first alert starts. */
export const FIRST_TO_SECOND_ALERT_S = 30;
/** R30.4: final alert 5 s after the second alert starts. */
export const SECOND_TO_FINAL_ALERT_S = 5;
/** R36: driver marked inactive 2 s after the final alert starts. */
export const FINAL_TO_INACTIVE_S = 2;
/** SR7 (and SD7): takeover period before the minimal risk maneuver. */
export const TAKEOVER_PERIOD_S = 30;
/** SR1.1.1: shoulder must be reached within 60 s, else stop in lane. */
export const MRM_SHOULDER_TIME_LIMIT_S = 60;
/** SR1.1.2: stay >= 2 s in each entered lane before the next lateral move. */
export const MRM_MIN_LANE_DWELL_S = 2;
/** R39.2: resume after 3 s of stable driving. */
export const STEER_RESUME_STABLE_S = 3;
/** R39.2: speed must stay within ±1.0 mph during the resume window. */
export const STEER_RESUME_SPEED_BAND_MPH = 1.0;
/** R35: firm grip = at least 2 sensing areas. */
export const GRIP_MIN_AREAS = 2;
/** R38.4 (SD7 note): re-check availability 20 s after a driver takeover. */
export const POST_TAKEOVER_RECHECK_S = 20;
/** R38.2, R41.2: re-engagement buffer (s). */
export const REACTIVATION_BUFFER_S = 30;
/** R41: deactivate on the 3rd system-initiated reclaim ... */
export const RECLAIM_LIMIT_COUNT = 3;
/** R41: ... within 5 minutes. */
export const RECLAIM_WINDOW_S = 300;
/** R44.2: block re-engagement 20 s after a corrupted control process. */
export const CORRUPTION_BLOCK_S = 20;
/** IR16: LiDAR map older than 7 months is outdated ("Update needed"). */
export const MAP_MAX_AGE_MONTHS = 7;
/** IR5.8: sensor data older than 100 ms is unhealthy. */
export const SENSOR_DATA_MAX_AGE_MS = 100;
/** IR5.8: GPS correction older than 5 s is unhealthy. */
export const GPS_CORRECTION_MAX_AGE_S = 5;
/** IR5.8: redundant position sources must agree within 0.3 m. */
export const REDUNDANT_AGREEMENT_M = 0.3;
/** IR8.2: unstable if a vehicle's acceleration changes by 10 ft/s² ... (ISSUE-07 units) */
export const UNSTABLE_ACCEL_CHANGE_FTPS2 = 10;
/** IR8.2: ... within 1 s. */
export const UNSTABLE_ACCEL_WINDOW_S = 1;
/** IR8.3: unstable if the gap changes by 30 % of trail distance ... */
export const UNSTABLE_GAP_CHANGE_FRAC = 0.3;
/** IR8.3: ... within 3 s. */
export const UNSTABLE_GAP_WINDOW_S = 3;
/** IR8.3: "or the time is under 1.0 second", read as time headway (ISSUE-08). */
export const UNSTABLE_MIN_TIME_HEADWAY_S = 1.0;

/** R37.2 severity bands (inclusive ranges, 0..100). */
export const SEVERITY_BANDS = {
  low: { min: 0, max: 24 },
  middle: { min: 25, max: 74 },
  high: { min: 75, max: 100 },
} as const;

/** R22 worked example; per-vehicle site adaptation (SRS 2.1), overridden by vehicleConfig. */
export const DEFAULT_MAX_BRAKING_DECEL_FTPS2 = 11.5;

/** Exact HMI strings (CLAUDE.md rule 3). */
export const HMI_TEXT = {
  /** R29.2 first alert. */
  PAY_ATTENTION: 'Pay attention to the road.',
  /** R30.3, UC19 second alert and Class A. */
  TAKE_CONTROL: 'Take steering control immediately.',
  /** IR6. */
  HFDS_AVAILABLE: 'HFDS available',
  /** IR16. */
  UPDATE_NEEDED: 'Update needed',
  /** R40 banner when control passes to the driver (doc 10 R40 prototype note). */
  CONTROL_TO_DRIVER: 'You are in control',
  /** R40 banner when HFDS takes over steering (doc 10 R40 prototype note). */
  CONTROL_TO_HFDS: 'HFDS steering',
} as const;

// ===========================================================================
// 2. Prototype assumptions (doc 13 §1.2; doc 16 A-xx)
// ===========================================================================

/** A-03: safety cushion = 0.5 s × v × sizeFactor (44 ft at 60 mph behind a car, R22 example). */
export const SAFETY_CUSHION_S = 0.5;
/** A-04: forward sensor detection range (R4.2 cap); overridden by vehicleConfig. */
export const FORWARD_SENSOR_RANGE_FT = 800;
/** A-05: speeds within ±0.5 mph count as "matched" in the coast zone (doc 13 §3). */
export const ACC_SPEED_MATCH_TOL_MPH = 0.5;
/** A-06: continuous eyes-off-road time before DATS detects attention loss (R29). */
export const ATTENTION_LOSS_DETECT_S = 3.0;
/** A-07: start sequence duration (self-tests + validation; R14, R42). */
export const START_SEQUENCE_S = 1.0;
/** A-08: driver gap settings (s). */
export const GAP_SETTINGS_S: Readonly<Record<GapSetting, number>> = {
  Near: 2.0,
  Medium: 2.5,
  Far: 3.0,
};
/** A-09: natural deceleration with zero throttle (R21, IR13). */
export const COAST_DECEL_FTPS2 = 1.5;
/** A-09: comfort acceleration when resuming set speed (R24). */
export const ACC_MAX_ACCEL_FTPS2 = 3.0;
/** A-10: ODD limits (IR5.1, IR5.4); outside if any limit is crossed. */
export const ODD_MAX_ROAD_MOISTURE = 0.3;
/** A-10: outside the ODD below this visibility (m). */
export const ODD_MIN_VISIBILITY_M = 150;
/** A-10: weather outside the ODD. */
export const ODD_EXCLUDED_WEATHER = ['Rain', 'Sleet', 'Snow', 'Fog', 'Ice'] as const;
/** A-10: light conditions outside the ODD. */
export const ODD_EXCLUDED_LIGHT = ['Night', 'LowAngleSun'] as const;
/** A-11 / A-34: allowed time scales (fixed-dt steps per real tick). */
export const TIME_SCALES = [0.5, 1, 2, 4] as const;
export type TimeScale = (typeof TIME_SCALES)[number];
/** A-12: minimal-risk-maneuver controlled-stop deceleration (SR1). */
export const MRM_DECEL_FTPS2 = 5.0;
/** A-13: phantom brake duration (R31.3). */
export const PHANTOM_BRAKE_DURATION_S = 0.5;
/** A-13: phantom brake deceleration (R31.3). */
export const PHANTOM_BRAKE_DECEL_FTPS2 = 4.0;
/** A-14: curve too sharp when v²·κ exceeds this (UC9). */
export const MAX_LATERAL_ACCEL_FTPS2 = 8.0;
/** A-14: navigateCurve() look-ahead in seconds of travel (doc 13 §4). */
export const CURVE_LOOKAHEAD_S = 5;
/** A-15: lateral offset away from a large adjacent vehicle (UC12), clamped inside the lane. */
export const LARGE_VEHICLE_OFFSET_FT = 1.0;
/** A-15: offset applies while the large vehicle is within ±1 of its lengths (doc 13 §4). */
export const LARGE_VEHICLE_RANGE_LENGTHS = 1;
/** A-16: default lane width (ft); scenarios give laneWidthM. */
export const LANE_WIDTH_FT = 12;
/** A-17: |steer input| at or above this means the driver is steering (R39). */
export const STEER_INPUT_THRESHOLD = 0.05;
/** A-18: vehicle dimensions (ft) by size class (R6 classification, R4.3 overlap). */
export const VEHICLE_DIMENSIONS_FT: Readonly<
  Record<VehicleSizeClass, { length: number; width: number }>
> = {
  Car: { length: 15, width: 6 },
  SUV: { length: 16, width: 6.5 },
  Truck: { length: 20, width: 7 },
  Bus: { length: 40, width: 8.5 },
  SemiTruck: { length: 70, width: 8.5 },
};
/** A-18: ego vehicle size class (prototype vehicle is a car). */
export const EGO_SIZE_CLASS: VehicleSizeClass = 'Car';
/** A-20: Class A / not available when less than 10 s of travel remain on the enabled road (UC17, IR1). */
export const END_OF_ENABLED_ROAD_MIN_TRAVEL_S = 10;
/** A-23: MRM lane change is safe if no vehicle in the target lane within ±1.5 s of travel ... */
export const MRM_SAFE_GAP_S = 1.5;
/** A-23: ... or within ±60 ft of the ego. */
export const MRM_SAFE_GAP_FT = 60;
/** A-25: Forward Collision System brakes when time-to-collision drops below 2.0 s (IR22). */
export const FCS_TTC_THRESHOLD_S = 2.0;
/** A-31: isPathValid() requires pathConfidence >= 0.5 (doc 13 §4, UC5). */
export const PATH_CONFIDENCE_MIN = 0.5;
/** A-33: default rate for scripted traffic speed changes (doc 14 `setSpeed` behavior). */
export const TRAFFIC_DEFAULT_SPEED_CHANGE_FTPS2 = 5.0;

// ===========================================================================
// 3. Units and plumbing
// ===========================================================================

/** 1 mph in ft/s (A-02). */
export const MPH_TO_FTPS = 5280 / 3600;
/** 1 m in ft (A-02). */
export const M_TO_FT = 3.28084;
/** Scenario/protocol schema version, bumped when the preset format changes. */
export const SCENARIO_SCHEMA_VERSION = 1;
/** Worker host real-tick interval (ms); one fixed engine step per tick at 1× (A-11, A-35). */
export const HOST_TICK_MS = 1000 / TICK_HZ;
/** Road geometry sent in a snapshot: this far behind the ego (ft). Plumbing (doc 15 B4 size limit). */
export const SNAPSHOT_WINDOW_BEHIND_FT = 300;
/** Road geometry sent in a snapshot: this far ahead of the ego (ft). */
export const SNAPSHOT_WINDOW_AHEAD_FT = 1200;

// ===========================================================================
// 4. Manual driving and world model (M1)
// ===========================================================================

/** A-36: driver throttle 1.0 gives this acceleration (manual driving, IR25). */
export const DRIVER_MAX_ACCEL_FTPS2 = 6.0;
/** A-36: brake rate when a setBrake input gives none. */
export const DRIVER_DEFAULT_BRAKE_FTPS2 = 10.0;
/** A-36: full steering input (|steer| = 1) moves the ego sideways at this speed; + = left. */
export const DRIVER_MAX_LATERAL_SPEED_FTPS = 4.0;
/** A-36: displayed steering-wheel angle at full input (VehicleControl.currentSteeringAngle). */
export const MAX_STEERING_ANGLE_DEG = 15;
/** A-37: the ego's front bumper starts at s = 0 on the road (hazards and segments use absolute s). */
export const EGO_START_S_FT = 0;
/** A-44: R16 / R49 rejection messages (dashboard, HUD, activation warning) stay this long (s). */
export const REJECTION_DISPLAY_S = 5;
/** A-44: R16.3 light-bar error flash after a rejected press (s). */
export const LIGHT_BAR_ERROR_FLASH_S = 2;
/** A-44: R40 control-transfer banner duration (s). */
export const CONTROL_TRANSFER_BANNER_S = 5;
/** A-47: blue path length ahead of the ego (ft); equals the default forward sensor range (A-04). */
export const BLUE_PATH_LENGTH_FT = 800;
/** A-47: spacing of blue-path points (ft). */
export const BLUE_PATH_POINT_SPACING_FT = 25;
/** A-47: pathConfidence multiplier when a lane line is not visible (IR2). */
export const PATH_CONFIDENCE_NO_MARKINGS_FACTOR = 0.4;
/** A-48: Director `trafficErraticAccel`: +a then −a pulses of this size (ft/s²) ... */
export const ERRATIC_ACCEL_PULSE_FTPS2 = 6;
/** A-48: ... each lasting this long (s), i.e. a 12 ft/s² change within 1 s (IR8.2). */
export const ERRATIC_ACCEL_PULSE_S = 0.5;
/** A-51: ACC speed tracking time constant (s): accel = (target − v) / τ, within the A-09 limits. */
export const ACC_SPEED_TRACK_TAU_S = 1.0;
/** A-51: ACC follow mode: commanded speed = lead speed + 0.1 /s × (gap − trail distance). */
export const ACC_GAP_GAIN_PER_S = 0.1;
/** A-51: lane keeping (R20): lateral speed = 1.0 /s × lateral error, capped at full steering. */
export const LANE_KEEP_GAIN_PER_S = 1.0;
/** A-52: UC11 lane intrusion: a vehicle is entering when its predicted extent overlaps the ego path within this time (s). */
export const LANE_INTRUSION_PREDICTION_S = 1.0;
/** A-53: scripted driver `steerToLaneId`: steering input per ft of lateral error (capped at ±1). */
export const SCRIPTED_STEER_GAIN_PER_FT = 0.5;
/** A-53: scripted driver `steerToLaneId` ends within this lateral error (ft). */
export const SCRIPTED_STEER_DONE_FT = 0.3;
/** A-39: EventLog.capacity; beyond it the oldest entries are dropped (EventLog.count keeps the total). */
export const EVENT_LOG_CAPACITY = 10_000;

// ===========================================================================
// 5. Client display (no effect on engine behavior)
// ===========================================================================

/** A-36: steering input sent while ←/→ is held (doc 15 B6 keyboard). */
export const KEYBOARD_STEER_INPUT = 0.5;
/** Rows kept in the event log panel; the full log stays in the engine (export). */
export const EVENT_LOG_PANEL_MAX_ROWS = 500;
/** Road view shows at least this much road (ft) across its width, ego at 25 % from the left. */
export const ROAD_VIEW_MIN_RANGE_FT = 600;
/** Road view may draw the across-road axis up to this many times the along-road scale. */
export const ROAD_VIEW_MAX_LATERAL_STRETCH = 2.5;
