/**
 * Event log panel (doc 15 B6 region 6; R45): one row per engine log entry with its sim
 * timestamp, type, source, message and SRS IDs, newest first. Filterable by entry type and
 * by text or SRS ID (log-filter.ts); the trace panel sets the filter when an ID is clicked.
 */
import { EVENT_LOG_PANEL_MAX_ROWS } from '../../shared/constants';
import { enumValues, LogEntryType, type LogEntry } from '../../shared/domain';
import { matchesLogFilter } from './log-filter';

export interface EventLogPanel {
  append(entry: LogEntry): void;
  clear(): void;
  /** Shows only entries matching `query` (text or an SRS ID); '' shows all. */
  setFilter(query: string): void;
}

export function initEventLogPanel(host: HTMLOListElement): EventLogPanel {
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Filter: text or SRS ID (e.g. R30.4)';
  search.setAttribute('aria-label', 'Filter the event log by text or SRS ID');
  search.dataset.testid = 'log-filter';

  const typeSel = document.createElement('select');
  typeSel.setAttribute('aria-label', 'Filter the event log by entry type');
  typeSel.dataset.testid = 'log-type-filter';
  typeSel.append(
    new Option('All types', ''),
    ...enumValues(LogEntryType).map((t) => new Option(t.replace('_', ' '), t)),
  );

  const count = document.createElement('span');
  count.className = 'log-count muted';
  count.dataset.testid = 'log-count';
  count.setAttribute('aria-live', 'polite');

  const bar = document.createElement('div');
  bar.className = 'log-filter';
  bar.append(search, typeSel, count);
  host.before(bar);

  const entries = new WeakMap<Element, LogEntry>();
  let shown = 0;

  const active = () => search.value.trim() !== '' || typeSel.value !== '';
  const visible = (entry: LogEntry) => matchesLogFilter(entry, search.value, typeSel.value);
  const updateCount = () => {
    const total = host.childElementCount;
    count.textContent = active()
      ? `${shown} of ${total} entries`
      : `${total} ${total === 1 ? 'entry' : 'entries'}`;
  };
  const refresh = () => {
    shown = 0;
    for (const li of host.children) {
      const entry = entries.get(li);
      const show = entry ? visible(entry) : true;
      (li as HTMLElement).hidden = !show;
      if (show) shown++;
    }
    updateCount();
  };

  search.addEventListener('input', refresh);
  typeSel.addEventListener('change', refresh);
  updateCount();

  return {
    append(entry) {
      const li = document.createElement('li');
      li.className = `log-entry log-${entry.type}`;
      const ids = entry.reqs.length ? ` [${entry.reqs.join(', ')}]` : '';
      li.textContent = `${entry.t.toFixed(2)} s · ${entry.type} · ${entry.source}: ${entry.message}${ids}`;
      entries.set(li, entry);
      li.hidden = !visible(entry);
      if (!li.hidden) shown++;
      host.prepend(li);
      while (host.childElementCount > EVENT_LOG_PANEL_MAX_ROWS) {
        const last = host.lastElementChild as HTMLElement | null;
        if (!last) break;
        if (!last.hidden) shown--;
        last.remove();
      }
      updateCount();
    },
    clear() {
      host.replaceChildren();
      shown = 0;
      updateCount();
    },
    setFilter(query) {
      search.value = query;
      refresh();
      search.scrollIntoView({ block: 'nearest' });
    },
  };
}
