import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadScenario } from '../../src/engine/scenario/loader';
import { ScenarioIndexSchema, type Scenario } from '../../src/shared/scenario-schema';

export const ROOT = join(import.meta.dirname, '..', '..');
export const SCENARIO_DIR = join(ROOT, 'public', 'scenarios');

export function readPreset(id: string): Scenario {
  const r = loadScenario(JSON.parse(readFileSync(join(SCENARIO_DIR, `${id}.json`), 'utf8')), id);
  if (!r.ok) throw new Error(r.error);
  return r.scenario;
}

export function presetIds(): string[] {
  const idx = ScenarioIndexSchema.parse(
    JSON.parse(readFileSync(join(SCENARIO_DIR, 'index.json'), 'utf8')),
  );
  return idx.scenarios.map((s) => s.id);
}

/** A copy of a preset with some fields replaced, for focused tests. */
export function withChanges(base: Scenario, change: Partial<Scenario>): Scenario {
  return { ...structuredClone(base), ...change };
}
