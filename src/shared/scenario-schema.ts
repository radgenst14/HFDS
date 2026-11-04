/**
 * Zod schema for scenario presets (doc 14 "Scenario schema", timeline and expectation
 * vocabulary). Presets live in public/scenarios/ and are listed in index.json.
 *
 * Objects are strict: an unknown key is a typo and fails validation with a readable
 * message (doc 15 Part A: "Rejects malformed presets with a readable error").
 *
 * Pure module: used by the engine's scenario loader, the tests and the trace script.
 */
import { z } from 'zod';
import {
  enumValues,
  FollowingZone,
  GapSetting,
  GripArea,
  HazardType,
  HfdsMode,
  HMI_FIELDS,
  LightBarState,
  LightCondition,
  LogEntryType,
  RoadType,
  SecondAlertMode,
  SensorId,
  SensorStatus,
  SubsystemFlag,
  VehicleSizeClass,
  WarningClass,
  WarningReason,
  WeatherType,
} from './domain';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * SRS requirement ID (R29.3, SR1.1.2, IR12, IR29b — ISSUE-01) or use case (UC9 —
 * ISSUE-35). Never renumbered.
 */
export const REQ_ID_PATTERN = /^(?:(?:R|SR|IR)\d+(?:\.\d+)*b?|UC\d+)$/;
export const ReqId = z.string().regex(REQ_ID_PATTERN, 'not an SRS ID (R…, SR…, IR…, IR29b or UC…)');

const isoDate = z.iso.date();
const nonNeg = z.number().nonnegative();
const pos = z.number().positive();
const laneId = z.number().int().nonnegative(); // A-28: 0 = right shoulder, 1 = rightmost travel lane
const kebabId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id must be kebab-case');

const zSizeClass = z.enum(enumValues(VehicleSizeClass));
const zSensorId = z.enum(enumValues(SensorId));
const zSensorStatus = z.enum(enumValues(SensorStatus));
const zGapSetting = z.enum(enumValues(GapSetting));
const zGripArea = z.enum(enumValues(GripArea));
const zHazardType = z.enum(enumValues(HazardType));
const zWarningClass = z.enum(enumValues(WarningClass));

const gripState = z.strictObject({
  L: z.boolean(),
  R: z.boolean(),
  TOP: z.boolean(),
  BOTTOM: z.boolean(),
});
const gripPartial = gripState.partial();

export const EnvironmentSchema = z.strictObject({
  weather: z.enum(enumValues(WeatherType)),
  lightCondition: z.enum(enumValues(LightCondition)),
  roadMoisture: z.number().min(0).max(1),
  visibilityM: nonNeg,
});

// ---------------------------------------------------------------------------
// Static scenario parts
// ---------------------------------------------------------------------------

const vehicleConfig = z.strictObject({
  maxBrakingDecelFtps2: pos, // site adaptation (SRS 2.1), default 11.5
  forwardSensorRangeFt: pos, // R4.2, default 800 (A-04)
  hasHUD: z.boolean(), // R16.2
  hasLightBar: z.boolean(), // R16.3
  secondAlertMode: z.enum(enumValues(SecondAlertMode)), // R30.2
  trailerAttached: z.boolean(), // IR5.5
  trailerCapable: z.boolean(), // IR5.5
});

const lidarMap = z.strictObject({
  version: z.string().min(1),
  lastUpdated: isoDate,
  enabled: z.boolean(),
});

const roadSegment = z
  .strictObject({
    fromFt: nonNeg,
    toFt: nonNeg,
    curvatureRadiusFt: pos.optional(),
    direction: z.enum(['left', 'right']).optional(),
    constructionZone: z.boolean().optional(), // IR5.2
    tunnel: z.boolean().optional(), // IR5.2
    inMap: z.boolean().optional(), // false = missing from LiDAR map (R10)
    markings: z.strictObject({ left: z.boolean(), right: z.boolean() }).optional(), // IR2
    enabledForHfds: z.boolean().optional(), // IR1 / UC17
    roadType: z.string().optional(), // IR5.3
  })
  .refine((s) => s.toFt > s.fromFt, { message: 'segment toFt must be greater than fromFt' })
  .refine((s) => (s.curvatureRadiusFt === undefined) === (s.direction === undefined), {
    message: 'curvatureRadiusFt and direction go together',
  });

const road = z.strictObject({
  roadType: z.enum(enumValues(RoadType)),
  lengthFt: pos,
  travelLanes: z.number().int().min(1),
  laneWidthM: pos,
  rightShoulder: z.boolean(),
  medianBarrier: z.boolean(),
  segments: z.array(roadSegment),
});

const ego = z.strictObject({
  laneId,
  speedMph: nonNeg,
  setSpeedMph: pos.nullable(),
  gapSetting: zGapSetting,
});

const trafficBehavior = z.discriminatedUnion('action', [
  z.strictObject({
    t: nonNeg,
    action: z.literal('setSpeed'),
    speedMph: nonNeg,
    decelFtps2: pos.optional(),
    accelFtps2: pos.optional(),
  }),
  z.strictObject({ t: nonNeg, action: z.literal('changeLane'), toLaneId: laneId, durationS: pos }),
  z.strictObject({ t: nonNeg, action: z.literal('brakeHard'), decelFtps2: pos, durationS: pos }), // IR8.1
]);

const trafficVehicle = z.strictObject({
  id: z.number().int().positive(),
  sizeClass: zSizeClass,
  laneId,
  sFt: z.number(), // relative to ego, + = ahead, front-to-front
  speedMph: nonNeg,
  behavior: z.array(trafficBehavior).optional(),
});

const hazard = z.strictObject({
  id: z.number().int().positive(),
  type: zHazardType,
  laneId,
  sFt: nonNeg, // absolute along road
});

// ---------------------------------------------------------------------------
// Timeline events (doc 14 "Timeline events")
// ---------------------------------------------------------------------------

const ev = <K extends 'driver' | 'inject', A extends string, S extends z.ZodType | undefined>(
  kind: K,
  action: A,
  args?: S,
) =>
  z.strictObject({
    t: nonNeg,
    kind: z.literal(kind),
    action: z.literal(action),
    ...(args ? { args } : { args: z.strictObject({}).optional() }),
  });

const driverEvents = [
  ev('driver', 'pressHfdsButton'), // IR7, R12
  ev('driver', 'setBrake', z.strictObject({ pressed: z.boolean(), rate: pos.optional() })), // IR15, R50
  ev('driver', 'setThrottle', z.strictObject({ value: z.number().min(0).max(1) })), // IR25
  ev('driver', 'setSteer', z.strictObject({ value: z.number().min(-1).max(1) })), // R39, IR25
  ev('driver', 'setGrip', gripPartial), // R35
  ev('driver', 'setGaze', z.strictObject({ eyesOnRoad: z.boolean() })), // R27
  ev('driver', 'setGap', z.strictObject({ gapSetting: zGapSetting })), // Driver.setFollowGap
  ev('driver', 'setSpeed', z.strictObject({ mph: pos })), // engine caps at 85 (IR27)
] as const;

/** Reactive driver script: fires `delayS` after any Class A warning (t must be null). */
const takeoverOnClassA = z.strictObject({
  t: z.null(),
  kind: z.literal('driver'),
  action: z.literal('takeoverOnClassA'),
  args: z.strictObject({
    delayS: nonNeg,
    grip: z.array(zGripArea),
    steer: z.number().min(-1).max(1).optional(),
    steerToLaneId: laneId.optional(),
  }),
});

const injectEvents = [
  ev('inject', 'failSensor', z.strictObject({ sensorId: zSensorId, status: zSensorStatus })), // R9, IR5.6
  ev('inject', 'clearAllFaults'), // R38
  ev('inject', 'clearFault', z.strictObject({ code: z.string().optional() })), // R38
  ev('inject', 'setEnvironment', EnvironmentSchema.partial()), // R13, IR5.1, IR5.4
  ev(
    'inject',
    'applyMapUpdate',
    z.strictObject({ version: z.string().min(1), lastUpdated: isoDate }),
  ), // R11
  ev('inject', 'staleGpsCorrection', z.strictObject({ ageS: nonNeg })), // IR5.8
  ev('inject', 'dropLaneMarkings', z.strictObject({ durationS: pos })), // IR2
  ev('inject', 'spawnHazard', z.strictObject({ type: zHazardType, laneId, aheadFt: pos })), // IR26
  ev('inject', 'tamperDriverCamera'), // SR2
  ev('inject', 'corruptControlProcess'), // R44
  ev('inject', 'primaryComputeFailure'), // SR4.3
  ev('inject', 'fcwEscalation'), // IR5.10
  ev('inject', 'collision', z.strictObject({ airbag: z.boolean() })), // SR8
  ev(
    'inject',
    'externalCommand',
    z.strictObject({ kind: z.string().min(1), value: z.unknown(), authenticated: z.boolean() }),
  ), // IR18, IR19
  ev('inject', 'ignitionCycle'), // IR10
  ev(
    'inject',
    'setTrailer',
    z.strictObject({ attached: z.boolean(), capable: z.boolean().optional() }),
  ), // IR5.5
  ev(
    'inject',
    'setEgoLane',
    z
      .strictObject({
        laneId: laneId.optional(),
        laneType: z.enum(['ExitLane', 'ServiceDrive']).optional(),
      })
      .refine((a) => (a.laneId === undefined) !== (a.laneType === undefined), {
        message: 'setEgoLane takes exactly one of laneId or laneType',
      }),
  ), // IR5.3
  ev(
    'inject',
    'setRoadFlags',
    z.strictObject({
      constructionZone: z.boolean().optional(),
      tunnel: z.boolean().optional(),
      enabledForHfds: z.boolean().optional(),
    }),
  ), // IR5.2, IR1
  ev('inject', 'mapError'), // IR5.7
  ev('inject', 'gpsError'), // IR5.7
  ev(
    'inject',
    'trafficHardBrake',
    z.strictObject({ vehicleId: z.number().int().positive(), decelFtps2: pos, durationS: pos }),
  ), // IR8.1
  ev('inject', 'trafficErraticAccel', z.strictObject({ vehicleId: z.number().int().positive() })), // IR8.2
  ev(
    'inject',
    'trafficTailgateGap',
    z.strictObject({ vehicleId: z.number().int().positive(), headwayS: pos }),
  ), // IR8.3
  ev(
    'inject',
    'setSubsystemFlag',
    z.strictObject({ name: z.enum(enumValues(SubsystemFlag)), ok: z.boolean() }),
  ), // IR5.9, IR17
] as const;

const noteEvent = z.strictObject({
  t: nonNeg,
  kind: z.literal('note'),
  args: z.strictObject({ text: z.string().min(1) }),
});

export const TimelineEventSchema = z.union([
  noteEvent,
  z.discriminatedUnion('action', [...driverEvents, takeoverOnClassA, ...injectEvents]),
]);

/** Director inject actions (doc 14); the Director panel exposes the same list. */
export const INJECT_ACTIONS = injectEvents.map((e) => e.shape.action.value);
export type InjectAction = (typeof injectEvents)[number]['shape']['action']['value'];
/** Scripted driver actions (doc 14), excluding the reactive takeoverOnClassA. */
export const DRIVER_ACTIONS = driverEvents.map((e) => e.shape.action.value);

// ---------------------------------------------------------------------------
// Expectations (doc 14 "Expectations")
// ---------------------------------------------------------------------------

/** `after: "<anchor>+<seconds>"`; a bare anchor means +0 s (s12 uses `"mrm"`). */
export const AFTER_PATTERN = /^(classA|takeover|mrm)(?:\+(\d+(?:\.\d+)?))?$/;

/** Identifiers allowed in `trailDistanceFt.approxFormula`, e.g. "speedFtps*2.0*1.25". */
export const FORMULA_IDENTIFIERS = ['speedFtps', 'timeGapS', 'sizeFactor'] as const;
const FORMULA_PATTERN = new RegExp(
  `^(?:\\s|\\d|\\.|[*/+\\-()]|${FORMULA_IDENTIFIERS.join('|')})+$`,
);

const anchor = z
  .string()
  .regex(AFTER_PATTERN, 'anchor must be "<classA|takeover|mrm>[+<seconds>]"');
/** Window bound: sim seconds or an engine anchor (s04 uses `to: "classA"`; ISSUE-37). */
const windowBound = z.union([nonNeg, anchor]);

const timing = {
  /** SRS IDs verified. Empty only for setup checks (e.g. "engaged before the fault"; ISSUE-37). */
  reqs: z.array(ReqId),
  at: nonNeg.optional(),
  by: nonNeg.optional(),
  from: windowBound.optional(),
  to: windowBound.optional(),
  after: anchor.optional(),
  whenEgoSFt: nonNeg.optional(),
  whenEgoSFtAtLeast: nonNeg.optional(),
  whenHazardWithinFt: nonNeg.optional(),
  beforeSFt: nonNeg.optional(),
};

const ex = <C extends string, S extends z.ZodRawShape>(check: C, shape: S) =>
  z.strictObject({ check: z.literal(check), ...timing, ...shape });

const tolerance = { approx: z.number(), tol: nonNeg };

const expectationOptions = [
  ex('mode', { value: z.enum(enumValues(HfdsMode)) }),
  ex('notEngaged', {}),
  ex('available', { value: z.boolean() }),
  ex('lightBar', { value: z.enum(enumValues(LightBarState)) }),
  ex('hmi', {
    field: z.enum(HMI_FIELDS),
    value: z.unknown().optional(),
    valueIn: z.array(z.unknown()).min(1).optional(),
    nonEmpty: z.literal(true).optional(),
  }),
  ex('logged', {
    type: z.enum(enumValues(LogEntryType)),
    contains: z.string().min(1).optional(),
    code: z
      .string()
      .regex(/^E\d{3}$/)
      .optional(),
  }),
  ex('warningActive', { cls: zWarningClass, reason: z.enum(enumValues(WarningReason)).optional() }),
  ex('noWarningClass', { cls: zWarningClass }),
  ex('setSpeedMph', tolerance),
  ex('speedMph', tolerance),
  ex('accActive', { value: z.boolean() }),
  ex('lead', { vehicleId: z.number().int().positive().nullable() }),
  ex('zoneSeen', { sequence: z.array(z.enum(enumValues(FollowingZone))).min(1) }),
  ex('gapAtLeastTrail', { factor: pos }),
  ex('gapAboveCushion', {}),
  ex('trailDistanceFt', {
    approxFormula: z.string().regex(FORMULA_PATTERN, 'approxFormula uses an unknown identifier'),
    tol: nonNeg,
  }),
  ex('invariantInLane', {}),
  ex('targetOffsetNonZeroWhilePassing', { vehicleId: z.number().int().positive() }),
  ex('noAccelWhileRed', {}),
  ex('laneUnchangedUntilTakeover', {}),
  ex('laneDwellAtLeast', { seconds: pos }),
  ex('onShoulderStopped', {}),
  ex('stoppedInLane', { laneId }),
] as const;

export const EXPECTATION_CHECKS = expectationOptions.map((o) => o.shape.check.value);

const TRIGGER_KEYS = [
  'at',
  'by',
  'after',
  'whenEgoSFt',
  'whenEgoSFtAtLeast',
  'whenHazardWithinFt',
  'beforeSFt',
] as const;

export const ExpectationSchema = z
  .discriminatedUnion('check', expectationOptions)
  .superRefine((e, ctx) => {
    if ((e.from === undefined) !== (e.to === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'from and to must be given together' });
    }
    if (typeof e.from === 'number' && typeof e.to === 'number' && e.to < e.from) {
      ctx.addIssue({ code: 'custom', message: 'to must be >= from' });
    }
    const triggers =
      TRIGGER_KEYS.filter((k) => e[k] !== undefined).length + (e.from !== undefined ? 1 : 0);
    if (triggers > 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'use at most one of at / by / from+to / after / spatial trigger',
      });
    }
    if (e.check === 'hmi') {
      const forms = [e.value !== undefined, e.valueIn !== undefined, e.nonEmpty !== undefined];
      if (forms.filter(Boolean).length !== 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'hmi needs exactly one of value / valueIn / nonEmpty',
        });
      }
    }
  });

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export const ScenarioSchema = z
  .strictObject({
    id: kebabId,
    name: z.string().min(1),
    description: z.string().min(1),
    customerScenario: z.number().int().positive().nullable(), // Q-01
    sequenceDiagram: z.string().nullable(),
    optional: z.boolean(),
    requirements: z.array(ReqId),
    caption: z.strictObject({
      summary: z.string().min(1),
      steps: z.array(z.string().min(1)),
      watchFor: z.array(z.string().min(1)),
    }),
    seed: z.number().int().nonnegative(), // mulberry32 seed
    simDate: isoDate, // IR16 map-age reference date
    durationS: pos,
    vehicleConfig,
    map: lidarMap,
    road,
    environment: EnvironmentSchema,
    ego,
    driver: z.strictObject({ eyesOnRoad: z.boolean(), grip: gripState }),
    sensorOverrides: z.partialRecord(zSensorId, zSensorStatus),
    traffic: z.array(trafficVehicle),
    hazards: z.array(hazard),
    timeline: z.array(TimelineEventSchema),
    expect: z.array(ExpectationSchema),
  })
  .superRefine((s, ctx) => {
    const maxLane = s.road.travelLanes;
    const checkLane = (lane: number, path: (string | number)[]) => {
      if (lane > maxLane || (lane === 0 && !s.road.rightShoulder)) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: `laneId ${lane} does not exist on this road`,
        });
      }
    };
    checkLane(s.ego.laneId, ['ego', 'laneId']);
    s.traffic.forEach((v, i) => checkLane(v.laneId, ['traffic', i, 'laneId']));
    s.hazards.forEach((h, i) => checkLane(h.laneId, ['hazards', i, 'laneId']));
    const ids = s.traffic.map((v) => v.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['traffic'], message: 'traffic ids must be unique' });
    }
    s.timeline.forEach((e, i) => {
      if (e.t !== null && e.t > s.durationS) {
        ctx.addIssue({
          code: 'custom',
          path: ['timeline', i, 't'],
          message: 'event after durationS',
        });
      }
    });
  });

export type Scenario = z.infer<typeof ScenarioSchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export type Expectation = z.infer<typeof ExpectationSchema>;
export type ExpectationCheck = Expectation['check'];
export type VehicleConfig = Scenario['vehicleConfig'];
export type TrafficVehicleSpec = Scenario['traffic'][number];

// ---------------------------------------------------------------------------
// index.json
// ---------------------------------------------------------------------------

export const ScenarioIndexEntrySchema = z.strictObject({
  id: kebabId,
  name: z.string().min(1),
  customerScenario: z.number().int().positive().nullable(),
  optional: z.boolean(),
  file: z.string().regex(/^[a-z0-9-]+\.json$/),
});

export const ScenarioIndexSchema = z.strictObject({
  scenarios: z.array(ScenarioIndexEntrySchema).min(1),
});

export type ScenarioIndex = z.infer<typeof ScenarioIndexSchema>;
export type ScenarioIndexEntry = z.infer<typeof ScenarioIndexEntrySchema>;

/** Parse a preset, returning a readable multi-line error on failure. */
export function parseScenario(
  data: unknown,
): { ok: true; scenario: Scenario } | { ok: false; error: string } {
  const result = ScenarioSchema.safeParse(data);
  if (result.success) return { ok: true, scenario: result.data };
  return { ok: false, error: z.prettifyError(result.error) };
}
