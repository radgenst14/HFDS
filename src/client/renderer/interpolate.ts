/**
 * Smooths motion between engine snapshots (doc 15 Part A: the renderer interpolates
 * between the last two snapshots). Display only; the engine state is never changed.
 */
import { HOST_TICK_MS } from '../../shared/constants';
import type { Snapshot } from '../../shared/protocol';

export interface Pose {
  s: number;
  y: number;
}

export class SnapshotBuffer {
  private prev: Snapshot | null = null;
  private cur: Snapshot | null = null;
  private receivedAt = 0;

  push(snapshot: Snapshot, now: number): void {
    // A new scenario or a reset: do not interpolate across it.
    const restart =
      !this.cur || snapshot.scenarioId !== this.cur.scenarioId || snapshot.tick < this.cur.tick;
    this.prev = restart ? snapshot : this.cur;
    this.cur = snapshot;
    this.receivedAt = now;
  }

  get latest(): Snapshot | null {
    return this.cur;
  }

  /** 0 = previous snapshot, 1 = latest. */
  alpha(now: number): number {
    if (!this.cur || !this.prev || this.cur.paused) return 1;
    return Math.min(1, Math.max(0, (now - this.receivedAt) / HOST_TICK_MS));
  }

  egoPose(now: number): Pose | null {
    if (!this.cur) return null;
    const a = this.alpha(now);
    const p = this.prev ?? this.cur;
    return { s: lerp(p.ego.s, this.cur.ego.s, a), y: lerp(p.ego.lateral, this.cur.ego.lateral, a) };
  }

  vehiclePose(id: number, now: number): Pose | null {
    const c = this.cur?.traffic.find((v) => v.id === id);
    if (!c) return null;
    const p = this.prev?.traffic.find((v) => v.id === id) ?? c;
    const a = this.alpha(now);
    return { s: lerp(p.s, c.s, a), y: lerp(p.lateral, c.lateral, a) };
  }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
