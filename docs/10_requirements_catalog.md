# 10 — Requirements Catalog (SRS Section 3, normalized)

Source: *HFDS – Group 3 SRS*, Section 3. Requirement **text is verbatim from the SRS** (including its typos) so it can be quoted and traced. The **Prototype** columns are this kit's mapping of each requirement to the prototype; they are not part of the SRS. Child requirements (e.g. R15.2) inherit their parent's mapping unless listed separately. A machine-readable copy is in `requirements.json`.

**Treatment codes**

| Code | Meaning |
|---|---|
| SIM | Implemented as engine behavior and verified by automated tests |
| HMI | Visible in the HMI panels (light bar, cluster message, indicators); verified by engine state tests and Playwright |
| LOG | Appears in the event log with a timestamp |
| STUB | Represented by a simulated status flag or indicator, not modeled physically |
| DOC | Not demonstrable in a browser prototype; listed in the trace panel as out of prototype scope |

**Requirement-ID notes:** IDs are not sequential in the SRS (R4 follows R8, R26 does not exist, SR9 sits in 3.4, IR17–IR21 sit in 3.4). IR29 is used twice; the second is called **IR29b** here. Do not renumber — tests and log entries must use the SRS IDs.


## 3.1.1 Vehicle control and position

| ID | SRS text (verbatim) | Prototype | How it is shown / verified | Scenarios |
|---|---|---|---|---|
| **R1** | The Vehicle Control System shall steer, accelerate, and brake the vehicle according to commands from the Driver Assist System. | SIM | VehicleControl applies ControlCommands (steer/accelerate/brake) to the ego kinematic model. | S04,S05 |
| **R2** | The Path Prediction Subsystem shall calculate the projected path (the blue path) from Vehicle Position Subsystem data and the precision Light Detection and Ranging (LiDAR) map. | SIM | PathPrediction.calculateBluePath() returns lane-centerline points (+targetOffset) from the scenario road map; drawn as the blue path. | S04 |
| **R3** | The Vehicle Position Subsystem shall validate the vehicle position by comparing camera, radar, and Global Positioning System (GPS) data against the LiDAR map. | STUB | VehiclePosition.validatePosition() compares simulated camera / radar / GPS position estimates against the map; a scenario can inject disagreement. | S07,S08 |

## 3.1.2 Engagement

| ID | SRS text (verbatim) | Prototype | How it is shown / verified | Scenarios |
|---|---|---|---|---|
| **R12** | The Human Machine Interface (HMI) shall let the driver turn hands-free mode on and off. | SIM | HFDS button (driver panel / key H) toggles request on/off. | S01,S13 |
| **R13** | The Driver Assist System shall gather weather and road condition data. | SIM | Environment (weather, light, moisture, visibility) read from scenario and Director overrides; isWithinODD(). | S03 |
| **R14** | Before engagement, the HFDS shall confirm that the cameras, radars, GPS, map data, and lane-management functions pass their self-tests. | SIM | Start sequence runs selfTest() on cameras, radars, GPS, map data, lane-management functions. | S01,S03 |
| **R15** | Before engagement, the Driver Assist System shall validate as safe: | SIM | validateEngagement() checks road conditions, trajectory, sensor input, blue path. Each check result shown in the activation checklist panel. | S01,S02,S03 |
| **R15.1** | the road conditions, | SIM | See parent R15. | S01,S02,S03 |
| **R15.2** | the current trajectory, | SIM | See parent R15. | S01,S02,S03 |
| **R15.3** | the sensor input, and | SIM | See parent R15. | S01,S02,S03 |
| **R15.4** | the blue path. | SIM | See parent R15. | S01,S02,S03 |
| **R16** | When the driver presses the HFDS button while the HFDS is unavailable, the HFDS shall display an error: | HMI | Button press while unavailable -> error on dashboard; also HUD and light bar only if vehicleConfig.hasHUD / hasLightBar. | S02,S03 |
| **R16.1** | on the dashboard, | HMI | See parent R16. | S02,S03 |
| **R16.2** | on the front window screen, if the vehicle has one, and | HMI | See parent R16. | S02,S03 |
| **R16.3** | on the steering wheel light bar, if the vehicle has one. | HMI | See parent R16. | S02,S03 |
| **R17** | After engaging, the HFDS shall enter the Adaptive Cruise Control (ACC) state and use the current vehicle speed as the set speed if no speed was previously set. | SIM | On engage: ACC state; setSpeed = current speed if no prior set speed. | S01 |
| **R47** | Before engagement, the Driver Assist System shall check the sensor status, the vehicle position, and the validity of the LiDAR map. | SIM | Pre-engagement check of sensor status, vehicle position, LiDAR map validity. | S01,S02 |
| **R48** | The Vehicle Control System shall: | SIM | VehicleControl reports activation conditions met and confirms engagement (sequence SD1). | S01 |
| **R48.1** | report to the Driver Assist System whether the vehicle activation conditions are met, and | SIM | See parent R48. | S01 |
| **R48.2** | confirm each engagement to the Driver Assist System. | SIM | See parent R48. | S01 |
| **R49** | When engagement is rejected, the HMI shall display an activation warning and the HFDS shall notify the driver that the activation was rejected. | HMI | Rejected engagement -> activation warning on HMI + driver notified (message lists failed checks). | S02,S03 |
| **R42** | The HFDS shall finish its start sequence before processing a stop request. | SIM | Stop request during start sequence is queued until the sequence finishes. | S01 |
| **R43** | The HFDS shall ignore any HFDS button press that occurs within 0.5 seconds of the previous press. | SIM | HFDS button presses within 0.5 s of the previous press are ignored. | S01 |

## 3.1.3 Lane keeping

| ID | SRS text (verbatim) | Prototype | How it is shown / verified | Scenarios |
|---|---|---|---|---|
| **R18** | While engaged, the HFDS shall keep the vehicle within its existing lane. | SIM | Ego never leaves lane while engaged (test: |lateralOffset| + egoWidth/2 <= laneWidth/2). | S04 |
| **R19** | While engaged, the Driver Assist System shall continuously analyze, using the pre-loaded LiDAR map: | SIM | analyzeSurroundings() every tick while engaged. | S04 |
| **R19.1** | the vehicle position, | SIM | See parent R19. | S04 |
| **R19.2** | the current trajectory, | SIM | See parent R19. | S04 |
| **R19.3** | the surrounding vehicles, and | SIM | See parent R19. | S04 |
| **R19.4** | the sensor health. | SIM | See parent R19. | S04 |
| **R20** | The Driver Assist System shall keep the vehicle centered in its lane along the blue path, using the detected lane markings and the surrounding vehicles as additional inputs. | SIM | keepLaneCentered() steers toward blue path; lateral offset converges to targetOffset. | S04 |
| **R39** | When the driver steers manually while the HFDS is engaged and no takeover has been requested: | SIM | Driver steering while engaged (no takeover request) -> pulsing blue, HFDS pauses lateral control; resumes after 3 s within 1.0 mph band and firm grip. | S14 |
| **R39.1** | the HMI shall show the pulsing blue light bar, and | SIM | See parent R39. | S14 |
| **R39.2** | the HFDS shall resume steering once the vehicle speed has stayed within a band of 1.0 mph for 3 consecutive seconds and the driver has held the steering wheel with a firm grip (R35) for the same 3 seconds. | SIM | See parent R39. | S14 |

## 3.1.4 Surroundings and lead-vehicle following

| ID | SRS text (verbatim) | Prototype | How it is shown / verified | Scenarios |
|---|---|---|---|---|
| **R6** | The Driver Assist System shall classify each surrounding vehicle by size as a car, SUV, truck, semi-truck, or bus. | SIM | Each traffic vehicle has a sizeClass; classifyVehicle() derives it from length. SUV missing from the domain enum; see ISSUE-06. | S04,S05 |
| **R7** | The Driver Assist System shall estimate the relative speed and the relative acceleration of each surrounding vehicle. | SIM | Relative speed and acceleration computed per tick from simulated tracks. | S05,S06 |
| **R8** | The Driver Assist System shall estimate the position, length, and width of the near surroundings. The near surroundings are the vehicles, the road shoulder, the median barrier, and the lane boundaries within the selection distance (R4) ahead of the vehicle and within the adjacent lane on each side. | SIM | Near-surroundings list (vehicles, shoulder, median barrier, lane boundaries) within selection distance and adjacent lanes. | S04 |
| **R4** | The Driver Assist System shall select as the lead vehicle the nearest vehicle ahead that is in the lane of the vehicle and within the selection distance. | SIM | selectLeadVehicle(): nearest in-lane vehicle within selection distance (R4.1-R4.3). Lead is highlighted in the renderer. | S05,S06 |
| **R4.1** | The selection distance shall be the trail distance plus the braking distance, in feet. | SIM | See parent R4. | S05,S06 |
| **R4.1.1** | The selection distance is how far ahead the HFDS looks for a lead vehicle. The trail distance is the distance the HFDS keeps behind the lead vehicle. The braking distance is the distance needed to brake from the current speed to a stop. It equals the speed squared, divided by twice. MaxBrakingDecel(in feet) is the largest braking deceleration the HFDS may command. | SIM | Braking distance = v^2 / (2 * maxBrakingDecel). Text in SRS is garbled; see ISSUE-03. | S05 |
| **R4.2** | The selection distance shall not exceed the detection range of the forward sensors. | SIM | Clamp to vehicleConfig.forwardSensorRangeFt (value not given in SRS; see ASSUMPTION A-04). | S05 |
| **R4.3** | A vehicle shall be treated as in the lane of the vehicle when any part of its width overlaps the path of the vehicle along the blue path. The width of the vehicle and of the other vehicle decide this overlap, and the length of the other vehicle decides its size class in R6. The weight of the vehicle enters through a_b. | SIM | Lateral overlap test between ego path corridor (ego width along blue path) and the other vehicle width. "a_b" in the note is undefined; see ISSUE-04. | S06 |
| **R5** | In the closing zone, the Driver Assist System shall hold the current speed until the gap reaches the coast zone. | SIM | Closing zone: hold current speed. Zone boundaries are not defined in the SRS; see ISSUE-05 / A-05. | S05 |
| **R21** | In the coast zone, the Driver Assist System shall coast to match the lead vehicle speed before the safety zone is reached. | SIM | Coast zone: zero throttle, natural decel, until speed matches lead; then follow at trail distance. | S05 |
| **R22** | When the closing speed is too high for the distance but within the braking capability of the system, the Driver Assist System shall brake at the required deceleration a_req. | SIM | a_req = closingSpeed^2 / (2 * (gap - safetyCushion)); brake at a_req if <= maxBrakingDecel. Worked example from SRS is a unit test. | S06 |
| **R22.1** | The required deceleration is the constant braking rate that brings the closing speed to zero before the gap shrinks to the safety zone. The closing speed is how much faster the vehicle travels than the lead vehicle, in feet per second; it is 0 if the lead vehicle is as fast or faster, so no braking is needed. The available braking distance is the gap (the distance from the front of the vehicle to the rear of the lead vehicle) minus the safety zone. | SIM | See parent R22. | S06 |
| **R22.2** | The Driver Assist System shall brake at the required deceleration when it is not greater than maxBrakingDecel. | SIM | See parent R22. | S06 |
| **R22.3** | When the gap is not greater than the safety cushion, the Driver Assist System shall treat a_req as greater than maxBrakingDecel. Example: at 60 mph behind a car, d_trail is 176 ft and the safety cushion is 44 ft. With a gap of 100 ft and a closing speed of 20 mph (29.3 ft/s), a_req is about 7.7 ft/, which is below 11.5 ft/s², so the HFDS brakes. With a closing speed of 30 mph (44 ft/s), a_req is about 17.3 ft/s², which is above 11.5 ft/, so the HFDS issues the reclaim-control warning of R23. Note: the statement in R22.1 assumes that the lead vehicle holds its speed or that there is no lead vehicle. If the lead vehicle brakes, the deceleration actually needed is higher than a_req, and the Forward Collision System (IR22) and the reclaim-control warning (R23) cover that case. | SIM | See parent R22. | S06 |
| **R23** | When the required deceleration a_req exceeds maxBrakingDecel, the Driver Assist System shall issue a reclaim-control warning to the driver. | SIM | a_req > maxBrakingDecel -> Class A reclaim-control warning (UC19). | S06 |
| **R24** | If the lead vehicle leaves the lane, the Driver Assist System shall resume the set speed. | SIM | Lead leaves lane -> resumeSetSpeed() (never above 85 mph, IR27). | S05 |
| **R25** | The Driver Assist System shall compute the trail distance as the speed of the vehicle, multiplied by the time gap, multiplied by the size factor(1.00/car and SUV, 1.25/truck,1.50/bus,2.00/semi-truck) of the lead vehicle, in feet. The speed is the speed of the vehicle in feet per second. The time gap is the larger of the driver-selected following gap and the 2.0 second minimum of IR9. | SIM | d_trail = v(ft/s) * max(driverGap, 2.0 s) * sizeFactor(lead). | S05 |

## 3.1.5 Driver attention and warnings

| ID | SRS text (verbatim) | Prototype | How it is shown / verified | Scenarios |
|---|---|---|---|---|
| **R27** | The Driver Attention System (DATS) shall continuously monitor the driver's eye movement and head position while the HFDS is engaged. | SIM | DATS samples driver gaze/head state each tick (driver panel toggles "eyes on road"). | S09,S10 |
| **R28** | The HFDS shall assign every warning to exactly one of two classes: | SIM | Every Warning has warningClass A or B. | S06,S09,S11 |
| **R28.1** | Class A: reclaim control because of the operational design domain (ODD) or a possible threat (lane visibility loss, sensor fault, road hazard). | SIM | See parent R28. | S06,S09,S11 |
| **R28.2** | Class B: reclaim control because of driver disengagement. | SIM | See parent R28. | S06,S09,S11 |
| **R29** | First alert: when the DATS detects attention loss, | SIM | First alert: flashing green, "Pay attention to the road."; second alert after 30 s more of attention loss. | S09,S10 |
| **R29.1** | the light bar shall flash green, | SIM | See parent R29. | S09,S10 |
| **R29.2** | the display shall show "Pay attention to the road.", and | SIM | See parent R29. | S09,S10 |
| **R29.3** | the DATS shall start the second alert if attention loss continues 30 seconds after the first alert started. | SIM | See parent R29. | S09,S10 |
| **R30** | Second alert: | SIM | Second alert: flashing red, chime or seat vibration, "Take steering control immediately."; final after 5 s. | S09,S10 |
| **R30.1** | the light bar shall flash red, | SIM | See parent R30. | S09,S10 |
| **R30.2** | the HFDS shall sound an audible alert or vibrate the driver seat, | SIM | See parent R30. | S09,S10 |
| **R30.3** | the display shall show "Take steering control immediately.", and | SIM | See parent R30. | S09,S10 |
| **R30.4** | the DATS shall start the final alert if attention loss continues 5 seconds after the second alert started. | SIM | See parent R30. | S09,S10 |
| **R31** | Final alert: | SIM | Final alert: continuous seat vibration, voice prompt, phantom brake. | S09 |
| **R31.1** | the driver seat shall vibrate continuously, | SIM | See parent R31. | S09 |
| **R31.2** | a voice prompt shall instruct the driver to take control, and | SIM | See parent R31. | S09 |
| **R31.3** | the HFDS shall apply a phantom brake. | SIM | See parent R31. | S09 |
| **R32** | The HFDS shall cancel the active alert if the driver engagement resumes. | SIM | Eyes back on road -> active alert cancelled, light bar back to solid green. | S10 |
| **R35** | The HFDS shall confirm a driver takeover by detecting a firm grip on at least two steering wheel sensing areas. | SIM | Takeover confirmed when >= 2 grip areas report firm grip (driver panel has grip-area toggles). | S08,S11 |
| **R36** | The DATS shall mark the driver as inactive if the driver has not re-engaged within 2 seconds after the final alert started. | SIM | Driver marked inactive 2 s after final alert starts without re-engagement. | S09 |

## 3.1.6 Human Machine Interface

| ID | SRS text (verbatim) | Prototype | How it is shown / verified | Scenarios |
|---|---|---|---|---|
| **R33** | The HMI shall show a solid green light bar when the HFDS is steering the vehicle. | HMI | Solid green light bar while HFDS steers; "hands-free OK" indicator only while solid green. | S01 |
| **R33.1** | The HFDS shall allow the driver to remove their hands from the steering wheel only while the light bar is solid green. | HMI | See parent R33. | S01 |
| **R34** | The HMI shall display the following light bar states: | HMI | Light bar states: flashing green / pulsing blue / flashing red. | S09,S14 |
| **R34.1** | flashing green: the HFDS is active and the driver engagement is questionable, | HMI | See parent R34. | S09,S14 |
| **R34.2** | pulsing blue: the HFDS is active and the driver is steering manually, and | HMI | See parent R34. | S09,S14 |
| **R34.3** | flashing red: the driver needs to take steering control immediately. | HMI | See parent R34. | S09,S14 |
| **R40** | The HMI shall announce every transfer of control with a visual indication. | HMI | Every control transfer shows a visual banner ("You are in control" / "HFDS steering"). | S08,S11,S13 |
| **R46** | The HMI shall display: | HMI | Cluster shows current HFDS state and active warnings. | all |
| **R46.1** | the current system state, and | HMI | See parent R46. | all |
| **R46.2** | any active warnings. | HMI | See parent R46. | all |
| **R50** | When the driver brakes, the HFDS shall: | SIM | Driver brake -> cancel ACC, update display, log disengagement. | S13 |
| **R50.1** | cancel the adaptive cruise control, | SIM | See parent R50. | S13 |
| **R50.2** | update the display, and | SIM | See parent R50. | S13 |
| **R50.3** | log the disengagement. | SIM | See parent R50. | S13 |

## 3.1.7 Faults, map data, and logging

| ID | SRS text (verbatim) | Prototype | How it is shown / verified | Scenarios |
|---|---|---|---|---|
| **R9** | The HFDS shall detect faults in: | SIM | Faults injected by scenario timeline or Director panel are detected by self-test each tick and raised as ErrorCodes. | S07,S08,S16 |
| **R9.1** | the radar, camera, and other sensors, | SIM | See parent R9. | S07,S08,S16 |
| **R9.2** | the GPS receiver, | SIM | See parent R9. | S07,S08,S16 |
| **R9.3** | the map data, and | SIM | See parent R9. | S07,S08,S16 |
| **R9.4** | the Path Prediction Subsystem. | SIM | See parent R9. | S07,S08,S16 |
| **R10** | The HFDS shall detect a mismatch between the LiDAR map and the sensed environment, such as a construction zone missing from the map. | SIM | LiDARMap.detectMismatch(): sensed construction zone / lane geometry not in map -> fault + Class A (IR14). | S16 |
| **R11** | The HFDS shall download LiDAR map updates and GPS correction data automatically. | STUB | Map-update and GPS-correction "downloads" are simulated status timestamps; Director can make GPS correction stale (> 5 s, IR5.8) or apply a map update. | S02 |
| **R37** | The HFDS shall record each fault as an error code with: | LOG | ErrorCode {code, description, severity 0-100, band low/middle/high, sensor metadata}. | S07,S08 |
| **R37.1** | a description, and | LOG | See parent R37. | S07,S08 |
| **R37.2** | a severity score(0 to 100, 0-24 = low, 25-74 = middle, and 75-100 = high) | LOG | See parent R37. | S07,S08 |
| **R38** | After a fault, the HFDS shall allow re-engagement according to the severity of the error code: | SIM | Re-engagement gating by severity band; 20 s post-takeover recheck then "HFDS available". | S08,S11 |
| **R38.1** | low score: once all operating constraints in Section 3.3 are met again, | SIM | See parent R38. | S08,S11 |
| **R38.2** | middle score: only after the fault has cleared, the 30 second reactivation buffer of R41.2 has passed, and the engagement checks pass, | SIM | See parent R38. | S08,S11 |
| **R38.3** | high score: as stated in IR23, and | SIM | See parent R38. | S08,S11 |
| **R38.4** | after a driver takeover: the HFDS shall re-run its engagement checks 20 seconds after the takeover and display "HFDS available" when the checks pass. | SIM | See parent R38. | S08,S11 |
| **R41** | After 3 system-initiated reclaim requests within 5 minutes, the HFDS shall: | SIM | 3 system-initiated reclaim requests within 5 min -> deactivate + 30 s reactivation buffer. | S15 |
| **R41.1** | deactivate itself, and | SIM | See parent R41. | S15 |
| **R41.2** | apply a reactivation buffer of 30 seconds until the surroundings are stable. | SIM | See parent R41. | S15 |
| **R44** | If the HFDS control process becomes corrupted mid-cycle: | SIM | Director "corrupt control process" -> reset to default state, block reactivation 20 s. | S00 |
| **R44.1** | the HFDS shall reset it to its default state, and | SIM | See parent R44. | S00 |
| **R44.2** | the HFDS shall block reactivation for 20 seconds. | SIM | See parent R44. | S00 |
| **R45** | The HFDS shall log each of the following with a timestamp: | LOG | Event log entries with sim timestamp for engagement, disengagement, warning, error code, takeover request. | all |
| **R45.1** | engagement, | LOG | See parent R45. | all |
| **R45.2** | disengagement, | LOG | See parent R45. | all |
| **R45.3** | warning, | LOG | See parent R45. | all |
| **R45.4** | error code, and | LOG | See parent R45. | all |
| **R45.5** | takeover request. | LOG | See parent R45. | all |

## 3.2 Safety Requirements

| ID | SRS text (verbatim) | Prototype | How it is shown / verified | Scenarios |
|---|---|---|---|---|
| **SR1** | If the driver does not take over after a reclaim warning or the final attention alert, the HFDS shall: | SIM | Minimal risk maneuver: shoulder if reachable within 60 s via one lane at a time (>= 2 s per lane), else stop in lane; hazards, OnStar, unlock doors. | S09,S12 |
| **SR1.1** | The HFDS shall maneuver the vehicle to the right shoulder and bring it to a controlled stop if the shoulder can be safely reached within the time limit specified in SR1.1.1. Otherwise, the HFDS shall bring the vehicle to a controlled stop in its current lane. | SIM | See parent SR1. | S09,S12 |
| **SR1.1.1** | The HFDS shall evaluate shoulder reachability at fallback initiation and throughout the maneuver using the defined time, distance, and safe-path checks. If these checks fail or the shoulder has not been reached within 60 seconds of fallback initiation, the HFDS shall bring the vehicle to a controlled stop in its current lane. | SIM | See parent SR1.1. | S09,S12 |
| **SR1.1.2** | The HFDS shall move toward the right shoulder one adjacent lane at a time, maintaining travel in each entered lane for at least 2 seconds before the next lateral transition, including shoulder entry, while maintaining safe speed and vehicle separation. | SIM | See parent SR1.1. | S09,S12 |
| **SR1.2** | turn on the hazard lights, | SIM | See parent SR1. | S09,S12 |
| **SR1.3** | connect an OnStar emergency advisor, and | STUB | OnStar call shown as an HMI status ("Connecting to OnStar advisor...") and logged. | S09 |
| **SR1.4** | unlock the doors so that emergency services can reach the occupants. | STUB | Door-lock indicator switches to unlocked. | S09 |
| **SR2** | The DATS shall detect when the driver camera is manipulated so that attention could be faked. | SIM | Director "tamper driver camera" -> DATS detectTampering() true -> treated as DATS loss (SR5). | S17 |
| **SR3** | The HFDS shall detect any single point of failure and then hand control to the driver. | SIM | Any single point of failure without redundancy -> Class A takeover. | S08 |
| **SR4** | The HFDS shall have hardware and sensor redundancy so that a single failure leaves enough data to hold the lane until the driver re-engages: | SIM | Lane position and lead distance each have two sources; losing one keeps HFDS engaged (SR4.4). | S07 |
| **SR4.1** | lane position shall come from at least two independent sources (for example, the front camera and the LiDAR map with GPS), | SIM | See parent SR4. | S07 |
| **SR4.2** | lead-vehicle distance shall come from at least two independent sources (for example, the front radar and the front camera), | SIM | See parent SR4. | S07 |
| **SR4.3** | the computing and power hardware shall have a backup able to hold the lane and brake to a stop after a primary failure, and | STUB | Backup compute/power shown as a status flag; Director "primary compute failure" -> backup holds lane and requests takeover. | S00 |
| **SR4.4** | when a sensor fault occurs and a redundant source is available, the HFDS shall switch to the redundant source, continue lane centering, and show the solid green light bar. | SIM | See parent SR4. | S07 |
| **SR5** | The HFDS shall treat loss of the Driver Attention System (camera blocked, disabled, or failed) as a single point of failure. | SIM | DATS camera blocked/disabled/failed = single point of failure -> Class A takeover. | S17 |
| **SR6** | If the driver does not respond to the final alert, the HFDS shall abort hands-free driving and perform the controlled stop in SR1. | SIM | No response to final alert -> SR1. | S09 |
| **SR7** | If the driver does not take control within the takeover period of 30 seconds, the HFDS shall perform the controlled stop in SR1. | SIM | No takeover within 30 s of takeover request -> SR1. | S12 |
| **SR8** | After a collision or airbag deployment, the HFDS shall place an emergency call to an OnStar advisor. | STUB | Director "collision / airbag" -> OnStar emergency call status + log. | S18 |
| **SR10** | The HFDS shall continuously self-verify that all systems work correctly, using redundancy so that one error does not hide another. | SIM | Continuous self-verification: every sensor/subsystem self-test each tick (IR29: every 50 ms = every tick at 20 Hz). | all |

## 3.3 Operating Constraints (Invariant Requirements)

| ID | SRS text (verbatim) | Prototype | How it is shown / verified | Scenarios |
|---|---|---|---|---|
| **IR1** | The HFDS shall operate only on divided highways that the Path Prediction Subsystem has enabled from the LiDAR map. | SIM | Engage only on road segments with roadType DividedHighway and enabled in LiDAR map; UC17 detects end of enabled road ahead. | S03,S01 |
| **IR2** | The HFDS shall operate only when the lane lines on both sides of the current lane are clearly visible and detected. | SIM | Both lane markings visible required (Lane.bothMarkingsVisible()). | S16 |
| **IR3** | The HFDS shall operate only while the DATS detects an engaged driver. | SIM | Engagement requires an engaged driver. While engaged, attention loss is handled by R29-R31 escalation (see ISSUE-11). | S09 |
| **IR4** | The HFDS shall operate only while every assist subsystem is engaged and reports no fault. | SIM | All subsystems status OK required to engage/stay engaged (Degraded allowed only via SR4.4 redundancy). | S07,S08 |
| **IR5** | The HFDS shall disengage, or refuse engagement, when any of the following holds: | SIM | ODD exclusions IR5.1-IR5.10: refuse engagement, or Class A reclaim if engaged. | S03,S16 |
| **IR5.1** | low light (night) or low-angle direct sunlight (sunrise) prevents lane detection, | SIM | See parent IR5. | S03,S16 |
| **IR5.2** | the vehicle is in a construction zone or a tunnel, | SIM | See parent IR5. | S03,S16 |
| **IR5.3** | the vehicle is on a road shoulder, a service drive, or a highway exit lane, | SIM | See parent IR5. | S03,S16 |
| **IR5.4** | rain, fog, ice, snow, or road moisture is detected outside the ODD, | SIM | See parent IR5. | S03,S16 |
| **IR5.5** | a trailer is attached and the vehicle lacks trailering capability, | STUB | vehicleConfig.trailerAttached / trailerCapable flags. | S03 |
| **IR5.6** | a camera, LiDAR, or radar sensor is obstructed, damaged, or covered, | SIM | See parent IR5. | S03,S16 |
| **IR5.7** | LiDAR map, navigation, or GPS data is in error or unavailable, | SIM | See parent IR5. | S03,S16 |
| **IR5.8** | real-time data transfer or network connectivity falls below the required health level, The required health level is met only when all of the following hold: every subsystem reports status OK; sensor data is no older than 100 ms; GPS correction data is no older than 5 seconds; and the redundant sources for lane position and lead-vehicle distance agree within 0.3 m. | SIM | Health level: all subsystems OK, sensor data age <= 100 ms, GPS correction age <= 5 s, redundant sources agree within 0.3 m. | S07 |
| **IR5.9** | the motion forecasting, self-supervision, or dynamic environment function is unavailable, or | STUB | Status flags for motion forecasting, self-supervision, dynamic environment functions. | S00 |
| **IR5.10** | a forward collision warning escalates to a takeover request. | SIM | See parent IR5. | S03,S16 |
| **IR6** | The HMI shall display an "HFDS available" indicator only when every operating constraint in IR1 through IR5 and IR28 is met. | HMI | "HFDS available" indicator iff IR1-IR5 and IR28 all hold (computed every tick, checklist panel shows each). | S01,S03 |
| **IR7** | The HFDS shall engage only when the driver presses the dedicated HFDS button on the steering wheel or an equivalent control. | SIM | Only the HFDS button input can engage. | S01 |
| **IR8** | The HFDS shall refuse engagement when the surrounding traffic is unstable, meaning that any of the following holds: | SIM | Traffic-stability checks over sliding windows of surrounding-vehicle tracks. | S03 |
| **IR8.1** | heavy braking: a surrounding vehicle decelerates at more than maxBrakingDecel. | SIM | See parent IR8. | S03 |
| **IR8.2** | extreme acceleration change: the acceleration of a surrounding vehicle changes by more than 10 ft/ within 1 second. | SIM | See parent IR8. | S03 |
| **IR8.3** | the gap to the lead vehicle changes by more than 30 percent of the trail distance within 3 seconds, or the time is under 1.0 second.” | SIM | See parent IR8. | S03 |
| **IR9** | The Driver Assist System shall keep a trail distance of at least trail distance, which is never less than 2.0 seconds of travel time and is never less than the driver-selected gap. | SIM | Trail distance never below 2.0 s of travel or driver gap. | S05 |
| **IR10** | After a controlled stop for an unresponsive driver, the HFDS shall stay unavailable until the next ignition cycle. | SIM | After SR1 stop for unresponsive driver: unavailable until Director "ignition cycle". | S09 |
| **IR11** | The HFDS shall never remain in hands-free driving mode after the driver is deemed inactive. | SIM | Driver inactive -> never remain hands-free (immediately SR1). | S09 |
| **IR12** | While the light bar flashes red, the HFDS shall not accelerate the vehicle. | SIM | No positive acceleration command while light bar flashing red (assert every tick). | S06,S09,S11 |
| **IR13** | Until the driver takes control, the HFDS shall hold the vehicle in its lane and let it coast without accelerating. | SIM | Until takeover: hold lane, coast, no acceleration. | S11,S12 |
| **IR14** | Upon a fault, an invalid blue path, or a map mismatch, the HFDS shall immediately issue a Class A reclaim warning. | SIM | Fault / invalid blue path / map mismatch -> immediate Class A. | S08,S16 |
| **IR15** | Driver braking shall always disengage the HFDS and the ACC. | SIM | Driver brake always disengages HFDS and ACC, in every engaged state including alerts and SR1. | S13 |
| **IR16** | The HFDS shall refuse engagement, and shall disengage if engaged, when the stored LiDAR map is more than 7 months old, and shall display an "Update needed" warning. | SIM | Map older than 7 months (scenario simDate vs map lastUpdated) -> refuse/disengage, "Update needed". | S02 |
| **IR22** | While the HFDS is engaged, the Forward Collision System (automatic emergency braking) shall be set to "Alert and Brake". | STUB | Forward Collision System mode indicator set to "Alert and Brake" while engaged. | S01 |
| **IR23** | The HFDS shall block re-engagement after a high-score error code (75 to 100) until the fault is cleared. | SIM | High-severity (75-100) error blocks re-engagement until cleared. | S08 |
| **IR24** | The fail-safe state shall be driver control: the HFDS shall hand control to the driver and shall not continue hands-free driving with degraded mapping or a sensor fault. | SIM | Fail-safe = driver control; no degraded hands-free driving except SR4.4 redundant switch. | S08 |
| **IR25** | Driver steering, braking, or throttle input shall always take priority over the HFDS. | SIM | Driver steering, braking, throttle always override HFDS commands in the same tick. | S13,S14 |
| **IR26** | The HFDS shall not steer around objects. When it detects an object in the lane (debris, pothole, stopped vehicle, pedestrian), it shall issue a Class A reclaim warning. | SIM | In-lane object (debris, pothole, stopped vehicle, pedestrian) -> no avoidance, Class A. | S11,S12 |
| **IR27** | The HFDS shall not command a vehicle speed above 85 mph. | SIM | Commanded speed clamped to 85 mph (set speed UI also capped). | S05 |
| **IR28** | The HFDS shall engage only when the vehicle speed is above 3 mph. | SIM | Engage only when speed > 3 mph. | S03 |
| **IR29** | A sensor shall perform a check every 50ms to validate working capabilities. | SIM | Sensor self-check every 50 ms (one engine tick at 20 Hz). | all |
| **IR29b** | Sensor error logs shall contain identifying metadata. ⚠ Duplicate ID in SRS (second IR29). Prototype refers to it as IR29b; see ISSUE-01. | LOG | Sensor error log entries carry sensorId, type, status, lastReading timestamp. | S07 |

## 3.4 Cybersecurity Requirements

| ID | SRS text (verbatim) | Prototype | How it is shown / verified | Scenarios |
|---|---|---|---|---|
| **IR17** | The HFDS shall have an active data service for real-time positioning while engaged. | STUB | Positioning data-service status flag required while engaged. | S00 |
| **IR18** | The Vehicle Control System shall execute commands only from the authenticated in-car Driver Assist System or from the driver's own controls. | DOC | Command-source authentication shown only in optional S19. | S19 |
| **IR19** | The Vehicle Control System shall reject any command that arrives through an external network unless an authenticated service provider is connected. | DOC | External-network command rejection shown only in optional S19. | S19 |
| **IR20** | The HFDS shall require cryptographic authorization for diagnostic access, and the authorization shall be tied to one specific purpose (crash investigation, full lock, or manufacturer or factory unlock). | DOC | Diagnostic access authorization: documented, not simulated. | - |
| **IR21** | The Human Machine Interface (HMI) subsystem shall execute only authorized commands. | DOC | HMI executes only authorized commands: documented; optional S19. | S19 |
| **SR9** | The HFDS shall ensure that an unauthorized entity cannot view or change the following internal data: | DOC | Not demonstrable in a browser simulation; listed in the trace panel as out of prototype scope (optional S19 shows rejected unauthorized command). | S19 |
| **SR9.1** | vehicle position, | DOC | See parent SR9. | S19 |
| **SR9.2** | sensor data, and | DOC | See parent SR9. | S19 |
| **SR9.3** | control commands. | DOC | See parent SR9. | S19 |
