# 15 — Technical Stack (team decision) + HFDS Adaptation

Part A is the team's *Prototype Technical Stack* document (Tucker Radgens, 2026-11-04), exported in full. It was written generically ("game", "winter-storm", "move or select") before being tied to HFDS. Part B maps it onto HFDS and **overrides Part A only where noted**. If they conflict, Part B wins for HFDS-specific content; Part A wins for hosting, tooling and deployment.

---

## Part A — Prototype Technical Stack (verbatim content)

### Purpose and scope
The prototype ships as a static TypeScript web app on the team's EGR site, with all game logic isolated in a simulation engine that runs in a Web Worker. The SRS defines what the prototype must do; this document defines how it is built, tested and delivered.

It covers the technology stack, the engine and client split, preset scenarios, the repository layout, local development, and deployment by `git pull` on the EGR server.

### Hosting constraints
The EGR site is Apache serving static files from a shared folder, so the simulation cannot run as a server process behind it. Everything the browser needs must be prebuilt files.

| What the hosting guide gives us | What it means for the stack |
|---|---|
| Files in `/egr/courses/unix/CSE/435/web/<groupname>` are served at `https://www.egr.msu.edu/cse435/<groupname>/` | Deploy the Vite build output, not source code |
| SSH/SFTP access to `scully.egr.msu.edu`; pages are served by `www.egr.msu.edu` | No reverse proxy or process manager we control, so no backend behind the site |
| Per-directory `.htaccess` works (the guide's password example uses it) | Use `.htaccess` to block `.git` and set caching |
| Directories need 755 and files 644, or Apache returns Forbidden | Reset permissions after every update |
| The site lives under a subpath, beside other team pages | Relative asset paths, hash routing, prototype in its own `prototype/` folder |
| SRS and meeting notes go in a password-protected folder | Keep `protected/` out of the prototype checkout |

**Decision:** the simulation engine runs in a Web Worker in the visitor's browser. This keeps it off the rendering thread and preserves the client/server split. If a real backend becomes available, the engine moves there by swapping one transport module (see Future path).

Source: CSE435 Website Hosting Guide (TA Sol Zilberman).

### Architecture
The page draws and collects input; the engine owns all game state and rules. The two talk only through typed messages, so the engine never touches the DOM and the renderer never decides game outcomes.

Diagram (described): *EGR web server — static files only* holds the **App bundle** (index.html, JS and CSS built by Vite) and **Scenario files** (JSON presets plus an index). In each visitor's **browser**: the **main thread** has the Scenario picker and HUD (HTML overlay: presets and live stats), the Input handler (keys and clicks become intents), the Renderer (PixiJS; draws state, smooths between ticks) and the Transport adapter (Worker today, WebSocket later). The **Web Worker** has the Scenario loader (validates presets with Zod) and the Simulation engine (tick loop, rules, seeded RNG). The page loads from the server; scenario files are fetched when picked; inputs and commands flow page → worker; state and events flow worker → page.

Only the transport adapter knows where the engine runs. Swapping in a WebSocket version moves the engine to a server without touching the renderer or UI.

The engine ticks at a fixed rate (target 20 Hz) and sends a state snapshot each tick. The renderer runs at the display's frame rate and interpolates between the last two snapshots.

| Direction | Message | Purpose |
|---|---|---|
| Page to engine | `load_scenario {id}` | Load a preset and reset state |
| Page to engine | `input {action, ...}` | A player intent, such as move or select |
| Page to engine | `reset` · `pause` · `resume` | Session control |
| Engine to page | `state {tick, entities, hud}` | Snapshot for the renderer and HUD |
| Engine to page | `event {name, ...}` | One-off notices, such as scenario loaded or game over |
| Engine to page | `error {message}` | Invalid scenario or bad command |

```ts
interface Transport {
  send(msg: ClientMessage): void;
  onMessage(handler: (msg: EngineMessage) => void): void;
  close(): void;
}
// WorkerTransport now; WebSocketTransport if a backend is added later
```

### Stack
One language (TypeScript) across engine and client, built by Vite into plain static files. The EGR server needs only Git; Node is used on developer machines and in CI.

| Layer | Technology | Responsibility |
|---|---|---|
| Language | TypeScript, strict mode | Shared types for messages and scenarios, checked in both engine and client |
| Build and dev server | Vite | Hot reload locally; `base: './'` so the build works under `/cse435/<groupname>/prototype/` |
| Rendering | PixiJS | Draws entities from the latest snapshot; no game logic |
| UI and HUD | HTML and CSS overlay, vanilla TS | Scenario picker, stats, buttons; add Preact only if menus grow |
| Simulation | Engine module in a Web Worker | Fixed tick loop, rules, state; emits snapshots and events |
| Randomness | Seeded PRNG (e.g. mulberry32) | Same seed and inputs give the same run |
| Scenario validation | Zod | Rejects malformed presets with a readable error |
| Unit tests | Vitest | Engine rules, scenario loading, determinism |
| End-to-end test | Playwright | Page loads, scenarios switch, input changes state |
| Code quality | ESLint and Prettier | Style, plus a rule blocking `engine/` from importing `client/` |
| Version control | Git on GitHub | `main` for source; `deploy` holds built files |
| CI | GitHub Actions | Test, build and publish `dist/` to the `deploy` branch |
| Hosting | EGR Apache | Serves a checkout of the `deploy` branch |

### Preset scenarios
Scenarios are data, not code: one JSON file per preset in `public/scenarios/`, listed in `index.json`. Adding a scenario means adding a file and an index entry, with no code change.

```json
{
  "id": "winter-storm",
  "name": "Winter storm",
  "description": "Low visibility and reduced speed.",
  "seed": 4127,
  "map": "plains-01",
  "initialState": { },
  "modifiers": { "speedMultiplier": 0.6 }
}
```

The fields above are a starting shape; the real schema follows the game rules in the SRS and lives in `src/shared/scenario-schema.ts`.

How a scenario loads:
1. The page fetches `scenarios/index.json` and fills the scenario picker.
2. Picking one sends `load_scenario {id}` to the engine.
3. The engine fetches that file, validates it with Zod, and resets state from it and its seed.
4. The engine replies `event scenario_loaded`, or `error` with the validation message.
5. The page writes `#scenario=<id>` to the URL, so a link opens straight into that preset for demos and grading.

### Repository layout
The engine, client and shared types live in separate folders. `engine/` has no DOM or Pixi imports, enforced by lint, so it can later run under Node unchanged.

```
prototype/
├── index.html
├── vite.config.ts
├── package.json
├── src/
│   ├── shared/
│   │   ├── protocol.ts          # message types
│   │   └── scenario-schema.ts   # Zod schema
│   ├── engine/
│   │   ├── engine.ts            # tick loop, state, rules
│   │   ├── rng.ts               # seeded PRNG
│   │   └── worker.ts            # Worker entry: engine <-> postMessage
│   ├── transport/
│   │   ├── transport.ts         # interface
│   │   └── worker-transport.ts
│   └── client/
│       ├── main.ts              # wires UI, input, renderer, transport
│       ├── input.ts
│       ├── renderer/            # PixiJS drawing + interpolation
│       └── ui/                  # scenario picker, HUD
├── public/
│   ├── .htaccess                # copied into the build
│   └── scenarios/
│       ├── index.json
│       └── *.json
├── tests/
│   ├── engine/                  # Vitest
│   └── e2e/                     # Playwright
├── scripts/
│   └── update-egr.sh            # run on scully to update the site
└── .github/workflows/deploy.yml
```

### Local development
All iteration happens on developer machines with the current Node LTS; the EGR server is touched only to update the live site.
1. Clone the repo and run `npm install`.
2. `npm run dev` starts Vite at `http://localhost:5173` with hot reload. Engine changes reload the worker automatically.
3. `npm test` runs Vitest in watch mode while you work.
4. `npm run build && npm run preview` checks the production build before merging. Relative paths mean the preview behaves like the EGR subpath.
5. Work on a feature branch and open a pull request to `main`. `main` must always pass tests, because every push to it updates the `deploy` branch.

### Deployment to EGR
CI builds on every push to `main` and commits the built files to a `deploy` branch. The EGR `prototype/` folder is a clone of that branch, so updating the site is one `git pull`. Pulling from the server avoids needing CI to SSH into campus machines.

**CI workflow** (`.github/workflows/deploy.yml`):
```yaml
name: deploy
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_branch: deploy
          publish_dir: ./dist
```

**One-time setup on scully.** Use a read-only deploy key so no personal GitHub credentials sit on the shared server:
```bash
ssh <netid>@scully.egr.msu.edu
ssh-keygen -t ed25519 -f ~/.ssh/prototype_deploy   # add the .pub as a read-only Deploy key on GitHub
cd /egr/courses/unix/CSE/435/web/<groupname>
GIT_SSH_COMMAND='ssh -i ~/.ssh/prototype_deploy' \
  git clone --branch deploy --single-branch git@github.com:<org>/<repo>.git prototype
cd prototype && git config core.sshCommand 'ssh -i ~/.ssh/prototype_deploy'
```

**Every update** (`scripts/update-egr.sh`, copied to `~/bin` on scully):
```bash
#!/usr/bin/env bash
set -euo pipefail
cd /egr/courses/unix/CSE/435/web/<groupname>/prototype
git pull --ff-only
find . -path ./.git -prune -o -type d -exec chmod 755 {} +
find . -path ./.git -prune -o -type f -exec chmod 644 {} +
chmod -R o-rwx .git   # web server cannot read repo metadata
```

**`public/.htaccess`**, shipped in every build as a second guard:
```apache
RedirectMatch 404 /\.git
```

The live prototype is then at `https://www.egr.msu.edu/cse435/<groupname>/prototype/`. The team's existing pages and `protected/` folder sit beside it and are never touched by a pull. One teammate owns the checkout and runs updates, unless the team shares a Unix group (see Open questions).

### Testing and SRS traceability
Because the engine has no DOM and a seeded RNG, most requirements can be verified by fast unit tests that replay a scenario with a fixed input script.

| Test type | Tool | What it proves |
|---|---|---|
| Rule tests | Vitest | Each game rule produces the expected state change |
| Scenario validation | Vitest | Every file in `public/scenarios/` passes the Zod schema and runs 100 ticks without error |
| Replay | Vitest | Same seed and input log give an identical final state |
| Smoke test | Playwright | Page loads, picker lists all presets, switching resets state, a key press changes state |

Tag each test with the SRS requirement it verifies, e.g. `it('[FR-07] switching scenario resets state', ...)`. A small script can grep those tags into the requirement-to-test matrix for the SRS appendix.

Suggested non-functional targets for the SRS: engine tick 20 Hz, rendering 60 fps on a typical laptop, and support for current Chrome, Firefox, Edge and Safari.

### Future path: server-hosted engine
If the engine later needs to run on a server, the client changes by one module. The engine is TypeScript with no DOM, so it runs under Node with the `ws` library without a rewrite; a Python (FastAPI) port is possible but not needed.
- Add `WebSocketTransport` implementing the same `Transport` interface, selected by config or `?transport=ws`.
- Host the engine on a machine reachable over `wss://`. The EGR static site cannot proxy to it, so it needs another host or DECS support.
- Add an origin allowlist for the EGR domain, a cap on concurrent sessions, idle timeouts, and a 20–30 second heartbeat.

### Open questions (from the stack doc)
- [ ] Is Git installed on scully, and can it reach GitHub over SSH? Check with `git --version` and `ssh -T git@github.com`.
- [ ] Do teammates share a Unix group on the team folder? If so, any of them can run updates (use 775/664 and `git config core.sharedRepository group`).
- [ ] Does EGR Apache honor `RedirectMatch` in `.htaccess`? After the first deploy, `/prototype/.git/HEAD` must return 403 or 404.
- [ ] Does the course require a specific Git host, such as GitHub or MSU GitLab?
- [ ] Should the prototype be public, or sit behind the team's password-protected folder?
- [ ] Is a long-running process allowed anywhere for the course? Only needed for the future server-hosted engine.

---

## Part B — HFDS adaptation (overrides Part A where noted)

### B1. Terminology
"Game" = the HFDS driving simulation. "Player" = the person using the page, who plays two roles: **Driver** (pedals, wheel, grip, gaze, HFDS button) and **Director** (scenario operator who injects faults, weather, hazards, traffic events, ignition cycles, time scale). Keep the two panels visually separate so a demo audience can tell driver actions from injected events.

### B2. Test tags (overrides "FR-07")
Use **SRS IDs** in brackets, e.g. `it('[R29.3][R30] second alert starts 30 s after first', ...)`, `it('[IR12] no acceleration while light bar flashes red', ...)`. Multiple tags allowed. The trace script greps `\[(R|SR|IR)\d+(\.\d+)*b?\]` and also reads each scenario's `requirements` and `expect[].reqs`.

### B3. Scenario schema (overrides the "winter-storm" example)
Use the HFDS schema in `14_scenarios.md`. Drafts for all presets are in `scenarios/`.

### B4. Protocol (`src/shared/protocol.ts`) — concrete messages

```ts
// Page → engine
type ClientMessage =
  | { type: 'load_scenario'; id: string }
  | { type: 'input'; action: DriverAction }                    // Driver panel / keyboard
  | { type: 'inject'; action: DirectorAction }                 // Director panel
  | { type: 'reset' } | { type: 'pause' } | { type: 'resume' }
  | { type: 'step' }                                           // advance one tick while paused (debugging, screenshots)
  | { type: 'set_time_scale'; scale: 0.5 | 1 | 2 | 4 }         // sim runs N fixed steps per real tick; dt stays 0.05 s
  | { type: 'export_log' };                                    // EventLog.exportLog()

type DriverAction =
  | { kind: 'pressHfdsButton' } | { kind: 'setBrake'; pressed: boolean; rate?: number }
  | { kind: 'setThrottle'; value: number } | { kind: 'setSteer'; value: number }
  | { kind: 'setGrip'; L?: boolean; R?: boolean; TOP?: boolean; BOTTOM?: boolean }
  | { kind: 'setGaze'; eyesOnRoad: boolean } | { kind: 'setGap'; gapSetting: GapSetting }
  | { kind: 'setSpeed'; mph: number };

type DirectorAction = { kind: string; args?: Record<string, unknown> };  // vocabulary = timeline "inject" actions in doc 14

// Engine → page
type EngineMessage =
  | { type: 'state'; snapshot: Snapshot }
  | { type: 'event'; name: string; t: number; reqs: string[]; data?: unknown }   // every log entry is also an event
  | { type: 'error'; message: string }
  | { type: 'log_export'; file: LogFile };

type Snapshot = {
  tick: number; simTime: number; scenarioId: string; paused: boolean; timeScale: number;
  ego: { s: number; lateral: number; laneId: number; heading: number; speedMph: number; accel: number; steeringAngle: number };
  traffic: Array<{ id: number; sizeClass: VehicleSizeClass; s: number; lateral: number; laneId: number; speedMph: number; length: number; width: number; isLead: boolean; isIntruding: boolean }>;
  hazards: Array<{ id: number; type: HazardType; s: number; laneId: number }>;
  road: { visibleSegments: unknown; laneWidthFt: number; travelLanes: number; rightShoulder: boolean };  // only what's near the ego
  hfds: {
    mode: HfdsMode; available: boolean; availabilityChecks: Array<{ id: string; label: string; pass: boolean; reqs: string[] }>;
    bluePath: Array<{ s: number; y: number }>; targetOffset: number; lateralOffset: number; pathConfidence: number;
    acc: { active: boolean; setSpeedMph: number | null; timeGapS: number; trailDistanceFt: number; selectionDistanceFt: number; safetyCushionFt: number; zone: FollowingZone | null; gapFt: number | null; closingSpeedFtps: number; aReqFtps2: number | null; maxBrakingDecelFtps2: number };
    timers: { alertElapsedS?: number; takeoverRemainingS?: number; resumeProgressS?: number; cooldownRemainingS?: number; mrmElapsedS?: number };
    reclaimsInWindow: number;
    sensors: Array<{ sensorId: string; type: SensorType; status: SensorStatus; activeForLane: boolean; activeForLead: boolean }>;
    errors: ErrorCode[];
  };
  hmi: HmiState;              // see doc 12, HumanMachineInterface
  driver: { eyesOnRoad: boolean; grip: Record<'L'|'R'|'TOP'|'BOTTOM', boolean>; brake: boolean; throttle: number; steer: number; attentionLevel: AttentionLevel };
  environment: Environment;
  traceReqs: string[];        // SRS IDs exercised since scenario start (for the trace panel)
};
```

Snapshot size: keep under ~20 KB. Send the blue path and road geometry only for the visible window.

### B5. Repository layout additions (extends Part A)
```
src/shared/  domain.ts (enums + entity types)  constants.ts (doc 13 §1)  protocol.ts  scenario-schema.ts
src/engine/  engine.ts  rng.ts  worker.ts  clock.ts
             world/   road.ts lane.ts lidar-map.ts environment.ts traffic.ts hazards.ts ego-kinematics.ts
             hfds/    hfds.ts (mode machine)  driver-assist.ts  speed-management.ts  driver-attention.ts
                      vehicle-control.ts  path-prediction.ts  vehicle-position.ts  sensors.ts
                      hmi.ts  warning.ts  event-log.ts  error-codes.ts  mrm.ts  availability.ts
             scenario/ loader.ts  timeline.ts  expectations.ts (shared by tests and the in-page checker)
src/client/  renderer/ road.ts vehicles.ts blue-path.ts zones.ts hazards.ts camera.ts interpolate.ts
             ui/       scenario-picker.ts caption-panel.ts cluster.ts light-bar.ts checklist.ts
                       driver-panel.ts director-panel.ts event-log.ts trace-panel.ts sensors-panel.ts
             audio.ts  (WebAudio chime / voice-prompt text-to-speech, muted by default)
scripts/     trace-matrix.ts  (requirement → scenario/test matrix, fails on uncovered SIM reqs)
tests/engine formulas.test.ts  mode-machine.test.ts  attention.test.ts  mrm.test.ts  faults.test.ts
             scenarios.test.ts (runs every preset's expect list)  replay.test.ts  invariants.test.ts
tests/e2e    smoke.spec.ts  scenario-switch.spec.ts  driver-input.spec.ts
docs/        this kit's knowledge files (requirements.json is read by the trace script)
```

### B6. UI layout (client)
Desktop-first (≥ 1280 px), usable at 1024 px. Regions:
1. **Top bar** — scenario picker, play/pause/step, time scale, reset, shareable link, "Export log".
2. **Road view (PixiJS, center)** — top-down scrolling highway following the ego: lanes, markings (dashed/solid, fade when IR2 fails), right shoulder, median barrier, construction cones, tunnel shading; ego car; traffic with size-class labels; lead highlight; intruding-vehicle highlight; hazards; **blue path**; following-zone bands (Closing / Coast / Safety) and selection-distance marker.
3. **Cluster (HTML, below road)** — steering-wheel **light bar** (animated: solid / flashing / pulsing), cluster message (R29.2, R30.3 exact strings), HFDS state badge (R46.1), "HFDS available" indicator (IR6), speed / set speed / gap setting, active warnings (R46.2), alert/takeover countdowns, HUD line (R16.2, only if hasHUD), seat-vibration / chime / voice icons, hazard-light, OnStar, door-lock and FCS-mode indicators, control-transfer banner (R40).
4. **Left column** — caption panel (scenario summary, steps, watch-for) and availability/activation checklist with requirement IDs.
5. **Right column** — Driver panel (HFDS button, brake, throttle, steer, grip areas, eyes-on-road, gap, set speed) above the Director panel (injections grouped: Sensors, Map/GPS, Environment, Road, Driver camera, Traffic, Emergency, Session).
6. **Bottom drawer** — event log (R45, filterable, each entry shows its SRS IDs) and requirement trace panel (IDs exercised so far, color-coded by section).

Keyboard: `H` HFDS button · `Space` brake (hold) · `↑` throttle (hold) · `←/→` steer (hold) · `G` toggle both-hand grip · `L` toggle eyes on road · `P` pause · `.` step · `1–4` time scale.

Accessibility: never signal a state by color alone — the light bar always has a text label ("Solid green — hands-free"); respect `prefers-reduced-motion` for flashing (use a slower blink and text).
