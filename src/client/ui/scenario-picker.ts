/**
 * Scenario picker + `#scenario=<id>` routing (doc 15 Part A "How a scenario loads",
 * steps 1, 2 and 5). The picker only sends `load_scenario`; the engine validates it.
 */
import { ScenarioIndexSchema, type ScenarioIndexEntry } from '../../shared/scenario-schema';

const HASH_KEY = 'scenario';

export function readHashScenario(): string | null {
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get(HASH_KEY);
}

export function writeHashScenario(id: string): void {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  params.set(HASH_KEY, id);
  window.history.replaceState(null, '', `#${params.toString()}`);
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
  const pick = (id: string) => {
    picker.value = id;
    writeHashScenario(id);
    onPick(id);
  };
  const initial = entries.find((e) => e.id === readHashScenario()) ?? entries[0];
  if (initial) pick(initial.id);
  picker.addEventListener('change', () => pick(picker.value));
  window.addEventListener('hashchange', () => {
    const id = readHashScenario();
    if (id && id !== picker.value && entries.some((e) => e.id === id)) pick(id);
  });
  picker.dataset.loaded = 'true';
  return entries;
}
