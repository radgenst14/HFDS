# 14 — Preset Scenarios and Scenario Schema

Scenarios are **data, not code** (tech stack doc): one JSON file per preset in `public/scenarios/`, listed in `index.json`. Draft presets for all 20 scenarios are in `scenarios/` in this kit; copy them into the repo and adjust them to the final schema.

Each scenario serves three purposes:
1. **Demo** — selectable from the picker, linkable with `#scenario=<id>`, with a caption panel (summary, steps, what to watch for). The captions satisfy the Prototype v1 "interfaces with descriptive captions" expectation.
2. **Script** — a timeline of scripted driver actions and Director injections, so the scenario plays out by itself. The user can also pause and take over the Driver panel at any time.
3. **Acceptance test** — an `expect` list that Vitest runs headlessly against the engine (`tests/engine/scenarios.test.ts`), tagged with SRS IDs.

> **Timing caveat.** Times and distances in the drafts were computed by hand from the formulas in doc 13. They state the *intent*. After the engine exists, run each scenario, then tune positions and speeds (not the expectations' requirement logic) until the expectations pass. Never loosen an expectation that encodes an SRS number (30 s, 5 s, 2 s, 0.5 s, 20 s, 30 s buffer, 85 mph, 3 mph, 2.0 s gap).

## Customer scenarios

The SRS cites **Scenario 1** (activation, SD 4.3.1) and **Scenario 4** (driver brakes, SD 4.3.8). The full customer list is not in the SRS (Q-01). Until it is added, `customerScenario` is set only on S01 and S13. When the list arrives, map every customer scenario to a preset (add presets if needed) — **every customer scenario must have a preset** (course requirement for v1 and v2).

## Scenario catalog

| ID | Name | Seq. diagram | Main requirements | Customer # |
|---|---|---|---|---|
| s00 | Sandbox — free drive | — | any | — |
| s01 | Activate HFDS on a supported highway | SD1 | R12, R14, R15, R17, R33, R43, R47, R48, IR6, IR7, IR22, IR28 | 1 |
| s02 | Activation rejected: outdated LiDAR map | SD5 | R11, R16, R49, IR16 | — |
| s03 | Activation rejected: outside the ODD (rain) | — | R13, R15.1, R16, R49, IR5.4 (+ Director variants IR5.1, IR5.2, IR5.5, IR8, IR28) | — |
| s04 | Lane keeping: curves, a passing semi, a too-sharp curve | SD2 | R2, R3, R18–R20, R6, R8, UC9, UC12 | — |
| s05 | Follow a lead vehicle: closing, coast, match, resume, truck | SD3 | R4, R5, R21, R24, R25, IR9, IR27 | — |
| s06 | Cut-ins: brake within capability, then reclaim warning | SD3 (brake branch) | UC11, UC14, R22, R23, IR12, IR15 | — |
| s07 | Sensor faults covered by redundant sources | SD4 (above threshold) | R9, R37, SR4, SR4.4, IR29b | — |
| s08 | Sensor fault without redundancy: takeover, re-engagement | SD4 (below threshold) | SR3, IR14, IR24, R35, R38.2, R40 | — |
| s09 | Driver ignores every attention warning → shoulder stop | SD6 | R27–R31, R36, IR10–IR12, SR1, SR6 | — |
| s10 | Driver looks back during the second alert | SD6 (variant) | R29, R30, R32 | — |
| s11 | Road hazard: driver takes over | SD7 | UC10, IR26, IR12, IR13, R38.4, R40 | — |
| s12 | Takeover request ignored → stop in lane | SD7 (no response) | IR2, IR14, SR7, SR1.1 | — |
| s13 | Driver brakes to regain control | SD8 | R50, IR15, IR25 | 4 |
| s14 | Driver steers briefly, HFDS resumes | — | R39, R34.2, R35 | — |
| s15 | Three reclaim requests in five minutes | — | R41 | — |
| s16 | Unmapped construction zone (map mismatch) | — | R10, IR5.2, IR14 | — |
| s17 | Driver camera tampered with | — | SR2, SR5, IR23 | — |
| s18 | Collision / airbag → OnStar (optional) | — | SR8 | — |
| s19 | Unauthorized external command rejected (optional) | — | IR18, IR19, IR21, SR9 | — |

**Coverage rule:** every requirement with treatment SIM, HMI or LOG in `10_requirements_catalog.md` must appear in at least one scenario's `requirements` or in a unit test tag. A script (`scripts/trace-matrix.ts`) builds the requirement → scenario/test matrix for the SRS appendix and fails CI if a SIM requirement has no test.

## Scenario schema (proposed — implement as Zod in `src/shared/scenario-schema.ts`)

```ts
type Scenario = {
  id: string;                       // kebab-case, matches file name
  name: string;
  description: string;
  customerScenario: number | null;  // customer's scenario number, if any
  sequenceDiagram: string | null;   // e.g. "SD1 (4.3.1)"
  optional: boolean;                // true = not required for grading
  requirements: string[];           // SRS IDs this scenario demonstrates
  caption: { summary: string; steps: string[]; watchFor: string[] };
  seed: number;                     // seeded PRNG (mulberry32)
  simDate: string;                  // ISO date used for map-age checks (IR16)
  durationS: number;
  vehicleConfig: {
    maxBrakingDecelFtps2: number;   // site adaptation, default 11.5
    forwardSensorRangeFt: number;   // R4.2, default 800 (A-04)
    hasHUD: boolean;                // R16.2
    hasLightBar: boolean;           // R16.3
    secondAlertMode: 'chime' | 'seat';  // R30.2 "audible alert or vibrate the seat"
    trailerAttached: boolean; trailerCapable: boolean;   // IR5.5
  };
  map: { version: string; lastUpdated: string; enabled: boolean };   // LiDARMap
  road: {
    roadType: 'DividedHighway' | 'Undivided' | 'ServiceDrive';
    lengthFt: number;
    travelLanes: number;            // lane IDs: 0 = right shoulder, 1 = rightmost travel lane … n = leftmost
    laneWidthM: number;
    rightShoulder: boolean;
    medianBarrier: boolean;
    segments: Array<{
      fromFt: number; toFt: number;
      curvatureRadiusFt?: number; direction?: 'left' | 'right';
      constructionZone?: boolean; tunnel?: boolean;
      inMap?: boolean;              // false = present in world, missing from LiDAR map (R10)
      markings?: { left: boolean; right: boolean };   // IR2
      enabledForHfds?: boolean;     // IR1 / UC17 end of enabled road
      roadType?: string;            // e.g. exit lane or service drive segments (IR5.3)
    }>;
  };
  environment: { weather: WeatherType; lightCondition: LightCondition; roadMoisture: number; visibilityM: number };
  ego: { laneId: number; speedMph: number; setSpeedMph: number | null; gapSetting: 'Near' | 'Medium' | 'Far' };
  driver: { eyesOnRoad: boolean; grip: { L: boolean; R: boolean; TOP: boolean; BOTTOM: boolean } };
  sensorOverrides: Record<string, SensorStatus>;   // initial sensor states
  traffic: Array<{
    id: number; sizeClass: VehicleSizeClass; laneId: number;
    sFt: number;                    // initial position relative to ego (+ = ahead), front-to-front
    speedMph: number;
    behavior?: Array<
      | { t: number; action: 'setSpeed'; speedMph: number; decelFtps2?: number; accelFtps2?: number }   // default 5 ft/s²
      | { t: number; action: 'changeLane'; toLaneId: number; durationS: number }
      | { t: number; action: 'brakeHard'; decelFtps2: number; durationS: number }                       // IR8.1
    >;
  }>;
  hazards: Array<{ id: number; type: HazardType; laneId: number; sFt: number }>;  // absolute along road
  timeline: Array<TimelineEvent>;
  expect: Array<Expectation>;
};
```

### Timeline events

`{ t, kind, action, args }`, applied at the first tick with `simTime ≥ t`. `t: null` means "reactive" (see `takeoverOnClassA`).

| kind | action | args | Meaning |
|---|---|---|---|
| driver | `pressHfdsButton` | — | Driver presses the HFDS button (IR7, R12) |
| driver | `setBrake` | `pressed`, `rate` (ft/s²) | Brake pedal (IR15, R50) |
| driver | `setThrottle` | `value` 0..1 | Throttle (IR25) |
| driver | `setSteer` | `value` −1..1 | Steering input (R39, IR25) |
| driver | `setGrip` | `L, R, TOP, BOTTOM` booleans | Grip sensing areas (R35) |
| driver | `setGaze` | `eyesOnRoad` | DATS input (R27) |
| driver | `setGap` | `gapSetting` | Following gap (Driver.setFollowGap) |
| driver | `setSpeed` | `mph` | ACC set speed, capped at 85 (IR27) |
| driver | `takeoverOnClassA` | `delayS`, `grip[]`, `steer?`, `steerToLaneId?` | Reactive: `delayS` after any Class A, grip the listed areas (and steer / change lane) |
| inject | `failSensor` | `sensorId`, `status` | Sensor fault (R9, IR5.6) |
| inject | `clearAllFaults` / `clearFault` | `code?` | Faults clear (R38) |
| inject | `setEnvironment` | any Environment fields | Weather/light changes (R13, IR5.1, IR5.4) |
| inject | `applyMapUpdate` | `version`, `lastUpdated` | Map download (R11) |
| inject | `staleGpsCorrection` | `ageS` | IR5.8 |
| inject | `dropLaneMarkings` | `durationS` | IR2 |
| inject | `spawnHazard` | `type`, `laneId`, `aheadFt` | IR26 |
| inject | `tamperDriverCamera` | — | SR2 |
| inject | `corruptControlProcess` | — | R44 |
| inject | `primaryComputeFailure` | — | SR4.3 |
| inject | `fcwEscalation` | — | IR5.10 |
| inject | `collision` | `airbag` | SR8 |
| inject | `externalCommand` | `kind`, `value`, `authenticated` | IR18, IR19 |
| inject | `ignitionCycle` | — | IR10 |
| inject | `setTrailer` | `attached`, `capable?` | IR5.5 |
| inject | `setEgoLane` | `laneId` (0 = shoulder) or `laneType` (`ExitLane`, `ServiceDrive`) | IR5.3 |
| inject | `setRoadFlags` | `constructionZone?`, `tunnel?`, `enabledForHfds?` | IR5.2, IR1 |
| inject | `mapError` / `gpsError` | — | IR5.7 |
| inject | `trafficHardBrake` | `vehicleId`, `decelFtps2`, `durationS` | IR8.1 |
| inject | `trafficErraticAccel` | `vehicleId` | IR8.2 |
| inject | `trafficTailgateGap` | `vehicleId`, `headwayS` | IR8.3 |
| inject | `setSubsystemFlag` | `name` (`motionForecasting`, `selfSupervision`, `dynamicEnvironment`, `positioningDataService`), `ok` | IR5.9, IR17 |
| note | — | `text` | Caption marker shown on the timeline |

The Director panel exposes the same `inject` actions as buttons, so every scripted event can also be triggered by hand.

### Expectations

`{ check, reqs, at? | by? | from?+to? | after?, ...args }`

- `at: t` — holds at the tick nearest `t` (± 1 tick).
- `by: t` — becomes true at some tick ≤ `t` (and the assertion records when).
- `from` / `to` — holds at every tick in the interval.
- `after: "<anchor>+<seconds>"` — relative to an engine-recorded anchor: `classA` (first Class A warning), `takeover`, `mrm`.
- Some checks use a spatial trigger instead of a time (`whenEgoSFt`, `whenEgoSFtAtLeast`, `whenHazardWithinFt`, `beforeSFt`).

| check | args | Passes when |
|---|---|---|
| `mode` | `value` | HFDS mode equals value (`UNAVAILABLE`, `AVAILABLE`, `STARTING`, `HANDS_FREE`, `DRIVER_STEERING`, `ALERT_FIRST`, `ALERT_SECOND`, `ALERT_FINAL`, `TAKEOVER_REQUESTED`, `MINIMAL_RISK_MANEUVER`, `STOPPED_LOCKOUT`) |
| `available` | `value` | IR6 indicator equals value |
| `lightBar` | `value` | LightBarState equals value |
| `hmi` | `field`, `value` / `valueIn` / `nonEmpty` | HMI state field |
| `logged` | `type`, `contains?`, `code?` | Event log has a matching entry |
| `warningActive` | `cls`, `reason?` | Active warning of that class (and reason) |
| `noWarningClass` | `cls` | No active warning of that class |
| `setSpeedMph`, `speedMph` | `approx`, `tol` | Within tolerance |
| `accActive` | `value` | ACC on/off |
| `lead` | `vehicleId` | Lead vehicle id |
| `zoneSeen` | `sequence` | Zones observed in order |
| `gapAtLeastTrail` | `factor` | gap ≥ factor × trailDistance |
| `gapAboveCushion` | — | gap > safetyCushion |
| `trailDistanceFt` | `approxFormula`, `tol` | Trail distance matches R25 |
| `invariantInLane` | — | R18 lateral containment |
| `targetOffsetNonZeroWhilePassing` | `vehicleId` | UC12 offset applied while beside that vehicle |
| `noAccelWhileRed` | — | IR12 for the whole run |
| `laneUnchangedUntilTakeover` | — | HFDS made no lane change (IR26) |
| `laneDwellAtLeast` | `seconds` | SR1.1.2 lane dwell during MRM |
| `onShoulderStopped` | — | Speed 0 on lane 0 |
| `stoppedInLane` | `laneId` | Speed 0 in that lane |

Note on `mode = UNAVAILABLE` after a disengagement: the engine reports `AVAILABLE` only when IR6 holds. Immediately after a takeover, cooldowns make it `UNAVAILABLE`; tests that just mean "no longer engaged" may use a helper `notEngaged`. Add it if useful.

**Global invariants checked in every scenario run** (no need to list them): IR11, IR12, IR27, R18 while engaged, R45 timestamps, determinism (run twice → identical final state hash).
