# HFDS Prototype — CSE 435 Group 3

A browser-based simulation of the Group 3 **Hands-Free Driving System (HFDS)** Software Requirements Specification (SRS). It shows the team's reading of the SRS to the customer (Andrew Davenport, GM) and the instructor (Dr. Betty H.C. Cheng, MSU).

> This is a simulation for requirements validation, not vehicle software. The driver always has authority (IR25), and every failure hands control back to the driver (IR24).

## How to run (SRS Section 5.1)

**Live:** `https://www.egr.msu.edu/cse435/<groupname>/prototype/`. The group name is still open question Q-05; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

- **Browsers:** current Chrome, Firefox, Edge or Safari. A desktop or laptop is recommended (the layout targets 1280 px or wider and works at 1024 px).
- **No plugins and no account.** The page is static: it makes no network calls after loading, so it keeps working offline once it has loaded.
- **Pick a scenario** in the top bar. Each preset plays its scripted timeline; you can also drive by hand.
- **Shareable links:** `#scenario=<id>` opens a preset, and `#scenario=<id>&t=<seconds>` opens it paused at that moment. **Copy link** includes the time while the simulation is paused.

### Keyboard

| Key | Action |
|---|---|
| `H` | HFDS button |
| `Space` (hold) | Brake |
| `↑` (hold) | Throttle |
| `←` / `→` (hold) | Steer |
| `G` | Toggle both-hand grip |
| `L` | Toggle eyes on road |
| `P` | Pause / play |
| `.` | Step one tick (0.05 s) while paused |
| `1`–`4` | Time scale 0.5× / 1× / 2× / 4× |

### What is on screen

- **Left column:** the scenario caption (summary, steps, what to watch for), the availability checklist with SRS IDs, sensor statuses and active error codes.
- **Centre:** the top-down road view (lanes, traffic, hazards, blue path, following zones) and the instrument cluster (light bar with a text label, cluster message, HFDS state, speeds, countdowns, indicators).
- **Right column:** the Driver panel (green edge) and the Director panel (amber edge). The Director panel injects faults, weather, hazards, traffic events, external commands and ignition cycles.
- **Bottom:** the event log (R45). Filter it by text, SRS ID or entry type. Next to it is the requirement trace panel: the SRS IDs this run has exercised, grouped and colour-coded by SRS section. Click an ID to filter the log by it.

The trace panel counts an ID as *exercised* once the engine logs an event tagged with that ID (or with one of its sub-items). IDs the scenario lists but has not reached yet are shown outlined.

## Scenarios

The presets live in `public/scenarios/` (S00 sandbox, S01–S17, and optional S18 collision → OnStar and S19 unauthorized external command). Each preset's `expect` list is an acceptance test that runs in Vitest. The scenario format is in `docs/14_scenarios.md`.

## Development

Requires Node.js LTS.

```bash
npm ci
```

```bash
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on http://localhost:5173 |
| `npm run build` | Type-check and build to `dist/` (relative paths, works under any subpath) |
| `npm run preview` | Serve the build on http://localhost:4173 |
| `npm test` / `npm run test:run` | Vitest: engine rules, every preset's expectations, replay determinism, pure client logic |
| `npm run e2e` | Playwright end-to-end tests against the production build |
| `npm run lint` / `npm run format:check` | ESLint (including the engine purity rules) and Prettier |
| `npm run trace:write` | Regenerate `docs/trace-matrix.md` (requirement → scenario/test matrix, the SRS appendix) |
| `npm run trace:check` | CI check: fails if a SIM requirement has no test or expectation, or if the matrix is stale |
| `npm run screenshots` | Capture every preset at its key moments into `docs/screenshots/` for SRS Section 5.2 (git-ignored) |

### Architecture

- `src/engine/` is a pure, deterministic simulation: a fixed 20 Hz tick, a seeded RNG, and no DOM, timers or wall clock. It runs in a Web Worker (`worker.ts`).
- `src/client/` renders snapshots (PixiJS road view plus HTML panels) and sends intents through the `Transport` interface. It never decides HFDS outcomes.
- `src/shared/` holds the domain enums, the constants (each with its SRS or assumption source), the protocol and the scenario schema.

### Traceability

Requirement IDs appear in code comments, test names (`[R30.4]`), every event-log entry and the trace panel. Assumptions (A-xx), SRS defects (ISSUE-xx) and open questions (Q-xx) are in `docs/16_open_issues_and_assumptions.md`. The project rules are in `CLAUDE.md`.

## Deployment

On every push to `main`, GitHub Actions runs lint, format, the unit tests, the trace check, the build and the e2e tests. It then publishes `dist/` to the `deploy` branch. The EGR server pulls that branch; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
