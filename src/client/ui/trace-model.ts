/**
 * Requirement trace model (doc 15 B6 region 6; doc 17 M6). Pure, so it is unit-tested under
 * Node; trace-panel.ts renders it.
 *
 * An SRS ID counts as exercised in this run when the engine has logged an event tagged with
 * it or with one of its sub-items (snapshot.traceReqs; the same parent rule as
 * scripts/trace-matrix.ts). The panel shows every exercised ID plus the IDs the scenario
 * lists, grouped by SRS section in document order. IDs outside the catalog (use cases such
 * as UC19) go to a final "Use cases and other tags" group.
 */

export type Treatment = 'SIM' | 'STUB' | 'HMI' | 'LOG' | 'DOC';

/** The fields of docs/requirements.json the panel needs. */
export interface RequirementRecord {
  id: string;
  section: string;
  text: string;
  prototype: { treatment: Treatment };
}

export type ChipState = 'exercised' | 'listed';

export interface TraceChip {
  id: string;
  state: ChipState;
  /** Requirement text ('' for tags outside the catalog). */
  text: string;
  treatment: Treatment | null;
}

export interface TraceSection {
  /** "3.1.5", "3.2", … or "other". */
  key: string;
  title: string;
  chips: TraceChip[];
  /** Catalog requirements in this section. */
  total: number;
  /** Catalog requirements in this section exercised in this run. */
  exercised: number;
}

export interface TraceModel {
  sections: TraceSection[];
  catalogCount: number;
  exercisedCount: number;
  listedCount: number;
  listedExercised: number;
  /** DOC-treatment requirements: listed as out of prototype scope (doc 10 legend). */
  documentedOnly: RequirementRecord[];
}

export const OTHER_SECTION = 'other';

/** "3.1.5 Driver attention and warnings" → "3.1.5". */
export function sectionKey(section: string): string {
  return section.trim().split(/\s+/)[0] ?? section;
}

/** Drops the trailing colon some SRS headings carry. */
export function sectionTitle(section: string): string {
  return section.trim().replace(/:$/, '');
}

/** Natural order for tags outside the catalog: UC2 before UC10. */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

export function buildTraceModel(
  catalog: readonly RequirementRecord[],
  exercisedIds: readonly string[],
  listedIds: readonly string[],
): TraceModel {
  const exercisedSet = new Set(exercisedIds);
  const isExercised = (id: string) =>
    exercisedSet.has(id) || exercisedIds.some((x) => x.startsWith(`${id}.`));
  const shown = new Set([...exercisedIds, ...listedIds]);
  const known = new Set(catalog.map((r) => r.id));

  const sections = new Map<string, TraceSection>();
  for (const r of catalog) {
    const key = sectionKey(r.section);
    let sec = sections.get(key);
    if (!sec) {
      sec = { key, title: sectionTitle(r.section), chips: [], total: 0, exercised: 0 };
      sections.set(key, sec);
    }
    sec.total++;
    const done = isExercised(r.id);
    if (done) sec.exercised++;
    if (shown.has(r.id)) {
      sec.chips.push({
        id: r.id,
        state: done ? 'exercised' : 'listed',
        text: r.text,
        treatment: r.prototype.treatment,
      });
    }
  }

  const others = [...shown].filter((id) => !known.has(id)).sort(naturalCompare);
  const result = [...sections.values()].filter((s) => s.chips.length > 0);
  if (others.length > 0) {
    result.push({
      key: OTHER_SECTION,
      title: 'Use cases and other tags',
      chips: others.map((id) => ({
        id,
        state: isExercised(id) ? 'exercised' : 'listed',
        text: '',
        treatment: null,
      })),
      total: 0,
      exercised: 0,
    });
  }

  const listedKnown = [...new Set(listedIds)].filter((id) => known.has(id));
  return {
    sections: result,
    catalogCount: catalog.length,
    exercisedCount: catalog.filter((r) => isExercised(r.id)).length,
    listedCount: listedKnown.length,
    listedExercised: listedKnown.filter(isExercised).length,
    documentedOnly: catalog.filter((r) => r.prototype.treatment === 'DOC'),
  };
}
