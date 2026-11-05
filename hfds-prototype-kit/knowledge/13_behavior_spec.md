# 13 — Behavior Specification for the Simulation Engine

This turns SRS Section 3 into implementable engine behavior: constants, formulas with test vectors, the HFDS mode state machine, warning escalation, takeover and minimal-risk-maneuver flows, and the per-tick order of operations.

Every rule is tagged with the SRS IDs it implements. **Anything the SRS does not define is marked `A-xx` (assumption) and is listed in `16_open_issues_and_assumptions.md`.** Assumptions are implemented as named constants in `src/shared/constants.ts` so the team can change them in one place.

---

## 1. Constants

### 1.1 From the SRS (do not change without an SRS change)

| Constant | Value | Source |
|---|---|---|
| `TICK_HZ` | 20 (50 ms) | Tech stack doc; also satisfies IR29 sensor check every 50 ms |
| `BUTTON_DEBOUNCE_S` | 0.5 | R43 |
| `MIN_ENGAGE_SPEED_MPH` | 3 (engage only if speed **>** 3) | IR28 |
| `MAX_COMMAND_SPEED_MPH` | 85 | IR27 |
| `MIN_TIME_GAP_S` | 2.0 | IR9, R25 |
| `SIZE_FACTOR` | Car 1.00, SUV 1.00, Truck 1.25, Bus 1.50, SemiTruck 2.00 | R25 |
| `FIRST_TO_SECOND_ALERT_S` | 30 | R29.3 |
| `SECOND_TO_FINAL_ALERT_S` | 5 | R30.4 |
| `FINAL_TO_INACTIVE_S` | 2 | R36 |
| `TAKEOVER_PERIOD_S` | 30 | SR7 (and SD7) |
| `MRM_SHOULDER_TIME_LIMIT_S` | 60 | SR1.1.1 |
| `MRM_MIN_LANE_DWELL_S` | 2 | SR1.1.2 |
| `STEER_RESUME_STABLE_S` | 3 | R39.2 |
| `STEER_RESUME_SPEED_BAND_MPH` | 1.0 | R39.2 |
| `GRIP_MIN_AREAS` | 2 | R35 |
| `POST_TAKEOVER_RECHECK_S` | 20 | R38.4 (SD7 note: "after 20 seconds reactivation") |
| `REACTIVATION_BUFFER_S` | 30 | R38.2, R41.2 |
| `RECLAIM_LIMIT_COUNT` / `RECLAIM_WINDOW_S` | 3 / 300 | R41 |
| `CORRUPTION_BLOCK_S` | 20 | R44.2 |
| `MAP_MAX_AGE_MONTHS` | 7 | IR16 |
| `SENSOR_DATA_MAX_AGE_MS` | 100 | IR5.8 |
| `GPS_CORRECTION_MAX_AGE_S` | 5 | IR5.8 |
| `REDUNDANT_AGREEMENT_M` | 0.3 | IR5.8 |
| `UNSTABLE_ACCEL_CHANGE_FTPS2` / window | 10 ft/s² within 1 s | IR8.2 |
| `UNSTABLE_GAP_CHANGE_FRAC` / window | 30 % of trail distance within 3 s | IR8.3 |
| `UNSTABLE_MIN_TIME_HEADWAY_S` | 1.0 | IR8.3 ("or the time is under 1.0 second", read as time headway; ISSUE-08) |
| `SEVERITY_BANDS` | low 0–24, middle 25–74, high 75–100 | R37.2 |
| `DEFAULT_MAX_BRAKING_DECEL_FTPS2` | 11.5 | R22 worked example; per-vehicle config (2.1 site adaptation) |

### 1.2 Assumptions (prototype defaults; confirm with the team)

| Constant | Default | Why needed | ID |
|---|---|---|---|
| `SAFETY_CUSHION_S` | 0.5 s × speed × sizeFactor | R22 uses a "safety cushion"/"safety zone" without a formula; this reproduces the SRS example (44 ft at 60 mph behind a car) | A-03 |
| `FORWARD_SENSOR_RANGE_FT` | 800 | R4.2 cap; no value in SRS | A-04 |
| `ATTENTION_LOSS_DETECT_S` | 3.0 | Continuous eyes-off-road time before DATS "detects attention loss" (R29) | A-06 |
| `START_SEQUENCE_S` | 1.0 | Duration of self-tests + validation (R14, R42) | A-07 |
| `GAP_SETTINGS_S` | Near 2.0 / Medium 2.5 / Far 3.0 | Driver gap options (Driver.selectedGap enum) | A-08 |
| `COAST_DECEL_FTPS2` | 1.5 | Natural deceleration with zero throttle (R21, IR13) | A-09 |
| `ACC_MAX_ACCEL_FTPS2` | 3.0 | Comfort limit when resuming set speed | A-09 |
| `MRM_DECEL_FTPS2` | 5.0 | Controlled-stop deceleration (SR1); 60 mph → stop in 17.6 s / 774 ft | A-12 |
| `PHANTOM_BRAKE` | 0.5 s at 4.0 ft/s² | R31.3 "phantom brake" magnitude | A-13 |
| `MAX_LATERAL_ACCEL_FTPS2` | 8.0 | Curve "too sharp" threshold (UC9): v²·κ > limit → Class A. At 60 mph, radius < 968 ft | A-14 |
| `LARGE_VEHICLE_OFFSET_FT` | 1.0 | UC12 target offset away from Truck/SemiTruck/Bus in adjacent lane, clamped to stay in lane | A-15 |
| `LANE_WIDTH_FT` | 12 (3.66 m) | Scenario default | A-16 |
| `STEER_INPUT_THRESHOLD` | 0.05 (normalized) | Below this the driver is "holding", not "steering" (R39 resume) | A-17 |
| Vehicle dimensions (L × W ft) | Car 15×6, SUV 16×6.5, Truck 20×7, Bus 40×8.5, SemiTruck 70×8.5 | R6 classify by length; R4.3 overlap by width | A-18 |
| ODD thresholds | `roadMoisture > 0.3` or `visibility < 150 m` or weather ∈ {Rain, Sleet, Snow, Fog, Ice} or light ∈ {Night, LowAngleSun} → outside ODD | IR5.1, IR5.4, `isWithinODD()` | A-10 |
| Error-code catalog | see §9 | R37 severities are per fault but no catalog exists | A-19 |

---

## 2. Formulas (SRS R4, R22, R25, IR9) with test vectors

All in feet and seconds; `v` = ego speed in ft/s.

```
timeGap        = max(driverSelectedGap, MIN_TIME_GAP_S)                 // R25, IR9
trailDistance  = v * timeGap * SIZE_FACTOR[lead.sizeClass]              // R25
brakingDist    = v^2 / (2 * maxBrakingDecel)                             // R4.1.1 (garbled in SRS; ISSUE-03)
selectionDist  = min(trailDistance + brakingDist, FORWARD_SENSOR_RANGE_FT)  // R4.1, R4.2
safetyCushion  = SAFETY_CUSHION_S * v * SIZE_FACTOR[lead.sizeClass]      // A-03
gap            = distance from ego front bumper to lead rear bumper
closingSpeed   = max(0, v - v_lead)                                      // R22.1
a_req          = gap <= safetyCushion ? +Infinity                        // R22.3
               : closingSpeed^2 / (2 * (gap - safetyCushion))            // R22.1
brake at a_req      if a_req <= maxBrakingDecel                          // R22, R22.2
Class A reclaim     if a_req >  maxBrakingDecel                          // R23
```

For `trailDistance` when there is no lead, use sizeFactor 1.00 (selection distance needs a value).

**Test vectors (must be unit tests, tagged with the IDs):**

| # | Inputs | Expected | IDs |
|---|---|---|---|
| T1 | 60 mph (88 ft/s), gap setting 2.0 s, lead = Car | trailDistance = 176 ft | R25, IR9 |
| T2 | 60 mph, driver gap 1.5 s | timeGap clamps to 2.0 → 176 ft | IR9 |
| T3 | 60 mph, lead Truck / Bus / SemiTruck | 220 / 264 / 352 ft | R25 |
| T4 | 60 mph, maxBrakingDecel 11.5 | brakingDist ≈ 336.7 ft; selectionDist ≈ 512.7 ft | R4.1 |
| T5 | 85 mph | trail+braking ≈ 925 ft → clamped to 800 ft | R4.2, A-04 |
| T6 | 60 mph, Car lead, gap 100 ft, closing 20 mph (29.33 ft/s), cushion 44 ft | a_req ≈ 7.68 ft/s² ≤ 11.5 → brake | R22 (SRS example) |
| T7 | Same, closing 30 mph (44 ft/s) | a_req ≈ 17.29 ft/s² > 11.5 → Class A reclaim | R23 (SRS example) |
| T8 | gap 40 ft, cushion 44 ft | a_req = +∞ → Class A | R22.3 |
| T9 | lead faster than ego | closingSpeed = 0, a_req = 0, no braking | R22.1 |

**In-lane test (R4.3):** project the other vehicle onto the blue path; it is "in lane" if its lateral extent `[y − w/2, y + w/2]` overlaps the ego corridor `[pathY − egoW/2, pathY + egoW/2]`. Lead = nearest such vehicle ahead with `0 < gap ≤ selectionDist` (R4).

---

## 3. Following zones (R5, R21, R22, R24) — A-05

The SRS names Closing, Coast and Safety zones but never gives their boundaries. Proposed, consistent with the SRS example and UC13:

| Zone | Condition | Longitudinal behavior |
|---|---|---|
| (no lead) | no in-lane vehicle within selectionDist | `resumeSetSpeed()`: accelerate ≤ `ACC_MAX_ACCEL` toward `min(setSpeed, 85 mph)` (R24, IR27) |
| Closing | `trailDistance < gap ≤ selectionDist` | `holdSpeed()` — keep current speed (R5). *A-05b:* if `v < setSpeed` and the lead is faster, hold — do not accelerate (literal R5) |
| Coast | `safetyCushion < gap ≤ trailDistance` | `coastToMatchLead()`: zero throttle (−`COAST_DECEL`) while `v > v_lead`; once matched (±0.5 mph), track lead speed and hold gap ≈ trailDistance with a gentle P-controller, never exceeding setSpeed (R21, IR9) |
| Safety | `gap ≤ safetyCushion` | a_req = ∞ → Class A (R22.3, R23) |

**R22 runs every tick in every zone**: if the coast deceleration cannot remove the closing speed before the cushion (`a_req > COAST_DECEL`), brake at `a_req` when `a_req ≤ maxBrakingDecel`, else Class A reclaim. This matches SD3 (brake path) and UC14.

`currentZone` is part of the state snapshot and is drawn as colored bands ahead of the ego car.

---

## 4. Lateral control (R2, R18, R20, UC9, UC12, R39)

- Blue path = centerline of the ego's current lane + `targetOffset` (R2, R20). `pathConfidence` = 1.0 when both lane-position sources agree and both markings are visible; drops when a source is lost or markings vanish.
- `isPathValid()` = path exists AND `pathConfidence ≥ 0.5` AND map not outdated AND road enabled (UC5, IR16). Invalid while engaged → Class A (IR14).
- `keepLaneCentered()`: steering command proportional to lateral error and heading error (simple kinematic bicycle or point-mass model; physics fidelity is not the goal). Test: |lateralOffset| + egoWidth/2 ≤ laneWidth/2 at all ticks while engaged (R18).
- `navigateCurve()` (UC9): look ahead along the path; if `v²·κ_max > MAX_LATERAL_ACCEL` within the next 5 s of travel → Class A reclaim (reason `CURVE_TOO_SHARP`).
- UC12: Truck/SemiTruck/Bus in an adjacent lane within ±1 vehicle length → `targetOffset = ±LARGE_VEHICLE_OFFSET_FT` away from it, clamped so the ego stays inside its lane.
- HFDS never changes lanes except during SR1 (MRM).

---

## 5. Availability and engagement (IR1–IR8, IR16, IR23, IR28, R14–R17, R42, R43, R47–R49)

### 5.1 Availability (computed every tick)
`available = all of:`

| Check | IDs |
|---|---|
| Road is DividedHighway and enabled in LiDAR map; not at/near end of enabled road (UC17: ≥ 10 s of travel remaining, A-20) | IR1 |
| Both lane markings visible | IR2 |
| Driver engaged (eyes on road, DATS OK) | IR3 |
| Every subsystem status OK | IR4 |
| None of IR5.1–IR5.10 | IR5 |
| Traffic stable (IR8.1–IR8.3) | IR8 |
| Map age ≤ 7 months | IR16 |
| No unresolved high-severity error; middle-severity cleared + 30 s buffer elapsed | IR23, R38 |
| No cooldown active (R38.4 20 s, R41.2 30 s, R44.2 20 s) | R38, R41, R44 |
| Not locked until ignition cycle | IR10 |
| Speed > 3 mph | IR28 |

The HMI "HFDS available" indicator = `available` (IR6). The checklist panel shows each line with pass/fail and its IDs (this doubles as the v1 "annotated interface").

### 5.2 Button press (IR7, R12, R43, R16, R49, R42)
1. Ignore if within 0.5 s of the previous press (R43; log as info).
2. If HFDS is engaged (any engaged sub-state) → treat as stop request: disengage, log (R12, R45.2). If in STARTING → queue the stop until the start sequence finishes (R42).
3. If not engaged and **not available** → HMI error on dashboard (+ HUD if `hasHUD`, + light bar flash if `hasLightBar`) (R16), activation warning listing failed checks (R49), log.
4. If available → enter STARTING for `START_SEQUENCE_S`: run `selfTest()` on all sensors (R14), `validateEngagement()` (R15, R47), VehicleControl reports conditions met (R48.1). Any failure → REJECTED (R49). Success → VehicleControl confirms (R48.2) → ENGAGED_HANDS_FREE, log engagement (R45.1), ACC on with setSpeed = current speed if none set (R17), FCS mode "Alert and Brake" (IR22).

---

## 6. HFDS mode state machine (derived — the SRS has no state diagram)

```
                 ┌──────────────┐  available   ┌───────────┐
   ignition ───► │ UNAVAILABLE  │ ───────────► │ AVAILABLE │
                 └──────────────┘ ◄─────────── └───────────┘
                        ▲         not available     │ button (debounced)
                        │                           ▼
                        │                    ┌────────────┐ checks fail ──► UNAVAILABLE (+R49 warning)
                        │                    │  STARTING  │
                        │                    └────────────┘
                        │                           │ checks pass
                        │                           ▼
   driver brake / button / takeover    ┌───────────────────────────────┐
   (→ DISENGAGED cooldown) ◄────────── │ ENGAGED                       │
                                       │  ├ HANDS_FREE      (solid green)
                                       │  ├ DRIVER_STEERING (pulsing blue)   R39
                                       │  ├ ALERT_FIRST     (flashing green) R29  Class B
                                       │  ├ ALERT_SECOND    (flashing red)   R30  Class B
                                       │  ├ ALERT_FINAL     (flashing red)   R31  Class B
                                       │  └ TAKEOVER_REQUESTED (flashing red)    Class A, UC19
                                       └───────────────────────────────┘
                                            │ driver inactive (R36) / no takeover in 30 s (SR7)
                                            ▼
                                     ┌──────────────────────┐
                                     │ MINIMAL_RISK_MANEUVER│  SR1 (hazards, OnStar, unlock)
                                     └──────────────────────┘
                                            │ stopped
                                            ▼
                                     ┌──────────────────────┐
                                     │ STOPPED_LOCKOUT      │  IR10 until ignition cycle
                                     └──────────────────────┘
```

| From | Event / guard | To | Actions | IDs |
|---|---|---|---|---|
| any engaged (incl. alerts, takeover) | driver brake | UNAVAILABLE/AVAILABLE (cooldown per cause) | cancel ACC, update display, log disengagement, R40 banner "You are in control" | IR15, R50, IR25, R40 |
| MRM | driver brake or firm grip + steering | UNAVAILABLE | abort MRM, driver in control, hazards stay on, log | IR25 (A-21) |
| HANDS_FREE | driver steering input > threshold, no takeover request | DRIVER_STEERING | pulsing blue; HFDS stops lateral commands, ACC continues | R39.1, IR25 |
| DRIVER_STEERING | 3 s with speed within ±1.0 mph band AND firm grip (≥ 2 areas) AND steering input < threshold | HANDS_FREE | `resumeAfterDriverSteering()`, solid green | R39.2, R35 |
| HANDS_FREE / DRIVER_STEERING | eyes off road continuously ≥ `ATTENTION_LOSS_DETECT_S` | ALERT_FIRST | Class B warning: flashing green, "Pay attention to the road.", log | R27, R29 |
| ALERT_FIRST | attention loss continues 30 s after first alert start | ALERT_SECOND | flashing red, chime **or** seat vibration (config), "Take steering control immediately.", log; acceleration inhibited | R29.3, R30, IR12 |
| ALERT_SECOND | continues 5 s after second alert start | ALERT_FINAL | continuous seat vibration, voice prompt, phantom brake, log | R30.4, R31 |
| ALERT_* | eyes back on road | previous engaged sub-state | cancel alert, log | R32 |
| ALERT_FINAL | no re-engagement 2 s after final alert start | MINIMAL_RISK_MANEUVER | `markDriverInactive()`, log disengagement | R36, IR11, SR6 |
| any engaged | Class A cause (see §7) | TAKEOVER_REQUESTED | Class A warning, flashing red, "Take steering control immediately.", hold lane, coast, no acceleration, `logTakeoverRequest()`, count toward R41 | R23, R28.1, IR12–IR14, IR26, UC19 |
| TAKEOVER_REQUESTED | takeover confirmed: firm grip ≥ 2 areas, or driver steering, or driver brake | UNAVAILABLE (cooldown) | control to driver, R40 banner, log; re-check after 20 s, show "HFDS available" when checks pass | R35, R38.4, R40, UC18 |
| TAKEOVER_REQUESTED | 30 s without takeover | MINIMAL_RISK_MANEUVER | log | SR7 |
| MRM | vehicle stopped | STOPPED_LOCKOUT (if driver unresponsive) | hazards on, OnStar connected, doors unlocked | SR1.2–SR1.4, IR10 |
| STOPPED_LOCKOUT | Director "ignition cycle" | UNAVAILABLE | reset | IR10 |
| any | 3rd system-initiated reclaim within 300 s | UNAVAILABLE + 30 s buffer | deactivate | R41 |
| any | Director "corrupt control process" | UNAVAILABLE | reset to defaults, block 20 s | R44 |
| HANDS_FREE | sensor fault **with** redundant source | HANDS_FREE (stays) | switch source, log error code, solid green | SR4.4, R37 |

**Priority when several things happen in one tick:** driver brake > driver takeover > MRM > Class A > Class B > R39 steering pause. Class A while a Class B alert is active replaces it (the Class A warning is active; Class B is cancelled and logged as superseded) — A-22.

### Light bar mapping (R33, R34, R39.1, R29.1, R30.1, UC19)

| Mode | Light bar | Hands-free allowed (R33.1) |
|---|---|---|
| UNAVAILABLE / AVAILABLE / STARTING / STOPPED_LOCKOUT | Off | no |
| HANDS_FREE | SolidGreen | **yes** |
| DRIVER_STEERING | PulsingBlue | no |
| ALERT_FIRST | FlashingGreen | no |
| ALERT_SECOND, ALERT_FINAL, TAKEOVER_REQUESTED, MRM | FlashingRed | no |

**Invariant tests (every tick, every scenario):** FlashingRed ⇒ no positive acceleration command from HFDS (IR12); driver inactive ⇒ not HANDS_FREE (IR11); commanded speed ≤ 85 mph (IR27); while engaged, gap ≥ safetyCushion unless a Class A is active (IR9 intent); log entries have timestamps (R45).

---

## 7. Class A causes (R28.1)

| Cause | Detection | IDs |
|---|---|---|
| Braking insufficient | a_req > maxBrakingDecel or gap ≤ cushion | R22.3, R23 |
| Hazard in lane | Hazard on ego lane within selectionDist | IR26, UC10 |
| Sensor fault without redundancy / single point of failure | self-test fails and no redundant source | IR14, SR3, IR24 |
| DATS loss or camera tamper | DriverCamera failed/blocked or tamper | SR2, SR5 |
| Invalid blue path | `isPathValid()` false | IR14 |
| Map mismatch | `detectMismatch()` true (e.g., unmapped construction) | R10, IR14 |
| ODD exit while engaged | any IR5.x or IR1/IR2 violation, map becomes outdated (IR16) | IR5, IR16 |
| Curve too sharp | §4 | UC9 |
| End of enabled road ahead | UC17 | IR1 |
| Forward-collision warning escalates | Director "FCW escalation" | IR5.10 |

**Forward Collision System (A-25).** The SRS assumes an existing FCS set to "Alert and Brake" while HFDS is engaged (IR22) but does not specify it. Minimal model so IR13 coasting cannot drive into a stopped object: if an in-lane object's time-to-collision < 2.0 s, the FCS brakes at `maxBrakingDecel` independent of HFDS mode, shows "Forward collision alert" and logs it. HFDS still follows its own Class A / SR1 flow.

**Manual driving (A-26).** When HFDS/ACC is off and the driver gives no pedal input, the ego holds its current speed. This keeps scenarios readable; it is not a requirement.

---

## 8. Minimal Risk Maneuver (SR1, UC21)

1. On entry: hazard lights on (SR1.2), log; start 60 s timer.
2. **Shoulder reachability** (SR1.1.1) evaluated at entry and every tick: a right shoulder exists, each lane between ego and shoulder has a safe gap (no vehicle within ±1.5 s of travel or 60 ft of the ego in the target lane — A-23), and the remaining time allows the lane changes (each ≥ 2 s dwell, SR1.1.2) plus the stop within the 60 s limit.
3. Reachable → move right **one lane at a time**, staying ≥ 2 s in each entered lane before the next lateral move, including shoulder entry (SR1.1.2), decelerating at `MRM_DECEL` once on the shoulder (or progressively, keeping safe separation).
4. Not reachable, a check fails mid-maneuver, or 60 s elapses before reaching the shoulder → controlled stop in the current lane (SR1.1, SR1.1.1).
5. On stop: OnStar advisor "connecting" → "connected" (SR1.3), doors unlocked (SR1.4), log; if triggered by an unresponsive driver → STOPPED_LOCKOUT until ignition cycle (IR10).

---

## 9. Faults, error codes and re-engagement (R9, R37, R38, IR23, IR29b) — catalog is A-19

| Code | Fault | Severity | Band | Redundant source? | Effect while engaged |
|---|---|---|---|---|---|
| E101 | Front camera obstructed/failed | 60 | middle | Lane position: LiDAR map + GPS. Lead distance: radar | Stay engaged (SR4.4) if the partner sources are OK; else Class A |
| E102 | Front radar failed | 50 | middle | Lead distance: front camera | SR4.4 or Class A |
| E103 | LiDAR sensor fault | 40 | middle | Lane position: camera | SR4.4 or Class A |
| E104 | GPS receiver fault | 70 | middle | Lane position: camera | SR4.4 or Class A |
| E105 | GPS correction stale (> 5 s) | 20 | low | — | IR5.8 health → Class A; re-engage when constraints met (R38.1) |
| E106 | Redundant sources disagree > 0.3 m | 55 | middle | — | IR5.8 → Class A |
| E201 | Map data error/unavailable | 80 | high | — | IR5.7 → Class A; blocked until cleared (IR23) |
| E202 | Map outdated (> 7 months) | 30 | middle | — | IR16 refuse/disengage, "Update needed" |
| E203 | Map mismatch (e.g. construction) | 60 | middle | — | R10, IR14 → Class A |
| E301 | Path Prediction fault | 80 | high | — | R9.4 → Class A |
| E401 | Driver camera failed/blocked | 85 | high | — | SR5 → Class A |
| E402 | Driver camera tampering | 90 | high | — | SR2 → Class A |
| E501 | Control process corrupted | 75 | high | — | R44: reset + 20 s block |
| E601 | Primary compute/power failure | 95 | high | Backup compute (SR4.3) | Backup holds lane; Class A |

Every error log entry carries sensor metadata `{sensorId, type, status, lastReadingAt}` (IR29b) and a description (R37.1).

**Re-engagement after a fault (R38):** low → when all Section 3.3 constraints hold again; middle → fault cleared AND 30 s buffer elapsed AND engagement checks pass; high → blocked until cleared (IR23), then as middle; after any driver takeover → re-run checks at +20 s and show "HFDS available" when they pass (R38.4).

---

## 10. Driver input arbitration (IR25, R50, R39) — per tick

1. **Brake pedal** → VehicleControl brakes at the driver's rate; if HFDS engaged → disengage (IR15, R50).
2. **Throttle** → driver's acceleration overrides ACC while pressed; HFDS stays engaged (A-24). HFDS itself never accelerates while FlashingRed (IR12), but the driver may.
3. **Steering** → overrides HFDS lateral command. HANDS_FREE → DRIVER_STEERING (R39). In TAKEOVER_REQUESTED / ALERT_* → counts as takeover (UC18).
4. **Grip areas** → used for R35 confirmation and R39.2 resume.
5. **Gaze** (eyes on/off road) → DATS (R27).

---

## 11. Engine tick order (fixed, 20 Hz)

1. Apply queued client inputs and Director injections stamped for this tick; run scenario timeline events whose `t` ≤ simTime.
2. Advance world: traffic vehicles (scripted behaviors), hazards, environment.
3. Sensors: `selfTest()` + `read()` for every sensor (IR29, SR10); record data ages.
4. VehiclePosition: update + validate (R3, SR4.1); PathPrediction: blue path (R2).
5. DriverAssistSystem: `analyzeSurroundings()` (R19), classify (R6), relative speed/accel (R7), lead selection (R4), zones (R5, R21), `brakeForClosingSpeed()` (R22, R23), hazards (IR26), lane intrusion (UC11), curves (UC9), large vehicles (UC12).
6. DATS: monitor, tamper check, escalation timers (R27–R36, SR2, SR5).
7. HFDS mode machine: availability, button handling, transitions (§5–§8), cooldowns, R41 counter.
8. Build HFDS ControlCommands; VehicleControl arbitrates with driver input (IR25) and enforces IR12, IR27.
9. Integrate ego kinematics (dt = 0.05 s × timeScale steps; always fixed dt per step).
10. HMI state update (R46), event log append (R45), invariant assertions in dev/test builds.
11. Emit `state` snapshot; emit `event` messages for anything logged this tick.

Determinism: same scenario + seed + input log ⇒ identical final state (replay test). Use only the seeded PRNG; never `Math.random()` or wall-clock time in `engine/`.
