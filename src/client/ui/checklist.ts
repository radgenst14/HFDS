/**
 * Availability / activation checklist (doc 13 §5.1; doc 15 B6 region 4). One line per
 * engine check with pass/fail, its SRS IDs and, when failing, why. Doubles as the v1
 * "annotated interface". Display only: the engine computes every line.
 */
import type { AvailabilityCheck, Snapshot } from '../../shared/protocol';

export interface Checklist {
  sync(snapshot: Snapshot): void;
}

export function initChecklist(host: HTMLElement): Checklist {
  const summary = document.createElement('p');
  summary.className = 'checklist-summary';
  summary.dataset.testid = 'checklist-summary';
  const list = document.createElement('ul');
  list.className = 'checklist';
  list.dataset.testid = 'checklist';
  host.replaceChildren(summary, list);
  let last = '';

  const row = (c: AvailabilityCheck): HTMLLIElement => {
    const li = document.createElement('li');
    li.className = c.pass ? 'check pass' : 'check fail';
    li.dataset.checkId = c.id;
    const mark = document.createElement('span');
    mark.className = 'check-mark';
    mark.textContent = c.pass ? '✓' : '✗';
    mark.setAttribute('aria-label', c.pass ? 'pass' : 'fail');
    const label = document.createElement('span');
    label.className = 'check-label';
    label.textContent = c.label;
    const ids = document.createElement('span');
    ids.className = 'check-ids';
    ids.textContent = c.reqs.join(', ');
    li.append(mark, label, ids);
    if (!c.pass && c.detail) {
      const detail = document.createElement('span');
      detail.className = 'check-detail';
      detail.textContent = c.detail;
      li.append(detail);
    }
    return li;
  };

  return {
    sync(s) {
      const checks = s.hfds.availabilityChecks;
      const key = JSON.stringify(checks);
      if (key === last) return;
      last = key;
      const failing = checks.filter((c) => !c.pass).length;
      summary.textContent =
        failing === 0
          ? `All ${checks.length} checks pass: "HFDS available" (IR6)`
          : `${failing} of ${checks.length} checks fail: HFDS cannot engage`;
      summary.classList.toggle('ok', failing === 0);
      list.replaceChildren(...checks.map(row));
    },
  };
}
