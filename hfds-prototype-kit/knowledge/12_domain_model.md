# 12 — Domain Model → Engine Types

Source: SRS Section 4.3 domain-model figures (`diagrams/01`–`05`) and the Data Dictionary. The engine's classes and field names **must follow the SRS names** so code, tests, logs and the SRS read the same way. Where the SRS leaves a class empty or a type undefined, the proposed shape is marked **[proposed]** and also listed in `16_open_issues_and_assumptions.md`.

## Units convention (prototype)

The SRS mixes units (mph for speeds, ft and ft/s² for gaps and deceleration, meters for lane width, visibility and the 0.3 m redundancy tolerance). **Engine-internal units: feet, seconds, ft/s, ft/s².** Convert mph and meters only at the boundaries (scenario files, HMI display). Field names carry a unit suffix where it is not the internal unit (`speedMph`, `widthM`). 1 mph = 1.46667 ft/s; 1 m = 3.28084 ft.

## Subsystem composition

`HFDS` owns six subsystems (composition 1-to-1): **DriverAssistSystem** (which owns **SpeedManagement**), **DriverAttentionSystem**, **VehicleControl**, **HumanMachineInterface**, **PathPrediction**, **VehiclePosition**, plus **EventLog**. Supporting entities: Driver, Sensor, LiDARMap, Road, Lane, Environment, SurroundingVehicle, Hazard, Warning, ControlCommand, LogEntry, ErrorCode.

Note on duplication in the SRS: the DriverAssistSystem dictionary entry lists setSpeed, driverSelectedGap, minimumGap, currentZone, closingSpeed, maxBrakingDecel and the ACC operations, **and** SpeedManagement lists the same. In code, ACC state and operations live in `SpeedManagement`; DriverAssistSystem delegates to it (composition shown in diagram 03).

## Enumerations

| Enum | Values | Source |
|---|---|---|
| SubsystemStatus | OK, Degraded, Faulted | Diagram 05 |
| SensorType | Camera, DriverCamera, Radar, LiDAR, GPS, GripSensor | Data dictionary |
| SensorStatus | OK, Obstructed, Damaged, Failed | Data dictionary (IR5.6) |
| WeatherType | Clear, Rain, Sleet, Snow, Fog, Ice | Diagram 02 |
| LightCondition | Day, Night, LowAngleSun | Diagram 02 |
| RoadType | DividedHighway, Undivided, ServiceDrive | Diagram 02 |
| LaneType | Travel, Shoulder, ExitLane, ServiceDrive | Diagram 03 |
| VehicleSizeClass | Car, Truck, SemiTruck, Bus — **add SUV** (R6, R25 require it; ISSUE-06) | Diagram 03 |
| AlertLevel | First, Second, Final | Diagram 04 |
| FollowingZone | Closing, Coast, Safety | Data dictionary |
| WarningClass | A, B | R28 (dictionary says "e.g. Class B") |
| LightBarState **[proposed]** | Off, SolidGreen, FlashingGreen, PulsingBlue, FlashingRed | R33, R34 (no enum in SRS) |
| DisplayState **[proposed]** | see HFDS mode in `13_behavior_spec.md` | HMI.displayedState type undefined |
| AttentionLevel **[proposed]** | Engaged, Inattentive, Inactive | Driver dictionary ("engaged inattentive or inactive ect.") |
| EyeDirection **[proposed]** | OnRoad, OffRoad | Driver dictionary (enum, values unstated) |
| HeadPosition **[proposed]** | Forward, Turned, Down | Driver dictionary (enum, values unstated) |
| GapSetting **[proposed]** | Near = 2.0 s, Medium = 2.5 s, Far = 3.0 s | Driver.selectedGap (enum, values unstated; A-08) |
| HazardType **[proposed]** | Debris, Pothole, StoppedVehicle, Pedestrian | IR26 list |

## Classes

Attributes and operations are from the SRS. Return types in `()` were missing and are proposed.

### HFDS
Empty class in the SRS (orchestrator). **[proposed]** fields: `mode: HfdsMode` (state machine in doc 13), `vehicleConfig`, `timers` (cooldowns, takeover, alert), `reclaimHistory: number[]` (R41), `lockedUntilIgnition: boolean` (IR10), `startSequenceRemaining`, `pendingStopRequest` (R42), `lastButtonPressAt` (R43).

### DriverAssistSystem «subsystem»
Decision maker: combines position, blue path and surrounding vehicles; decides steer / accelerate / brake.
- Attributes: `status: SubsystemStatus`, `trackedVehicles: SurroundingVehicle[]`, `leadVehicle: SurroundingVehicle | null`, `leadGap: float`, `closingSpeed: float`, `bluePath: Point[]`, `pathCurvature: float[]`, `pathConfidence: float (0..1)`, `lateralOffset: float`, `targetOffset: float`; ACC fields via SpeedManagement.
- Operations: `analyzeSurroundings()`, `classifyVehicle(v): VehicleSizeClass`, `gatherConditions(): Environment`, `validateEngagement(): boolean`, `isPathValid(): boolean`, `keepLaneCentered(): ControlCommand`, `navigateCurve(): ControlCommand`, `resumeAfterDriverSteering()`, `selectLeadVehicle(): SurroundingVehicle`, `computeTrailDistance(speed): float`, `updateZone(): FollowingZone`, `holdSpeed()`, `coastToMatchLead()`, `brakeForClosingSpeed(): boolean`, `resumeSetSpeed()`, `cancelCruise()`, `detectLaneIntrusion(): SurroundingVehicle`, `detectHazard(): Hazard`, `sendCommand(cmd)`, `raiseError(code)`.
- Relationships: receives blue path from PathPrediction; uses VehiclePosition; tracks 0..* SurroundingVehicle, 0..1 as "lead"; detects 0..* Hazard; reads Environment; creates ControlCommands sent to 1 VehicleControl.
- Constraints: `trailDistance >= max(driverSelectedGap, minimumGap) × speed` (IR9); no acceleration while `HMI.lightBarStatus = FlashingRed` (IR12); lane position from ≥ 2 independent sources (SR4.1); lead gap from ≥ 2 independent sources (SR4.2).

### SpeedManagement (part of DriverAssistSystem)
- Attributes: `setSpeed: float (mph)`, `driverSelectedGap: float (s)`, `minimumGap: float = 2.0`, `currentZone: FollowingZone`, `closingSpeed: float`, `maxBrakingDecel: float`.
- Operations: `computeTrailDistance(speed, lead): float`, `updateZone(gap): FollowingZone`, `holdSpeed(): ControlCommand`, `coastToMatchLead(): ControlCommand`, `brakeForClosingSpeed(): boolean`, `resumeSetSpeed(): ControlCommand`, `cancelCruise()`.
- Relationships: reads 0..1 lead SurroundingVehicle; uses the Driver's selected gap; produces ControlCommands via DriverAssistSystem; causes a reclaim Warning when braking is insufficient.

### DriverAttentionSystem «subsystem» (DATS)
- Attributes: `eyesOnRoad: boolean`, `headPosition: Vector3`, `inattentionDuration: float (s)`, `cameraTamperDetected: boolean`, `status: SubsystemStatus`.
- Operations: `monitorDriver(d)`, `isDriverEngaged(): boolean`, `escalateAlert(): AlertLevel`, `cancelAlert()`, `markDriverInactive(d)`, `detectTampering(): boolean`.
- Relationships: monitors 1 Driver; uses 1 driver-facing Sensor (DriverCamera); issues Class B Warnings; raises ErrorCodes.
- Constraint: `status = Faulted` ⇒ HFDS hands control to the driver (SR5).

### VehicleControl
- Attributes: `status: SubsystemStatus`, `currentSpeed: float (mph)`, `currentAcceleration: float (ft/s²)`, `currentSteeringAngle: float (deg)`, `driverBrakeApplied: boolean`.
- Operations: `steer(angle)`, `accelerate(rate)`, `brake(rate)`, `applyPhantomBrake()`, `detectDriverBraking(): boolean`, `detectDriverSteering(): boolean`, `getVehicleState(): VehicleState`.
- Relationships: receives ControlCommands from DriverAssistSystem; provides VehicleState; reports driver brake and steering inputs.
- Prototype: owns the ego kinematic model and arbitrates driver input over HFDS commands (IR25).

### HumanMachineInterface
- Attributes: `displayedState: DisplayState`, `displayedMessage: string`, `activeWarnings: Warning[]`, `lightBarStatus: LightBarState`.
- Operations: `updateDisplay()`, `displayWarning(w)`, `removeWarning(w)`.
- **[proposed]** extra output fields so the UI can show every required channel: `availableIndicator: boolean` (IR6), `hudMessage?: string` (R16.2), `seatVibration: 'off'|'pulse'|'continuous'`, `audibleAlert: boolean`, `voicePrompt?: string`, `controlTransferBanner?: string` (R40), `hazardLights: boolean`, `onStar: 'idle'|'connecting'|'connected'`, `doorsUnlocked: boolean`, `fcsMode: 'AlertAndBrake'|'Default'` (IR22), `updateNeeded: boolean` (IR16).

### PathPrediction «subsystem»
- Attributes: `status: SubsystemStatus`, `lastCalculated: DateTime`.
- Operations: `calculateBluePath(pos: Position, map: LiDARMap): Point[]`, `raiseError(code)`.

### VehiclePosition
- Attributes: `status`, `currentPosition: Vector3`, `currentLane: int`, `positionValid: boolean`.
- Operations: `validatePosition(): boolean`, `updatePosition()`, `getPosition(): Vector`.
- Prototype: holds per-source estimates (camera, LiDAR-map+GPS) so SR4.1 and the 0.3 m agreement check (IR5.8) can be simulated.

### Sensor
- Attributes: `sensorId: string`, `type: SensorType`, `status: SensorStatus`, `lastReading: SensorData`.
- Operations: `read(): SensorData`, `selfTest(): boolean`, `raiseError(code)`.
- Prototype default sensor set **[proposed]**: `CAM_FRONT` (Camera), `CAM_REAR` (Camera), `CAM_DRIVER` (DriverCamera), `RADAR_FRONT` (Radar), `LIDAR_1` (LiDAR), `GPS_1` (GPS), `GRIP_L`, `GRIP_R`, `GRIP_TOP`, `GRIP_BOTTOM` (GripSensor ×4 sensing areas; R35 needs ≥ 2).

### LiDARMap
- Attributes: `version: string`, `lastUpdated: Date`, `enabledRoads: Road[]`.
- Operations: `isOutdated(): boolean` (> 7 months, IR16), `isEnabled(road): boolean` (IR1), `detectMismatch(sensed: Environment, hazards: Hazard[]): boolean` (R10), `applyUpdate(update: MapUpdate)` (R11).

### Road
- Attributes: `roadType: RoadType`, `isConstructionZone: boolean`, `isTunnel: boolean`, `speedLimit: float`.
- Operations: `getLanes(): Lane[]`. Composed of 1..* Lane.

### Lane
- Attributes: `laneId: int`, `width: float (m)`, `leftMarkingVisible: boolean`, `rightMarkingVisible: boolean`, `laneType: LaneType`.
- Operations: `bothMarkingsVisible(): boolean` (IR2). Contains 0..* Hazard.

### Environment (Road Conditions)
- Attributes: `weather: WeatherType`, `lightCondition: LightCondition`, `roadMoisture: float`, `visibility: float (m)`.
- Operations: `isWithinODD(): boolean` (IR5.1, IR5.4). ODD thresholds are not given — see A-10.

### SurroundingVehicle
- Attributes: `vehicleId: int`, `sizeClass: VehicleSizeClass`, `laneId: int`, `relativePosition: Vector3`, `distance: float`, `relativeSpeed: float`, `lateralVelocity: float`. **[proposed]** add `length`, `width`, `relativeAcceleration` (R7, R8).
- Operations: `isInLane(lane): boolean`, `isEnteringLane(lane): boolean`, `updateTrack(data: SensorData)`.

### Driver
- Attributes: `attentionLevel: AttentionLevel`, `headPosition: HeadPosition`, `eyeDirection: EyeDirection`, `brakePressed: boolean`, `steeringInput: float`, `throttleInput: float`, `selectedGap: GapSetting`.
- Operations: `requestHFDS(enable: boolean)`, `setFollowGap(gap: GapSetting)`, `applyBrake()`, `steer(input: float)`, `hitGas(input: float)`.
- Prototype: the Driver panel and keyboard produce these inputs. **[proposed]** add `gripAreas: Record<'L'|'R'|'TOP'|'BOTTOM', boolean>` for R35.

### Warning
- Attributes: `warningClass: WarningClass`, `level: AlertLevel`, `message: string`, `issuedAt: DateTime`, `isActive: boolean`.
- Operations: `issue()`, `escalate(): AlertLevel`, `cancel()`.
- Relationships: issued by DATS (Class B) and DriverAssistSystem (reclaim, Class A); shown to Driver; Final alert triggers `VehicleControl.applyPhantomBrake()`; logged by EventLog.
- **[proposed]** add `id`, `reason` (e.g. `HAZARD_IN_LANE`, `BRAKING_INSUFFICIENT`, `SENSOR_FAULT`, `MAP_MISMATCH`, `CURVE_TOO_SHARP`, `ODD_EXIT`, `DATS_LOSS`, `ATTENTION_LOSS`, `UPDATE_NEEDED`), `reqs: string[]`.

### EventLog
- Attributes: `status`, `entries: LogEntry[]`, `capacity: int`.
- Operations: `logEvent(entry)`, `logDisengagement()`, `logTakeoverRequest()`, `exportLog(): LogFile`, `logError(code: ErrorCode)`.
- Constraint: every entry has a timestamp.

### Classes the SRS names but leaves empty — [proposed] shapes

| Class | Proposed fields |
|---|---|
| ControlCommand | `kind: 'steer'|'accelerate'|'brake'|'coast'|'phantomBrake'`, `value: number` (deg or ft/s²), `source: 'DriverAssistSystem'|'Driver'|'External'`, `authenticated: boolean` (IR18/IR19), `reqs: string[]` |
| Hazard | `id`, `type: HazardType`, `laneId`, `s` (distance along road, ft), `detectedAt` |
| LogEntry | `t` (sim seconds), `wallTime?`, `type: 'engagement'|'disengagement'|'warning'|'error'|'takeover_request'|'info'`, `source` (class name), `message`, `reqs: string[]`, `data?` |
| ErrorCode | `code: string`, `description: string`, `severity: 0..100`, `band: 'low'|'middle'|'high'` (R37.2), `sensor?: {sensorId, type, status, lastReadingAt}` (IR29b), `raisedAt`, `clearedAt?` |
| VehicleState | `speed` (ft/s), `acceleration`, `steeringAngle`, `s`, `lateral`, `laneId`, `heading` |
| Position / Point / Vector3 | `{x, y, z}` in feet in road frame (`x` = along-road distance s, `y` = lateral offset from road reference line) |
| SensorData | `sensorId`, `t`, `ok`, `payload` (type-specific) |
| MapUpdate | `version`, `lastUpdated` |
| LogFile | JSON blob `{scenarioId, seed, entries}` downloadable from the HMI |

## Where each class lives in the repo

| Class | File |
|---|---|
| HFDS (orchestrator, mode machine) | `src/engine/hfds/hfds.ts` |
| DriverAssistSystem, SpeedManagement | `src/engine/hfds/driver-assist.ts`, `src/engine/hfds/speed-management.ts` |
| DriverAttentionSystem | `src/engine/hfds/driver-attention.ts` |
| VehicleControl | `src/engine/hfds/vehicle-control.ts` |
| HumanMachineInterface (state only, no DOM) | `src/engine/hfds/hmi.ts` |
| PathPrediction, VehiclePosition, LiDARMap | `src/engine/hfds/path-prediction.ts`, `vehicle-position.ts`, `src/engine/world/lidar-map.ts` |
| Sensor, ErrorCode catalog | `src/engine/hfds/sensors.ts`, `src/engine/hfds/error-codes.ts` |
| EventLog, Warning | `src/engine/hfds/event-log.ts`, `src/engine/hfds/warning.ts` |
| Road, Lane, Environment, SurroundingVehicle, Hazard, Driver | `src/engine/world/*.ts` |
| Enums + all shared types | `src/shared/domain.ts` |
| Constants | `src/shared/constants.ts` (single source; see doc 13) |

The HMI *rendering* lives in `src/client/ui/`; the engine only produces HMI *state*.
