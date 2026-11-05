/**
 * Director panel (doc 15 B1, B6 region 5): every timeline `inject` action from doc 14 as a
 * control, grouped Sensors · Map/GPS · Environment · Road · Driver camera · Traffic ·
 * Emergency · Session. Each control sends one `inject` intent; the engine validates and
 * applies it. Kept visually separate from the Driver panel so a demo audience can tell
 * injected events from driver actions.
 */
import {
  enumValues,
  HazardType,
  LightCondition,
  SensorId,
  SubsystemFlag,
  WeatherType,
} from '../../shared/domain';
import type { DirectorAction, Snapshot } from '../../shared/protocol';

type Send = (action: DirectorAction) => void;

export interface DirectorPanel {
  sync(snapshot: Snapshot): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

const select = (values: readonly string[], label: string, value?: string) => {
  const s = el(
    'select',
    {},
    values.map((v) => el('option', { value: v, textContent: v })),
  );
  s.setAttribute('aria-label', label);
  if (value) s.value = value;
  return s;
};
const num = (value: number, label: string, step = 1, width = 56) => {
  const i = el('input', { type: 'number', value: String(value), step: String(step) });
  i.style.width = `${width}px`;
  i.setAttribute('aria-label', label);
  return i;
};
const check = (label: string, checked = false) => {
  const box = el('input', { type: 'checkbox', checked });
  return { box, label: el('label', {}, [box, ` ${label}`]) };
};

export function initDirectorPanel(host: HTMLElement, send: Send): DirectorPanel {
  const btn = (text: string, action: () => DirectorAction | null, testid?: string) => {
    const b = el('button', { type: 'button', textContent: text });
    if (testid) b.dataset.testid = testid;
    b.addEventListener('click', () => {
      const a = action();
      if (a) send(a);
    });
    return b;
  };
  const row = (...nodes: Node[]) => el('div', { className: 'director-row' }, nodes);
  const group = (title: string, ...rows: HTMLElement[]) =>
    el('fieldset', { className: 'director-group' }, [
      el('legend', { textContent: title }),
      ...rows,
    ]);

  // Sensors
  const sensorSel = select(enumValues(SensorId), 'Sensor');
  const statusSel = select(['Obstructed', 'Damaged', 'Failed'], 'Sensor status', 'Failed');
  const codeSel = select([], 'Error code');
  const sensors = group(
    'Sensors',
    row(
      sensorSel,
      statusSel,
      btn(
        'Fail',
        () => ({
          kind: 'failSensor',
          args: { sensorId: sensorSel.value, status: statusSel.value },
        }),
        'director-fail-sensor',
      ),
    ),
    row(
      codeSel,
      btn('Clear code', () =>
        codeSel.value ? { kind: 'clearFault', args: { code: codeSel.value } } : null,
      ),
      btn('Clear all faults', () => ({ kind: 'clearAllFaults' }), 'director-clear-all'),
    ),
  );

  // Map / GPS
  const ageIn = num(6, 'GPS correction age (s)');
  const verIn = el('input', { type: 'text', value: 'MI-I96-2026.11', size: 12 });
  verIn.setAttribute('aria-label', 'Map version');
  const dateIn = el('input', { type: 'date', value: '2026-11-01' });
  dateIn.setAttribute('aria-label', 'Map date');
  const mapGps = group(
    'Map / GPS',
    row(
      btn('Map error', () => ({ kind: 'mapError' })),
      btn('GPS error', () => ({ kind: 'gpsError' })),
    ),
    row(
      ageIn,
      btn('Stale GPS correction', () => ({
        kind: 'staleGpsCorrection',
        args: { ageS: Number(ageIn.value) },
      })),
    ),
    row(
      verIn,
      dateIn,
      btn('Map update', () => ({
        kind: 'applyMapUpdate',
        args: { version: verIn.value, lastUpdated: dateIn.value },
      })),
    ),
  );

  // Environment
  const weather = select(enumValues(WeatherType), 'Weather');
  const light = select(enumValues(LightCondition), 'Light');
  const moisture = num(0, 'Road moisture (0–1)', 0.05);
  const vis = num(1000, 'Visibility (m)', 50, 64);
  const environment = group(
    'Environment',
    row(weather, light),
    row(
      el('span', { textContent: 'moisture' }),
      moisture,
      el('span', { textContent: 'vis m' }),
      vis,
      btn('Apply', () => ({
        kind: 'setEnvironment',
        args: {
          weather: weather.value,
          lightCondition: light.value,
          roadMoisture: Number(moisture.value),
          visibilityM: Number(vis.value),
        },
      })),
    ),
  );

  // Road and hazards
  const dropIn = num(2, 'Markings drop duration (s)');
  const cz = check('construction');
  const tunnel = check('tunnel');
  const enabled = check('HFDS-enabled', true);
  const laneSel = select(['0', '1', '2', '3', 'ExitLane', 'ServiceDrive'], 'Ego lane', '2');
  const hazType = select(enumValues(HazardType), 'Hazard type');
  const hazLane = select(['1', '2', '3'], 'Hazard lane', '2');
  const hazAhead = num(600, 'Hazard distance ahead (ft)', 50, 64);
  const road = group(
    'Road',
    row(
      dropIn,
      btn('Drop lane lines', () => ({
        kind: 'dropLaneMarkings',
        args: { durationS: Number(dropIn.value) },
      })),
    ),
    row(
      cz.label,
      tunnel.label,
      enabled.label,
      btn('Apply flags', () => ({
        kind: 'setRoadFlags',
        args: {
          constructionZone: cz.box.checked,
          tunnel: tunnel.box.checked,
          enabledForHfds: enabled.box.checked,
        },
      })),
    ),
    row(
      laneSel,
      btn('Move ego', () =>
        /^\d+$/.test(laneSel.value)
          ? { kind: 'setEgoLane', args: { laneId: Number(laneSel.value) } }
          : { kind: 'setEgoLane', args: { laneType: laneSel.value } },
      ),
    ),
    row(
      hazType,
      hazLane,
      hazAhead,
      btn('Spawn hazard', () => ({
        kind: 'spawnHazard',
        args: {
          type: hazType.value,
          laneId: Number(hazLane.value),
          aheadFt: Number(hazAhead.value),
        },
      })),
    ),
  );

  // Driver camera
  const camera = group(
    'Driver camera',
    row(btn('Tamper with camera', () => ({ kind: 'tamperDriverCamera' }), 'director-tamper')),
  );

  // Traffic
  const vehSel = select([], 'Vehicle');
  const decel = num(14, 'Hard-brake decel (ft/s²)');
  const dur = num(2, 'Hard-brake duration (s)');
  const headway = num(0.8, 'Headway (s)', 0.1);
  const vid = () => (vehSel.value ? Number(vehSel.value) : null);
  const traffic = group(
    'Traffic',
    row(
      vehSel,
      decel,
      dur,
      btn('Hard brake', () =>
        vid()
          ? {
              kind: 'trafficHardBrake',
              args: {
                vehicleId: vid(),
                decelFtps2: Number(decel.value),
                durationS: Number(dur.value),
              },
            }
          : null,
      ),
    ),
    row(
      btn('Erratic accel', () =>
        vid() ? { kind: 'trafficErraticAccel', args: { vehicleId: vid() } } : null,
      ),
      headway,
      btn('Tailgate gap', () =>
        vid()
          ? {
              kind: 'trafficTailgateGap',
              args: { vehicleId: vid(), headwayS: Number(headway.value) },
            }
          : null,
      ),
    ),
  );

  // Emergency
  const emergency = group(
    'Emergency',
    row(
      btn('FCW escalation', () => ({ kind: 'fcwEscalation' })),
      btn('Compute failure', () => ({ kind: 'primaryComputeFailure' })),
    ),
    row(
      btn('Corrupt control process', () => ({ kind: 'corruptControlProcess' })),
      btn('Collision (airbag)', () => ({ kind: 'collision', args: { airbag: true } })),
    ),
    row(
      btn('Unauthenticated external command', () => ({
        kind: 'externalCommand',
        args: { kind: 'setSpeed', value: 90, authenticated: false },
      })),
    ),
  );

  // Session
  const trailer = check('trailer attached');
  const capable = check('capable', true);
  const flagSel = select(enumValues(SubsystemFlag), 'Vehicle function');
  const flagOk = check('available');
  const session = group(
    'Session',
    row(btn('Ignition cycle', () => ({ kind: 'ignitionCycle' }), 'director-ignition')),
    row(
      trailer.label,
      capable.label,
      btn('Apply trailer', () => ({
        kind: 'setTrailer',
        args: { attached: trailer.box.checked, capable: capable.box.checked },
      })),
    ),
    row(
      flagSel,
      flagOk.label,
      btn('Set', () => ({
        kind: 'setSubsystemFlag',
        args: { name: flagSel.value, ok: flagOk.box.checked },
      })),
    ),
  );

  host.replaceChildren(sensors, mapGps, environment, road, camera, traffic, emergency, session);

  const known = new Set<number>();
  let codesKey = '';
  return {
    sync(s) {
      let added = false;
      for (const v of s.traffic) {
        if (!known.has(v.id)) {
          known.add(v.id);
          added = true;
        }
      }
      if (added) {
        const keep = vehSel.value;
        vehSel.replaceChildren(
          ...[...known]
            .sort((a, b) => a - b)
            .map((id) => el('option', { value: String(id), textContent: `vehicle ${id}` })),
        );
        if (keep) vehSel.value = keep;
      }
      const codes = s.hfds.errors.map((e) => e.code);
      const key = codes.join(',');
      if (key !== codesKey) {
        codesKey = key;
        codeSel.replaceChildren(...codes.map((c) => el('option', { value: c, textContent: c })));
      }
    },
  };
}
