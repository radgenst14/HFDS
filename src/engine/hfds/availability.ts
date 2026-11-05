/**
 * Availability (doc 13 §5.1), computed every tick. `available` is true only when every
 * line passes; the HMI "HFDS available" indicator equals it (IR6). The same lines are
 * shown in the checklist panel with their SRS IDs (doc 13 §5.1, v1 "annotated
 * interface") and named in R49 activation warnings.
 *
 * IR6 requires IR1–IR5 and IR28; doc 13 §5.1 adds IR8, IR16, IR17, IR23 and the
 * cooldowns / lockout. Showing "HFDS available" only when all of them hold satisfies
 * IR6's "only when".
 */
import {
  END_OF_ENABLED_ROAD_MIN_TRAVEL_S,
  GPS_CORRECTION_MAX_AGE_S,
  HMI_TEXT,
  MIN_ENGAGE_SPEED_MPH,
  MPH_TO_FTPS,
  REDUNDANT_AGREEMENT_M,
  SENSOR_DATA_MAX_AGE_MS,
} from '../../shared/constants';
import { LaneType, RoadType, SensorId, SubsystemStatus } from '../../shared/domain';
import type { AvailabilityCheck } from '../../shared/protocol';
import type { EnvironmentState } from '../world/environment';
import type { LiDARMap } from '../world/lidar-map';
import type { Road } from '../world/road';
import type { DriverAssistSystem } from './driver-assist';
import type { DriverAttentionSystem } from './driver-attention';
import { IR5_6_SENSORS, PERCEPTION_SENSORS, type SensorSuite } from './sensors';
import type { VehicleFunctions } from './vehicle-functions';
import type { VehiclePosition } from './vehicle-position';

export interface AvailabilityContext {
  t: number;
  simDate: string;
  ego: { s: number; speed: number };
  egoLaneId: number;
  egoLaneType: LaneType;
  road: Road;
  map: LiDARMap;
  environment: EnvironmentState;
  sensors: SensorSuite;
  dats: DriverAttentionSystem;
  das: DriverAssistSystem;
  position: VehiclePosition;
  functions: VehicleFunctions;
  /** Status of every assist subsystem (IR4), by class name. */
  subsystems: Record<string, SubsystemStatus>;
  /** IR23: an unresolved high-severity (75–100) error code (M5). */
  highSeverityError: string | null;
  /** R38.2 / R38.4 / R41.2 / R44.2 cooldowns still running (M4/M5). */
  cooldown: { remainingS: number; reason: string } | null;
  /** IR10 (M4). */
  lockedUntilIgnition: boolean;
}

function line(
  id: string,
  label: string,
  reqs: string[],
  pass: boolean,
  detail?: string,
): AvailabilityCheck {
  const c: AvailabilityCheck = { id, label, pass, reqs };
  if (!pass && detail) c.detail = detail;
  return c;
}

export function evaluateAvailability(ctx: AvailabilityContext): AvailabilityCheck[] {
  const { road, map, environment: env, sensors, ego } = ctx;
  const s = ego.s;
  const checks: AvailabilityCheck[] = [];

  // IR1: divided highway enabled in the LiDAR map; UC17 end of enabled road (A-20).
  const roadType = road.roadTypeAt(s);
  const enabled = map.isEnabled() && road.isEnabledForHfds(s);
  checks.push(
    line(
      'IR1',
      'Divided highway enabled in the LiDAR map',
      ['IR1'],
      roadType === RoadType.DividedHighway && enabled,
      roadType !== RoadType.DividedHighway
        ? `road type is ${roadType}`
        : 'road not enabled for HFDS',
    ),
  );
  const remainingS = ego.speed > 0 ? road.enabledDistanceAhead(s) / ego.speed : Infinity;
  checks.push(
    line(
      'UC17',
      `At least ${END_OF_ENABLED_ROAD_MIN_TRAVEL_S} s of enabled road ahead`,
      ['IR1', 'UC17'],
      remainingS >= END_OF_ENABLED_ROAD_MIN_TRAVEL_S - 1e-9,
      `${remainingS.toFixed(1)} s of enabled road left`,
    ),
  );

  // IR2: both lane lines visible.
  const m = road.markingsAt(s, ctx.t);
  checks.push(
    line(
      'IR2',
      'Lane lines visible on both sides',
      ['IR2'],
      m.left && m.right,
      `${!m.left ? 'left' : ''}${!m.left && !m.right ? ' and ' : ''}${!m.right ? 'right' : ''} line not detected`,
    ),
  );

  // IR3: DATS detects an engaged driver.
  checks.push(
    line(
      'IR3',
      'Driver attentive (DATS)',
      ['IR3'],
      ctx.dats.isDriverEngaged(),
      ctx.dats.status !== SubsystemStatus.OK
        ? 'driver camera unavailable'
        : ctx.dats.cameraTamperDetected
          ? 'driver camera tampering'
          : 'eyes off the road',
    ),
  );

  // IR4: every assist subsystem reports OK.
  const notOk = Object.entries(ctx.subsystems).filter(([, st]) => st !== SubsystemStatus.OK);
  checks.push(
    line(
      'IR4',
      'All assist subsystems report OK',
      ['IR4'],
      notOk.length === 0,
      notOk.map(([n, st]) => `${n} ${st}`).join(', '),
    ),
  );

  // IR5.1 – IR5.10 (A-10 thresholds for 5.1 / 5.4).
  checks.push(
    line(
      'IR5.1',
      'Daylight, no low-angle sun',
      ['IR5', 'IR5.1'],
      env.lightOk(),
      `light condition ${env.value.lightCondition}`,
    ),
  );
  const cz = road.isConstructionZone(s);
  const tunnel = road.isTunnel(s);
  checks.push(
    line(
      'IR5.2',
      'Not in a construction zone or tunnel',
      ['IR5', 'IR5.2'],
      !cz && !tunnel,
      cz ? 'construction zone' : 'tunnel',
    ),
  );
  checks.push(
    line(
      'IR5.3',
      'In a travel lane (not shoulder, service drive or exit lane)',
      ['IR5', 'IR5.3'],
      ctx.egoLaneType === LaneType.Travel && roadType !== RoadType.ServiceDrive,
      roadType === RoadType.ServiceDrive ? 'on a service drive' : `ego on ${ctx.egoLaneType}`,
    ),
  );
  const weather = env.weatherProblems();
  checks.push(
    line(
      'IR5.4',
      'Weather and road surface inside the ODD',
      ['IR5', 'IR5.4'],
      weather.length === 0,
      weather.join(', '),
    ),
  );
  checks.push(
    line(
      'IR5.5',
      'No trailer, or vehicle can tow one',
      ['IR5', 'IR5.5'],
      !ctx.functions.trailerProblem(),
      'trailer attached without trailering capability',
    ),
  );
  const blocked = IR5_6_SENSORS.filter((id) => !sensors.ok(id));
  checks.push(
    line(
      'IR5.6',
      'Cameras, LiDAR and radar unobstructed',
      ['IR5', 'IR5.6'],
      blocked.length === 0,
      blocked.map((id) => `${id} ${sensors.get(id).status}`).join(', '),
    ),
  );
  const dataProblems = [
    map.dataError ? 'LiDAR map data error' : null,
    sensors.gpsDataError ? 'navigation/GPS data error' : null,
    !sensors.ok(SensorId.GPS_1) ? `GPS_1 ${sensors.get(SensorId.GPS_1).status}` : null,
  ].filter((x): x is string => x !== null);
  checks.push(
    line(
      'IR5.7',
      'LiDAR map, navigation and GPS data available',
      ['IR5', 'IR5.7'],
      dataProblems.length === 0,
      dataProblems.join(', '),
    ),
  );
  const health = healthProblems(ctx, notOk.length === 0);
  checks.push(
    line(
      'IR5.8',
      'Data health (sensors ≤ 100 ms, GPS correction ≤ 5 s, sources agree ≤ 0.3 m)',
      ['IR5', 'IR5.8'],
      health.length === 0,
      health.join(', '),
    ),
  );
  const missing = ctx.functions.unavailableFunctions();
  checks.push(
    line(
      'IR5.9',
      'Motion forecasting, self-supervision, dynamic environment available',
      ['IR5', 'IR5.9'],
      missing.length === 0,
      `${missing.join(', ')} unavailable`,
    ),
  );
  checks.push(
    line(
      'IR5.10',
      'No forward-collision takeover escalation',
      ['IR5', 'IR5.10'],
      !ctx.functions.fcwEscalated,
      'forward collision warning escalated',
    ),
  );

  // IR8: stable traffic.
  const stability = ctx.das.trafficStability(ego.speed);
  checks.push(
    line(
      'IR8',
      'Surrounding traffic stable',
      ['IR8', ...new Set(stability.problems.map((p) => p.id))],
      stability.stable,
      stability.problems.map((p) => `${p.id}: ${p.detail}`).join('; '),
    ),
  );

  // IR16: map age ≤ 7 months ("Update needed").
  const outdated = map.isOutdated(ctx.simDate);
  checks.push(
    line(
      'IR16',
      'LiDAR map at most 7 months old',
      ['IR16'],
      !outdated,
      `map is ${map.ageMonths(ctx.simDate)} months old: ${HMI_TEXT.UPDATE_NEEDED}`,
    ),
  );

  // IR17: real-time positioning data service.
  checks.push(
    line(
      'IR17',
      'Real-time positioning data service active',
      ['IR17'],
      ctx.functions.positioningDataService,
      'positioning data service unavailable',
    ),
  );

  // IR23 / R38: errors and cooldowns (filled from M4/M5).
  checks.push(
    line(
      'IR23',
      'No unresolved high-severity error',
      ['IR23', 'R38.3'],
      ctx.highSeverityError === null,
      ctx.highSeverityError ?? undefined,
    ),
  );
  checks.push(
    line(
      'R38',
      'No re-engagement wait active',
      ['R38.2', 'R38.4', 'R41.2', 'R44.2'],
      ctx.cooldown === null,
      ctx.cooldown
        ? `${ctx.cooldown.reason}: ${ctx.cooldown.remainingS.toFixed(1)} s left`
        : undefined,
    ),
  );
  checks.push(
    line(
      'IR10',
      'Not locked out until the next ignition cycle',
      ['IR10'],
      !ctx.lockedUntilIgnition,
      'stopped by a minimal risk maneuver; restart the vehicle',
    ),
  );

  // IR28: speed strictly above 3 mph.
  const mph = ego.speed / MPH_TO_FTPS;
  checks.push(
    line(
      'IR28',
      `Speed above ${MIN_ENGAGE_SPEED_MPH} mph`,
      ['IR28'],
      mph > MIN_ENGAGE_SPEED_MPH + 1e-9,
      `speed ${mph.toFixed(1)} mph`,
    ),
  );

  return checks;
}

/** IR5.8 required health level. */
function healthProblems(ctx: AvailabilityContext, subsystemsOk: boolean): string[] {
  const out: string[] = [];
  if (!subsystemsOk) out.push('a subsystem is not OK');
  const stale = PERCEPTION_SENSORS.filter(
    (id) => ctx.sensors.get(id).dataAgeS(ctx.t) * 1000 > SENSOR_DATA_MAX_AGE_MS + 1e-6,
  );
  if (stale.length) out.push(`${stale.join(', ')} data older than ${SENSOR_DATA_MAX_AGE_MS} ms`);
  const corr = ctx.sensors.gpsCorrectionAgeS(ctx.t);
  if (corr > GPS_CORRECTION_MAX_AGE_S + 1e-9) {
    out.push(`GPS correction ${corr.toFixed(1)} s old (max ${GPS_CORRECTION_MAX_AGE_S} s)`);
  }
  const d = ctx.position.sourceDisagreementM();
  if (d === null) out.push('lane-position sources not both available');
  else if (d > REDUNDANT_AGREEMENT_M + 1e-9) {
    out.push(`lane-position sources disagree by ${d.toFixed(2)} m`);
  }
  // Lead-distance sources (radar + front camera, SR4.2) report the same gap (A-46);
  // they can only disagree when one is missing, which IR5.6 / sensor age already cover.
  return out;
}

/** The failing lines, for R16 / R49 messages. */
export function failedChecks(checks: readonly AvailabilityCheck[]): AvailabilityCheck[] {
  return checks.filter((c) => !c.pass);
}

export function describeFailures(checks: readonly AvailabilityCheck[]): string {
  return failedChecks(checks)
    .map((c) => `${c.label} (${c.reqs.join(', ')})${c.detail ? `: ${c.detail}` : ''}`)
    .join('; ');
}
