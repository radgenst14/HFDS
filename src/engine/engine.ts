/**
 * Simulation engine: fixed 20 Hz tick, rules and state (doc 13 §11, doc 15 Part A).
 *
 * Pure and deterministic (CLAUDE.md rule 4): no DOM, timers, wall clock or Math.random.
 * The Worker host (worker.ts) calls step(); tests call it directly. Same scenario + seed
 * + input log ⇒ identical state hash (replay test).
 *
 * M1 implements tick-order steps 1, 2, 8, 9, 10 and 11. Steps 3–7 (sensors, position,
 * driver assist, DATS, HFDS mode machine) arrive in M2–M5.
 */
import {
  DT_S,
  EGO_START_S_FT,
  GAP_SETTINGS_S,
  MPH_TO_FTPS,
  SNAPSHOT_WINDOW_AHEAD_FT,
  SNAPSHOT_WINDOW_BEHIND_FT,
  type TimeScale,
} from '../shared/constants';
import {
  enumValues,
  HfdsMode,
  LogEntryType,
  SENSOR_TYPES,
  SensorId,
  SensorStatus,
  type Environment,
  type LogEntry,
  type LogFile,
} from '../shared/domain';
import type { DirectorAction, DriverAction, Snapshot } from '../shared/protocol';
import { TimelineEventSchema, type Scenario } from '../shared/scenario-schema';
import { simTimeOf } from './clock';
import { canonicalJson, hashString } from './hash';
import { EventLog } from './hfds/event-log';
import { initialHmiState } from './hfds/hmi';
import { VehicleControl } from './hfds/vehicle-control';
import { Rng } from './rng';
import { TimelineRunner, type TimedEvent } from './scenario/timeline';
import { Driver } from './world/driver';
import { EnvironmentState } from './world/environment';
import { HazardField } from './world/hazards';
import { Road } from './world/road';
import { TrafficModel } from './world/traffic';

/** One recorded client input, applied at the start of tick `tick` (replay log). */
export type InputLogEntry =
  | { tick: number; type: 'input'; action: DriverAction }
  | { tick: number; type: 'inject'; action: DirectorAction };

export type FinishReason = 'duration' | 'end_of_road';

export interface StepResult {
  tick: number;
  entries: LogEntry[];
  finished: FinishReason | null;
}

/** Validates a client intent against the same schema as timeline events (doc 14). */
export function validateClientAction(
  type: 'input' | 'inject',
  action: DriverAction | DirectorAction,
): string | null {
  const { kind, ...rest } = action as { kind: string } & Record<string, unknown>;
  const args = type === 'inject' ? (action as DirectorAction).args : rest;
  const candidate: Record<string, unknown> = {
    t: 0,
    kind: type === 'input' ? 'driver' : 'inject',
    action: kind,
  };
  if (args !== undefined && Object.keys(args).length > 0) candidate.args = args;
  const r = TimelineEventSchema.safeParse(candidate);
  return r.success
    ? null
    : `Invalid ${type} "${kind}": ${r.error.issues[0]?.message ?? 'bad arguments'}`;
}

export class Engine {
  readonly scenario: Scenario;
  readonly rng: Rng;
  readonly road: Road;
  readonly environment: EnvironmentState;
  readonly traffic: TrafficModel;
  readonly hazards: HazardField;
  readonly driver: Driver;
  readonly vehicleControl: VehicleControl;
  readonly eventLog: EventLog;
  private readonly timeline: TimelineRunner;

  private tickCount = 0;
  private queue: InputLogEntry[] = [];
  private readonly recorded: InputLogEntry[] = [];
  private readonly trace = new Set<string>();
  private finishedReason: FinishReason | null = null;

  constructor(scenario: Scenario) {
    this.scenario = scenario;
    this.rng = new Rng(scenario.seed);
    this.road = new Road(scenario.road);
    this.environment = new EnvironmentState(scenario.environment);
    this.traffic = new TrafficModel(scenario.traffic, EGO_START_S_FT, this.road);
    this.hazards = new HazardField(scenario.hazards);
    this.driver = new Driver(scenario);
    this.vehicleControl = new VehicleControl({
      s: EGO_START_S_FT,
      y: this.road.laneCenterY(scenario.ego.laneId),
      speedMph: scenario.ego.speedMph,
    });
    this.eventLog = new EventLog();
    this.timeline = new TimelineRunner(scenario.timeline);
    this.log(
      LogEntryType.info,
      'Engine',
      `Scenario "${scenario.id}" loaded (seed ${scenario.seed})`,
      [],
    );
  }

  get tick(): number {
    return this.tickCount;
  }

  /** Sim time (s) at the start of the next tick. */
  get simTime(): number {
    return simTimeOf(this.tickCount);
  }

  get finished(): FinishReason | null {
    return this.finishedReason;
  }

  /** Every client input applied so far, with its tick (for replay). */
  get inputLog(): readonly InputLogEntry[] {
    return this.recorded;
  }

  // -------------------------------------------------------------------------
  // Client intents (queued, applied at the start of the next tick)
  // -------------------------------------------------------------------------

  enqueueInput(action: DriverAction): void {
    this.queue.push({ tick: this.tickCount, type: 'input', action });
  }

  enqueueInject(action: DirectorAction): void {
    this.queue.push({ tick: this.tickCount, type: 'inject', action });
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------

  step(): StepResult {
    if (this.finishedReason)
      return { tick: this.tickCount, entries: [], finished: this.finishedReason };
    const t = this.simTime;

    // 1. Client inputs and Director injections, then scenario timeline events.
    for (const q of this.queue) {
      const applied = { ...q, tick: this.tickCount } as InputLogEntry;
      this.recorded.push(applied);
      if (applied.type === 'input') this.driver.apply(applied.action, t);
      else this.applyInject(applied.action.kind, applied.action.args ?? {});
    }
    this.queue = [];
    for (const e of this.timeline.due(t)) this.applyTimelineEvent(e, t);

    // 2. World: scripted traffic, hazards (static), environment (changed by injections).
    this.traffic.advance(DT_S, t);

    // 3–7. Sensors, VehiclePosition/PathPrediction, DriverAssistSystem, DATS, HFDS
    //      mode machine: M2–M5.

    // 8. VehicleControl arbitrates driver input (IR25); no HFDS commands yet (A-26).
    const cmd = this.vehicleControl.arbitrate(this.driver);

    // 9. Integrate ego kinematics with the fixed dt.
    this.vehicleControl.integrate(cmd, DT_S, this.road);

    this.tickCount++;

    // 10. Run end (A-37).
    const ego = this.vehicleControl.ego;
    if (this.simTime >= this.scenario.durationS - 1e-9) this.finish('duration');
    else if (ego.s >= this.road.lengthFt) this.finish('end_of_road');

    // 11. Entries logged this tick become `event` messages (the host emits the snapshot).
    return {
      tick: this.tickCount,
      entries: this.eventLog.takeFresh(),
      finished: this.finishedReason,
    };
  }

  private finish(reason: FinishReason): void {
    this.finishedReason = reason;
    const why =
      reason === 'duration'
        ? `scenario duration ${this.scenario.durationS} s reached`
        : `end of the ${this.road.lengthFt} ft road reached`;
    this.log(LogEntryType.info, 'Engine', `Run finished: ${why}`, []);
  }

  private log(
    type: LogEntryType,
    source: string,
    message: string,
    reqs: string[],
    data?: unknown,
  ): void {
    const entry: LogEntry = { t: this.simTime, type, source, message, reqs };
    if (data !== undefined) entry.data = data;
    this.eventLog.logEvent(entry);
    reqs.forEach((r) => this.trace.add(r));
  }

  private applyTimelineEvent(e: TimedEvent, t: number): void {
    if (e.kind === 'note') {
      this.log(LogEntryType.info, 'Scenario', e.args.text, []);
      return;
    }
    if (e.kind === 'driver') {
      this.driver.apply({ kind: e.action, ...(e.args ?? {}) } as DriverAction, t);
      return;
    }
    this.applyInject(e.action, (e.args ?? {}) as Record<string, unknown>);
  }

  /** Director injections (doc 14). World-level ones act now; HFDS ones arrive M2–M5. */
  private applyInject(kind: DirectorAction['kind'], args: Record<string, unknown>): void {
    switch (kind) {
      case 'setEnvironment':
        this.environment.apply(args as Partial<Environment>);
        this.log(LogEntryType.info, 'Director', `Environment changed: ${JSON.stringify(args)}`, []);
        return;
      case 'spawnHazard': {
        const a = args as {
          type: Parameters<HazardField['spawn']>[0];
          laneId: number;
          aheadFt: number;
        };
        const h = this.hazards.spawn(a.type, a.laneId, this.vehicleControl.ego.s + a.aheadFt);
        this.log(
          LogEntryType.info,
          'Director',
          `${h.type} spawned in lane ${h.laneId} at s = ${h.s.toFixed(0)} ft`,
          [],
        );
        return;
      }
      case 'trafficHardBrake': {
        const a = args as { vehicleId: number; decelFtps2: number; durationS: number };
        const v = this.traffic.byId(a.vehicleId);
        if (v) {
          v.brakeHard(a.decelFtps2, a.durationS);
          this.log(
            LogEntryType.info,
            'Director',
            `Vehicle ${v.vehicleId} brakes hard at ${a.decelFtps2} ft/s²`,
            [],
          );
        } else {
          this.log(
            LogEntryType.info,
            'Director',
            `trafficHardBrake: no vehicle ${a.vehicleId}`,
            [],
          );
        }
        return;
      }
      case 'setEgoLane': {
        const a = args as { laneId?: number };
        if (a.laneId !== undefined) {
          this.vehicleControl.placeInLane(this.road.laneCenterY(a.laneId));
          this.log(LogEntryType.info, 'Director', `Ego moved to lane ${a.laneId}`, []);
          return;
        }
        break;
      }
      case 'setRoadFlags':
        this.road.flags = { ...this.road.flags, ...args };
        this.log(LogEntryType.info, 'Director', `Road flags: ${JSON.stringify(args)}`, []);
        return;
      default:
        break;
    }
    this.log(
      LogEntryType.info,
      'Director',
      `Injection "${kind}" received; its HFDS effect is not simulated yet (M2–M5)`,
      [],
    );
  }

  // -------------------------------------------------------------------------
  // Outputs
  // -------------------------------------------------------------------------

  snapshot(meta: { paused: boolean; timeScale: TimeScale }): Snapshot {
    const ego = this.vehicleControl.ego;
    const road = this.road;
    const laneId = road.laneIdAt(ego.y);
    const fromS = ego.s - SNAPSHOT_WINDOW_BEHIND_FT;
    const toS = ego.s + SNAPSHOT_WINDOW_AHEAD_FT;
    const cfg = this.scenario.vehicleConfig;
    const d = this.driver;
    return {
      tick: this.tickCount,
      simTime: this.simTime,
      scenarioId: this.scenario.id,
      paused: meta.paused,
      timeScale: meta.timeScale,
      ego: {
        s: ego.s,
        lateral: ego.y,
        laneId,
        heading: ego.heading,
        speedMph: ego.speed / MPH_TO_FTPS,
        accel: ego.accel,
        steeringAngle: this.vehicleControl.currentSteeringAngle,
      },
      traffic: this.traffic.vehicles
        .filter((v) => v.s > fromS && v.s - v.length < toS)
        .map((v) => ({
          id: v.vehicleId,
          sizeClass: v.sizeClass,
          s: v.s,
          lateral: v.y,
          laneId: v.laneId,
          speedMph: v.speed / MPH_TO_FTPS,
          length: v.length,
          width: v.width,
          isLead: false,
          isIntruding: false,
        })),
      hazards: this.hazards.all
        .filter((h) => h.s > fromS && h.s < toS)
        .map((h) => ({ id: h.id, type: h.type, s: h.s, laneId: h.laneId })),
      road: {
        visibleSegments: road.visibleSegments(fromS, toS),
        laneWidthFt: road.laneWidthFt,
        travelLanes: road.travelLanes,
        rightShoulder: road.rightShoulder,
      },
      hfds: {
        mode: HfdsMode.UNAVAILABLE,
        available: false,
        availabilityChecks: [],
        bluePath: [],
        targetOffset: 0,
        lateralOffset: ego.y - road.laneCenterY(laneId),
        pathConfidence: 0,
        acc: {
          active: false,
          setSpeedMph: d.requestedSetSpeedMph,
          timeGapS: GAP_SETTINGS_S[d.selectedGap],
          trailDistanceFt: 0,
          selectionDistanceFt: 0,
          safetyCushionFt: 0,
          zone: null,
          gapFt: null,
          closingSpeedFtps: 0,
          aReqFtps2: null,
          maxBrakingDecelFtps2: cfg.maxBrakingDecelFtps2,
        },
        timers: {},
        reclaimsInWindow: 0,
        sensors: enumValues(SensorId).map((id) => ({
          sensorId: id,
          type: SENSOR_TYPES[id],
          status: this.scenario.sensorOverrides[id] ?? SensorStatus.OK,
          activeForLane: false,
          activeForLead: false,
        })),
        errors: [],
      },
      hmi: initialHmiState(),
      driver: {
        eyesOnRoad: d.eyesOnRoad,
        grip: { ...d.gripAreas },
        brake: d.brakePressed,
        throttle: d.throttleInput,
        steer: d.steeringInput,
        attentionLevel: d.attentionLevel,
      },
      environment: this.environment.value,
      traceReqs: [...this.trace].sort(),
    };
  }

  /** Canonical state for the replay test (doc 13 §11 determinism). */
  stateHash(): string {
    const ego = this.vehicleControl.ego;
    const d = this.driver;
    return hashString(
      canonicalJson({
        tick: this.tickCount,
        rng: this.rng.state,
        ego,
        traffic: this.traffic.vehicles.map((v) => [v.vehicleId, v.s, v.y, v.speed, v.laneId]),
        hazards: this.hazards.all.map((h) => [h.id, h.type, h.laneId, h.s]),
        driver: [
          d.brakePressed,
          d.brakeRate,
          d.throttleInput,
          d.steeringInput,
          d.eyesOnRoad,
          d.gripAreas,
          d.selectedGap,
        ],
        environment: this.environment.value,
        log: this.eventLog.entries.map((e) => [e.t, e.type, e.message]),
        finished: this.finishedReason,
      }),
    );
  }

  exportLog(): LogFile {
    return this.eventLog.exportLog(this.scenario.id, this.scenario.seed);
  }
}

/**
 * Headless run used by tests (and later the in-page checker): replays `inputLog` at its
 * recorded ticks and steps up to `ticks` times or until the run finishes.
 */
export function runScenario(
  scenario: Scenario,
  opts: { ticks?: number; inputLog?: readonly InputLogEntry[]; onTick?: (e: Engine) => void } = {},
): Engine {
  const engine = new Engine(scenario);
  const log = [...(opts.inputLog ?? [])].sort((a, b) => a.tick - b.tick);
  const maxTicks = opts.ticks ?? Math.ceil(scenario.durationS / DT_S);
  let i = 0;
  for (let n = 0; n < maxTicks && !engine.finished; n++) {
    while (i < log.length && (log[i]?.tick ?? Infinity) <= engine.tick) {
      const e = log[i++];
      if (!e) break;
      if (e.type === 'input') engine.enqueueInput(e.action);
      else engine.enqueueInject(e.action);
    }
    engine.step();
    opts.onTick?.(engine);
  }
  return engine;
}
