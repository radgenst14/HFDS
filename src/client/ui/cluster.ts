/**
 * Instrument cluster (doc 15 B6 region 3; R46): light bar, cluster message, HFDS state
 * badge (R46.1), "HFDS available" indicator (IR6), speed / set speed / gap, active
 * warnings (R46.2), HUD line (R16.2), dashboard error (R16.1), "Update needed" (IR16),
 * indicator row (FCS mode IR22, hazards, OnStar, doors, alert channels) and the
 * control-transfer banner (R40). Renders engine state only.
 */
import { HMI_TEXT } from '../../shared/constants';
import type { Snapshot } from '../../shared/protocol';
import { initLightBar } from './light-bar';

export interface Cluster {
  sync(snapshot: Snapshot): void;
}

const MODE_LABELS: Record<string, string> = {
  UNAVAILABLE: 'HFDS unavailable',
  AVAILABLE: 'HFDS ready',
  STARTING: 'Starting…',
  HANDS_FREE: 'Hands-free',
  DRIVER_STEERING: 'Driver steering',
  ALERT_FIRST: 'Attention alert 1',
  ALERT_SECOND: 'Attention alert 2',
  ALERT_FINAL: 'Final attention alert',
  TAKEOVER_REQUESTED: 'Takeover requested',
  MINIMAL_RISK_MANEUVER: 'Minimal risk maneuver',
  STOPPED_LOCKOUT: 'Stopped — locked out',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, testid?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (testid) node.dataset.testid = testid;
  return node;
}

function readout(label: string, testid: string): { root: HTMLElement; value: HTMLElement } {
  const root = el('div', 'readout');
  const l = el('span', 'readout-label');
  l.textContent = label;
  const value = el('span', 'readout-value', testid);
  root.append(l, value);
  return { root, value };
}

export function initCluster(host: HTMLElement): Cluster {
  const lightBarHost = el('div', 'light-bar-row');
  const lightBar = initLightBar(lightBarHost);

  const badge = el('span', 'state-badge', 'state-badge');
  const mode = el('span', 'mode-id', 'hfds-mode');
  const available = el('span', 'indicator available-indicator', 'available-indicator');
  const update = el('span', 'indicator update-needed', 'update-needed');
  update.textContent = HMI_TEXT.UPDATE_NEEDED;
  const statusRow = el('div', 'status-row');
  statusRow.append(badge, mode, available, update);

  const message = el('p', 'cluster-message', 'cluster-message');
  message.setAttribute('aria-live', 'assertive');
  const banner = el('p', 'transfer-banner', 'transfer-banner');
  const dashboardError = el('p', 'dashboard-error', 'dashboard-error');
  const hud = el('p', 'hud-line', 'hud-line');

  const speed = readout('Speed', 'ego-speed');
  const setSpeed = readout('Set speed', 'set-speed');
  const gap = readout('Gap', 'gap-setting');
  const acc = readout('ACC', 'acc-state');
  const lane = readout('Lane', 'ego-lane');
  const time = readout('Sim time', 'sim-time');
  const tick = readout('Tick', 'sim-tick');
  const readouts = el('div', 'readouts');
  readouts.append(speed.root, setSpeed.root, gap.root, acc.root, lane.root, time.root, tick.root);

  const indicators = el('div', 'indicators', 'indicators');
  const warnings = el('p', 'warnings', 'active-warnings');
  const status = el('p', 'cluster-note', 'run-status');

  host.replaceChildren(
    lightBarHost,
    statusRow,
    message,
    banner,
    dashboardError,
    hud,
    readouts,
    indicators,
    warnings,
    status,
  );

  const show = (node: HTMLElement, text: string | undefined) => {
    node.textContent = text ?? '';
    node.hidden = !text;
  };

  return {
    sync(s) {
      const hmi = s.hmi;
      lightBar.sync(hmi);
      badge.textContent = MODE_LABELS[hmi.displayedState] ?? hmi.displayedState;
      badge.dataset.mode = hmi.displayedState;
      mode.textContent = s.hfds.mode;
      available.textContent = hmi.availableIndicator
        ? `● ${HMI_TEXT.HFDS_AVAILABLE}`
        : `○ ${HMI_TEXT.HFDS_AVAILABLE}`;
      available.classList.toggle('on', hmi.availableIndicator);
      available.title = 'IR6: lit only when every operating constraint is met';
      update.hidden = !hmi.updateNeeded;
      show(message, hmi.displayedMessage);
      show(banner, hmi.controlTransferBanner);
      show(dashboardError, hmi.dashboardError ? `Dashboard: ${hmi.dashboardError}` : undefined);
      show(hud, hmi.hudMessage ? `HUD: ${hmi.hudMessage}` : undefined);

      const a = s.hfds.acc;
      speed.value.textContent = `${s.ego.speedMph.toFixed(1)} mph`;
      setSpeed.value.textContent = a.setSpeedMph === null ? '—' : `${a.setSpeedMph.toFixed(0)} mph`;
      gap.value.textContent = `${a.timeGapS.toFixed(1)} s`;
      acc.value.textContent = a.active ? 'on' : 'off';
      lane.value.textContent = s.ego.laneId === 0 ? 'shoulder' : String(s.ego.laneId);
      time.value.textContent = `${s.simTime.toFixed(2)} s`;
      tick.value.textContent = String(s.tick);

      const ind = [
        `FCS: ${hmi.fcsMode === 'AlertAndBrake' ? 'Alert and Brake' : 'default'}`,
        `Hazards: ${hmi.hazardLights ? 'on' : 'off'}`,
        `OnStar: ${hmi.onStar}`,
        `Doors: ${hmi.doorsUnlocked ? 'unlocked' : 'locked'}`,
        `Seat: ${hmi.seatVibration}`,
        `Chime: ${hmi.audibleAlert ? 'on' : 'off'}`,
        `Voice: ${hmi.voicePrompt ?? 'off'}`,
      ];
      indicators.textContent = ind.join(' · ');
      warnings.textContent = hmi.activeWarnings.length
        ? `Active warnings: ${hmi.activeWarnings.map((w) => `Class ${w.warningClass} ${w.reason}`).join(', ')}`
        : 'Active warnings: none';
      status.textContent = `${s.paused ? 'Paused' : 'Running'} · ${s.timeScale}×`;
    },
  };
}
