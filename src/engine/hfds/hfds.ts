/**
 * HFDS orchestrator and mode state machine (doc 12 HFDS; doc 13 §5–§6; ISSUE-23).
 *
 * M2 implements availability (doc 13 §5.1), button handling (§5.2: R12, R16, R42, R43,
 * R49, IR7, IR28) and STARTING → HANDS_FREE (R14, R15, R17, R47, R48, IR22). Attention
 * escalation, takeover and the minimal risk maneuver (§6 rows for Class A/B, R39, SR1)
 * arrive in M4; faults and cooldowns in M5.
 *
 * Tick order (doc 13 §11): sense() runs steps 3–6, updateMode() step 7, updateHmi()
 * step 10. Everything is deterministic and uses sim time only.
 */
import {
  DT_S,
  BUTTON_DEBOUNCE_S,
  HMI_TEXT,
  MPH_TO_FTPS,
  SENSOR_DATA_MAX_AGE_MS,
  START_SEQUENCE_S,
  VEHICLE_DIMENSIONS_FT,
  EGO_SIZE_CLASS,
} from '../../shared/constants';
import {
  ENGAGED_MODES,
  FcsMode,
  HfdsMode,
  LaneType,
  LogEntryType,
  SensorId,
  SubsystemStatus,
  type LogEntry,
} from '../../shared/domain';
import type { AvailabilityCheck } from '../../shared/protocol';
import type { Scenario } from '../../shared/scenario-schema';
import type { Driver } from '../world/driver';
import type { EnvironmentState } from '../world/environment';
import type { LiDARMap } from '../world/lidar-map';
import type { Road } from '../world/road';
import type { TrafficModel } from '../world/traffic';
import { describeFailures, evaluateAvailability, failedChecks } from './availability';
import { DriverAssistSystem } from './driver-assist';
import { DriverAttentionSystem } from './driver-attention';
import { EventLog } from './event-log';
import { HumanMachineInterface } from './hmi';
import { PathPrediction } from './path-prediction';
import { PERCEPTION_SENSORS, SensorSuite } from './sensors';
import { VehicleControl } from './vehicle-control';
import { VehicleFunctions } from './vehicle-functions';
import { VehiclePosition } from './vehicle-position';

/** World objects HFDS reads but does not own. */
export interface HfdsWorld {
  scenario: Scenario;
  road: Road;
  environment: EnvironmentState;
  traffic: TrafficModel;
  driver: Driver;
  map: LiDARMap;
}

/** Engine-recorded anchors for `after:` expectations (doc 14); set from M4. */
export interface Anchors {
  classA?: number;
  takeover?: number;
  mrm?: number;
}

const ticksOf = (seconds: number): number => Math.round(seconds / DT_S);

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

  availabilityChecks: AvailabilityCheck[] = [];
  available = false;
  /** R43: sim time of the previous button press (accepted or not; A-43). */
  lastButtonPressAt: number | null = null;
  /** R42 */
  startSequenceStartedAt: number | null = null;
  pendingStopRequest = false;
  /** R41 (M4) */
  reclaimHistory: number[] = [];
  /** IR10 (M4) */
  lockedUntilIgnition = false;
  /** Director `setEgoLane { laneType }` (IR5.3, A-49). */
  egoLaneTypeOverride: LaneType | null = null;
  readonly anchors: Anchors = {};
  /** SRS IDs exercised so far (trace panel). */
  readonly trace = new Set<string>();

  private readonly world: HfdsWorld;
  private previousAvailable: boolean | null = null;

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

  // -------------------------------------------------------------------------
  // Doc 13 §11 steps 3–6
  // -------------------------------------------------------------------------

  sense(t: number): void {
    const { road, map, traffic, driver, scenario } = this.world;
    const ego = this.vehicleControl.ego;
    this.sensors.checkAll(t); // 3. IR29
    this.vehiclePosition.updatePosition(ego, road, this.sensors, map); // 4. R3
    this.pathPrediction.calculateBluePath(this.vehiclePosition, map, road, t, scenario.simDate); // R2
    this.driverAssist.analyzeSurroundings(t, ego, traffic, this.pathPrediction); // 5. R19, R4
    this.driverAttention.monitorDriver(driver, this.sensors, DT_S); // 6. R27
  }

  // -------------------------------------------------------------------------
  // Doc 13 §11 step 7: availability, button, transitions
  // -------------------------------------------------------------------------

  updateMode(t: number): void {
    this.evaluateAvailability(t);

    const presses = this.world.driver.pendingButtonPresses.splice(0);
    for (const p of presses) this.handleButtonPress(p);

    if (this.mode === HfdsMode.STARTING) this.progressStartSequence(t);

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
      cooldown: null, // R38 / R41 / R44: M4–M5
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
    const egoHalf = VEHICLE_DIMENSIONS_FT[EGO_SIZE_CLASS].width / 2;
    const lane = this.vehiclePosition.currentLane;
    const offset = Math.abs(ego.y - road.laneCenterY(lane));
    const trajectoryOk = lane >= 1 && offset + egoHalf <= road.laneWidthFt / 2 + 1e-9;
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

  /** Any engaged state → driver control (A-45: ACC cancels, no cooldown for a button-off). */
  disengage(t: number, cause: string, reqs: string[]): void {
    this.mode = this.available ? HfdsMode.AVAILABLE : HfdsMode.UNAVAILABLE;
    this.speedManagement.cancelCruise();
    this.functions.fcsMode = FcsMode.Default;
    this.hmi.showControlTransfer(t, HMI_TEXT.CONTROL_TO_DRIVER); // R40
    this.log(
      t,
      LogEntryType.disengagement,
      'HFDS',
      `HFDS disengaged: ${cause}. ${HMI_TEXT.CONTROL_TO_DRIVER}`,
      ['R45.2', 'R40', ...reqs],
    );
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
  // Doc 13 §11 step 10
  // -------------------------------------------------------------------------

  updateHmi(t: number): void {
    this.hmi.updateDisplay(t, {
      mode: this.mode,
      available: this.available,
      updateNeeded: this.world.map.isOutdated(this.world.scenario.simDate),
      fcsMode: this.functions.fcsMode,
    });
  }

  /** Sensor used for lead distance first (radar, then front camera; SR4.2 — M5 switches). */
  leadSensor(): SensorId | null {
    if (this.sensors.ok(SensorId.RADAR_FRONT)) return SensorId.RADAR_FRONT;
    if (this.sensors.ok(SensorId.CAM_FRONT)) return SensorId.CAM_FRONT;
    return null;
  }
}
