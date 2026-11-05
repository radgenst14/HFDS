/**
 * Caption panel (doc 15 B6 region 4; doc 14 "Demo"): scenario summary, steps and what to
 * watch for, plus the SRS IDs the preset demonstrates. Content comes from the engine's
 * `scenario_loaded` event.
 */
export interface ScenarioInfo {
  id: string;
  name: string;
  description: string;
  customerScenario: number | null;
  sequenceDiagram: string | null;
  optional: boolean;
  requirements: string[];
  caption: { summary: string; steps: string[]; watchFor: string[] };
  durationS: number;
}

function list(items: string[]): HTMLUListElement {
  const ul = document.createElement('ul');
  for (const text of items) {
    const li = document.createElement('li');
    li.textContent = text;
    ul.append(li);
  }
  return ul;
}

function heading(text: string): HTMLHeadingElement {
  const h = document.createElement('h3');
  h.textContent = text;
  return h;
}

export function renderCaption(host: HTMLElement, info: ScenarioInfo): void {
  const title = document.createElement('p');
  title.className = 'caption-title';
  title.textContent = info.name;
  const meta = document.createElement('p');
  meta.className = 'caption-meta';
  meta.textContent = [
    info.customerScenario !== null ? `Customer Scenario ${info.customerScenario}` : null,
    info.sequenceDiagram,
    info.optional ? 'optional' : null,
    `${info.durationS} s`,
  ]
    .filter(Boolean)
    .join(' · ');
  const summary = document.createElement('p');
  summary.textContent = info.caption.summary;
  const reqs = document.createElement('p');
  reqs.className = 'caption-reqs';
  reqs.textContent = info.requirements.length
    ? `Requirements: ${info.requirements.join(', ')}`
    : '';
  host.replaceChildren(
    title,
    meta,
    summary,
    heading('Steps'),
    list(info.caption.steps),
    heading('Watch for'),
    list(info.caption.watchFor),
    reqs,
  );
}

export function renderCaptionError(host: HTMLElement, message: string): void {
  const p = document.createElement('p');
  p.className = 'caption-error';
  p.setAttribute('role', 'alert');
  p.textContent = message;
  host.replaceChildren(p);
}
