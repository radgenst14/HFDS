# HFDS Prototype — Claude Project Kit

Everything needed to start a Claude project that builds the CSE 435 Group 3 Hands-Free Driving System prototype. This kit **does not contain the prototype**. It gathers the SRS, the technical stack, and every derived decision into one place so the build can be done completely and accurately.

Built from: *HFDS – Group 3 SRS* (uploaded 2026-11-04) and the *Prototype Technical Stack* doc (2026-11-04).

## Set up the project

**Option A — Claude project on claude.ai**
1. Create a project, e.g. "HFDS Prototype".
2. Paste the body of `00_PROJECT_INSTRUCTIONS.md` into the project's custom instructions.
3. Upload everything in `knowledge/` as project knowledge: the ten `.md` files, `requirements.json`, the 21 files in `knowledge/scenarios/`, and the 14 PNGs in `knowledge/diagrams/`. If file count is a problem, the PNGs are optional; their content is transcribed in `18_diagram_index.md` and `12_domain_model.md`.
4. Start a chat and send **Prompt 1** from `01_KICKOFF_PROMPT.md`. Send the milestone prompts one at a time after that.

**Option B — Claude Code on the repo**
1. Create the repo; put `CLAUDE.md` at the root and copy `knowledge/` to `docs/`.
2. Send Prompt 1 from `01_KICKOFF_PROMPT.md`.

## Before the build starts: resolve these first

From `knowledge/16_open_issues_and_assumptions.md`:
- **Q-01: the customer's scenario list.** The SRS only names Scenario 1 (activation) and Scenario 4 (driver brakes). The course requires a preset for every customer scenario.
- **Q-02: zone boundaries and safety cushion.** The SRS never defines them. The kit's defaults reproduce the SRS worked example, but the team should confirm them.
- **Q-04: which prototype version is due next (v1 or v2).**
- **Q-05: EGR group name and GitHub repo.**

Everything else has a working default, so the build can proceed.

## Contents

| File | What it is |
|---|---|
| `00_PROJECT_INSTRUCTIONS.md` | Custom instructions for the project: role, precedence of sources, non-negotiable rules, working style |
| `01_KICKOFF_PROMPT.md` | First message plus one prompt per milestone (M1–M6) and useful follow-ups |
| `CLAUDE.md` | Same instructions, formatted for the repo root (Claude Code) |
| `knowledge/10_requirements_catalog.md` | All 177 requirement items from SRS §3, verbatim, each mapped to how the prototype shows and tests it and to its scenarios |
| `knowledge/requirements.json` | Machine-readable copy of the catalog, used by the trace-matrix script |
| `knowledge/11_srs_overview_and_use_cases.md` | Scope, definitions, interfaces, functions, use cases UC1–UC21, sequence diagram → scenario map |
| `knowledge/12_domain_model.md` | Every class, attribute, operation and enum, proposed shapes for the classes the SRS left empty, and the repo file for each |
| `knowledge/13_behavior_spec.md` | Constants (SRS and assumed), formulas with 9 test vectors, following zones, lateral control, availability, the derived HFDS state machine, light bar mapping, Class A causes, MRM, error-code catalog, input arbitration, tick order |
| `knowledge/14_scenarios.md` | Scenario catalog, JSON schema, timeline and Director vocabulary, expectation checks |
| `knowledge/scenarios/` | 20 draft presets (`s00`–`s19`) plus `index.json`. Each one is a demo, a script and an acceptance test |
| `knowledge/15_technical_stack.md` | The stack doc in full (Part A) plus the HFDS adaptation: protocol, snapshot, repo layout, UI layout, keyboard (Part B) |
| `knowledge/16_open_issues_and_assumptions.md` | 33 SRS issues with resolutions, 30 prototype assumptions, 9 open questions |
| `knowledge/17_build_plan.md` | Milestones M0–M6 with definitions of done, test inventory, SRS Section 5 deliverables |
| `knowledge/18_diagram_index.md` | Transcriptions of all 8 sequence diagrams and an index of the figures |
| `knowledge/diagrams/` | The 14 SRS figures, extracted and placed on white backgrounds |
| `knowledge/19_srs_source_text.md` | The full SRS text, kept only for checking exact wording |

## SRS fixes worth making now

Found while building the kit (details in doc 16): IR29 is used twice; the braking-distance sentence in R4.1.1 is garbled; zone boundaries and the safety cushion are undefined; SUV is missing from the `VehicleSizeClass` enum; IR3 conflicts with the R29–R31 escalation; IR5.6/IR5.7 conflict with SR4.4 redundancy; the takeover window in the SD4 diagram may read 3 s against SR7's 30 s; Section 4 has no state diagram; and Section 6 has only a placeholder reference.
