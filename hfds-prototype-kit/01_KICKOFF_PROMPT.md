# Kickoff Prompt

Send **Prompt 1** as the first message in the project. Send the milestone prompts one at a time after each milestone is accepted. Each is self-contained, so they also work in a fresh chat inside the same project.

---

## Prompt 1 — Orientation and M0 scaffold

```
We are starting the HFDS prototype described in the project instructions. Read every knowledge file before answering (10–19, requirements.json, scenarios/*.json, and the diagram index).

Part 1: Check your understanding. Keep it under one page.
1. In ≤ 12 bullets, summarize the architecture (engine in a Web Worker, transport, renderer, HMI/driver/director UI), the HFDS mode state machine, and how scenarios double as acceptance tests.
2. List the 20 presets with the customer scenario numbers we know (only Scenario 1 and Scenario 4 are known).
3. List any contradiction or gap you find across the knowledge files that is NOT already in 16_open_issues_and_assumptions.md, with a proposed resolution. If there are none, say so.

Part 2: Do milestone M0 from 17_build_plan.md.
- Produce the complete scaffold as full files with paths: package.json (scripts: dev, build, preview, test, test:run, e2e, lint, format, trace), tsconfig (strict), vite.config.ts (base './', worker format 'es'), ESLint config with the engine/ ↛ client/ and engine/ ↛ pixi.js/DOM boundary, Prettier, Vitest and Playwright configs, .github/workflows/deploy.yml, public/.htaccess, scripts/update-egr.sh, index.html with the empty UI regions from doc 15 B6.
- src/shared/constants.ts (every constant from doc 13 §1 with a source comment), domain.ts (enums and types from doc 12), protocol.ts (doc 15 B4), scenario-schema.ts (Zod, doc 14).
- Copy the 20 draft presets to public/scenarios/ (adjust to the schema if needed; tell me what you changed) and index.json.
- Tests: schema validation for every preset; a placeholder Playwright smoke test (page loads, picker lists 20 presets).
- Finish with the milestone report described in the instructions (files, requirement IDs, tests, assumptions, open questions, how to verify).
```

---

## Milestone prompts (send after the previous milestone passes)

```
Do milestone M1 (Engine core and road view) from 17_build_plan.md. Follow the tick order in 13_behavior_spec.md §11 for the parts that exist so far. Include the replay/determinism test. Finish with the milestone report.
```

```
Do milestone M2 (Availability, engagement, HMI basics). Implement doc 13 §5 completely, the STARTING → HANDS_FREE path, the cluster, light bar, checklist, caption and event-log panels. Make s01, s02 and s03 expectations pass. Finish with the milestone report.
```

```
Do milestone M3 (Lane keeping and ACC following). Implement doc 13 §2–§4 with test vectors T1–T9 as unit tests, the blue path, zone bands and lead highlight. Make s04, s05 and s06 expectations pass. Finish with the milestone report.
```

```
Do milestone M4 (Attention, takeover, minimal risk maneuver). Implement every transition row in doc 13 §6, §8 and §10, plus the HMI indicators. Make s09–s14 pass and add the global invariants test. Finish with the milestone report.
```

```
Do milestone M5 (Faults, redundancy, logging, cooldowns). Implement doc 13 §7 and §9, the Forward Collision System (A-25), log export, and the full Director panel. Make s07, s08, s15, s16 and s17 pass. Finish with the milestone report.
```

```
Do milestone M6 (Polish, traceability, deploy). Build the trace panel and scripts/trace-matrix.ts (fail on uncovered SIM requirements, output a Markdown matrix), optional s18/s19, keyboard shortcuts, reduced motion, the Playwright screenshot script for SRS Section 5.2, and a deployment checklist for EGR. Finish with the milestone report and the generated trace matrix.
```

## Useful follow-ups

- "Show me the requirement → test matrix for everything implemented so far, and list SIM requirements with no test."
- "Walk through preset sNN tick by tick at the key moments and confirm each expectation's timing against doc 13."
- "The customer scenario list is: … Map each one to a preset, create any missing presets, and update captions and `customerScenario` numbers."
- "Update the prototype for SRS change: <paste the changed requirement>. Show every file and test affected."
