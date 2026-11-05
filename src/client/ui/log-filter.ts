/**
 * Event log filter (doc 15 B6 region 6: the R45 event log is filterable). Pure, so it is
 * unit-tested under Node.
 *
 * A query that looks like an SRS or use-case ID (R30.4, IR29b, SR1.1.2, UC19) matches
 * entries tagged with that ID or with one of its sub-items, so R30 also finds R30.4 but
 * not R300. Any other query is a case-insensitive substring match on the source, message
 * and IDs.
 */
import type { LogEntry } from '../../shared/domain';

const ID_QUERY = /^(?:r|sr|ir|uc)\d+(?:\.\d+)*b?$/i;

/** "ir29B" → "IR29b", "sr1.1.2" → "SR1.1.2". */
export function normaliseReqId(query: string): string {
  const m = /^([a-z]+)(.*)$/i.exec(query.trim());
  return m ? `${(m[1] ?? '').toUpperCase()}${(m[2] ?? '').toLowerCase()}` : query.trim();
}

export function isReqIdQuery(query: string): boolean {
  return ID_QUERY.test(query.trim());
}

/** True when `entry` passes the text/ID query and the type filter ('' = any type). */
export function matchesLogFilter(entry: LogEntry, query: string, type: string): boolean {
  if (type !== '' && entry.type !== type) return false;
  const q = query.trim();
  if (q === '') return true;
  if (isReqIdQuery(q)) {
    const id = normaliseReqId(q);
    return entry.reqs.some((r) => r === id || r.startsWith(`${id}.`));
  }
  const haystack = `${entry.source} ${entry.message} ${entry.reqs.join(' ')}`.toLowerCase();
  return haystack.includes(q.toLowerCase());
}
