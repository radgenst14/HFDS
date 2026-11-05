/**
 * Timeline runner (doc 14 "Timeline events"): each event is applied at the first tick
 * whose start time is >= its `t` (doc 13 §11 step 1). Events with `t: null` are reactive
 * (`takeoverOnClassA`) and are handed to the HFDS logic that triggers them (M4).
 */
import type { TimelineEvent } from '../../shared/scenario-schema';

/** Tolerance so t = 2.0 fires on tick 40 despite float rounding of tick × 0.05. */
const T_EPS = 1e-9;

export type TimedEvent = Exclude<TimelineEvent, { t: null }>;
export type ReactiveEvent = Extract<TimelineEvent, { t: null }>;

export class TimelineRunner {
  private readonly timed: TimedEvent[];
  private next = 0;
  readonly reactive: readonly ReactiveEvent[];

  constructor(events: readonly TimelineEvent[]) {
    const timed: TimedEvent[] = [];
    const reactive: ReactiveEvent[] = [];
    for (const e of events) {
      if (e.t === null) reactive.push(e as ReactiveEvent);
      else timed.push(e as TimedEvent);
    }
    // Stable sort keeps file order for events with the same t.
    this.timed = timed
      .map((e, i) => ({ e, i }))
      .sort((a, b) => a.e.t - b.e.t || a.i - b.i)
      .map((x) => x.e);
    this.reactive = reactive;
  }

  /** Events due at a tick starting at `simTime`, in time then file order. */
  due(simTime: number): TimedEvent[] {
    const out: TimedEvent[] = [];
    while (this.next < this.timed.length) {
      const e = this.timed[this.next];
      if (!e || e.t > simTime + T_EPS) break;
      out.push(e);
      this.next++;
    }
    return out;
  }

  get remaining(): number {
    return this.timed.length - this.next;
  }
}
