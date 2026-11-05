/**
 * Requirement trace panel (doc 15 B6 region 6; doc 17 M6): the SRS IDs exercised since the
 * scenario started (snapshot.traceReqs) and the IDs the scenario lists, grouped and
 * color-coded by SRS section (trace-model.ts, docs/requirements.json).
 *
 * Never color alone (doc 15 B6 accessibility): each group has a heading with its section
 * number and count, an exercised ID is a filled chip with a ✓, a listed-but-not-yet one is
 * an outlined chip with a ○, and every chip's tooltip gives its state and the requirement
 * text. Clicking a chip filters the event log to entries tagged with that ID.
 */
import requirementsJson from '../../../docs/requirements.json';
import type { Snapshot } from '../../shared/protocol';
import { buildTraceModel, type RequirementRecord, type TraceChip } from './trace-model';

const CATALOG = requirementsJson as readonly RequirementRecord[];

export interface TracePanel {
  /** The scenario's `requirements` list (from the scenario_loaded event). */
  setScenario(listed: readonly string[]): void;
  sync(snapshot: Snapshot): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function chip(c: TraceChip, onPick: (id: string) => void): HTMLButtonElement {
  const b = el('button', `trace-chip ${c.state}`, `${c.state === 'exercised' ? '✓' : '○'} ${c.id}`);
  b.type = 'button';
  b.dataset.reqId = c.id;
  b.dataset.state = c.state;
  const state =
    c.state === 'exercised'
      ? 'exercised in this run'
      : 'listed for this scenario, not yet exercised';
  b.title = `${c.id} — ${state}${c.text ? `\n${c.text}` : ''}\nClick to filter the event log.`;
  b.setAttribute('aria-label', `${c.id}, ${state}. Filter the event log.`);
  b.addEventListener('click', () => onPick(c.id));
  return b;
}

/** The DOC-treatment list (doc 10 legend: out of prototype scope); built once. */
function documentedOnly(): HTMLDetailsElement {
  const ids = buildTraceModel(CATALOG, [], []).documentedOnly.map((r) => r.id);
  const doc = el('details', 'trace-doc');
  doc.append(
    el('summary', '', `Out of prototype scope — documented only (${ids.length})`),
    el(
      'p',
      'muted',
      `${ids.join(', ')}. In the SRS but not simulated; optional S19 illustrates IR18, IR19, ` +
        'IR21 and SR9.',
    ),
  );
  return doc;
}

export function initTracePanel(host: HTMLElement, onPick: (id: string) => void): TracePanel {
  let listed: readonly string[] = [];
  let exercised: readonly string[] = [];
  let renderedKey = '';
  const body = el('div', 'trace-body');
  host.replaceChildren(body, documentedOnly());

  const render = () => {
    const key = `${exercised.join(',')}|${listed.join(',')}`;
    if (key === renderedKey) return;
    renderedKey = key;
    const model = buildTraceModel(CATALOG, exercised, listed);

    const summary = el(
      'p',
      'trace-summary',
      `${model.exercisedCount} of ${model.catalogCount} SRS requirements exercised in this run` +
        (model.listedCount > 0
          ? ` · this scenario lists ${model.listedCount} (${model.listedExercised} exercised so far)`
          : ''),
    );
    summary.dataset.testid = 'trace-summary';

    const sections = model.sections.map((s) => {
      const section = el('section', 'trace-section');
      section.dataset.section = s.key;
      const heading = el('h3', 'trace-heading', s.title);
      if (s.total > 0) heading.append(el('span', 'trace-count', ` ${s.exercised}/${s.total}`));
      const list = el('div', 'trace-chips');
      list.append(...s.chips.map((c) => chip(c, onPick)));
      section.append(heading, list);
      return section;
    });

    body.replaceChildren(summary, ...sections);
  };

  return {
    setScenario(ids) {
      listed = [...ids];
      exercised = [];
      render();
    },
    sync(snapshot) {
      exercised = snapshot.traceReqs;
      render();
    },
  };
}
