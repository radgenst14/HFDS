# 17 — Build Plan, Milestones and Definition of Done

Order of work for the prototype. Each milestone ends with green tests, a working `npm run build`, and a short demo note. Milestones are vertical where possible so something is demoable early.

## Ground rules

1. **The SRS is the spec.** Requirement IDs appear in code comments at the point of implementation (`// R29.3`), in test names (`[R29.3]`), in log entries (`reqs: ['R29.3']`) and in the trace panel.
2. **No invented behavior.** Anything not in docs 10–16 gets a new `A-xx` entry in doc 16 in the same change.
3. **Engine purity.** `src/engine/` has no DOM, no PixiJS, no `Math.random`, no `Date.now`. Lint enforces the import boundary.
4. **Constants in one place.** `src/shared/constants.ts`, each with a comment naming its source (SRS ID or A-xx).
5. **Scenarios are acceptance tests.** Every preset's `expect` list runs in Vitest. CI fails on any failing expectation or uncovered SIM requirement.
6. **Fixed tick.** 20 Hz, dt = 0.05 s. Time scale only changes how many steps run per real tick.

## Milestones

### M0 — Scaffold (½ day)
- Vite + TypeScript strict, ESLint (with `engine/` ↛ `client/` boundary rule) + Prettier, Vitest, Playwright, GitHub Actions workflow, `public/.htaccess`, `scripts/update-egr.sh` (doc 15 Part A).
- `src/shared/constants.ts`, `domain.ts` (enums/types from doc 12), `protocol.ts` (doc 15 B4), `scenario-schema.ts` (doc 14) with Zod.
- Copy the 20 draft presets into `public/scenarios/`; schema test passes for all.
- **Done when:** `npm test`, `npm run build`, Playwright smoke (page loads, picker lists 20 presets) pass in CI.

### M1 — Engine core and road view (1–2 days)
- Worker + WorkerTransport, fixed tick loop, seeded RNG, pause/step/time scale, scenario loader + timeline runner.
- World: road with lanes/shoulder/segments, ego kinematics, scripted traffic behaviors, hazards.
- Renderer: top-down road, ego, traffic with labels, interpolation. Driver panel inputs wired (no HFDS yet; manual driving model A-26).
- **Done when:** S00 drives; replay test (same seed + inputs ⇒ identical state hash) passes.

### M2 — Availability, engagement, HMI basics (1–2 days)
- Sensors + self-tests (R14, IR29), LiDARMap (IR1, IR16), Environment ODD (IR5), availability checklist (doc 13 §5.1), IR6 indicator, button handling (R12, R16, R42, R43, R49, IR7, IR28), STARTING → HANDS_FREE, R17, IR22.
- Cluster UI: light bar, message, state badge, available indicator, checklist panel, caption panel, event log panel (R45).
- **Done when:** S01, S02, S03 expectations pass.

### M3 — Lane keeping and ACC following (2 days)
- PathPrediction blue path, VehiclePosition with two sources, keepLaneCentered, navigateCurve (UC9), large-vehicle offset (UC12).
- SpeedManagement: formulas and test vectors T1–T9 (doc 13 §2), zones (§3), R22/R23, R24, IR9, IR27; lane intrusion (UC11).
- Renderer: blue path, zone bands, lead highlight, ACC readouts.
- **Done when:** formulas.test.ts passes; S04, S05, S06 expectations pass.

### M4 — Attention, takeover, minimal risk maneuver (2 days)
- DATS (R27, A-06), Class B escalation (R29–R32, R36), Class A takeover (UC19, R35, R40, IR12–IR14), R39 steering pause/resume, driver arbitration (IR25), MRM (SR1 with SR1.1.1/SR1.1.2), IR10 lockout, ignition cycle.
- HMI: seat vibration / chime / voice icons (+ optional WebAudio and speechSynthesis, muted by default), countdowns, hazards, OnStar, door lock.
- **Done when:** S09–S14 expectations pass; invariants test (IR11, IR12, IR27, R18) passes over all presets.

### M5 — Faults, redundancy, logging, cooldowns (1–2 days)
- Error-code catalog (doc 13 §9), R37/IR29b metadata, SR4/SR4.4 source switching, SR3, SR5/SR2 tamper, R10 mismatch, IR5.8 health, R38 re-engagement rules, R41 counter, R44 reset, FCS (A-25), log export.
- Director panel complete (all inject actions from doc 14).
- **Done when:** S07, S08, S15, S16, S17 expectations pass.

### M6 — Polish, traceability, deploy (1–2 days)
- Trace panel, `scripts/trace-matrix.ts` (fails CI on uncovered SIM requirements; outputs a Markdown matrix for the SRS appendix), optional S18/S19.
- Shareable links `#scenario=<id>`, keyboard shortcuts, reduced-motion handling, captions reviewed against the SRS wording.
- Screenshot script (Playwright) that captures each preset at its key moments for SRS Section 5.2.
- Deploy to EGR per doc 15; verify `/prototype/.git/HEAD` returns 403/404.
- **Done when:** all non-optional presets pass, Playwright e2e passes, live URL works under the EGR subpath.

## Test inventory (minimum)

| File | Covers |
|---|---|
| `formulas.test.ts` | T1–T9 (R4, R22, R23, R25, IR9) |
| `mode-machine.test.ts` | Every transition row in doc 13 §6, R42, R43, R44 |
| `attention.test.ts` | R29–R32, R36 exact timings |
| `mrm.test.ts` | SR1.1, SR1.1.1 (60 s limit, reachability failure mid-maneuver), SR1.1.2 dwell |
| `faults.test.ts` | Doc 13 §9 table, R38 bands, IR23, SR4.4 |
| `availability.test.ts` | Each IR1–IR8, IR16, IR28 check in isolation |
| `scenarios.test.ts` | Every preset's `expect` list |
| `invariants.test.ts` | IR11, IR12, IR27, R18 across all presets |
| `replay.test.ts` | Determinism |
| `e2e/*.spec.ts` | Load, switch scenario (state resets, URL hash), key press changes state, light bar renders each state |

## Deliverables for the SRS (Section 5)

- 5.1 How to run: URL, supported browsers (current Chrome, Firefox, Edge, Safari), no plugins, desktop recommended, works offline once loaded.
- 5.2 Sample scenarios: one subsection per customer scenario with screenshots from the screenshot script and the caption text.
- Appendix: requirement → scenario/test matrix from `trace-matrix.ts`.
