/**
 * Simulation engine: fixed 20 Hz tick, rules and state (doc 13 §11, doc 15 Part A).
 *
 * Pure and deterministic (CLAUDE.md rule 4): no DOM, timers, wall clock or Math.random.
 * The Worker host (worker.ts) calls step(); tests call it directly. Same scenario + seed
 * + input log ⇒ identical state hash (replay test).
 *
 * Tick order (doc 13 §11):
 *   1 inputs, injections, timeline · 2 world · 3–6 HFDS sense() · 7 HFDS updateMode()
 *   8 VehicleControl arbitration · 9 ego kinematics · 10 HMI · 11 events/snapshot.
 */
import {
  DT_S,
  EGO_SIZE_CLASS,
  EGO_START_S_FT,
  MPH_TO_FTPS,
  SIZE_FACTOR,
  SNAPSHOT_WINDOW_AHEAD_FT,
  SNAPSHOT_WINDOW_BEHIND_FT,
  VEHICLE_DIMENSIONS_FT,
  type TimeScale,
} from '../shared/constants';
import {
  LaneType,
  LogEntryType,
  SensorId,
  type Environment,
  type HazardType,
  type HfdsMode,
  type HmiState,
  type LightBarState,
  type LogEntry,
  type LogFile,
  type SensorStatus,
  type SubsystemFlag,
  type WarningClass,
  type WarningReason,
} from '../shared/domain';
import type { DirectorAction, DriverAction, Snapshot } from '../shared/protocol';
import { TimelineEventSchema, type Scenario } from '../shared/scenario-schema';
import { simTimeOf } from './clock';
import { canonicalJson, hashString } from './hash';
import { HFDS, type Anchors } from './hfds/hfds';
import type { EventLog } from './hfds/event-log';
import type { VehicleControl } from './hfds/vehicle-control';
import { Rng } from './rng';
import { ReactiveDriverScript } from './scenario/reactive';
import { TimelineRunner, type TimedEvent } from './scenario/timeline';
import { Driver } from './world/driver';
import { EnvironmentState } from './world/environment';
import { HazardField } from './world/hazards';
import { LiDARMap } from './world/lidar-map';
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

/**
 * Per-tick state the expectation runner reads (doc 14 "Expectations"). Taken after each
 * step, so `t` is the end time of the tick (= the snapshot's simTime).
 */
export interface Observation {
  t: number;
  tick: number;
  mode: HfdsMode;
  available: boolean;
  lightBar: LightBarState;
  hmi: HmiState;
  setSpeedMph: number | null;
  speedMph: number;
  speedFtps: number;
  accActive: boolean;
  leadId: number | null;
  leadSizeClass: string | null;
  zone: string | null;
  gapFt: number | null;
  trailDistanceFt: number;
  safetyCushionFt: number;
  timeGapS: number;
  sizeFactor: number;
  laneId: number;
  egoS: number;
  /** R18: ego fully inside its lane */
  inLane: boolean;
  targetOffset: number;
  /** vehicles alongside the ego in an adjacent lane (UC12) */
  besideVehicleIds: number[];
  /** HFDS longitudinal command this tick (ft/s²; IR12), 0 until M3 */
  hfdsAccelCmd: number;
  warnings: Array<{ cls: WarningClass; reason: WarningReason }>;
  /** distance to the nearest hazard ahead in the ego's lane (ft) */
  hazardAheadFt: number | null;
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
  readonly map: LiDARMap;
  readonly hfds: HFDS;
  private readonly timeline: TimelineRunner;
  private readonly reactive: ReactiveDriverScript;

  private tickCount = 0;
  private queue: InputLogEntry[] = [];
  private readonly recorded: InputLogEntry[] = [];
  private finishedReason: FinishReason | null = null;

  constructor(scenario: Scenario) {
    this.scenario = scenario;
    this.rng = new Rng(scenario.seed);
    this.road = new Road(scenario.road);
    this.environment = new EnvironmentState(scenario.environment);
    this.traffic = new TrafficModel(scenario.traffic, EGO_START_S_FT, this.road);
    this.hazards = new HazardField(scenario.hazards);
    this.driver = new Driver(scenario);
    this.map = new LiDARMap(scenario.map);
    this.hfds = new HFDS(
      {
        scenario,
        road: this.road,
        environment: this.environment,
        traffic: this.traffic,
        driver: this.driver,
        hazards: this.hazards,
        map: this.map,
      },
      {
        s: EGO_START_S_FT,
        y: this.road.laneCenterY(scenario.ego.laneId),
        speedMph: scenario.ego.speedMph,
      },
    );
    this.timeline = new TimelineRunner(scenario.timeline);
    this.reactive = new ReactiveDriverScript(this.timeline.reactive);
    this.hfds.onTakeoverRequest.push((at) => this.reactive.onTakeoverRequest(at));
    this.log(
      LogEntryType.info,
      'Engine',
      `Scenario "${scenario.id}" loaded (seed ${scenario.seed})`,
      [],
    );
    // Initial HFDS state so the first snapshot already shows the checklist.
    this.hfds.sense(0);
    this.hfds.updateMode(0);
    this.hfds.updateHmi(0);
  }

  get vehicleControl(): VehicleControl {
    return this.hfds.vehicleControl;
  }

  get eventLog(): EventLog {
    return this.hfds.eventLog;
  }

  get anchors(): Anchors {
    return this.hfds.anchors;
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
    if (this.finishedReason) {
      return { tick: this.tickCount, entries: [], finished: this.finishedReason };
    }
    const t = this.simTime;
    const hfds = this.hfds;

    // 1. Client inputs and Director injections, then scenario timeline events.
    for (const q of this.queue) {
      const applied = { ...q, tick: this.tickCount } as InputLogEntry;
      this.recorded.push(applied);
      if (applied.type === 'input') this.applyDriverAction(applied.action, t);
      else this.applyInject(applied.action.kind, applied.action.args ?? {}, t);
    }
    this.queue = [];
    for (const e of this.timeline.due(t)) this.applyTimelineEvent(e, t);
    this.reactive.apply(t, this.driver, this.vehicleControl.ego, this.road); // doc 14 takeoverOnClassA

    // 2. World: scripted traffic; hazards are static; environment changes by injection.
    this.traffic.advance(DT_S, t);

    // 3–6. Sensors (IR29), VehiclePosition + PathPrediction (R3, R2), DriverAssistSystem
    //      (R19, R4, IR8 windows), DATS (R27).
    hfds.sense(t);

    // 7. HFDS mode machine: availability, button, transitions.
    hfds.updateMode(t);

    // 8. HFDS ControlCommands (R1) and the FCS (A-25); VehicleControl arbitrates (IR25).
    const fcsDecel = hfds.commands(t); // R1 commands; A-25 FCS
    const cmd = this.vehicleControl.arbitrate(this.driver, fcsDecel);

    // 9. Integrate ego kinematics with the fixed dt.
    this.vehicleControl.integrate(cmd, DT_S, this.road);

    // 10. HMI state (R46).
    hfds.updateHmi(t);

    this.tickCount++;

    // Run end (A-37).
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
    this.hfds.log(this.simTime, type, source, message, reqs, data);
  }

  private applyTimelineEvent(e: TimedEvent, t: number): void {
    if (e.kind === 'note') {
      this.log(LogEntryType.info, 'Scenario', e.args.text, []);
      return;
    }
    if (e.kind === 'driver') {
      this.applyDriverAction({ kind: e.action, ...(e.args ?? {}) } as DriverAction, t);
      return;
    }
    this.applyInject(e.action, (e.args ?? {}) as Record<string, unknown>, t);
  }

  private applyDriverAction(action: DriverAction, t: number): void {
    this.driver.apply(action, t);
    const sm = this.hfds.speedManagement;
    if (action.kind === 'setSpeed') sm.requestSetSpeed(action.mph); // IR27 cap
    if (action.kind === 'setGap') sm.setGap(action.gapSetting); // A-08
  }

  /** Director injections (doc 14). HFDS-reaction injections not listed here arrive M4–M6. */
  private applyInject(
    kind: DirectorAction['kind'],
    args: Record<string, unknown>,
    t: number,
  ): void {
    const hfds = this.hfds;
    const info = (message: string, reqs: string[]) =>
      this.log(LogEntryType.info, 'Director', message, reqs);
    switch (kind) {
      case 'setEnvironment':
        this.environment.apply(args as Partial<Environment>);
        info(`Environment changed: ${JSON.stringify(args)}`, ['R13']);
        return;
      case 'spawnHazard': {
        const a = args as { type: HazardType; laneId: number; aheadFt: number };
        const h = this.hazards.spawn(a.type, a.laneId, this.vehicleControl.ego.s + a.aheadFt);
        info(`${h.type} spawned in lane ${h.laneId} at s = ${h.s.toFixed(0)} ft`, []);
        return;
      }
      case 'trafficHardBrake': {
        const a = args as { vehicleId: number; decelFtps2: number; durationS: number };
        const v = this.traffic.byId(a.vehicleId);
        if (!v) return info(`trafficHardBrake: no vehicle ${a.vehicleId}`, []);
        v.brakeHard(a.decelFtps2, a.durationS);
        return info(`Vehicle ${v.vehicleId} brakes hard at ${a.decelFtps2} ft/s²`, ['IR8.1']);
      }
      case 'trafficErraticAccel': {
        const a = args as { vehicleId: number };
        const v = this.traffic.byId(a.vehicleId);
        if (!v) return info(`trafficErraticAccel: no vehicle ${a.vehicleId}`, []);
        v.erraticAccel();
        return info(`Vehicle ${v.vehicleId} accelerates erratically`, ['IR8.2']);
      }
      case 'trafficTailgateGap': {
        const a = args as { vehicleId: number; headwayS: number };
        const v = this.traffic.byId(a.vehicleId);
        if (!v) return info(`trafficTailgateGap: no vehicle ${a.vehicleId}`, []);
        const ego = this.vehicleControl.ego;
        v.placeAhead(ego.s, this.road.laneIdAt(ego.y), a.headwayS, ego.speed);
        return info(`Vehicle ${v.vehicleId} now ${a.headwayS} s ahead in the ego lane`, ['IR8.3']);
      }
      case 'setEgoLane': {
        const a = args as { laneId?: number; laneType?: 'ExitLane' | 'ServiceDrive' };
        if (a.laneId !== undefined) {
          this.vehicleControl.placeInLane(this.road.laneCenterY(a.laneId));
          hfds.egoLaneTypeOverride = null;
          return info(`Ego moved to lane ${a.laneId}`, ['IR5.3']);
        }
        if (a.laneType) {
          hfds.egoLaneTypeOverride = LaneType[a.laneType];
          return info(`Ego now in a ${a.laneType} (until moved to a lane)`, ['IR5.3']);
        }
        return;
      }
      case 'setRoadFlags':
        this.road.flags = { ...this.road.flags, ...args };
        return info(`Road flags: ${JSON.stringify(args)}`, ['IR5.2', 'IR1']);
      case 'failSensor': {
        const a = args as { sensorId: SensorId; status: SensorStatus };
        hfds.sensors.setStatus(a.sensorId, a.status);
        return info(`Sensor ${a.sensorId} → ${a.status}`, ['R9', 'IR5.6']);
      }
      case 'clearAllFaults':
      case 'clearFault':
        // M2: every injected fault clears; per-code clearing and R38 buffers are M5.
        hfds.sensors.clearAll();
        this.map.dataError = false;
        hfds.functions.clearFaults();
        return info('Injected faults cleared', ['R38']);
      case 'applyMapUpdate': {
        const a = args as { version: string; lastUpdated: string };
        this.map.applyUpdate(a);
        return info(`LiDAR map update ${a.version} (${a.lastUpdated}) downloaded`, ['R11']);
      }
      case 'staleGpsCorrection': {
        const a = args as { ageS: number };
        hfds.sensors.stopGpsCorrection(t, a.ageS);
        return info(`GPS correction downloads stopped (age ${a.ageS} s)`, ['R11', 'IR5.8']);
      }
      case 'dropLaneMarkings': {
        const a = args as { durationS: number };
        this.road.dropMarkings(t, a.durationS);
        return info(`Lane lines undetectable for ${a.durationS} s`, ['IR2']);
      }
      case 'mapError':
        this.map.dataError = true;
        return info('LiDAR map data error', ['IR5.7']);
      case 'gpsError':
        hfds.sensors.gpsDataError = true;
        return info('Navigation / GPS data error', ['IR5.7']);
      case 'setTrailer': {
        const a = args as { attached: boolean; capable?: boolean };
        hfds.functions.trailerAttached = a.attached;
        if (a.capable !== undefined) hfds.functions.trailerCapable = a.capable;
        return info(`Trailer ${a.attached ? 'attached' : 'detached'}`, ['IR5.5']);
      }
      case 'setSubsystemFlag': {
        const a = args as { name: SubsystemFlag; ok: boolean };
        hfds.functions.setFlag(a.name, a.ok);
        return info(`${a.name} ${a.ok ? 'available' : 'unavailable'}`, [
          a.name === 'positioningDataService' ? 'IR17' : 'IR5.9',
        ]);
      }
      case 'fcwEscalation':
        hfds.functions.fcwEscalated = true;
        return info('Forward collision warning escalated to a takeover request', ['IR5.10']);
      default:
        return info(
          `Injection "${kind}" received; its HFDS effect is not simulated yet (M4–M6)`,
          [],
        );
    }
  }

  // -------------------------------------------------------------------------
  // Outputs
  // -------------------------------------------------------------------------

  private hazardAheadFt(): number | null {
    const ego = this.vehicleControl.ego;
    const lane = this.road.laneIdAt(ego.y);
    let best: number | null = null;
    for (const h of this.hazards.all) {
      const d = h.s - ego.s;
      if (h.laneId === lane && d >= 0 && (best === null || d < best)) best = d;
    }
    return best;
  }

  /** Per-tick view for the expectation runner (doc 14). */
  observe(): Observation {
    const hfds = this.hfds;
    const ego = this.vehicleControl.ego;
    const road = this.road;
    const sm = hfds.speedManagement;
    const das = hfds.driverAssist;
    const lead = das.leadVehicle;
    const lane = road.laneIdAt(ego.y);
    const egoDims = VEHICLE_DIMENSIONS_FT[EGO_SIZE_CLASS];
    const offset = Math.abs(ego.y - road.laneCenterY(lane));
    const hmi = hfds.hmi.current;
    return {
      t: this.simTime,
      tick: this.tickCount,
      mode: hfds.mode,
      available: hfds.available,
      lightBar: hmi.lightBarStatus,
      hmi,
      setSpeedMph: sm.setSpeed,
      speedMph: ego.speed / MPH_TO_FTPS,
      speedFtps: ego.speed,
      accActive: sm.active,
      leadId: lead?.vehicleId ?? null,
      leadSizeClass: lead?.sizeClass ?? null,
      zone: sm.currentZone,
      gapFt: das.leadGap,
      trailDistanceFt: sm.computeTrailDistance(ego.speed, lead?.sizeClass ?? null),
      safetyCushionFt: sm.safetyCushion(ego.speed, lead?.sizeClass ?? null),
      timeGapS: sm.timeGap(),
      sizeFactor: lead ? SIZE_FACTOR[lead.sizeClass] : 1,
      laneId: lane,
      egoS: ego.s,
      inLane: offset + egoDims.width / 2 <= road.laneWidthFt / 2 + 1e-9,
      targetOffset: hfds.pathPrediction.targetOffset,
      besideVehicleIds: this.traffic.vehicles
        .filter(
          (v) =>
            Math.abs(v.laneId - lane) === 1 &&
            v.s > ego.s - egoDims.length - v.length &&
            v.s - v.length < ego.s,
        )
        .map((v) => v.vehicleId),
      hfdsAccelCmd: this.vehicleControl.appliedHfdsAccel,
      warnings: hmi.activeWarnings
        .filter((w) => w.isActive)
        .map((w) => ({ cls: w.warningClass, reason: w.reason })),
      hazardAheadFt: this.hazardAheadFt(),
    };
  }

  snapshot(meta: { paused: boolean; timeScale: TimeScale }): Snapshot {
    const hfds = this.hfds;
    const ego = this.vehicleControl.ego;
    const road = this.road;
    const laneId = road.laneIdAt(ego.y);
    const fromS = ego.s - SNAPSHOT_WINDOW_BEHIND_FT;
    const toS = ego.s + SNAPSHOT_WINDOW_AHEAD_FT;
    const d = this.driver;
    const sm = hfds.speedManagement;
    const das = hfds.driverAssist;
    const lead = das.leadVehicle;
    const leadSensor = hfds.leadSensor();
    const pos = hfds.vehiclePosition;
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
          isLead: lead?.vehicleId === v.vehicleId,
          isIntruding: das.tracks.get(v.vehicleId)?.isIntruding ?? false,
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
        mode: hfds.mode,
        available: hfds.available,
        availabilityChecks: hfds.availabilityChecks.map((c) => ({ ...c, reqs: [...c.reqs] })),
        bluePath: hfds.pathPrediction.bluePath.map((p) => ({ ...p })),
        targetOffset: hfds.pathPrediction.targetOffset,
        lateralOffset: ego.y - road.laneCenterY(laneId),
        pathConfidence: hfds.pathPrediction.pathConfidence,
        acc: {
          active: sm.active,
          setSpeedMph: sm.setSpeed,
          timeGapS: sm.timeGap(),
          trailDistanceFt: sm.computeTrailDistance(ego.speed, lead?.sizeClass ?? null),
          selectionDistanceFt: sm.selectionDistance(ego.speed, lead?.sizeClass ?? null),
          safetyCushionFt: sm.safetyCushion(ego.speed, lead?.sizeClass ?? null),
          coastStartFt: (() => {
            const info = das.leadInfo();
            return info ? sm.coastStartDistance(ego.speed, info) : null;
          })(),
          zone: sm.currentZone,
          gapFt: das.leadGap,
          closingSpeedFtps: sm.closingSpeed,
          aReqFtps2: sm.aReq,
          maxBrakingDecelFtps2: sm.maxBrakingDecel,
        },
        timers: hfds.timers(this.simTime),
        reclaimsInWindow: hfds.reclaimHistory.length,
        sensors: [...hfds.sensors.sensors.values()].map((s) => ({
          sensorId: s.sensorId,
          type: s.type,
          status: s.status,
          activeForLane:
            (s.sensorId === SensorId.CAM_FRONT && pos.sources.camera !== null) ||
            ((s.sensorId === SensorId.LIDAR_1 || s.sensorId === SensorId.GPS_1) &&
              pos.sources.map !== null),
          activeForLead: s.sensorId === leadSensor,
        })),
        errors: [],
      },
      hmi: hfds.hmi.current,
      driver: {
        eyesOnRoad: d.eyesOnRoad,
        grip: { ...d.gripAreas },
        brake: d.brakePressed,
        throttle: d.throttleInput,
        steer: d.steeringInput,
        attentionLevel: d.attentionLevel,
      },
      environment: this.environment.value,
      traceReqs: [...hfds.trace].sort(),
    };
  }

  /** Canonical state for the replay test (doc 13 §11 determinism). */
  stateHash(): string {
    const ego = this.vehicleControl.ego;
    const d = this.driver;
    const hfds = this.hfds;
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
        map: [this.map.version, this.map.lastUpdated, this.map.dataError],
        hfds: [
          hfds.mode,
          hfds.available,
          hfds.availabilityChecks.map((c) => c.pass),
          hfds.speedManagement.setSpeed,
          hfds.speedManagement.active,
          hfds.lastButtonPressAt,
          hfds.pendingStopRequest,
          [...hfds.sensors.sensors.values()].map((s) => s.status),
        ],
        hmi: hfds.hmi.current,
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
 * Headless run used by tests and the expectation runner: replays `inputLog` at its
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
