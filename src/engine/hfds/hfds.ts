/**
 * HFDS orchestrator and mode state machine (doc 12 HFDS; doc 13 §5–§8, §10; ISSUE-23).
 *
 * Implemented so far:
 *   M2  availability (doc 13 §5.1), button handling (§5.2: R12, R16, R42, R43, R49, IR7,
 *       IR28), STARTING → HANDS_FREE (R14, R15, R17, R47, R48, IR22).
 *   M3  lane keeping and ACC commands (R1, R18, R20, R21–R25, IR9, IR27), Class A takeover
 *       requests (UC19, IR12, IR13), takeover confirmation (R35, UC18, R40), driver brake
 *       disengagement (IR15, R50), the R38.4 recheck, the Forward Collision System (A-25).
 *   M4  Class B attention escalation (R27–R32, R36), R39 driver-steering pause / resume,
 *       the 30 s takeover period (SR7), the minimal risk maneuver (SR1, SR6) and the IR10
 *       lockout, more Class A causes (IR26 hazard, A-29 ODD exit, IR14 invalid path, UC17
 *       end of road, IR5.10 FCW), Class A superseding Class B (A-22), MRM abort (A-21).
 *   M5  faults, error codes, R38 bands, R41, R44.
 *
 * Priority within one tick (doc 13 §6): driver brake > driver takeover > MRM > Class A >
 * Class B > R39 steering pause.
 *
 * Tick order (doc 13 §11): sense() runs steps 3–6, updateMode() step 7, commands()
 * step 8, updateHmi() step 10. Deterministic, sim time only.
 */
import {
  BUTTON_DEBOUNCE_S,
  COAST_DECEL_FTPS2,
  DRIVER_MAX_LATERAL_SPEED_FTPS,
  DT_S,
  EGO_SIZE_CLASS,
  FINAL_TO_INACTIVE_S,
  FIRST_TO_SECOND_ALERT_S,
  GRIP_MIN_AREAS,
  HMI_TEXT,
  LANE_KEEP_GAIN_PER_S,
  MAX_STEERING_ANGLE_DEG,
  MPH_TO_FTPS,
  ONSTAR_CONNECT_S,
  PHANTOM_BRAKE_DECEL_FTPS2,
  PHANTOM_BRAKE_DURATION_S,
  POST_TAKEOVER_RECHECK_S,
  SECOND_TO_FINAL_ALERT_S,
  SENSOR_DATA_MAX_AGE_MS,
  START_SEQUENCE_S,
  STEER_RESUME_SPEED_BAND_MPH,
  STEER_RESUME_STABLE_S,
  TAKEOVER_PERIOD_S,
  VEHICLE_DIMENSIONS_FT,
} from '../../shared/constants';
import {
  AlertLevel,
  ENGAGED_MODES,
  FcsMode,
  HfdsMode,
  LaneType,
  LightBarState,
  LogEntryType,
  OnStarStatus,
  SensorId,
  SubsystemStatus,
  WarningClass,
  WarningReason,
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
import { MinimalRiskManeuver } from './mrm';
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
const ALERT_MODES: readonly HfdsMode[] = [
  HfdsMode.ALERT_FIRST,
  HfdsMode.ALERT_SECOND,
  HfdsMode.ALERT_FINAL,
];
/** Modes in which HFDS drives hands-free or under an attention alert (Class A / B apply). */
const SUPERVISED_MODES: readonly HfdsMode[] = [
  HfdsMode.HANDS_FREE,
  HfdsMode.DRIVER_STEERING,
  ...ALERT_MODES,
];
/** A-29: availability lines whose loss while engaged is an ODD exit (Class A). */
const ODD_LINES = ['IR1', 'IR2', 'IR5.1', 'IR5.2', 'IR5.3', 'IR5.4', 'IR5.5', 'IR5.9', 'IR16'];

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
  /** The Class B warning in force (R29–R31). */
  activeClassB: Warning | null = null;
  /** Mode to return to when a Class B alert is cancelled (R32). */
  preAlertMode: HfdsMode = HfdsMode.HANDS_FREE;
  /** R39.2 resume window: start time and the speed band seen so far (mph). */
  resumeWindow: { startedAt: number; min: number; max: number } | null = null;
  /** SR1 */
  mrm: MinimalRiskManeuver | null = null;
  /** SR1.2 / SR1.3 / SR1.4 outputs. */
  hazardLights = false;
  onStar: OnStarStatus = OnStarStatus.idle;
  doorsUnlocked = false;
  /** R38.2 / R38.4 / R41.2 / R44.2 waits. */
  cooldowns: Cooldown[] = [];
  /** R41: times of system-initiated reclaim requests (deactivation rule in M5). */
  reclaimHistory: number[] = [];
  /** IR10 */
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
    const { road, map, traffic, driver, scenario, hazards } = this.world;
    const ego = this.vehicleControl.ego;
    const das = this.driverAssist;
    this.sensors.checkAll(t); // 3. IR29
    this.vehiclePosition.updatePosition(ego, road, this.sensors, map); // 4. R3
    this.pathPrediction.targetOffset = das.updateTargetOffset(ego, road, traffic); // UC12
    this.pathPrediction.calculateBluePath(this.vehiclePosition, map, road, t, scenario.simDate); // R2
    das.analyzeSurroundings(t, ego, traffic, this.pathPrediction, road); // 5. R19, R7, R4, UC11
    das.navigateCurve(ego.s, ego.speed, road); // UC9
    das.detectHazard(t, ego, road, hazards.all); // UC10, IR26
    das.speedCommand(ego.speed); // R5, R21–R25 (while ACC is on)
    this.driverAttention.monitorDriver(driver, this.sensors, t); // 6. R27
  }

  // -------------------------------------------------------------------------
  // Doc 13 §11 step 7: availability, button, transitions
  // -------------------------------------------------------------------------

  updateMode(t: number): void {
    this.evaluateAvailability(t);
    const before = this.mode;

    const presses = this.world.driver.pendingButtonPresses.splice(0);
    for (const p of presses) this.handleButtonPress(p);

    this.updateDrivingStates(t);

    if (this.mode === HfdsMode.STARTING) this.progressStartSequence(t);

    const settled = !this.engaged && this.mode !== HfdsMode.STARTING && !this.isFallback();
    if (this.mode !== before && settled) this.evaluateAvailability(t); // a new wait may have started
    if (settled) this.mode = this.available ? HfdsMode.AVAILABLE : HfdsMode.UNAVAILABLE;
  }

  private isFallback(): boolean {
    return this.mode === HfdsMode.MINIMAL_RISK_MANEUVER || this.mode === HfdsMode.STOPPED_LOCKOUT;
  }

  /** Doc 13 §6 transitions for the engaged and fallback modes, in priority order. */
  private updateDrivingStates(t: number): void {
    const driver = this.world.driver;
    const vc = this.vehicleControl;
    const dats = this.driverAttention;
    const braking = vc.detectDriverBraking(driver);
    const steering = vc.detectDriverSteering(driver);
    const grips = Object.values(driver.gripAreas).filter(Boolean).length;

    // 1. Driver brake (IR15, R50) in any engaged state; during the MRM it aborts it (A-21).
    if (this.engaged && braking) {
      this.handOverToDriver(t, 'driver braked', ['IR15', 'R50', 'R50.1', 'R50.2', 'R50.3', 'IR25']);
      return;
    }
    if (
      this.mode === HfdsMode.MINIMAL_RISK_MANEUVER &&
      (braking || (grips >= GRIP_MIN_AREAS && steering))
    ) {
      this.abortMrm(t, braking ? 'driver braked' : 'driver gripped the wheel and steered');
      return;
    }

    // 2. Driver takeover.
    if (this.mode === HfdsMode.TAKEOVER_REQUESTED) {
      if (grips >= GRIP_MIN_AREAS) {
        this.handOverToDriver(t, `firm grip on ${grips} sensing areas`, ['R35', 'UC18']);
        return;
      }
      if (steering) {
        this.handOverToDriver(t, 'driver steering', ['UC18', 'IR25']);
        return;
      }
    }
    if (ALERT_MODES.includes(this.mode) && steering) {
      this.handOverToDriver(t, 'driver steering during an attention alert', ['UC18', 'IR25']);
      return;
    }

    // 3. Minimal risk maneuver: no takeover in 30 s (SR7); driver inactive (R36, SR6, IR11).
    if (
      this.mode === HfdsMode.TAKEOVER_REQUESTED &&
      this.takeoverRequestedAt !== null &&
      ticksOf(t - this.takeoverRequestedAt) >= ticksOf(TAKEOVER_PERIOD_S)
    ) {
      this.enterMrm(t, `no takeover within ${TAKEOVER_PERIOD_S} s of the takeover request`, [
        'SR7',
      ]);
      return;
    }
    if (
      this.mode === HfdsMode.ALERT_FINAL &&
      ticksOf(dats.alertElapsed(t)) >= ticksOf(FINAL_TO_INACTIVE_S) &&
      !dats.isDriverEngaged()
    ) {
      dats.markDriverInactive(driver);
      this.log(
        t,
        LogEntryType.warning,
        'DriverAttentionSystem',
        'Driver marked inactive: no re-engagement within 2 s of the final alert',
        ['R36'],
      );
      this.enterMrm(t, 'driver inactive after the final attention alert', ['R36', 'SR6', 'IR11']);
      return;
    }
    if (this.mode === HfdsMode.MINIMAL_RISK_MANEUVER) {
      this.progressMrm(t);
      return;
    }

    if (!SUPERVISED_MODES.includes(this.mode)) return;

    // 4. Class A causes (A-22: they supersede a Class B alert).
    const cause = this.classACause();
    if (cause) {
      this.requestTakeover(t, cause);
      return;
    }

    // 5. Class B attention escalation (R29–R32).
    if (ALERT_MODES.includes(this.mode)) {
      if (dats.isDriverEngaged()) {
        this.cancelAttentionAlert(t);
        return;
      }
      const elapsed = ticksOf(dats.alertElapsed(t));
      if (this.mode === HfdsMode.ALERT_FIRST && elapsed >= ticksOf(FIRST_TO_SECOND_ALERT_S))
        this.escalate(t);
      else if (this.mode === HfdsMode.ALERT_SECOND && elapsed >= ticksOf(SECOND_TO_FINAL_ALERT_S))
        this.escalate(t);
      return;
    }
    if (dats.attentionLossDetected()) {
      this.escalate(t);
      return;
    }

    // 6. R39 driver steering pause / resume.
    if (this.mode === HfdsMode.HANDS_FREE && steering) {
      this.mode = HfdsMode.DRIVER_STEERING;
      this.resumeWindow = null;
      this.log(
        t,
        LogEntryType.info,
        'DriverAssistSystem',
        'Driver steering: HFDS pauses steering, ACC continues (pulsing blue)',
        ['R39', 'R39.1', 'R34.2', 'IR25'],
      );
      return;
    }
    if (this.mode === HfdsMode.DRIVER_STEERING) this.checkResume(t, grips, steering);
  }

  /** R39.2: resume after 3 s within a 1.0 mph band with a firm grip and no steering (A-17, A-54). */
  private checkResume(t: number, grips: number, steering: boolean): void {
    const mph = this.vehicleControl.currentSpeed;
    if (grips < GRIP_MIN_AREAS || steering) {
      this.resumeWindow = null;
      return;
    }
    const w = this.resumeWindow;
    if (!w || Math.max(w.max, mph) - Math.min(w.min, mph) > STEER_RESUME_SPEED_BAND_MPH + 1e-9) {
      this.resumeWindow = { startedAt: t, min: mph, max: mph };
      return;
    }
    w.min = Math.min(w.min, mph);
    w.max = Math.max(w.max, mph);
    if (ticksOf(t - w.startedAt) >= ticksOf(STEER_RESUME_STABLE_S)) {
      this.mode = HfdsMode.HANDS_FREE;
      this.resumeWindow = null;
      this.hmi.showControlTransfer(t, HMI_TEXT.CONTROL_TO_HFDS); // R40
      this.log(
        t,
        LogEntryType.info,
        'DriverAssistSystem',
        `HFDS resumes steering: speed stayed within ${STEER_RESUME_SPEED_BAND_MPH} mph and the wheel was held for ${STEER_RESUME_STABLE_S} s`,
        ['R39.2', 'R35', 'R33', 'R40'],
      );
    }
  }

  /** Class A causes in priority order (doc 13 §7). */
  classACause(): ClassACause | null {
    const das = this.driverAssist.classACauses();
    const braking = das.find((c) => c.reason === WarningReason.BRAKING_INSUFFICIENT);
    if (braking) return braking;
    const hazard = das.find((c) => c.reason === WarningReason.HAZARD_IN_LANE);
    if (hazard) return hazard;
    const odd = this.availabilityChecks.filter((c) => !c.pass && ODD_LINES.includes(c.id));
    if (odd.length) {
      return {
        reason: WarningReason.ODD_EXIT,
        reqs: ['IR5', 'IR14', 'R28.1', ...new Set(odd.flatMap((c) => c.reqs))],
        detail: describeFailures(odd),
      };
    }
    if (!this.pathPrediction.isPathValid()) {
      return {
        reason: WarningReason.INVALID_PATH,
        reqs: ['IR14', 'R28.1', 'UC5'],
        detail: `blue path invalid (confidence ${this.pathPrediction.pathConfidence.toFixed(2)})`,
      };
    }
    const end = this.availabilityChecks.find((c) => c.id === 'UC17' && !c.pass);
    if (end) {
      return {
        reason: WarningReason.END_OF_ENABLED_ROAD,
        reqs: ['IR1', 'UC17', 'R28.1'],
        detail: end.detail ?? 'end of the HFDS-enabled road ahead',
      };
    }
    const curve = das.find((c) => c.reason === WarningReason.CURVE_TOO_SHARP);
    if (curve) return curve;
    if (this.functions.fcwEscalated) {
      return {
        reason: WarningReason.FCW_ESCALATION,
        reqs: ['IR5.10', 'R28.1'],
        detail: 'forward collision warning escalated to a takeover request',
      };
    }
    return null;
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

    if (this.isFallback()) {
      const locked = this.mode === HfdsMode.STOPPED_LOCKOUT;
      this.log(
        t,
        LogEntryType.info,
        'HumanMachineInterface',
        locked
          ? 'HFDS button ignored: unavailable until the next ignition cycle'
          : 'HFDS button ignored during the minimal risk maneuver: brake, or grip and steer, to take control',
        locked ? ['IR10'] : ['SR1', 'IR25'],
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

  private clearWarnings(): void {
    for (const w of [this.activeClassA, this.activeClassB]) if (w) this.hmi.removeWarning(w);
    this.activeClassA = null;
    this.activeClassB = null;
    this.driverAttention.cancelAlert();
  }

  /** Common exit to driver control (ACC cancels; A-45). */
  private releaseControl(t: number): void {
    this.mode = HfdsMode.UNAVAILABLE; // recomputed from availability at the end of updateMode
    this.speedManagement.cancelCruise();
    this.functions.fcsMode = FcsMode.Default;
    this.clearWarnings();
    this.takeoverRequestedAt = null;
    this.resumeWindow = null;
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
   * Driver takeover (UC18): after a takeover request or an alert, or by braking at any
   * time (IR15, R50; SD8). Control returns to the driver and the engagement checks re-run
   * 20 s later (R38.4, A-53).
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

  /** Any supervised state + Class A cause → TAKEOVER_REQUESTED (UC19, R28.1, IR12, IR13). */
  private requestTakeover(t: number, cause: ClassACause): void {
    if (this.activeClassB) {
      // A-22: the Class A warning replaces an active Class B alert.
      this.log(
        t,
        LogEntryType.info,
        'DriverAttentionSystem',
        'Attention alert superseded by a Class A reclaim warning',
        ['R28'],
      );
      this.hmi.removeWarning(this.activeClassB);
      this.activeClassB = null;
      this.driverAttention.cancelAlert();
    }
    this.mode = HfdsMode.TAKEOVER_REQUESTED;
    this.takeoverRequestedAt = t;
    this.resumeWindow = null;
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
    const reqs = ['R45.3', 'R45.5', 'UC19', 'IR12', 'IR13', ...cause.reqs];
    this.eventLog.logTakeoverRequest(
      t,
      'DriverAssistSystem',
      `Class A reclaim warning (${cause.reason}): ${cause.detail}. "${HMI_TEXT.TAKE_CONTROL}"`,
      reqs,
    );
    reqs.forEach((r) => this.trace.add(r));
    for (const cb of this.onTakeoverRequest) cb(t);
  }

  /** R29 → R30 → R31 (Class B, R28.2). */
  private escalate(t: number): void {
    const dats = this.driverAttention;
    if (!ALERT_MODES.includes(this.mode)) this.preAlertMode = this.mode;
    const level = dats.escalateAlert(t);
    this.mode =
      level === AlertLevel.First
        ? HfdsMode.ALERT_FIRST
        : level === AlertLevel.Second
          ? HfdsMode.ALERT_SECOND
          : HfdsMode.ALERT_FINAL;
    this.resumeWindow = null;
    const message = level === AlertLevel.First ? HMI_TEXT.PAY_ATTENTION : HMI_TEXT.TAKE_CONTROL;
    const reqs =
      level === AlertLevel.First
        ? ['R27', 'R28.2', 'R29', 'R29.1', 'R29.2', 'R34.1', 'R45.3']
        : level === AlertLevel.Second
          ? ['R29.3', 'R30', 'R30.1', 'R30.2', 'R30.3', 'IR12', 'R34.3', 'R45.3']
          : ['R30.4', 'R31', 'R31.1', 'R31.2', 'R34.3', 'R45.3'];
    const prev = this.activeClassB;
    if (prev) this.hmi.removeWarning(prev);
    const w = issueWarning(
      prev?.id ?? this.nextWarningId++,
      WarningClass.B,
      WarningReason.ATTENTION_LOSS,
      message,
      t,
      reqs,
      level,
    );
    this.activeClassB = w;
    this.hmi.displayWarning(w);
    this.log(
      t,
      LogEntryType.warning,
      'DriverAttentionSystem',
      `${level} attention alert: "${message}"`,
      reqs,
    );
    if (level === AlertLevel.Final) {
      this.vehicleControl.applyPhantomBrake(t + PHANTOM_BRAKE_DURATION_S); // R31.3, A-13
      this.log(
        t,
        LogEntryType.info,
        'VehicleControl',
        `phantom brake: ${PHANTOM_BRAKE_DECEL_FTPS2} ft/s² for ${PHANTOM_BRAKE_DURATION_S} s`,
        ['R31.3'],
      );
    }
  }

  /** R32: the driver re-engaged; the alert is cancelled. */
  private cancelAttentionAlert(t: number): void {
    const level = this.driverAttention.alertLevel;
    if (this.activeClassB) this.hmi.removeWarning(this.activeClassB);
    this.activeClassB = null;
    this.driverAttention.cancelAlert();
    this.mode = this.preAlertMode;
    this.log(
      t,
      LogEntryType.info,
      'DriverAttentionSystem',
      `${level ?? ''} attention alert cancelled: driver engagement resumed`.trim(),
      ['R32'],
    );
  }

  /** SR1 entry (SR6, SR7): hazards on, maneuver starts. */
  private enterMrm(t: number, cause: string, reqs: string[]): void {
    const { road, traffic } = this.world;
    this.clearWarnings();
    this.takeoverRequestedAt = null;
    this.speedManagement.cancelCruise();
    this.mode = HfdsMode.MINIMAL_RISK_MANEUVER;
    this.mrm = new MinimalRiskManeuver(cause, { t, ego: this.vehicleControl.ego, road, traffic });
    this.hazardLights = true; // SR1.2
    this.anchors.mrm ??= t;
    const plan = this.mrm.stopInLane
      ? `controlled stop in the current lane (${this.mrm.why})`
      : 'moving to the right shoulder';
    this.log(
      t,
      LogEntryType.disengagement,
      'HFDS',
      `Hands-free driving aborted: ${cause}. Minimal risk maneuver: ${plan}; hazard lights on`,
      ['SR1', 'SR1.1', 'SR1.1.1', 'SR1.2', 'R45.2', 'UC21', ...reqs],
    );
  }

  /** Logs the maneuver's transitions; MinimalRiskManeuver.update() runs in commands(). */
  private progressMrm(t: number): void {
    const mrm = this.mrm;
    if (!mrm) return;
    if (mrm.phase === 'stopped') {
      this.mode = HfdsMode.STOPPED_LOCKOUT;
      this.lockedUntilIgnition = true; // IR10
      this.functions.fcsMode = FcsMode.Default; // IR22 applies while HFDS drives
      this.onStar = OnStarStatus.connecting; // SR1.3
      this.doorsUnlocked = true; // SR1.4
      this.log(
        t,
        LogEntryType.info,
        'HFDS',
        `Vehicle stopped ${mrm.stopLane === 0 ? 'on the right shoulder' : `in lane ${mrm.stopLane}`}` +
          `: connecting an OnStar advisor, doors unlocked; HFDS unavailable until the next ignition cycle`,
        ['SR1.1', 'SR1.3', 'SR1.4', 'IR10'],
      );
    }
  }

  /** A-21: during the MRM the driver brakes, or grips and steers → driver control. */
  private abortMrm(t: number, how: string): void {
    this.mrm = null;
    this.releaseControl(t);
    this.startCooldown(t, 'R38.4 recheck after driver takeover', POST_TAKEOVER_RECHECK_S, [
      'R38.4',
    ]);
    this.anchors.takeover ??= t;
    this.log(
      t,
      LogEntryType.disengagement,
      'HFDS',
      `Minimal risk maneuver ended: ${how}. ${HMI_TEXT.CONTROL_TO_DRIVER}; hazard lights stay on`,
      ['IR25', 'R45.2', 'R40', 'R38.4'],
    );
  }

  /** IR10: a Director ignition cycle restarts HFDS. */
  ignitionCycle(t: number): void {
    this.mrm = null;
    this.clearWarnings();
    this.lockedUntilIgnition = false;
    this.hazardLights = false;
    this.onStar = OnStarStatus.idle;
    this.takeoverRequestedAt = null;
    this.cooldowns = [];
    this.speedManagement.cancelCruise();
    this.functions.fcsMode = FcsMode.Default;
    this.driverAttention.reset();
    this.mode = HfdsMode.UNAVAILABLE;
    this.log(t, LogEntryType.info, 'HFDS', 'Ignition cycle: HFDS restarted (lockout cleared)', [
      'IR10',
    ]);
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

  /** Lateral command towards a lateral position, using the R20 controller (A-51). */
  private steerTo(y: number): void {
    const ego = this.vehicleControl.ego;
    const lateral = Math.max(
      -DRIVER_MAX_LATERAL_SPEED_FTPS,
      Math.min(DRIVER_MAX_LATERAL_SPEED_FTPS, LANE_KEEP_GAIN_PER_S * (y - ego.y)),
    );
    this.vehicleControl.steer((lateral / DRIVER_MAX_LATERAL_SPEED_FTPS) * MAX_STEERING_ANGLE_DEG);
  }

  /** Builds this tick's HFDS commands and evaluates the FCS. Returns the FCS deceleration. */
  commands(t: number): number {
    const vc = this.vehicleControl;
    const ego = vc.ego;
    const das = this.driverAssist;
    const m = this.mode;
    let accel: number | null = null;

    if (m === HfdsMode.MINIMAL_RISK_MANEUVER && this.mrm) {
      const { road, traffic } = this.world;
      const wasStopInLane = this.mrm.stopInLane;
      const cmd = this.mrm.update({ t, ego, road, traffic });
      if (!wasStopInLane && this.mrm.stopInLane) {
        this.log(
          t,
          LogEntryType.info,
          'HFDS',
          `Shoulder no longer reachable (${this.mrm.why}): controlled stop in the current lane`,
          ['SR1.1', 'SR1.1.1'],
        );
      }
      this.steerTo(cmd.targetY);
      accel = cmd.accel;
    } else if (SUPERVISED_MODES.includes(m) || m === HfdsMode.TAKEOVER_REQUESTED) {
      // R39: no HFDS steering while the driver steers; IR13: hold the lane until takeover.
      if (m !== HfdsMode.DRIVER_STEERING) {
        const steer = das.keepLaneCentered(ego.y, this.pathPrediction); // R20
        if (steer) vc.execute(steer);
      }
      accel =
        m === HfdsMode.TAKEOVER_REQUESTED ? -COAST_DECEL_FTPS2 : (das.lastLongitudinal?.accel ?? 0);
      if (vc.phantomBrakeActive(t)) accel = Math.min(accel, -PHANTOM_BRAKE_DECEL_FTPS2); // R31.3
    }

    if (accel !== null) {
      if (lightBarFor(m) === LightBarState.FlashingRed) accel = Math.min(accel, 0); // IR12
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
    // SR1.3 stub: the advisor connects a few seconds after the stop (A-55).
    const stoppedAt = this.mrm?.stoppedAt ?? null;
    if (
      this.onStar === OnStarStatus.connecting &&
      stoppedAt !== null &&
      t - stoppedAt >= ONSTAR_CONNECT_S - 1e-9
    ) {
      this.onStar = OnStarStatus.connected;
      this.log(t, LogEntryType.info, 'HFDS', 'OnStar emergency advisor connected', ['SR1.3']);
    }
    this.hmi.updateDisplay(t, {
      mode: this.mode,
      available: this.available,
      updateNeeded: this.world.map.isOutdated(this.world.scenario.simDate),
      fcsMode: this.functions.fcsMode,
      takeoverRequested:
        this.mode === HfdsMode.TAKEOVER_REQUESTED || this.mode === HfdsMode.MINIMAL_RISK_MANEUVER,
      secondAlertMode: this.vehicleConfig.secondAlertMode,
      forwardCollisionAlert: this.forwardCollision.braking,
      alertLevel: this.driverAttention.alertLevel,
      hazardLights: this.hazardLights,
      onStar: this.onStar,
      doorsUnlocked: this.doorsUnlocked,
    });
  }

  /** Snapshot timers (doc 15 B4). */
  timers(t: number): HfdsTimers {
    const out: HfdsTimers = {};
    if (this.driverAttention.alertLevel !== null)
      out.alertElapsedS = this.driverAttention.alertElapsed(t);
    if (this.takeoverRequestedAt !== null) {
      out.takeoverRemainingS = Math.max(0, TAKEOVER_PERIOD_S - (t - this.takeoverRequestedAt));
    }
    if (this.resumeWindow) out.resumeProgressS = t - this.resumeWindow.startedAt;
    const cd = this.activeCooldown(t);
    if (cd) out.cooldownRemainingS = cd.remainingS;
    if (this.mrm && this.mode === HfdsMode.MINIMAL_RISK_MANEUVER)
      out.mrmElapsedS = this.mrm.elapsed(t);
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
