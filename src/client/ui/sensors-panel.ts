/**
 * Sensors and error codes (doc 15 B5 sensors-panel.ts): every sensor's status and whether
 * it is the source for lane position or lead distance (SR4.1, SR4.2, SR4.4), plus the
 * active error codes with severity and band (R37). Display only.
 */
import type { Snapshot } from '../../shared/protocol';

export interface SensorsPanel {
  sync(snapshot: Snapshot): void;
}

export function initSensorsPanel(host: HTMLElement): SensorsPanel {
  const list = document.createElement('ul');
  list.className = 'sensor-list';
  list.dataset.testid = 'sensor-list';
  const errors = document.createElement('ul');
  errors.className = 'error-list';
  errors.dataset.testid = 'error-list';
  const heading = document.createElement('h3');
  heading.textContent = 'Active error codes (R37)';
  host.replaceChildren(list, heading, errors);
  let last = '';

  return {
    sync(s) {
      const key = JSON.stringify([s.hfds.sensors, s.hfds.errors.map((e) => e.code)]);
      if (key === last) return;
      last = key;
      list.replaceChildren(
        ...s.hfds.sensors.map((x) => {
          const li = document.createElement('li');
          li.className = x.status === 'OK' ? 'sensor ok' : 'sensor bad';
          const roles = [x.activeForLane ? 'lane' : '', x.activeForLead ? 'lead' : '']
            .filter(Boolean)
            .join(' + ');
          li.textContent = `${x.sensorId} · ${x.status}${roles ? ` · ${roles}` : ''}`;
          return li;
        }),
      );
      errors.replaceChildren(
        ...(s.hfds.errors.length
          ? s.hfds.errors.map((e) => {
              const li = document.createElement('li');
              li.className = `error-code band-${e.band}`;
              li.textContent = `${e.code} · ${e.severity} (${e.band}) · ${e.description}`;
              return li;
            })
          : [
              Object.assign(document.createElement('li'), {
                textContent: 'none',
                className: 'muted',
              }),
            ]),
      );
    },
  };
}
