import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { Engine } from '../../src/engine/engine';
import { loadScenario } from '../../src/engine/scenario/loader';
import { ScenarioIndexSchema } from '../../src/shared/scenario-schema';

/**
 * Screenshot script for SRS Section 5.2 (doc 17 M6): `npm run screenshots`.
 *
 * For each preset the engine runs headless in Node to find its key moments: every HFDS
 * mode change (captured 0.5 s later so the HMI shows it) plus the final state. The page then
 * opens `#scenario=<id>&t=<s>`, which seeks the same deterministic run and pauses, and the
 * whole page is saved to docs/screenshots/<id>/. An index.md lists each shot with the
 * scenario caption, ready to paste into the SRS.
 */
const ROOT = join(import.meta.dirname, '..', '..');
const SCENARIOS = join(ROOT, 'public', 'scenarios');
const OUT = join(ROOT, 'docs', 'screenshots');
const SETTLE_S = 0.5;
const MAX_SHOTS = 8;

interface Moment {
  t: number;
  label: string;
}

function keyMoments(id: string, file: string): { moments: Moment[]; caption: string[] } {
  const loaded = loadScenario(JSON.parse(readFileSync(join(SCENARIOS, file), 'utf8')), id);
  if (!loaded.ok) throw new Error(loaded.error);
  const s = loaded.scenario;
  const engine = new Engine(s);
  const moments: Moment[] = [];
  let mode = '';
  while (!engine.finished) {
    engine.step();
    const now = engine.snapshot({ paused: true, timeScale: 1 }).hfds.mode;
    if (now !== mode) {
      mode = now;
      const t = Math.min(engine.simTime + SETTLE_S, s.durationS);
      moments.push({ t: Math.round(t * 20) / 20, label: now });
    }
  }
  moments.push({ t: s.durationS, label: 'end' });
  const unique = moments.filter((m, i) => moments.findIndex((x) => x.t === m.t) === i);
  // Keep the first and last few if a preset changes mode often.
  const picked =
    unique.length <= MAX_SHOTS ? unique : [...unique.slice(0, MAX_SHOTS - 2), ...unique.slice(-2)];
  return { moments: picked, caption: [s.caption.summary, ...s.caption.steps] };
}

const index = ScenarioIndexSchema.parse(
  JSON.parse(readFileSync(join(SCENARIOS, 'index.json'), 'utf8')),
).scenarios;

for (const entry of index) {
  test(`screenshots: ${entry.id}`, async ({ page }) => {
    test.setTimeout(120_000);
    const { moments, caption } = keyMoments(entry.id, entry.file);
    const dir = join(OUT, entry.id);
    mkdirSync(dir, { recursive: true });
    const lines = [`## ${entry.name}`, '', ...caption.map((c) => `- ${c}`), ''];
    for (const m of moments) {
      await page.goto(`./#scenario=${entry.id}&t=${m.t.toFixed(2)}`);
      await page
        .locator('#app')
        .waitFor({ state: 'attached' })
        .then(() =>
          page.waitForFunction(
            (t) => document.getElementById('app')?.dataset.simTime === t,
            m.t.toFixed(2),
            { timeout: 30_000 },
          ),
        );
      await page.waitForTimeout(400); // let the road view settle on the paused snapshot
      const name = `t${m.t.toFixed(2).padStart(6, '0')}-${m.label}.png`;
      await page.screenshot({ path: join(dir, name), fullPage: true });
      lines.push(`![${entry.id} at ${m.t.toFixed(2)} s — ${m.label}](${name})`, '');
    }
    writeFileSync(join(dir, 'index.md'), lines.join('\n'));
  });
}
