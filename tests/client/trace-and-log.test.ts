import { describe, expect, it } from 'vitest';
import requirementsJson from '../../docs/requirements.json';
import { matchesLogFilter, normaliseReqId } from '../../src/client/ui/log-filter';
import {
  buildTraceModel,
  OTHER_SECTION,
  sectionKey,
  type RequirementRecord,
} from '../../src/client/ui/trace-model';
import type { LogEntry } from '../../src/shared/domain';

/** Pure client logic behind the M6 trace panel and the R45 event log filter (doc 15 B6). */
const CATALOG = requirementsJson as readonly RequirementRecord[];

const entry = (message: string, reqs: string[], type: LogEntry['type'] = 'info'): LogEntry => ({
  t: 1,
  type,
  source: 'HFDS',
  message,
  reqs,
});

describe('event log filter', () => {
  const alert = entry('Second alert', ['R30', 'R30.4'], 'warning');
  const fault = entry('E102: Front radar failed', ['R9', 'R37', 'IR29b'], 'error');

  it('an SRS ID query matches that ID and its sub-items only', () => {
    expect(matchesLogFilter(alert, 'R30', '')).toBe(true);
    expect(matchesLogFilter(alert, 'r30.4', '')).toBe(true);
    expect(matchesLogFilter(alert, 'R3', '')).toBe(false);
    expect(matchesLogFilter(fault, 'ir29B', '')).toBe(true);
    expect(normaliseReqId('sr1.1.2')).toBe('SR1.1.2');
  });

  it('text queries search source, message and IDs; the type filter narrows', () => {
    expect(matchesLogFilter(fault, 'radar', '')).toBe(true);
    expect(matchesLogFilter(fault, 'radar', 'warning')).toBe(false);
    expect(matchesLogFilter(alert, '', 'warning')).toBe(true);
    expect(matchesLogFilter(alert, '   ', '')).toBe(true);
  });
});

describe('requirement trace model', () => {
  it('covers the whole catalog in SRS sections', () => {
    const m = buildTraceModel(CATALOG, [], []);
    expect(m.catalogCount).toBe(CATALOG.length);
    expect(m.exercisedCount).toBe(0);
    expect(m.sections).toEqual([]);
    expect(m.documentedOnly.map((r) => r.id)).toEqual(
      expect.arrayContaining(['IR18', 'IR19', 'IR20', 'IR21', 'SR9']),
    );
    expect(sectionKey('3.1.5 Driver attention and warnings')).toBe('3.1.5');
  });

  it('shows exercised and listed IDs with their states, in SRS section order', () => {
    const m = buildTraceModel(CATALOG, ['R30.4', 'IR12', 'UC19'], ['R30', 'R36', 'IR12']);
    const keys = m.sections.map((s) => s.key);
    expect(keys).toEqual(['3.1.5', '3.3', OTHER_SECTION]);
    const attention = m.sections[0];
    const state = (id: string) => attention?.chips.find((c) => c.id === id)?.state;
    expect(state('R30')).toBe('exercised'); // a child tag counts for its parent
    expect(state('R30.4')).toBe('exercised');
    expect(state('R36')).toBe('listed');
    expect(m.sections[2]?.chips.map((c) => c.id)).toEqual(['UC19']);
    expect(m.listedCount).toBe(3);
    expect(m.listedExercised).toBe(2);
    expect(attention?.exercised).toBe(2);
    expect(m.exercisedCount).toBe(3);
  });
});
