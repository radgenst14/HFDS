/**
 * Ego and traffic drawing (doc 15 B6): rectangles to scale (A-18) with size-class labels.
 * Lead / intruding highlights use snapshot flags (set by the engine from M3).
 */
import { Text, type Container, type Graphics } from 'pixi.js';
import { VEHICLE_DIMENSIONS_FT, EGO_SIZE_CLASS } from '../../shared/constants';
import type { Snapshot } from '../../shared/protocol';
import { screenX, screenY, type Camera } from './camera';
import type { Pose } from './interpolate';

const EGO_COLOR = 0x3b82f6;
const TRAFFIC_COLOR = 0xb8c0c8;
const LEAD_COLOR = 0xf5d90a;
const INTRUDING_COLOR = 0xff5c5c;

function rect(g: Graphics, cam: Camera, p: Pose, length: number, width: number) {
  const x = screenX(cam, p.s - length);
  const y = screenY(cam, p.y + width / 2);
  return g.roundRect(x, y, length * cam.scaleX, width * cam.scaleY, 2);
}

export function drawEgo(g: Graphics, cam: Camera, p: Pose): void {
  const d = VEHICLE_DIMENSIONS_FT[EGO_SIZE_CLASS];
  rect(g, cam, p, d.length, d.width).fill(EGO_COLOR).stroke({ width: 2, color: 0xffffff });
}

/** Keeps one label per vehicle id. */
export class LabelPool {
  private readonly labels = new Map<number, Text>();
  constructor(private readonly layer: Container) {}

  update(cam: Camera, traffic: Snapshot['traffic'], pose: (id: number) => Pose | null): void {
    const seen = new Set<number>();
    for (const v of traffic) {
      const p = pose(v.id);
      if (!p) continue;
      seen.add(v.id);
      let t = this.labels.get(v.id);
      if (!t) {
        t = new Text({
          text: '',
          style: { fontSize: 11, fill: 0xffffff, fontFamily: 'system-ui, sans-serif' },
        });
        this.layer.addChild(t);
        this.labels.set(v.id, t);
      }
      t.text = `#${v.id} ${v.sizeClass} ${v.speedMph.toFixed(0)} mph`;
      t.x = screenX(cam, p.s - v.length);
      t.y = screenY(cam, p.y + v.width / 2) - 14;
    }
    for (const [id, t] of this.labels) {
      if (!seen.has(id)) {
        t.destroy();
        this.labels.delete(id);
      }
    }
  }

  clear(): void {
    for (const t of this.labels.values()) t.destroy();
    this.labels.clear();
  }
}

export function drawTraffic(
  g: Graphics,
  cam: Camera,
  traffic: Snapshot['traffic'],
  pose: (id: number) => Pose | null,
): void {
  for (const v of traffic) {
    const p = pose(v.id);
    if (!p) continue;
    const r = rect(g, cam, p, v.length, v.width).fill(TRAFFIC_COLOR);
    if (v.isLead) r.stroke({ width: 3, color: LEAD_COLOR });
    else if (v.isIntruding) r.stroke({ width: 3, color: INTRUDING_COLOR });
  }
}
