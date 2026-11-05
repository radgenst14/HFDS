/**
 * EventLog (doc 12). Every entry has a sim-time timestamp (R45) and the SRS IDs it
 * relates to (CLAUDE.md rule 1). Entries logged during a tick are also emitted to the
 * page as `event` messages (doc 15 B4).
 */
import { EVENT_LOG_CAPACITY } from '../../shared/constants';
import {
  LogEntryType,
  SubsystemStatus,
  type ErrorCode,
  type LogEntry,
  type LogFile,
} from '../../shared/domain';

export class EventLog {
  status: SubsystemStatus = SubsystemStatus.OK;
  readonly capacity: number;
  private items: LogEntry[] = [];
  private fresh: LogEntry[] = [];
  private dropped = 0;

  constructor(capacity = EVENT_LOG_CAPACITY) {
    this.capacity = capacity;
  }

  get entries(): readonly LogEntry[] {
    return this.items;
  }

  /** Total entries ever logged (including dropped ones). */
  get count(): number {
    return this.items.length + this.dropped;
  }

  logEvent(entry: LogEntry): LogEntry {
    const e: LogEntry = { ...entry, reqs: [...entry.reqs] };
    this.items.push(e);
    this.fresh.push(e);
    if (this.items.length > this.capacity) {
      // A-39: keep the newest entries; `count` still reports every entry ever logged.
      const over = this.items.length - this.capacity;
      this.items.splice(0, over);
      this.dropped += over;
    }
    return e;
  }

  logDisengagement(t: number, source: string, message: string, reqs: string[]): LogEntry {
    return this.logEvent({ t, type: LogEntryType.disengagement, source, message, reqs });
  }

  logTakeoverRequest(t: number, source: string, message: string, reqs: string[]): LogEntry {
    return this.logEvent({ t, type: LogEntryType.takeover_request, source, message, reqs });
  }

  /** R37, IR29b: error entries carry the code, severity and sensor metadata. */
  logError(t: number, source: string, code: ErrorCode, reqs: string[]): LogEntry {
    return this.logEvent({
      t,
      type: LogEntryType.error,
      source,
      message: `${code.code}: ${code.description}`,
      reqs,
      data: code,
    });
  }

  /** Entries logged since the previous call (for `event` messages). */
  takeFresh(): LogEntry[] {
    const out = this.fresh;
    this.fresh = [];
    return out;
  }

  exportLog(scenarioId: string, seed: number): LogFile {
    return { scenarioId, seed, entries: this.items.map((e) => ({ ...e, reqs: [...e.reqs] })) };
  }
}
