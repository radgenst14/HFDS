/**
 * Scenario loader (doc 15 Part A "How a scenario loads", step 3): validates a preset with
 * the Zod schema and returns it, or a readable error. Fetching happens in worker.ts
 * (A-35); this module stays pure so tests load presets from disk the same way.
 */
import {
  parseScenario,
  ScenarioIndexSchema,
  type Scenario,
  type ScenarioIndexEntry,
} from '../../shared/scenario-schema';

export type LoadResult = { ok: true; scenario: Scenario } | { ok: false; error: string };

export function loadScenario(data: unknown, expectedId?: string): LoadResult {
  const parsed = parseScenario(data);
  if (!parsed.ok) return { ok: false, error: `Invalid scenario: ${parsed.error}` };
  if (expectedId !== undefined && parsed.scenario.id !== expectedId) {
    return {
      ok: false,
      error: `Scenario file id "${parsed.scenario.id}" does not match requested "${expectedId}"`,
    };
  }
  return parsed;
}

export function parseIndex(
  data: unknown,
): { ok: true; entries: ScenarioIndexEntry[] } | { ok: false; error: string } {
  const r = ScenarioIndexSchema.safeParse(data);
  return r.success
    ? { ok: true, entries: r.data.scenarios }
    : { ok: false, error: `Invalid scenarios/index.json: ${r.error.message}` };
}
