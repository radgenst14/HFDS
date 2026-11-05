/**
 * Scenario picker + `#scenario=<id>[&t=<s>]` routing (doc 15 Part A "How a scenario loads",
 * steps 1, 2 and 5; doc 17 M6 shareable links). The picker only sends `load_scenario`; the
 * engine validates it. `t` asks the page to seek the preset to that sim time and pause.
 */
import { ScenarioIndexSchema, type ScenarioIndexEntry } from '../../shared/scenario-schema';

const HASH_KEY = 'scenario';
const TIME_KEY = 't';

const hashParams = () => new URLSearchParams(window.location.hash.replace(/^#/, ''));

export function readHashScenario(): string | null {
  return hashParams().get(HASH_KEY);
}

/** The `t` of `#scenario=<id>&t=<s>` (sim seconds), if present and valid. */
export function readHashTime(): number | null {
  const v = hashParams().get(TIME_KEY);
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Records the scenario in the hash; a scenario picked by hand drops any `t`. */
export function writeHashScenario(id: string, keepTime = false): void {
  const params = hashParams();
  params.set(HASH_KEY, id);
  if (!keepTime) params.delete(TIME_KEY);
  window.history.replaceState(null, '', `#${params.toString()}`);
}

/** A shareable link to scenario `id`, opening at sim time `t` when given. */
export function shareLink(id: string, t: number | null): string {
  const url = new URL(window.location.href);
  const params = new URLSearchParams();
  params.set(HASH_KEY, id);
  if (t !== null) params.set(TIME_KEY, t.toFixed(2));
  url.hash = params.toString();
  return url.href;
}

export function scenarioLabel(entry: ScenarioIndexEntry): string {
  const code = entry.id.split('-')[0]?.toUpperCase() ?? entry.id;
  const customer =
    entry.customerScenario !== null ? ` · Customer Scenario ${entry.customerScenario}` : '';
  const optional = entry.optional ? ' (optional)' : '';
  return `${code} — ${entry.name}${customer}${optional}`;
}

export async function loadIndex(): Promise<ScenarioIndexEntry[]> {
  const res = await fetch('./scenarios/index.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`scenarios/index.json: HTTP ${res.status}`);
  return ScenarioIndexSchema.parse(await res.json()).scenarios;
}

/** Fills the picker and calls `onPick` for the initial preset and every change. */
export async function initScenarioPicker(
  picker: HTMLSelectElement,
  onPick: (id: string) => void,
): Promise<ScenarioIndexEntry[]> {
  const entries = await loadIndex();
  picker.replaceChildren(
    ...entries.map((e) => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = scenarioLabel(e);
      return opt;
    }),
  );
  const pick = (id: string, keepTime: boolean) => {
    picker.value = id;
    writeHashScenario(id, keepTime);
    onPick(id);
  };
  const initial = entries.find((e) => e.id === readHashScenario()) ?? entries[0];
  if (initial) pick(initial.id, true);
  picker.addEventListener('change', () => pick(picker.value, false));
  window.addEventListener('hashchange', () => {
    const id = readHashScenario();
    if (id && id !== picker.value && entries.some((e) => e.id === id)) pick(id, true);
  });
  picker.dataset.loaded = 'true';
  return entries;
}
