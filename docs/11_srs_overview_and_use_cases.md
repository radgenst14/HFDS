# 11 — SRS Overview, Scope and Use Cases

Condensed from *HFDS – Group 3 SRS* Sections 1, 2 and 4.1–4.2. Wording is kept close to the SRS; nothing here adds behavior. Behavior the prototype needs that the SRS leaves undefined is in `13_behavior_spec.md` and is labeled there as an assumption.

## Project

| | |
|---|---|
| Project | Hands-Free Driving System (HFDS), CSE 435 Group 3 |
| Authors | Eric Wheeler, Tucker Radgens, Tanmay Dabhade, Aldemir Konuk (Max Wickenkamp on Section 2 per the cover notes) |
| Customer | Andrew Davenport (GM) |
| Instructor | Dr. Betty H.C. Cheng, Michigan State University |

## What HFDS is (SRS 1, 1.2)

An embedded automotive system that steers, brakes and accelerates the car hands-free on supported divided highways. It can only be activated under the correct conditions (supported highway, safe environment, all subsystems working). Once on, it stays in the lane of activation and uses the car's built-in Adaptive Cruise Control (ACC) to manage speed and follow distance. The driver must keep paying attention; the Driver Attention System (DATS) watches eyes and head and escalates warnings. If the driver never responds, HFDS brakes and moves to the right shoulder if reachable, otherwise stops in its own lane, then deactivates.

**Driver input always wins:** braking cancels HFDS, steering pauses it until the vehicle is steady again, and taking over after a warning disengages it.

**Out of scope (SRS 1.2, 2.6):** lane changes (except the SR1 move to the shoulder), highway entrances/exits, construction zones, steering around obstacles, nighttime driving, bad weather or poor visibility.

## Definitions (SRS 1.3)

| Term | Meaning |
|---|---|
| HFDS | Hands-Free Driving System |
| ACC | Adaptive Cruise Control — assumed already built into the car; controls speed and gap while HFDS is active |
| HMI | Human Machine Interface — driver controls and displays |
| LiDAR | Used to build the precision highway maps used for path prediction and positioning |
| Blue Path | The predicted path computed from vehicle position and map data |
| GPS | Satellite positioning, combined with sensors and map data |
| DATS | Driver Attention System — eye movement and head position monitoring |
| ODD | Operational Design Domain (SRS writes "Operational Domain Design") — road, weather and traffic conditions HFDS is designed for |
| OnStar | GM emergency and connected-vehicle service |
| R / SR / IR | Requirement / Safety requirement / Invariant requirement prefixes |

## Product perspective (SRS 2.1)

HFDS builds on ACC and relies on the vehicle's sensors, brakes, steering and throttle, plus outside services (LiDAR maps, GPS data, OnStar).

| Interface | Elements |
|---|---|
| System | ACC, Forward Collision System, OnStar |
| User | HFDS start button, light bar, dashboard display, audio, seat vibration |
| Hardware | Cameras, radar, LiDAR, GPS, grip sensors, steering, throttle, brakes |
| Software | Updated LiDAR map, vehicle control software |
| Communication | Map updates, GPS correction, OnStar |
| Memory | LiDAR maps for every approved highway; event logs |
| Operations | Runs only under approved conditions on approved highways |
| Site adaptation | Each vehicle model decides its own maximum braking power (→ `maxBrakingDecel` is a vehicle config value) |

## Six major functions (SRS 2.2)

1. **Check conditions before engaging** — self-tests; weather, blue path, driver attention, verified-road map. Engage only if all pass.
2. **Center in lane** — follow the blue path.
3. **Follow lead vehicle** — ACC picks a lead, keeps a safe gap, brakes when the gap closes too fast.
4. **Verify driver attention** — camera tracks eyes/head; escalating warnings on attention drop.
5. **Return vehicle control** — on fault or leaving an approved road, ask the driver to take control; always yield when the driver takes control.
6. **Stop safely when necessary** — driver ignores escalated warnings → stop in a safe location and contact OnStar.

## User characteristics (SRS 2.3)

A licensed driver; no technical background. One button activates HFDS. The driver is expected to read HFDS state, stay attentive, be ready to take over within seconds, and know HFDS does not change lanes, avoid hazards or take exits.

## Constraints and assumptions (SRS 2.4, 2.5)

- Safety critical: incorrect steering or braking could cause a serious accident. The driver always maintains authority; any driver input overrides HFDS. (The rest of 2.4 is blank in the SRS.)
- Hardware assumed: working ACC and Forward Collision System; front and rear cameras, driver-facing camera, radar, GPS, steering-wheel grip sensors; redundant computing and sensing; HFDS-controllable steering, throttle and brakes.
- Software assumed: updated LiDAR maps for supported highways; map and GPS correction data available.
- Users/environment assumed: driver alert and ready; other vehicles behave normally, and anything abnormal is handled by emergency procedures or returning control.

## Prototype expectations (SRS Section 5 template, course requirements)

- Accessible through the web; give the URL.
- **Prototype v1**: does not have to be interactive, but must have enough interfaces with descriptive captions/annotations for the customer to understand the team's interpretation of the requirements. **All customer-provided scenarios must be included.**
- **Prototype v2**: accessible via a web page, executable, interactive. **All customer-provided scenarios must be supported and interactive.**
- Section 5.2 must give sample scenarios using real data with screen captures.

The SRS refers to customer scenarios by number in two places only: **Scenario 1** = activating HFDS on a supported highway (SD 4.3.1), **Scenario 4** = driver brakes to regain control (SD 4.3.8). The full customer scenario list is **not** in the SRS — see `16_open_issues_and_assumptions.md` (Q-01).

## Use case diagram (SRS 4.1, Figure 4.1)

Image: `diagrams/00_fig4-1_use_case_diagram.png`. System boundary "Driving Automation" (legend: system boundary = Driver Assist System). Actors: **Driver, HFDS, Vehicle, Other Vehicles**. Color legend: blue = Driver Assist, purple = Path Prediction, green = Vehicle Position, orange = Vehicle Control.

Groups:
- **Engagement** — UC5 includes UC4, UC15, UC17. UC4 includes UC1, which includes UC2. UC3 extends UC1.
- **Lane keeping** — UC8 includes UC5, UC15, UC7. UC9, UC10, UC11, UC12 (and UC18) extend UC8.
- **Speed management** — UC13 includes UC7. UC14 extends UC13 and UC11.
- **Vehicle control** — UC7 includes UC6.
- **Attention and handover** — UC16 extends UC15. UC18 extends UC8 and UC16 and includes UC19. UC21 extends UC18.

(No UC20 exists.)

## Use case summaries (SRS 4.2)

| UC | Name | Actors | Type | Includes / Extends | Behavior (from the SRS description) | Cross-refs |
|---|---|---|---|---|---|---|
| UC1 | Analyze Position, Trajectory, Surroundings | Vehicle | Secondary, essential | Incl. UC2; included by UC4; extended by UC3 | DriverAssistSystem continuously analyzes sensor data on position, path, SurroundingVehicles and each Sensor's health; results feed path calculation and all driving decisions. | R6, R7, R19, SR4 |
| UC2 | Gather Weather and Road Conditions | Vehicle, Other Vehicles | Secondary, essential | Included by UC1 | Obtain Environment (weather, light, wetness, visibility) from Sensors; `Environment.isWithinODD()` decides if lanes can still be detected. | R13, IR5.1, IR5.4 |
| UC3 | Detect Suspicious Lane Changes by Other Vehicles | Other Vehicles | Secondary, optional | Extends UC1 | Monitor lane and lateral speed of each tracked vehicle; erratic lane changes feed lane-keeping and following decisions. | R6, R7 |
| UC4 | Calculate the Blue Path | internal | Secondary, essential | Incl. UC1; included by UC5 | `PathPrediction.calculateBluePath()` from VehiclePosition + LiDARMap → array of map points → DriverAssistSystem. HFDS only starts on map-enabled highways. | R2, R9, IR1 |
| UC5 | Validate Conditions and Path Prediction System | HFDS (driver request) | Primary, essential | Incl. UC4, UC15, UC17; included by UC8 | `validateEngagement()`: sensor self-tests, Environment within ODD, blue path exists (`isPathValid()`), LiDARMap < 7 months old, road enabled, driver engaged (`isDriverEngaged()`). Pass → engage, HMI shows engaged. Fail → refuse, HMI shows warning e.g. "Update needed." | R14, R15, IR1, IR3, IR16; SD1, SD5 |
| UC6 | Steer, Accelerate and Brake the Car | Vehicle | Secondary, essential | Included by UC7 | `VehicleControl.steer(angle)`, `accelerate(rate)`, `brake(rate)`. No acceleration while light bar flashes red. Driver pedals/wheel take precedence. | R1, IR12, IR13, IR15 |
| UC7 | Send Commands to Vehicle Control | internal | Secondary, essential | Incl. UC6; included by UC8, UC12, UC13 | Each lane-keeping or speed decision → ControlCommand → `sendCommand(cmd)`. | R1 |
| UC8 | Keep Lane on Blue Path | HFDS, Driver | Primary, essential | Incl. UC5, UC7, UC15; extended by UC9–UC12, UC18 | `keepLaneCentered()` steers along blue path, lateral offset → lane center. DATS monitors throughout. After the driver steers, HFDS takes control back once steady (R39). | R18, R20, R39; SD2 |
| UC9 | Navigate Curves and Turns | internal | Secondary, essential | Extends UC8 | `navigateCurve()` follows bends; too sharp → hand control to driver (UC18). | R2, R20 |
| UC10 | Detect Hazard in Lane | Vehicle | Secondary, essential | Extends UC8 | `detectHazard()`: debris, pothole, stopped vehicle. HFDS does not avoid it; centers the vehicle, gives a takeover warning, hands to driver (UC18). | IR26, R40; SD7 |
| UC11 | Detect Vehicle Entering our Lane | Other Vehicles | Secondary, essential | Extends UC8; extended by UC14 | `detectLaneIntrusion()` using lateral velocity and `isEnteringLane()`; may become new lead; rapid gap closing → UC14. | R4, R7 |
| UC12 | Stay Centered, Large Vehicles | internal | Secondary, optional | Extends UC8; incl. UC7 | Truck / SemiTruck / Bus in next lane → targetOffset slightly away, still in lane. | R6, R20 |
| UC13 | Follow Lead Vehicle | Other Vehicles | Primary, essential | Incl. UC7; extended by UC14 | Select leader; trail gap ≥ max(driver gap, 2.0 s) at current speed, larger behind trucks/semis/buses. Hold speed in closing zone, coast in coast zone, brake in safety zone. Lead exits lane → resume set speed (≤ 85 mph). ACC disabled when driver brakes. | R4, R5, R17, R21, R24, R25, IR9, IR15; SD3 |
| UC14 | Brake for Closing Speed | internal | Secondary, essential | Extends UC11, UC13 | `brakeForClosingSpeed()`: within capability → brake at that rate; otherwise return false and warn driver to reclaim (UC18). | R22, R23 |
| UC15 | Monitor Driver Attentiveness | Driver, HFDS | Primary, essential | Included by UC5, UC8; extended by UC16 | `monitorDriver()` on gaze and head position; also detects camera tampering. DATS failure → control back to driver. | R27, IR3, SR2, SR5 |
| UC16 | Initiate Inattentive Warnings | Driver, HFDS | Secondary, essential | Extends UC15; extended by UC18 | `isDriverEngaged()` false → Class B warning, escalating: (1) flashing green + "Pay attention to the road"; (2) flashing red + seat vibration or sound; (3) seat vibration + voice command + phantom brake. Driver regains → alert cancelled. | R29–R32, R36; SD6 |
| UC17 | Detect Route Completion | internal | Secondary, essential | Included by UC5 | Is the car near/at the end of the HFDS-enabled road on the LiDARMap → whether UC5 activates or keeps HFDS active. | IR1 |
| UC18 | Relinquish Control to Driver | Driver, HFDS, Vehicle | Primary, essential | Incl. UC19; extends UC8, UC16; extended by UC21 | Hazard, curve too tight, inadequate braking, sensor/system failure, or unresponsive driver → takeover request (UC19). Driver takes over by steering or braking (`detectDriverSteering()`, `detectDriverBraking()`). Cruise cancelled; control returned. | R22, R23, R40, IR15, IR26, SR5; SD4, SD7, SD8 |
| UC19 | Issue Takeover Request | Driver, HFDS | Secondary, essential | Included by UC18 | Class A warning "Take steering control immediately."; light bar red; acceleration inhibited; `EventLog.logTakeoverRequest()`. | R22, R23, IR12, IR26 |
| UC21 | Execute Minimal Risk Maneuver | Vehicle, Other Vehicles, HFDS | Secondary, essential | Extends UC18 | No reply / driver inactive → slow controlled stop, toward the shoulder if possible, hazard lights on, responders alerted. | R36, SR1, SR6, SR7; SD4, SD6 |

## Sequence diagrams (SRS 4.3) — summary

Full transcriptions are in `18_diagram_index.md`.

| SD | Title | Requirements listed in SRS | Prototype scenario |
|---|---|---|---|
| SD1 (4.3.1) | Activating HFDS (customer Scenario 1) | R14, R15, R47, R48, R49 | S01 |
| SD2 (4.3.2) | Lane Keeping | R2, R3, R18, R19, R20 | S04 |
| SD3 (4.3.3) | Following a Lead Vehicle | R4, R5, R21–R25, IR9 | S05, S06 |
| SD4 (4.3.4) | Sensor Failure | R9, R37, R38, SR1, SR4, IR10 | S07, S08 |
| SD5 (4.3.5) | Activation Rejected for an Outdated Map | R10, R49, IR16 | S02 |
| SD6 (4.3.6) | Driver Inattention (ignores every warning) | R27–R31, R36, SR1, SR6, IR12 | S09 (S10 = recovered variant) |
| SD7 (4.3.7) | Road Hazard Requires Driver Takeover | R28, R38, R40, SR1, SR7, IR12, IR13, IR26 | S11, S12 |
| SD8 (4.3.8) | Driver Brakes to Regain Control (customer Scenario 4) | R50, IR15, IR25 | S13 |
