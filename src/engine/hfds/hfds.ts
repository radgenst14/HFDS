/**
 * HFDS orchestrator and mode state machine (doc 12 HFDS; doc 13 §5–§6; ISSUE-23).
 *
 * Implemented so far:
 *   M2  availability (doc 13 §5.1), button handling (§5.2: R12, R16, R42, R43, R49, IR7,
 *       IR28), STARTING → HANDS_FREE (R14, R15, R17, R47, R48, IR22).
 *   M3  lane keeping and ACC commands (R1, R18, R20, R21–R25, IR9, IR27), Class A
 *       takeover request for braking-insufficient (R23) and curve-too-sharp (UC9) causes
 *       (UC19, IR12, IR13), takeover confirmation (R35, UC18, R40), driver brake
 *       disengagement (IR15, R50), the R38.4 recheck and the Forward Collision System (A-25).
 *   M4  attention escalation (R27–R36), the 30 s takeover period → minimal risk
 *       maneuver (SR7, SR1), R39 steering pause, more Class A causes.
 *   M5  faults, error codes, R38 bands, R41, R44.
 *
 * Tick order (doc 13 §11): sense() runs steps 3–6, updateMode() step 7, commands()
 * step 8, updateHmi() step 10. Deterministic, sim time only.
 */
import {
  BUTTON_DEBOUNCE_S,
  COAST_DECEL_FTPS2,
  DT_S,
  EGO_SIZE_CLASS,
  GRIP_MIN_AREAS,
  HMI_TEXT,
  MPH_TO_FTPS,
  POST_TAKEOVER_RECHECK_S,
  SENSOR_DATA_MAX_AGE_MS,
  START_SEQUENCE_S,
  TAKEOVER_PERIOD_S,
  VEHICLE_DIMENSIONS_FT,
} from '../../shared/constants';
import {
  ENGAGED_MODES,
  FcsMode,
  HfdsMode,
  LaneType,
  LightBarState,
  LogEntryType,
  SensorId,
  SubsystemStatus,
  WarningClass,
  type LogEntry,
  type Warning,
} from '../../shared/domain';
import type { AvailabilityCheck, HfdsTimers } from '../../shared/protocol';
import type { Scenario } from '../../shared/scenario-schema';
import type { Driver } from '../world/driver';
import type { EnvironmentState } from '../world/environment';
import type { HazardField } from '../world/hazards';
import type { LiDARMap } from '../world/lidar-map';
import type { Road } from '../world/road';
import type { TrafficModel } from '../world/traffic';
import { describeFailures, evaluateAvailability, failedChecks } from './availability';
import { DriverAssistSystem, type ClassACause } from './driver-assist';
import { DriverAttentionSystem } from './driver-attention';
import { EventLog } from './event-log';
import { ForwardCollisionSystem, type CollisionObject } from './forward-collision';
import { HumanMachineInterface, lightBarFor } from './hmi';
import { PathPrediction } from './path-prediction';
import { PERCEPTION_SENSORS, SensorSuite } from './sensors';
import { VehicleControl } from './vehicle-control';
import { VehicleFunctions } from './vehicle-functions';
import { VehiclePosition } from './vehicle-position';
import { issueWarning } from './warning';

/** World objects HFDS reads but does not own. */
export interface HfdsWorld {
  scenario: Scenario;
  road: Road;
  environment: EnvironmentState;
  traffic: TrafficModel;
  hazards: HazardField;
  driver: Driver;
  map: LiDARMap;
}

/** Engine-recorded anchors for `after:` expectations (doc 14). */
export interface Anchors {
  classA?: number;
  takeover?: number;
  mrm?: number;
}

/** A re-engagement wait (R38.2, R38.4, R41.2, R44.2); A-30: the longest one counts. */
export interface Cooldown {
  reason: string;
  until: number;
  reqs: string[];
}

const ticksOf = (seconds: number): number => Math.round(seconds / DT_S);
const EGO_HALF_WIDTH = VEHICLE_DIMENSIONS_FT[EGO_SIZE_CLASS].width / 2;

export class HFDS {
  mode: HfdsMode = HfdsMode.UNAVAILABLE;
  readonly vehicleConfig: Scenario['vehicleConfig'];
  readonly sensors: SensorSuite;
  readonly driverAssist: DriverAssistSystem;
  readonly driverAttention = new DriverAttentionSystem();
  readonly vehicleControl: VehicleControl;
  readonly hmi: HumanMachineInterface;
  readonly pathPrediction = new PathPrediction();
  readonly vehiclePosition = new VehiclePosition();
  readonly eventLog = new EventLog();
  readonly functions: VehicleFunctions;
  readonly forwardCollision: ForwardCollisionSystem;

  availabilityChecks: AvailabilityCheck[] = [];
  available = false;
  /** R43: sim time of the previous button press (accepted or not; A-43). */
  lastButtonPressAt: number | null = null;
  /** R42 */
  startSequenceStartedAt: number | null = null;
  pendingStopRequest = false;
  /** UC19: when the current takeover request started. */
  takeoverRequestedAt: number | null = null;
  /** The Class A warning in force (UC19). */
  activeClassA: Warning | null = null;
  /** R38.2 / R38.4 / R41.2 / R44.2 waits. */
  cooldowns: Cooldown[] = [];
  /** R41: times of system-initiated reclaim requests (deactivation rule in M5). */
  reclaimHistory: number[] = [];
  /** IR10 (M4) */
  lockedUntilIgnition = false;
  /** Director `setEgoLane { laneType }` (IR5.3, A-49). */
  egoLaneTypeOverride: LaneType | null = null;
  readonly anchors: Anchors = {};
  /** SRS IDs exercised so far (trace panel). */
  readonly trace = new Set<string>();
  /** Called on every takeover request (the scenario's reactive `takeoverOnClassA`). */
  readonly onTakeoverRequest: Array<(t: number) => void> = [];

  private readonly world: HfdsWorld;
  private previousAvailable: boolean | null = null;
  private nextWarningId = 1;
  private fcsDecel = 0;

  constructor(world: HfdsWorld, egoStart: { s: number; y: number; speedMph: number }) {
    this.world = world;
    const sc = world.scenario;
    this.vehicleConfig = { ...sc.vehicleConfig };
    this.sensors = new SensorSuite(sc.sensorOverrides);
    this.driverAssist = new DriverAssistSystem(
      sc.vehicleConfig,
      sc.ego.gapSetting,
      sc.ego.setSpeedMph,
    );
    this.vehicleControl = new VehicleControl(egoStart);
    this.hmi = new HumanMachineInterface(sc.vehicleConfig);
    this.functions = new VehicleFunctions(sc.vehicleConfig);
    this.forwardCollision = new ForwardCollisionSystem(sc.vehicleConfig.maxBrakingDecelFtps2);
  }

  get speedManagement() {
    return this.driverAssist.speedManagement;
  }

  get engaged(): boolean {
    return ENGAGED_MODES.includes(this.mode);
  }

  // -------------------------------------------------------------------------
  // Logging (R45: every entry has a timestamp; rule 1: every entry has its IDs)
  // -------------------------------------------------------------------------

  log(
    t: number,
    type: LogEntryType,
    source: string,
    message: string,
    reqs: string[],
    data?: unknown,
  ): LogEntry {
    const entry: LogEntry = { t, type, source, message, reqs };
    if (data !== undefined) entry.data = data;
    reqs.forEach((r) => this.trace.add(r));
    return this.eventLog.logEvent(entry);
  }

  /** Statuses of the assist subsystems (IR4). */
  subsystemStatuses(): Record<string, SubsystemStatus> {
    return {
      DriverAssistSystem: this.driverAssist.status,
      DriverAttentionSystem: this.driverAttention.status,
      VehicleControl: this.vehicleControl.status,
      PathPrediction: this.pathPrediction.status,
      VehiclePosition: this.vehiclePosition.status,
      EventLog: this.eventLog.status,
    };
  }

  egoLaneType(): LaneType {
    if (this.egoLaneTypeOverride) return this.egoLaneTypeOverride;
    return this.vehiclePosition.currentLane === 0 ? LaneType.Shoulder : LaneType.Travel;
  }

  /** A-30: the longest active wait, or null. */
  activeCooldown(t: number): { remainingS: number; reason: string } | null {
    this.cooldowns = this.cooldowns.filter((c) => c.until > t + 1e-9);
    let best: Cooldown | null = null;
    for (const c of this.cooldowns) if (!best || c.until > best.until) best = c;
    return best ? { remainingS: best.until - t, reason: best.reason } : null;
  }

  startCooldown(t: number, reason: string, seconds: number, reqs: string[]): void {
    this.cooldowns.push({ reason, until: t + seconds, reqs });
  }

  // -------------------------------------------------------------------------
  // Doc 13 §11 steps 3–6
  // -------------------------------------------------------------------------

  sense(t: number): void {
    const { road, map, traffic, driver, scenario } = this.world;
    const ego = this.vehicleControl.ego;
    const das = this.driverAssist;
    this.sensors.checkAll(t); // 3. IR29
    this.vehiclePosition.updatePosition(ego, road, this.sensors, map); // 4. R3
    this.pathPrediction.targetOffset = das.updateTargetOffset(ego, road, traffic); // UC12
    this.pathPrediction.calculateBluePath(this.vehiclePosition, map, road, t, scenario.simDate); // R2
    das.analyzeSurroundings(t, ego, traffic, this.pathPrediction, road); // 5. R19, R7, R4, UC11
    das.navigateCurve(ego.s, ego.speed, road); // UC9
    das.speedCommand(ego.speed); // R5, R21–R25 (while ACC is on)
    this.driverAttention.monitorDriver(driver, this.sensors, DT_S); // 6. R27
  }

  // -------------------------------------------------------------------------
  // Doc 13 §11 step 7: availability, button, transitions
  // -------------------------------------------------------------------------

  updateMode(t: number): void {
    this.evaluateAvailability(t);
    const driver = this.world.driver;
    const before = this.mode;

    const presses = driver.pendingButtonPresses.splice(0);
    for (const p of presses) this.handleButtonPress(p);

    // Priority (doc 13 §6): driver brake > driver takeover > MRM (M4) > Class A > Class B (M4).
    if (this.engaged && this.vehicleControl.detectDriverBraking(driver)) {
      this.handOverToDriver(t, 'driver braked', ['IR15', 'R50', 'R50.1', 'R50.2', 'R50.3', 'IR25']);
    } else if (this.mode === HfdsMode.TAKEOVER_REQUESTED) {
      const grips = Object.values(driver.gripAreas).filter(Boolean).length;
      if (grips >= GRIP_MIN_AREAS) {
        this.handOverToDriver(t, `firm grip on ${grips} sensing areas`, ['R35', 'UC18']);
      } else if (this.vehicleControl.detectDriverSteering(driver)) {
        this.handOverToDriver(t, 'driver steering', ['UC18', 'IR25']);
      }
    } else if (this.mode === HfdsMode.HANDS_FREE) {
      const [cause] = this.driverAssist.classACauses();
      if (cause) this.requestTakeover(t, cause);
    }

    if (this.mode === HfdsMode.STARTING) this.progressStartSequence(t);

    if (this.mode !== before && !this.engaged && this.mode !== HfdsMode.STARTING) {
      this.evaluateAvailability(t); // a new wait may have started
    }
    if (!this.engaged && this.mode !== HfdsMode.STARTING) {
      this.mode = this.available ? HfdsMode.AVAILABLE : HfdsMode.UNAVAILABLE;
    }
    // Engaged + availability lost → Class A takeover request (A-29): M4.
  }

  private evaluateAvailability(t: number): void {
    const { road, map, environment, scenario } = this.world;
    const ego = this.vehicleControl.ego;
    this.availabilityChecks = evaluateAvailability({
      t,
      simDate: scenario.simDate,
      ego,
      egoLaneId: this.vehiclePosition.currentLane,
      egoLaneType: this.egoLaneType(),
      road,
      map,
      environment,
      sensors: this.sensors,
      dats: this.driverAttention,
      das: this.driverAssist,
      position: this.vehiclePosition,
      functions: this.functions,
      subsystems: this.subsystemStatuses(),
      highSeverityError: null, // IR23: M5
      cooldown: this.activeCooldown(t),
      lockedUntilIgnition: this.lockedUntilIgnition,
    });
    this.available = this.availabilityChecks.every((c) => c.pass);
    if (this.available !== this.previousAvailable) {
      this.log(
        t,
        LogEntryType.info,
        'HumanMachineInterface',
        this.available
          ? `"${HMI_TEXT.HFDS_AVAILABLE}" shown: all operating constraints met`
          : `"${HMI_TEXT.HFDS_AVAILABLE}" off: ${describeFailures(this.availabilityChecks)}`,
        ['IR6'],
      );
      this.previousAvailable = this.available;
    }
  }

  /** Doc 13 §5.2. */
  private handleButtonPress(t: number): void {
    const prev = this.lastButtonPressAt;
    this.lastButtonPressAt = t;
    // R43 (A-43): ignore a press within 0.5 s (inclusive) of the previous press.
    if (prev !== null && ticksOf(t - prev) <= ticksOf(BUTTON_DEBOUNCE_S)) {
      this.log(
        t,
        LogEntryType.info,
        'HumanMachineInterface',
        `HFDS button press ignored (debounce: ${(t - prev).toFixed(2)} s after the previous press)`,
        ['R43'],
      );
      return;
    }

    if (this.mode === HfdsMode.STARTING) {
      // R42: finish the start sequence before processing a stop request.
      this.pendingStopRequest = true;
      this.log(
        t,
        LogEntryType.info,
        'HFDS',
        'Stop request queued until the start sequence finishes',
        ['R42', 'R12'],
      );
      return;
    }

    if (this.engaged) {
      this.disengage(t, 'driver pressed the HFDS button', ['R12']);
      return;
    }

    if (!this.available) {
      this.reject(t, failedChecks(this.availabilityChecks), 'HFDS unavailable');
      return;
    }

    // IR7: only the HFDS button starts engagement.
    this.mode = HfdsMode.STARTING;
    this.startSequenceStartedAt = t;
    this.log(
      t,
      LogEntryType.info,
      'DriverAssistSystem',
      'HFDS button pressed: start sequence running self-tests and engagement checks',
      ['IR7', 'R12', 'R14', 'R15', 'R47', 'R48.1'],
    );
  }

  private progressStartSequence(t: number): void {
    const started = this.startSequenceStartedAt ?? t;
    if (!this.available) {
      // Conditions changed during the start sequence.
      this.endStartSequence();
      this.reject(t, failedChecks(this.availabilityChecks), 'Engagement checks failed');
      this.dropQueuedStop(t);
      return;
    }
    if (ticksOf(t - started) < ticksOf(START_SEQUENCE_S)) return; // A-07

    this.endStartSequence();
    const failed = this.validateStart(t).filter((c) => !c.pass);
    if (failed.length > 0) {
      this.reject(t, failed, 'Engagement checks failed');
      this.dropQueuedStop(t);
      return;
    }
    this.engage(t);
    if (this.pendingStopRequest) {
      this.pendingStopRequest = false;
      this.disengage(t, 'stop request queued during the start sequence', ['R42', 'R12']);
    }
  }

  private endStartSequence(): void {
    this.startSequenceStartedAt = null;
    this.mode = this.available ? HfdsMode.AVAILABLE : HfdsMode.UNAVAILABLE;
  }

  private dropQueuedStop(t: number): void {
    if (!this.pendingStopRequest) return;
    this.pendingStopRequest = false;
    this.log(t, LogEntryType.info, 'HFDS', 'Queued stop request dropped: HFDS did not engage', [
      'R42',
    ]);
  }

  /**
   * End of the start sequence (SD1): R14 self-tests, R15 / R47 validation and R48.1
   * activation conditions. Returned as checklist-shaped lines for R49 messages.
   */
  validateStart(t: number): AvailabilityCheck[] {
    const { map, scenario, environment, road, driver } = this.world;
    const ego = this.vehicleControl.ego;
    const sensorsOk = PERCEPTION_SENSORS.every((id) => this.sensors.get(id).selfTest());
    const laneFunctionsOk =
      this.pathPrediction.status === SubsystemStatus.OK &&
      this.vehiclePosition.status === SubsystemStatus.OK;
    const mapValid = map.isEnabled() && !map.dataError && !map.isOutdated(scenario.simDate);
    const fresh = PERCEPTION_SENSORS.every(
      (id) => this.sensors.get(id).dataAgeS(t) * 1000 <= SENSOR_DATA_MAX_AGE_MS + 1e-6,
    );
    // A-41: trajectory valid when the ego is fully inside one travel lane (R18 containment).
    const lane = this.vehiclePosition.currentLane;
    const offset = Math.abs(ego.y - road.laneCenterY(lane));
    const trajectoryOk = lane >= 1 && offset + EGO_HALF_WIDTH <= road.laneWidthFt / 2 + 1e-9;
    const vc = this.vehicleControl.checkActivationConditions(driver);
    const r = (id: string, label: string, reqs: string[], pass: boolean, detail?: string) => {
      const c: AvailabilityCheck = { id, label, pass, reqs };
      if (!pass && detail) c.detail = detail;
      return c;
    };
    return [
      r(
        'R14',
        'Self-tests: cameras, radar, GPS, map data, lane management',
        ['R14'],
        sensorsOk && laneFunctionsOk && mapValid,
      ),
      r('R15.1', 'Road conditions safe', ['R15', 'R15.1'], environment.isWithinODD()),
      r(
        'R15.2',
        'Current trajectory inside the lane',
        ['R15', 'R15.2'],
        trajectoryOk,
        'ego not inside one travel lane',
      ),
      r('R15.3', 'Sensor input current', ['R15', 'R15.3'], fresh, 'sensor data older than 100 ms'),
      r(
        'R15.4',
        'Blue path valid',
        ['R15', 'R15.4'],
        this.pathPrediction.isPathValid(),
        `path confidence ${this.pathPrediction.pathConfidence.toFixed(2)}`,
      ),
      r(
        'R47',
        'Sensor status, vehicle position and LiDAR map valid',
        ['R47'],
        sensorsOk && this.vehiclePosition.positionValid && mapValid,
      ),
      r(
        'R48.1',
        'Vehicle activation conditions met',
        ['R48', 'R48.1'],
        vc.met,
        vc.problems.join(', '),
      ),
    ];
  }

  /** STARTING → HANDS_FREE (R48.2, R17, IR22, R33, R40, R45.1). */
  private engage(t: number): void {
    this.vehicleControl.confirmEngagement(); // R48.2
    this.mode = HfdsMode.HANDS_FREE;
    const mph = this.vehicleControl.ego.speed / MPH_TO_FTPS;
    this.speedManagement.activate(mph); // R17, IR27
    this.functions.fcsMode = FcsMode.AlertAndBrake; // IR22
    this.hmi.clearRejection();
    this.hmi.showControlTransfer(t, HMI_TEXT.CONTROL_TO_HFDS); // R40
    this.log(
      t,
      LogEntryType.engagement,
      'HFDS',
      `HFDS engaged (hands-free). Checks passed: R14 self-tests, R15 validation, R47, R48.1; ` +
        `engagement confirmed by VehicleControl. ACC set speed ${this.speedManagement.setSpeed?.toFixed(1)} mph; ` +
        `Forward Collision System "Alert and Brake"`,
      ['R45.1', 'R48.2', 'R15', 'R14', 'R47', 'R17', 'IR22', 'R33', 'R40'],
    );
  }

  /** Common exit from any engaged state to driver control (ACC cancels; A-45). */
  private releaseControl(t: number): void {
    this.mode = HfdsMode.UNAVAILABLE; // recomputed from availability at the end of updateMode
    this.speedManagement.cancelCruise();
    this.functions.fcsMode = FcsMode.Default;
    if (this.activeClassA) {
      this.hmi.removeWarning(this.activeClassA);
      this.activeClassA = null;
    }
    this.takeoverRequestedAt = null;
    this.hmi.showControlTransfer(t, HMI_TEXT.CONTROL_TO_DRIVER); // R40
  }

  /** R12 button-off (A-45: no wait afterwards). */
  disengage(t: number, cause: string, reqs: string[]): void {
    this.releaseControl(t);
    this.mode = this.available ? HfdsMode.AVAILABLE : HfdsMode.UNAVAILABLE;
    this.log(
      t,
      LogEntryType.disengagement,
      'HFDS',
      `HFDS disengaged: ${cause}. ${HMI_TEXT.CONTROL_TO_DRIVER}`,
      ['R45.2', 'R40', ...reqs],
    );
  }

  /**
   * Driver takeover (UC18): after a takeover request, or by braking at any time (IR15,
   * R50; SD8). Control returns to the driver and the engagement checks re-run 20 s later
   * (R38.4, A-53).
   */
  private handOverToDriver(t: number, how: string, reqs: string[]): void {
    const wasRequest = this.mode === HfdsMode.TAKEOVER_REQUESTED;
    this.releaseControl(t);
    this.startCooldown(t, 'R38.4 recheck after driver takeover', POST_TAKEOVER_RECHECK_S, [
      'R38.4',
    ]);
    this.anchors.takeover ??= t;
    this.log(
      t,
      LogEntryType.disengagement,
      'HFDS',
      `${wasRequest ? 'Takeover confirmed' : 'HFDS disengaged'}: ${how}; ACC cancelled. ${HMI_TEXT.CONTROL_TO_DRIVER}. ` +
        `Engagement checks re-run in ${POST_TAKEOVER_RECHECK_S} s`,
      ['R45.2', 'R40', 'R38.4', ...reqs],
    );
  }

  /** Any engaged state + Class A cause → TAKEOVER_REQUESTED (UC19, R28.1, IR12, IR13). */
  private requestTakeover(t: number, cause: ClassACause): void {
    this.mode = HfdsMode.TAKEOVER_REQUESTED;
    this.takeoverRequestedAt = t;
    const w = issueWarning(
      this.nextWarningId++,
      WarningClass.A,
      cause.reason,
      HMI_TEXT.TAKE_CONTROL,
      t,
      [...cause.reqs, 'UC19'],
    );
    this.activeClassA = w;
    this.hmi.displayWarning(w);
    this.reclaimHistory.push(t); // R41 (deactivation rule in M5)
    this.anchors.classA ??= t;
    this.eventLog.logTakeoverRequest(
      t,
      'DriverAssistSystem',
      `Class A reclaim warning (${cause.reason}): ${cause.detail}. "${HMI_TEXT.TAKE_CONTROL}"`,
      ['R45.3', 'R45.5', 'UC19', 'IR12', 'IR13', ...cause.reqs],
    );
    cause.reqs.concat(['R45.3', 'R45.5', 'UC19', 'IR12', 'IR13']).forEach((r) => this.trace.add(r));
    for (const cb of this.onTakeoverRequest) cb(t);
  }

  /** R16 + R49 (ISSUE-29). */
  private reject(t: number, failed: AvailabilityCheck[], heading: string): void {
    const reasons = describeFailures(failed);
    const labels = failed
      .map((c) => (c.id === 'IR16' ? `${c.label} (${HMI_TEXT.UPDATE_NEEDED})` : c.label))
      .join('; ');
    this.hmi.showRejection(t, `${heading}: ${labels}`, `Activation rejected: ${labels}`);
    this.log(
      t,
      LogEntryType.warning,
      'HumanMachineInterface',
      `Activation rejected (${heading}): ${reasons}`,
      ['R16', 'R49', ...new Set(failed.flatMap((c) => c.reqs))],
      { failed: failed.map((c) => c.id) },
    );
  }

  // -------------------------------------------------------------------------
  // Doc 13 §11 step 8: HFDS ControlCommands (R1) and the Forward Collision System
  // -------------------------------------------------------------------------

  /** In-lane objects ahead for the FCS: the lead (incl. entering vehicles) and hazards. */
  private collisionObjects(): CollisionObject[] {
    const ego = this.vehicleControl.ego;
    const das = this.driverAssist;
    const out: CollisionObject[] = [];
    if (das.leadVehicle && das.leadGap !== null) {
      out.push({
        label: `vehicle ${das.leadVehicle.vehicleId}`,
        gap: das.leadGap,
        closing: ego.speed - das.leadVehicle.speed,
      });
    }
    const lane = this.world.road.laneIdAt(ego.y);
    for (const h of this.world.hazards.all) {
      const gap = h.s - ego.s;
      if (h.laneId === lane && gap >= 0)
        out.push({ label: `${h.type} ${h.id}`, gap, closing: ego.speed });
    }
    return out;
  }

  /** Builds this tick's HFDS commands and evaluates the FCS. Returns the FCS deceleration. */
  commands(t: number): number {
    const vc = this.vehicleControl;
    const ego = vc.ego;
    const das = this.driverAssist;
    if (this.mode === HfdsMode.HANDS_FREE || this.mode === HfdsMode.TAKEOVER_REQUESTED) {
      const steer = das.keepLaneCentered(ego.y, this.pathPrediction); // R20; IR13 hold lane
      if (steer) vc.execute(steer);
      let accel =
        this.mode === HfdsMode.TAKEOVER_REQUESTED
          ? -COAST_DECEL_FTPS2 // IR13: coast without accelerating
          : (das.lastLongitudinal?.accel ?? 0);
      if (lightBarFor(this.mode) === LightBarState.FlashingRed) accel = Math.min(accel, 0); // IR12
      if (accel >= 0) vc.accelerate(accel);
      else vc.brake(-accel);
    }

    const fcs = this.forwardCollision.evaluate(this.collisionObjects());
    if (fcs.started && this.forwardCollision.cause) {
      const c = this.forwardCollision.cause;
      this.log(
        t,
        LogEntryType.warning,
        'ForwardCollisionSystem',
        `Forward collision alert: automatic braking for ${c.label} (time to collision ${ForwardCollisionSystem.ttc(c).toFixed(2)} s)`,
        ['IR22'],
      );
    }
    this.fcsDecel = fcs.decel;
    return fcs.decel;
  }

  // -------------------------------------------------------------------------
  // Doc 13 §11 step 10
  // -------------------------------------------------------------------------

  updateHmi(t: number): void {
    this.hmi.updateDisplay(t, {
      mode: this.mode,
      available: this.available,
      updateNeeded: this.world.map.isOutdated(this.world.scenario.simDate),
      fcsMode: this.functions.fcsMode,
      takeoverRequested: this.mode === HfdsMode.TAKEOVER_REQUESTED,
      secondAlertMode: this.vehicleConfig.secondAlertMode,
      forwardCollisionAlert: this.forwardCollision.braking,
    });
  }

  /** Snapshot timers (doc 15 B4). */
  timers(t: number): HfdsTimers {
    const out: HfdsTimers = {};
    if (this.takeoverRequestedAt !== null) {
      out.takeoverRemainingS = Math.max(0, TAKEOVER_PERIOD_S - (t - this.takeoverRequestedAt));
    }
    const cd = this.activeCooldown(t);
    if (cd) out.cooldownRemainingS = cd.remainingS;
    return out;
  }

  /** FCS deceleration decided in commands() this tick. */
  get fcsDeceleration(): number {
    return this.fcsDecel;
  }

  /** Sensor used for lead distance first (radar, then front camera; SR4.2 — M5 switches). */
  leadSensor(): SensorId | null {
    if (this.sensors.ok(SensorId.RADAR_FRONT)) return SensorId.RADAR_FRONT;
    if (this.sensors.ok(SensorId.CAM_FRONT)) return SensorId.CAM_FRONT;
    return null;
  }
}
