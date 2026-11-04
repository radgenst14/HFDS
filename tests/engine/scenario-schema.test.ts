import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ExpectationSchema,
  parseScenario,
  REQ_ID_PATTERN,
  ScenarioIndexSchema,
  TimelineEventSchema,
} from '../../src/shared/scenario-schema';

const ROOT = join(import.meta.dirname, '..', '..');
const SCENARIO_DIR = join(ROOT, 'public', 'scenarios');
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const index = ScenarioIndexSchema.parse(readJson(join(SCENARIO_DIR, 'index.json')));
const srsIds = new Set(
  (readJson(join(ROOT, 'docs', 'requirements.json')) as Array<{ id: string }>).map((r) => r.id),
);

describe('scenario index', () => {
  it('lists the 20 presets s00–s19 in order', () => {
    expect(index.scenarios.map((e) => e.id.slice(0, 3))).toEqual(
      Array.from({ length: 20 }, (_, i) => `s${String(i).padStart(2, '0')}`),
    );
  });

  it('lists every preset file in public/scenarios and nothing else', () => {
    const files = readdirSync(SCENARIO_DIR).filter(
      (f) => f !== 'index.json' && f.endsWith('.json'),
    );
    expect(index.scenarios.map((e) => e.file).sort()).toEqual(files.sort());
  });

  it('[Q-01] sets customerScenario only for the known customer scenarios (S01 = 1, S13 = 4)', () => {
    const customer = index.scenarios.filter((e) => e.customerScenario !== null);
    expect(customer.map((e) => [e.id, e.customerScenario])).toEqual([
      ['s01-activation-success', 1],
      ['s13-driver-brakes', 4],
    ]);
  });

  it('marks only s18 and s19 optional (doc 14)', () => {
    expect(index.scenarios.filter((e) => e.optional).map((e) => e.id)).toEqual([
      's18-collision-onstar',
      's19-unauthorized-command',
    ]);
  });
});

describe.each(index.scenarios)('preset $id', (entry) => {
  const raw = readJson(join(SCENARIO_DIR, entry.file));
  const parsed = parseScenario(raw);

  it('passes the Zod schema', () => {
    if (!parsed.ok) throw new Error(`${entry.file}\n${parsed.error}`);
    expect(parsed.ok).toBe(true);
  });

  it('agrees with its index entry and file name', () => {
    if (!parsed.ok) return;
    const s = parsed.scenario;
    expect(`${s.id}.json`).toBe(entry.file);
    expect(s.id).toBe(entry.id);
    expect(s.name).toBe(entry.name);
    expect(s.customerScenario).toBe(entry.customerScenario);
    expect(s.optional).toBe(entry.optional);
  });

  it('cites only requirement IDs that exist in the SRS catalog (UC IDs allowed, ISSUE-35)', () => {
    if (!parsed.ok) return;
    const cited = [
      ...parsed.scenario.requirements,
      ...parsed.scenario.expect.flatMap((e) => e.reqs),
    ];
    const unknown = cited.filter((id) => !id.startsWith('UC') && !srsIds.has(id));
    expect(unknown).toEqual([]);
  });

  it('has at least one expectation unless it is the sandbox', () => {
    if (!parsed.ok) return;
    if (entry.id === 's00-sandbox') return;
    expect(parsed.scenario.expect.length).toBeGreaterThan(0);
  });
});

describe('schema rejects malformed presets with readable errors', () => {
  const base = readJson(join(SCENARIO_DIR, 's01-activation-success.json')) as Record<
    string,
    unknown
  >;

  it('rejects an unknown top-level key', () => {
    const r = parseScenario({ ...base, speedMultiplier: 0.6 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/speedMultiplier/);
  });

  it('rejects a lane that does not exist', () => {
    const r = parseScenario({ ...base, ego: { ...(base.ego as object), laneId: 9 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/laneId 9/);
  });

  it('rejects an unknown timeline action', () => {
    expect(
      TimelineEventSchema.safeParse({ t: 1, kind: 'inject', action: 'teleport' }).success,
    ).toBe(false);
  });

  it('only allows t: null for the reactive takeoverOnClassA', () => {
    expect(
      TimelineEventSchema.safeParse({ t: null, kind: 'driver', action: 'pressHfdsButton' }).success,
    ).toBe(false);
    expect(
      TimelineEventSchema.safeParse({
        t: null,
        kind: 'driver',
        action: 'takeoverOnClassA',
        args: { delayS: 3, grip: ['L', 'R'] },
      }).success,
    ).toBe(true);
  });

  it('rejects an expectation with two timing triggers', () => {
    const r = ExpectationSchema.safeParse({
      check: 'mode',
      reqs: ['R29'],
      at: 1,
      by: 2,
      value: 'HANDS_FREE',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an expectation with from but no to', () => {
    const r = ExpectationSchema.safeParse({
      check: 'available',
      reqs: ['IR6'],
      from: 1,
      value: true,
    });
    expect(r.success).toBe(false);
  });

  it('accepts a bare after anchor ("mrm" = mrm+0)', () => {
    const r = ExpectationSchema.safeParse({
      check: 'hmi',
      reqs: ['SR1.2'],
      after: 'mrm',
      field: 'hazardLights',
      value: true,
    });
    expect(r.success).toBe(true);
  });
});

describe('requirement ID format', () => {
  it.each(['R29.3', 'SR1.1.2', 'IR12', 'IR29b', 'R45.1', 'UC19'])('[ISSUE-01] accepts %s', (id) => {
    expect(REQ_ID_PATTERN.test(id)).toBe(true);
  });
  it.each(['FR-07', 'r29', 'IR', 'R29.', 'A-03'])('rejects %s', (id) => {
    expect(REQ_ID_PATTERN.test(id)).toBe(false);
  });
});
