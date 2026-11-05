/**
 * Event log panel (doc 15 B6 region 6; R45): one row per engine log entry with its sim
 * timestamp, type, message and SRS IDs. Filtering is added in M5.
 */
import { EVENT_LOG_PANEL_MAX_ROWS } from '../../shared/constants';
import type { LogEntry } from '../../shared/domain';

export interface EventLogPanel {
  append(entry: LogEntry): void;
  clear(): void;
}

export function initEventLogPanel(host: HTMLOListElement): EventLogPanel {
  return {
    append(entry) {
      const li = document.createElement('li');
      li.className = `log-entry log-${entry.type}`;
      const ids = entry.reqs.length ? ` [${entry.reqs.join(', ')}]` : '';
      li.textContent = `${entry.t.toFixed(2)} s · ${entry.type} · ${entry.source}: ${entry.message}${ids}`;
      host.prepend(li);
      while (host.childElementCount > EVENT_LOG_PANEL_MAX_ROWS) host.lastElementChild?.remove();
    },
    clear() {
      host.replaceChildren();
    },
  };
}
