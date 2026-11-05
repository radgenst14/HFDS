/**
 * Worker host (A-35): the only engine file with real-time timers and fetch. It owns the
 * 50 ms real tick, pause/step/time scale and scenario loading, and drives the pure
 * Engine. The page talks to it only through WorkerTransport (doc 15 Part A).
 *
 * The scenarios base URL arrives as the Worker's `name` (set by WorkerTransport) because
 * the worker script's own URL differs between dev and build.
 */
import { DT_S, HOST_TICK_MS, TIME_SCALES, type TimeScale } from '../shared/constants';
import type { ScenarioIndexEntry } from '../shared/scenario-schema';
import { eventFromLog, type ClientMessage, type EngineMessage } from '../shared/protocol';
import { stepsForRealTick } from './clock';
import { Engine, validateClientAction } from './engine';
import { loadScenario, parseIndex } from './scenario/loader';
import type { Scenario } from '../shared/scenario-schema';

interface WorkerScope {
  name: string;
  postMessage(msg: EngineMessage): void;
  onmessage: ((ev: MessageEvent<ClientMessage>) => void) | null;
}
const ctx = self as unknown as WorkerScope;
const scenariosBase = ctx.name || './scenarios/';

let engine: Engine | null = null;
let current: Scenario | null = null;
let paused = false;
let timeScale: TimeScale = 1;
let accumulator = 0;
let indexCache: ScenarioIndexEntry[] | null = null;
let loadToken = 0;

const post = (msg: EngineMessage): void => ctx.postMessage(msg);
const postError = (message: string): void => post({ type: 'error', message });

function postState(): void {
  if (engine) post({ type: 'state', snapshot: engine.snapshot({ paused, timeScale }) });
}

function runSteps(n: number): void {
  if (!engine) return;
  for (let i = 0; i < n; i++) {
    const r = engine.step();
    for (const entry of r.entries) post(eventFromLog(entry));
    if (r.finished) {
      paused = true;
      post({
        type: 'event',
        name: 'scenario_end',
        t: engine.simTime,
        reqs: [],
        data: { reason: r.finished },
      });
      break;
    }
  }
}

function start(scenario: Scenario): void {
  current = scenario;
  engine = new Engine(scenario);
  paused = false;
  accumulator = 0;
  post({
    type: 'event',
    name: 'scenario_loaded',
    t: 0,
    reqs: [],
    data: {
      id: scenario.id,
      name: scenario.name,
      description: scenario.description,
      customerScenario: scenario.customerScenario,
      sequenceDiagram: scenario.sequenceDiagram,
      optional: scenario.optional,
      requirements: scenario.requirements,
      caption: scenario.caption,
      durationS: scenario.durationS,
    },
  });
  for (const entry of engine.eventLog.takeFresh()) post(eventFromLog(entry));
  postState();
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function load(id: string): Promise<void> {
  const token = ++loadToken;
  try {
    if (!indexCache) {
      const idx = parseIndex(await fetchJson(new URL('index.json', scenariosBase).href));
      if (!idx.ok) return postError(idx.error);
      indexCache = idx.entries;
    }
    const entry = indexCache.find((e) => e.id === id);
    if (!entry) return postError(`Unknown scenario "${id}"`);
    const result = loadScenario(await fetchJson(new URL(entry.file, scenariosBase).href), id);
    if (token !== loadToken) return; // a newer load_scenario won
    if (!result.ok) return postError(result.error);
    start(result.scenario);
  } catch (err) {
    postError(err instanceof Error ? err.message : String(err));
  }
}

ctx.onmessage = (ev) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'load_scenario':
      void load(msg.id);
      break;
    case 'reset':
      if (current) start(current);
      break;
    case 'pause':
      paused = true;
      postState();
      break;
    case 'resume':
      if (engine && !engine.finished) paused = false;
      postState();
      break;
    case 'step':
      if (engine && paused) {
        runSteps(1);
        postState();
      }
      break;
    case 'seek': {
      if (!current) return postError('No scenario loaded');
      if (!Number.isFinite(msg.t) || msg.t < 0) return postError(`Invalid seek time ${msg.t}`);
      const target = Math.min(msg.t, current.durationS);
      if (!engine || target < engine.simTime - 1e-9) start(current);
      const steps = Math.round((target - (engine?.simTime ?? 0)) / DT_S);
      if (steps > 0) runSteps(steps);
      paused = true;
      accumulator = 0;
      postState();
      break;
    }
    case 'set_time_scale':
      if ((TIME_SCALES as readonly number[]).includes(msg.scale)) {
        timeScale = msg.scale;
        accumulator = 0;
        postState();
      } else postError(`Unsupported time scale ${String(msg.scale)}`);
      break;
    case 'input':
    case 'inject': {
      if (!engine) return postError('No scenario loaded');
      const problem = validateClientAction(msg.type, msg.action);
      if (problem) return postError(problem);
      if (msg.type === 'input') engine.enqueueInput(msg.action);
      else engine.enqueueInject(msg.action);
      break;
    }
    case 'export_log':
      if (engine) post({ type: 'log_export', file: engine.exportLog() });
      break;
  }
};

setInterval(() => {
  if (!engine || paused) return;
  const r = stepsForRealTick(timeScale, accumulator);
  accumulator = r.accumulator;
  if (r.steps === 0) return;
  runSteps(r.steps);
  postState();
}, HOST_TICK_MS);
