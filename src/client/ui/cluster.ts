/**
 * Instrument cluster (doc 15 B6 region 3). M1 shows manual-driving readouts only; the
 * light bar, cluster message, state badge and IR6 indicator arrive in M2.
 */
import type { Snapshot } from '../../shared/protocol';

export interface Cluster {
  sync(snapshot: Snapshot): void;
}

function readout(label: string, testid: string): { root: HTMLElement; value: HTMLElement } {
  const root = document.createElement('div');
  root.className = 'readout';
  const l = document.createElement('span');
  l.className = 'readout-label';
  l.textContent = label;
  const value = document.createElement('span');
  value.className = 'readout-value';
  value.dataset.testid = testid;
  root.append(l, value);
  return { root, value };
}

export function initCluster(host: HTMLElement): Cluster {
  const speed = readout('Speed', 'ego-speed');
  const lane = readout('Lane', 'ego-lane');
  const time = readout('Sim time', 'sim-time');
  const tick = readout('Tick', 'sim-tick');
  const mode = readout('HFDS', 'hfds-mode');
  const status = document.createElement('p');
  status.className = 'cluster-note';
  status.dataset.testid = 'run-status';
  const grid = document.createElement('div');
  grid.className = 'readouts';
  grid.append(speed.root, lane.root, time.root, tick.root, mode.root);
  host.replaceChildren(grid, status);

  return {
    sync(s) {
      speed.value.textContent = `${s.ego.speedMph.toFixed(1)} mph`;
      lane.value.textContent = s.ego.laneId === 0 ? 'shoulder' : String(s.ego.laneId);
      time.value.textContent = `${s.simTime.toFixed(2)} s`;
      tick.value.textContent = String(s.tick);
      mode.value.textContent = s.hfds.mode;
      status.textContent = `${s.paused ? 'Paused' : 'Running'} · ${s.timeScale}× · manual driving (HFDS logic arrives in M2)`;
    },
  };
}
