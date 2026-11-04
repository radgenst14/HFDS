/**
 * Client entry (M0): loads scenarios/index.json into the picker and keeps
 * `#scenario=<id>` in the URL (doc 15 Part A "How a scenario loads", steps 1 and 5).
 * The engine, transport, renderer and panels are wired in M1+. The client never
 * decides HFDS outcomes (CLAUDE.md rule 5).
 */
import { ScenarioIndexSchema, type ScenarioIndexEntry } from '../shared/scenario-schema';

const HASH_KEY = 'scenario';

function readHashScenario(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return params.get(HASH_KEY);
}

function writeHashScenario(id: string): void {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  params.set(HASH_KEY, id);
  window.history.replaceState(null, '', `#${params.toString()}`);
}

function label(entry: ScenarioIndexEntry): string {
  const code = entry.id.split('-')[0]?.toUpperCase() ?? entry.id;
  const customer =
    entry.customerScenario !== null ? ` · Customer Scenario ${entry.customerScenario}` : '';
  const optional = entry.optional ? ' (optional)' : '';
  return `${code} — ${entry.name}${customer}${optional}`;
}

function renderCaptionPlaceholder(entry: ScenarioIndexEntry | undefined): void {
  const body = document.getElementById('caption-body');
  if (!body) return;
  body.textContent = entry ? label(entry) : '';
}

async function loadIndex(): Promise<ScenarioIndexEntry[]> {
  // Relative URL: works under the EGR subpath (base './').
  const res = await fetch('./scenarios/index.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`scenarios/index.json: HTTP ${res.status}`);
  return ScenarioIndexSchema.parse(await res.json()).scenarios;
}

async function init(): Promise<void> {
  const picker = document.getElementById('scenario-picker') as HTMLSelectElement | null;
  if (!picker) return;
  try {
    const entries = await loadIndex();
    picker.replaceChildren(
      ...entries.map((e) => {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = label(e);
        return opt;
      }),
    );
    const fromHash = readHashScenario();
    const initial = entries.find((e) => e.id === fromHash) ?? entries[0];
    if (initial) {
      picker.value = initial.id;
      writeHashScenario(initial.id);
      renderCaptionPlaceholder(initial);
    }
    picker.addEventListener('change', () => {
      writeHashScenario(picker.value);
      renderCaptionPlaceholder(entries.find((e) => e.id === picker.value));
    });
    window.addEventListener('hashchange', () => {
      const entry = entries.find((e) => e.id === readHashScenario());
      if (entry && entry.id !== picker.value) {
        picker.value = entry.id;
        renderCaptionPlaceholder(entry);
      }
    });
    picker.dataset.loaded = 'true';
  } catch (err) {
    picker.replaceChildren(new Option('Failed to load presets', '', true, true));
    console.error(err);
  }
}

void init();
