# 16 — SRS Issues, Prototype Assumptions, Open Questions

Three lists:
- **ISSUE-xx** — defects or gaps found in the SRS while preparing the prototype. Each has a proposed resolution. Fixing them in the SRS is a team task; the prototype follows the proposed resolution meanwhile.
- **A-xx** — assumptions the prototype makes where the SRS is silent. Each is a named constant or isolated rule so it can change in one place. The caption/trace panel should list assumptions a scenario relies on.
- **Q-xx** — questions only the team, customer or instructor can answer.

**Rule for the build:** never silently invent behavior. If something new comes up that is not covered here, add an A-xx entry (and, if it reveals an SRS problem, an ISSUE-xx) in this file in the same change.

---

## SRS issues

| ID | Where | Problem | Proposed resolution (used by the prototype) |
|---|---|---|---|
| ISSUE-01 | 3.3 IR29 | ID used twice ("check every 50 ms" and "error logs contain metadata"). | Call the second **IR29b** in code/tests; renumber in the SRS (e.g. IR30). |
| ISSUE-02 | Section 3 | IDs are non-sequential (R26 absent, SR9 and IR17–IR21 under 3.4, R4 after R8). | Informational. Never renumber in code; always use the SRS IDs. |
| ISSUE-03 | R4.1.1 | Braking-distance sentence is garbled ("speed squared, divided by twice. MaxBrakingDecel(in feet)"). | `brakingDistance = v² / (2 · maxBrakingDecel)`, v in ft/s, result in ft. |
| ISSUE-04 | R4.3 note | "The weight of the vehicle enters through a_b" — `a_b` is never defined. | Treat `a_b` as `maxBrakingDecel` (vehicle-specific per 2.1 site adaptation). |
| ISSUE-05 | R5, R21, R22, UC13 | Closing / Coast / Safety zone boundaries and the "safety cushion" have no formula. The R22 example gives 44 ft at 60 mph behind a car. | A-03 and A-05 (doc 13 §3). |
| ISSUE-06 | R6, R25 vs domain model | R6/R25 include **SUV**; the `VehicleSizeClass` enum lists only Car, Truck, SemiTruck, Bus. | Add SUV (size factor 1.00). |
| ISSUE-07 | R22 example, IR8.2 | Units truncated ("7.7 ft/", "11.5 ft/", "10 ft/"). | ft/s². |
| ISSUE-08 | IR8.3 | "…or the time is under 1.0 second." (and a stray closing quote). Which time? | Time headway (gap ÷ ego speed) < 1.0 s. |
| ISSUE-09 | IR9 | Circular: "keep a trail distance of at least trail distance". | At least `v · max(driverGap, 2.0 s)` (× size factor per R25). |
| ISSUE-10 | R29 | When does DATS "detect attention loss"? No duration threshold. | A-06 (3 s continuous eyes-off-road). |
| ISSUE-11 | IR3 vs R29–R31 | IR3 says HFDS operates only while the driver is engaged, but R29–R31 keep HFDS engaged through ~37 s of escalating alerts. | IR3 gates *engagement*; while engaged, inattention is handled by R29–R31/R36/SR6. Reword IR3. |
| ISSUE-12 | IR5.6, IR5.7 vs SR4.4 | IR5.6/5.7 require disengagement on any obstructed sensor or GPS error; SR4.4 requires continuing on a redundant source. | Refuse *engagement* on any sensor fault (R14, IR5.6/5.7). *While engaged*, SR4.4 applies when a redundant source exists; otherwise Class A. |
| ISSUE-13 | R39.2, UC8 | Resume requires a firm grip for 3 s, but gives no way to tell "holding" from "steering". UC8's sentence is garbled ("keeps the steering wheel at the same speed"). | A-17: resume when steering input stays below a threshold for the same 3 s. Fix UC8 text to match R39.2. |
| ISSUE-14 | R41 | When does the 30 s buffer start, and what does "until the surroundings are stable" add to a fixed 30 s? Does the 3rd request still give the driver a takeover period? | The 3rd request runs the normal takeover flow; the buffer starts when control returns to the driver; then IR8 stability must also hold. |
| ISSUE-15 | R38.2, R38.4, R41.2, R44.2, IR23 | Several cooldowns can overlap. | Re-engagement allowed only when **all** active cooldowns have expired (A-30). |
| ISSUE-16 | UC19, R28.1 | Class A channels unspecified beyond red light bar and message. | Class A = flashing red + "Take steering control immediately." + chime (or seat pulse if `secondAlertMode = seat`). |
| ISSUE-17 | 4.3.7 text vs SD7 diagram, IR14, IR26 | Text implies a plain warning first and Class A "if no steering response in the proper amount of time"; diagram and IR14/IR26 issue Class A immediately. | Immediate Class A (IR14/IR26 are invariants). Fix the 4.3.7 text. |
| ISSUE-18 | SD4 diagram | Takeover-window label in the low-resolution diagram reads like "3 s", conflicting with SR7's 30 s. | Use SR7: 30 s. Re-export the diagram at higher resolution and check the label. |
| ISSUE-19 | SR1, SR1.1.1 | Controlled-stop deceleration and the "time, distance, and safe-path checks" are undefined. | A-12, A-23. |
| ISSUE-20 | R31.3 | "Phantom brake" magnitude/duration undefined. | A-13. |
| ISSUE-21 | IR13 vs stopped hazards | "Hold lane and coast without accelerating" could coast into a stopped vehicle during the 30 s takeover period. The Forward Collision System (IR22) is assumed but unspecified. | A-25 minimal FCS model (automatic braking at short time-to-collision). |
| ISSUE-22 | IR25 | Driver throttle while engaged: override, pause or disengage? | A-24: temporary override, HFDS stays engaged. |
| ISSUE-23 | Section 4 | No state diagrams (the template's "Start of your text" is empty), yet HFDS is mode-driven. | Use the derived machine in doc 13 §6; add it to the SRS as a state diagram. |
| ISSUE-24 | Data dictionary | DriverAssistSystem and SpeedManagement both list the ACC attributes/operations. | ACC lives in SpeedManagement; DriverAssistSystem delegates. |
| ISSUE-25 | Data dictionary | Mixed units (Lane.width and visibility in m, gaps in ft, speeds in mph). | A-02 internal units; convert at boundaries. |
| ISSUE-26 | R37, R38 | Severity bands are defined but no error-code catalog assigns severities. | A-19 catalog (doc 13 §9); needs team sign-off (Q-06). |
| ISSUE-27 | R16.2 | "front window screen" | Treat as head-up display (HUD); `vehicleConfig.hasHUD`. |
| ISSUE-28 | Document | "Figure ____" placeholders, empty 2.4 bullets, template text and red notes still present; Section 4 numbering (domain model has no number, sequences are 4.3). | Clean up before submission (not a prototype concern). |
| ISSUE-29 | R16 vs R49 | Both specify the rejection display. | One rejection path satisfies both: R16 channels + R49 activation warning naming the failed checks. |
| ISSUE-30 | IR5 "shall disengage" while engaged | Instant disengagement would drop control with hands off the wheel, conflicting with IR24 (fail-safe = driver control) and UC18. | While engaged, an IR5 violation raises a Class A takeover request (A-29). |
| ISSUE-31 | R42 | "start sequence" undefined. | A-07. |
| ISSUE-32 | UC17, IR1 | How far ahead the end of the enabled road triggers a takeover is undefined. | A-20. |
| ISSUE-33 | References (Section 6) | Only a placeholder reference (Thakore & Biswas 2005) unrelated to HFDS. | Team to add real references (customer spec, hosting guide, etc.). |
| ISSUE-34 | Kit: doc 13 §5.2 vs §6 / doc 14; doc 12 HMI vs s02/s03 | (a) §5.2 names modes `REJECTED` and `ENGAGED_HANDS_FREE`, which are not in the §6 machine or the doc 14 mode list. (b) s02/s03 check `hmi.dashboardError` (R16.1), and §5.2 asks for an R49 "activation warning listing failed checks", but neither field is in the doc 12 HMI shape. | (a) No REJECTED mode: a rejection is a logged event + R16/R49 HMI output, then the mode follows availability (UNAVAILABLE or AVAILABLE). `ENGAGED_HANDS_FREE` = `HANDS_FREE`. (b) Add `dashboardError?: string` and `activationWarning?: string` to HmiState. Found in M0. |
| ISSUE-35 | Kit: presets vs doc 15 B2 | Scenario `requirements` and some `expect[].reqs` cite use cases (UC2…UC21), which are not in requirements.json and not matched by the B2 trace regex. | The schema accepts `UC\d+` alongside R/SR/IR IDs; the trace matrix counts only SRS §3 IDs, so UC tags are informational. Found in M0. |
| ISSUE-36 | Kit: doc 15 Part A CI vs doc 17 M0 | Part A's workflow runs only `npm test` + build, but doc 17 M0 requires lint and the Playwright smoke test to pass in CI. `npm test` is also watch mode locally (Part A step 3). | `deploy.yml` adds a `verify` job (lint, format check, `test:run`, build, Playwright) that gates the Part A publish job; CI calls `test:run`. Part A's publish step is unchanged. Found in M0. |
| ISSUE-37 | Kit: presets vs doc 14 "Expectations" | Two forms used by the drafts are not in the doc 14 vocabulary: (a) setup checks with `reqs: []` (s02, s03, s04, s08, s15: "engaged before the event under test"); (b) an anchor as a window bound (s04 `from: 3.2, to: "classA"`); also a bare `after: "mrm"` (s12) where doc 14 shows `"<anchor>+<seconds>"`. | Schema accepts all three: empty `reqs` marks a setup check (runs, traces nothing); `from`/`to` take seconds or an anchor; a bare anchor means +0 s. Presets unchanged. Found in M0. |
| ISSUE-38 | SD5 vs Warning class | SD5 issues a Warning for the outdated map ("Issue-Warning"), but `Warning.warningClass` is only A (takeover) or B (attention). | Activation warnings (R49, IR16 "Update needed") are HMI messages plus `warning` log entries (R45.3), not Class A/B Warning objects, so `activeWarnings` keeps meaning "Class A/B in force". Found in M2. |
| ISSUE-39 | Kit: doc 14 expectation timing | Doc 14 gives the trigger names but not their exact semantics (tolerance of `at`, meaning of spatial triggers, `logged` with a window). | Semantics fixed in `src/engine/scenario/expectations.ts`: `at`/`after`/`whenEgoSFt` hold within ±1 tick; `by` at some tick ≤ t; `from`/`to` at every tick; `whenEgoSFtAtLeast`, `whenHazardWithinFt`, `beforeSFt` and no trigger hold at some tick where the condition holds; `logged` applies the same windows to entry times. Found in M2. |

---

## Prototype assumptions

| ID | Assumption | Default | Where |
|---|---|---|---|
| A-01 | Build target is the interactive **v2** architecture; v1 expectations are met by captions, checklist and scripted autoplay of each preset | — | doc 17 |
| A-02 | Engine units: ft, s, ft/s, ft/s²; mph and m only at boundaries | — | doc 12 |
| A-03 | Safety cushion = 0.5 s × v × sizeFactor (reproduces 44 ft at 60 mph, car) | 0.5 s | doc 13 §1.2 |
| A-04 | Forward sensor detection range | 800 ft | R4.2 |
| A-05 | Zones: Closing = trail < gap ≤ selection; Coast = cushion < gap ≤ trail; Safety = gap ≤ cushion. R22 checked every tick | — | doc 13 §3 |
| A-05b | In the closing zone HFDS holds current speed literally (does not accelerate toward set speed) | — | R5 |
| A-06 | DATS detects attention loss after continuous eyes-off-road | 3.0 s | R29 |
| A-07 | Start sequence (self-tests + validation) duration | 1.0 s | R14, R42 |
| A-08 | Driver gap settings | Near 2.0 / Medium 2.5 / Far 3.0 s | Driver.selectedGap |
| A-09 | Coast deceleration; ACC resume acceleration | 1.5 / 3.0 ft/s² | R21, R24 |
| A-10 | ODD: outside if weather ∈ {Rain, Sleet, Snow, Fog, Ice}, light ∈ {Night, LowAngleSun}, roadMoisture > 0.3, or visibility < 150 m | — | IR5.1, IR5.4 |
| A-11 | Time-scale control (0.5×–4×) runs extra fixed 50 ms steps; never changes dt | — | protocol |
| A-12 | MRM controlled-stop deceleration | 5.0 ft/s² | SR1 |
| A-13 | Phantom brake | 0.5 s at 4.0 ft/s² | R31.3 |
| A-14 | Curve too sharp when v²·κ exceeds | 8.0 ft/s² | UC9 |
| A-15 | Large-vehicle lateral offset (clamped inside lane) | 1.0 ft | UC12 |
| A-16 | Lane width | 12 ft (3.66 m) | scenarios |
| A-17 | Driver "steering" if |steer input| ≥ threshold | 0.05 | R39 |
| A-18 | Vehicle dimensions (L × W ft): Car 15×6, SUV 16×6.5, Truck 20×7, Bus 40×8.5, SemiTruck 70×8.5 | — | R6, R4.3 |
| A-19 | Error-code catalog and severities | doc 13 §9 | R37 |
| A-20 | End of enabled road: Class A when < 10 s of travel remain; not available below that | 10 s | UC17 |
| A-21 | During MRM, driver brake or grip+steer ends the maneuver and returns control | — | IR25 |
| A-22 | Class A supersedes an active Class B alert | — | R28 |
| A-23 | MRM lane change is safe if no vehicle in the target lane within ±1.5 s of travel or ±60 ft of the ego | — | SR1.1.1 |
| A-24 | Driver throttle temporarily overrides ACC; HFDS stays engaged | — | IR25 |
| A-25 | Minimal Forward Collision System: in-lane stationary/slow object with time-to-collision < 2.0 s → automatic braking at maxBrakingDecel, logged | 2.0 s | IR22 |
| A-26 | Manual driving model: with HFDS/ACC off and no pedal input, the ego holds its speed (keeps scenarios readable) | — | engine |
| A-27 | Sensor set: CAM_FRONT, CAM_REAR, CAM_DRIVER, RADAR_FRONT, LIDAR_1, GPS_1, GRIP_L/R/TOP/BOTTOM | — | doc 12 |
| A-28 | Lane IDs: 0 = right shoulder, 1 = rightmost travel lane … n = leftmost | — | doc 14 |
| A-29 | IR5 violation while engaged → Class A takeover request (see ISSUE-30) | — | doc 13 §7 |
| A-30 | Re-engagement waits for the longest active cooldown | — | R38, R41, R44 |
| A-31 | `isPathValid()` requires `pathConfidence ≥ 0.5` (value in doc 13 §4 had no A-xx) | 0.5 | UC5, IR14 |
| A-32 | Coast zone: speeds within ±0.5 mph of the lead count as matched (value in doc 13 §3, recorded as `ACC_SPEED_MATCH_TOL_MPH` under A-05) | 0.5 mph | R21 |
| A-33 | Scripted traffic `setSpeed` changes speed at 5 ft/s² unless the preset gives a rate (doc 14 schema default) | 5.0 ft/s² | scenarios |
| A-34 | Time scale 0.5× runs one fixed step every other real tick (A-11 only covers "extra" steps). Keys `1–4` (doc 15 B6) map to 0.5×, 1×, 2×, 4× | — | protocol, UI |
| A-35 | `src/engine/worker.ts` is the Worker host: the only engine file allowed real-time timers and `fetch` (it drives the pure `engine.step()` and loads presets). All other engine/shared files stay timer-, DOM- and wall-clock-free (lint-enforced) | — | CLAUDE.md rule 4, doc 15 B5 |
| A-36 | Manual-driving kinematics: point mass in the road frame (curves do not move the car; they only feed UC9 checks and are drawn as a tinted straight segment). Throttle 1.0 = 6 ft/s²; brake without a rate = 10 ft/s²; full steer (\|1\|) = 4 ft/s sideways, + = left; display wheel angle = steer × 15°; the ego is clamped to the paved road (shoulder edge to median). Keyboard ←/→ sends steer ±0.5 | 6 / 10 ft/s², 4 ft/s, 15°, 0.5 | IR25, A-26, R1 |
| A-37 | The ego's front bumper starts at s = 0 (hazards and segments use absolute s; traffic `sFt` is relative to it). A run ends at `durationS` or when the ego reaches the end of the road; the host then pauses | s = 0 | doc 14 |
| A-38 | Road frame: lane L's centre is at y = (L − 1) × laneWidth (y + = left); the right shoulder is as wide as a travel lane | — | A-28 |
| A-39 | `EventLog.capacity` = 10 000 entries; beyond it the oldest are dropped and `EventLog.count` keeps the total (R45 runs here are far shorter) | 10 000 | R45 |
| A-40 | Until attention escalation exists (M4), `DriverAttentionSystem.monitorDriver()` sets `Driver.attentionLevel` from `isDriverEngaged()` (eyes on road, driver camera OK, no tampering ⇒ Engaged; otherwise Inattentive). Director injections with no effect yet are logged as "not simulated yet" | — | R27, IR3, doc 14 |
| A-41 | Start-sequence validation (R15): R15.1 road conditions = `Environment.isWithinODD()`; R15.2 current trajectory = the ego is fully inside one travel lane (R18 containment); R15.3 sensor input = camera, radar, LiDAR and GPS data no older than 100 ms; R15.4 blue path = `isPathValid()` | — | R15, R47 |
| A-42 | R48.1 vehicle activation conditions: VehicleControl status OK, speed above 3 mph (IR28) and the brake pedal not pressed (braking would disengage at once, IR15) | — | R48.1 |
| A-43 | R43 debounce: "the previous press" is the previous press of any kind, including ignored ones, and "within 0.5 s" is inclusive (a press exactly 0.5 s later is ignored). Rapid repeated presses therefore keep being ignored | — | R43 |
| A-44 | Display times: R16 / R49 dashboard error, HUD line and activation warning stay 5 s (or until the next engagement); the R16.3 light-bar error is a 2 s amber flash (no SRS colour; `HmiState.lightBarError`), kept separate from FlashingRed, which means "take control" (R34.3); the R40 banner ("HFDS steering" / "You are in control") stays 5 s | 5 s / 2 s / 5 s | R16, R40, R49 |
| A-45 | Any disengagement cancels ACC and returns full control to the driver; a driver button-off (R12) starts no cooldown (R38.4 cooldowns follow takeover requests, M4). The ACC set speed is kept and reused at the next engagement as the "previously set" speed (R17) | — | R12, R17, R50.1 |
| A-46 | Simulated lane-position sources (camera; LiDAR map + GPS) and lead-distance sources (radar; front camera) report the true value, so they agree unless a fault injects a disagreement (M5, E106). GPS corrections download continuously (age 0) until the Director stops them with `staleGpsCorrection`; the age then grows from `ageS` until faults clear | — | R3, R11, IR5.8, SR4.1, SR4.2 |
| A-47 | Blue path = current lane centre + targetOffset, 800 ft long, a point every 25 ft. `pathConfidence` = (lane-position sources available ÷ 2) × (1 with both lane lines visible, else 0.4), so one lost source still allows a valid path (SR4.4) but missing lane lines do not | 800 ft, 25 ft, 0.4 | R2, UC5, A-31 |
| A-48 | IR8 tracking: a vehicle is tracked while within the forward sensor range ahead of or behind the ego; IR8.3 uses the current lead's gap history only (a new lead starts a new history). Director `trafficErraticAccel` = +6 ft/s² for 0.5 s then −6 ft/s² for 0.5 s (a 12 ft/s² change within 1 s); `trafficTailgateGap` moves the vehicle into the ego lane `headwayS` × ego speed ahead, at the ego's speed | 6 ft/s², 0.5 s | IR8, doc 14 |
| A-49 | Director `setEgoLane { laneType: ExitLane \| ServiceDrive }` marks the ego as being in that lane type (IR5.3) until a `setEgoLane { laneId }` | — | IR5.3, doc 14 |
| A-50 | A forward-collision takeover escalation (Director `fcwEscalation`, IR5.10) stays active until the Director clears faults | — | IR5.10 |

---

## Open questions

| ID | For | Question | Blocks |
|---|---|---|---|
| Q-01 | Customer / instructor | **What is the full list of customer-provided scenarios (with their numbers)?** The SRS cites only Scenario 1 (activation) and Scenario 4 (driver brakes). Every customer scenario must have a preset. | Scenario coverage for v1/v2 |
| Q-02 | Team | Confirm A-03 (safety cushion) and A-05 (zone boundaries), then put them in the SRS. | R5, R21, R22 behavior |
| Q-03 | Team / customer | Attention-loss detection threshold (A-06)? | S09, S10 timing |
| Q-04 | Instructor | Which prototype version (v1 or v2) is due next, and when? | Milestone order |
| Q-05 | Team | EGR group name (for the URL and deploy paths) and the GitHub org/repo. | Deployment |
| Q-06 | Team | Sign off the error-code catalog and severities (A-19). | R37, R38 |
| Q-07 | Team | Tech-stack open questions (Git on scully, shared Unix group, `.htaccess` RedirectMatch, required Git host, public vs password-protected). | Deployment |
| Q-08 | Team | Include optional S18 (collision/OnStar) and S19 (cybersecurity) in the demo? | Scope |
| Q-09 | Customer | Imperial units in the HMI (mph, ft) as in the SRS — confirm. | HMI |
