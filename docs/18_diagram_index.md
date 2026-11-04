# 18 — Diagram Index and Transcriptions

All figures were extracted from the SRS and placed on a white background in `diagrams/`. The sequence diagrams are low resolution (624 px wide) in the source document; the transcriptions below were read from upscaled copies and cross-checked against the SRS prose. Where a label could not be read reliably, it says so. **If a transcription disagrees with Section 3 requirements, the requirements win** (and the disagreement is in doc 16).

| File | SRS figure |
|---|---|
| `00_fig4-1_use_case_diagram.png` | Figure 4.1 — HFDS use case diagram |
| `01_domain_model_hfds_subsystems.png` | Domain Model — HFDS & Subsystems (transparent original; lines may be faint) |
| `02_domain_model_sensors_environment.png` | Domain Model — Sensors (VehiclePosition, Sensor, LiDARMap, Environment, Road + enums) |
| `03_domain_model_driver_assist_vehicle_control.png` | Domain Model — Driver Assist & Vehicle Control (SpeedManagement, ControlCommand, Hazard, SurroundingVehicle, Lane + enums) |
| `04_domain_model_warning.png` | Domain Model — Warning (+ AlertLevel) |
| `05_domain_model_event_log.png` | Domain Model — Event (EventLog, LogEntry, SubsystemStatus) |
| `06_sd1_activating_hfds.png` | Figure 1 — Activating HFDS |
| `07_sd2_lane_keeping.png` | Figure 2 — Lane Keeping |
| `08_sd3_following_lead_vehicle.png` | Figure 3 — Following a Lead Vehicle |
| `09_sd4_sensor_failure.png` | Figure 4 — Sensor Failure |
| `10_sd5_activation_rejected_outdated_map.png` | Figure 5 — Cannot activate HFDS because of outdated map |
| `11_sd6_driver_inattention.png` | Figure 6 — Driver Ignores Every Warning |
| `12_sd7_road_hazard_takeover.png` | Figure 7 — Road Hazard Requires Driver to Takeover |
| `13_sd8_driver_brakes_to_disengage.png` | Figure 8 — Driver Presses the Brake to Disengage |

Domain-model content is fully captured in `12_domain_model.md`; the use case diagram in `11_srs_overview_and_use_cases.md`.

---

## SD1 — Activating HFDS (customer Scenario 1) · R14, R15, R47, R48, R49
Lifelines: Driver, das: DriverAssistSystem, sens: Sensor, pos: VehiclePosition, map: LiDARMap, vc: VehicleControl, hmi: HumanMachineInterface.
1. Driver → das: `requestActivation()`
2. das → sens: `checkSensorStatus()` ; sens → das: `sensorStatus`
3. das → pos: `getPosition()` ; pos → das: `currentPosition`
4. das → map: `validateMap(currentPosition)` ; map → das: `mapValid`
5. das → vc: `checkActivationConditions()` ; vc → das: `conditionsMet`
6. **alt** [all valid]: das → vc: `engageHFD()` ; vc → das: `engagementConfirmed` ; → hmi: `displayHFDSActive()` (and logged per SRS prose)
   **else**: das → hmi: `displayActivationWarning()` ; das → Driver: `activationRejected`

Note: SRS prose says "Vehicle Control System validating current position with LiDAR map" but the diagram sends `validateMap` from DriverAssistSystem. Behavior is the same for the prototype.

## SD2 — Lane Keeping · R2, R3, R18, R19, R20
Lifelines: das, cam: Sensor, pos: VehiclePosition, path: PathPrediction, vc: VehicleControl, hmi.
1. das: `analyzeSurroundings()`
2. **loop** [HFDS engaged]: das → cam `read()` → `SensorData`; das → pos `getPosition()` → `currentPosition`; das → path `calculateBluePath(pos, map)` → `bluePath`; das: `isPathValid()`
   - **alt** [isPathValid() = true]: das: `keepLaneCentered()` ; das → vc: `steer(angle)`
   - [else]: das → hmi: `displayWarning(warning)` (prototype: Class A per IR14)

## SD3 — Following a Lead Vehicle · R4, R5, R21–R25, IR9
Lifelines: das, sens: Sensor, lead: SurroundingVehicle, vc: VehicleControl, hmi. Precondition: HFDS engaged and ACC active.
**loop** [HFDS engaged and ACC active]:
1. das → sens `read()` → `data: SensorData`; das → lead `updateTrack(data)`
2. das: `classifyVehicle(v)` → VehicleSizeClass (Car, Truck, SemiTruck, Bus); `selectLeadVehicle()` → `leadVehicle: SurroundingVehicle`
3. das → vc `getVehicleState()` → `vehicleState.currentSpeed`
4. das: `computeTrailDistance(speed)`; `updateZone()` → `currentZone: FollowingZone`
   Note on diagram: trail distance is at least the larger of driverSelectedGap and minimumGap (2.0 s) times speed; larger when the lead is a Truck, SemiTruck or Bus.
5. **alt**
   - [currentZone is Closing]: `holdSpeed()` → das → vc `accelerate(0)` (note: rate = 0, coast to match the lead speed before the safety zone; R21)
   - [currentZone is Coast]: `coastToMatchLead()` → das → vc `accelerate(rate)`
   - [currentZone is Safety]: `brakeForClosingSpeed()`; [closingSpeed within maxBrakingDecel] → das → vc `brake(rate)`; note: otherwise "Forward emergency braking system enabled (IR22)"
6. **opt** [lead vehicle left our lane]: das → lead `isInLane(lane)` → `false`; das: `resumeSetSpeed()` (note: rate moves the car to set speed, never above the 85 mph maximum, IR27) → vc `accelerate(rate)`
7. das → hmi: `updateDisplay()`

Labels in this diagram are small; the step list above combines the legible labels with the SRS prose for 4.3.3.

## SD4 — Sensor Failure · R9, R37, R38, SR1, SR4, IR10
Lifelines: Driver, Human Machine Interface, HFDS, Driver Assist System, Sensors (Camera/Radar/LiDAR), Vehicle Control System.
1. Sensors → DAS: `sensor-data (degraded)`; DAS: `check-sensor-health`
2. DAS → HFDS: `sensor-fault-detected`; HFDS: `record-error-code(severity)`; HFDS: `log-fault(timestamp)`
3. HFDS → DAS: `evaluate-system-confidence` → `confidence-level`
4. **alt**
   - [confidence above threshold]: HFDS → DAS `switch-to-redundant-source`; DAS → VCS `continue-lane-centering`; HFDS → HMI `show-solid-green` (SR4.4)
   - [confidence below threshold]: DAS → VCS `hold-lane-and-coast (no acceleration)`; HFDS → HMI `red-warning`; HMI → Driver `flash red, "System will disengage, take control immediately"`
     - **alt** [driver takes control within the takeover window]: Driver → HMI `grip-wheel`; HMI → HFDS `takeover-detected`; HFDS → VCS `return-control-to-driver`; HFDS → HMI `announce-control-transfer`; HMI → Driver `display-driver-in-control`; HFDS: `evaluate-reengagement(error-score)` (R38)
     - [no takeover within the window]: HFDS → HMI `disengage (driver control overrides)`; HFDS → VCS `slow-controlled-stop toward shoulder if applicable`; HFDS → VCS `hazards-on`; HFDS `alert-responders`; HFDS → HMI `HFDS-unavailable-until-next-ignition` (IR10)

The takeover-window label is not legible in the source (it may read "3 s"); SR7 says 30 s — use 30 s (ISSUE-18). The red-warning message in this diagram ("System will disengage, take control immediately") differs from UC19's "Take steering control immediately." — use UC19's string for Class A.

## SD5 — Activation Rejected for an Outdated Map · R10, R49, IR16
Lifelines: Driver, DriverAssistSystem, LiDARMap, Warning, HumanMachineInterface.
1. Driver: `Request-HFDS`; Driver → DAS: `Validate-Engagement`
2. DAS → LiDARMap: `Is-Outdated` → `true`
3. → Warning: `Issue-Warning`; DAS → HMI: `Display-Warning`
4. DAS → Driver: `false (engagement rejected)`

## SD6 — Driver Inattention (driver ignores every warning) · R27–R31, R36, SR1, SR6, IR12
Lifelines: d: Driver, dats: DriverAttentionSystem, w: Warning, hmi: HumanMachineInterface, das: DriverAssistSystem, vc: VehicleControl, log: EventLog.
1. **loop** [HFDS engaged]: dats `monitorDriver(d)`
2. dats `isDriverEngaged()` → false (eyesOnRoad = false)
3. dats → w `issue()` (note: Warning class B, level = First, msg = "Pay attention to the Road", isActive = true); w → hmi `displayWarning(warning)`; w → log `logEvent(entry)`; hmi → d: lightBarStatus = flashing green, displayedMessage = "Pay attention to the Road"
4. Note: no response within FIRST_ALERT = 30 seconds → dats `escalateAlert()`; dats → w `escalate()` (note: level 2, "take steering control immediately"); w → hmi `displayWarning`; hmi → d: lightBarStatus = flashing red, displayedMessage = steering control alert, driver seat vibration or sound (R30); das → vc `accelerate(0)` (note: rate = 0, hardware interlocks inhibit acceleration while the light bar is flashing red)
5. Note: no response within SECOND_ALERT = 5 seconds → dats `escalateAlert()`; dats → w `escalate()` (level = FINAL); w → hmi `displayWarning`; hmi → d: driver seat keeps vibrating and voice prompt to take control (R31); w → vc `applyPhantomBrake()`
6. Note: no response within FINAL_ALERT = 2 seconds → dats `markDriverInactive(d)` (attentionLevel = inactive, R36); dats → das `driverInactive`; das → log `logDisengagement()`; das → hmi `updateDisplay()`; hmi → d: driver inactive, hazard lights = true (SR1)
7. Note: Driver ignores every warning (SR6).

The diagram ends with hazards on; the shoulder/in-lane stop, OnStar and door unlock come from SR1 (and SD4's no-takeover branch).

## SD7 — Road Hazard Requires Driver Takeover · R28, R38, R40, SR1, SR7, IR12, IR13, IR26
Lifelines: d: Driver, cam: Sensor, das: DriverAssistSystem, w: Warning, hmi, vc: VehicleControl, log: EventLog.
1. **loop** [HFDS engaged]: das → cam `read()` → `SensorData`; das `detectHazard()` → `hazard`
2. Note: HFDS hands the hazard to the driver instead of avoiding it (IR26).
3. das → w `issue()` (note: warningClass = Class A, message = "Take steering control immediately", isActive = true); w → hmi `displayWarning(warning)`; w → log `logEvent(entry)`; hmi → d: lightBarStatus = flashing red, displayedMessage = "Take steering control immediately"
4. das `keepLaneCentered()` → `ControlCommand`; note: angle follows blue path, the vehicle stays in its lane; das → vc `steer(angle)`; das → vc `accelerate(0)` (note: rate = 0, no acceleration while the light bar is flashing red, IR12, IR13); das → log `logTakeoverRequest()`
5. **alt**
   - [driver takes over within 30 seconds]: d `Steer(input)`; vc `detectDriverSteering()` → das `true`; das → w `cancel()` → hmi `removeWarning(warning)`; das → hmi `updateDisplay()` → d: "Control returned to the driver" (R40); das → log `logDisengagement()`; note: HFDS disengaged, after 20 seconds reactivation; das `validateEngagement()` → `boolean`; **opt** [checks pass]: das → hmi `updateDisplay()` → d: "HFDS available"
   - [takeover period of 30 seconds expires]: das → hmi `updateDisplay()` → d: driver unresponsive, hazard lights on (SR1); ref: Driver Ignores Every Warning, emergency response (SR7)

## SD8 — Driver Brakes to Regain Control (customer Scenario 4) · R50, IR15, IR25
Lifelines: Driver, VehicleControl, DriverAssistSystem, HumanMachineInterface, EventLog.
1. Driver: `Driver-Brakes`
2. DAS → VehicleControl: `System-Detects-Brakes` → `true`
3. DAS: `Cancel-Cruise`
4. DAS → HMI: `Update-Display`
5. DAS → EventLog: `Store-Disengagement`
