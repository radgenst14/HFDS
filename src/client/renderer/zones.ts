/**
 * Following-zone bands ahead of the ego (doc 13 §3, A-05 revised): Safety (red, up to the
 * safety cushion), Coast (amber, up to where coasting starts), Closing (green, up to the
 * selection distance), plus a dashed selection-distance marker (R4.1). Shown while ACC is
 * on. Display only; the engine computes every distance.
 */
import { Text, type Container, type Graphics } from 'pixi.js';
import type { Snapshot } from '../../shared/protocol';
import { screenX, screenY, type Camera } from './camera';

const BAND = { Safety: 0xef4444, Coast: 0xf59e0b, Closing: 0x22c55e };

export class ZoneLabels {
  private readonly labels = new Map<string, Text>();
  constructor(private readonly layer: Container) {}

  place(key: string, text: string, x: number, y: number, visible: boolean): void {
    let t = this.labels.get(key);
    if (!t) {
      t = new Text({
        text,
        style: { fontSize: 10, fill: 0xffffff, fontFamily: 'system-ui, sans-serif' },
      });
      t.alpha = 0.85;
      this.layer.addChild(t);
      this.labels.set(key, t);
    }
    t.text = text;
    t.x = x;
    t.y = y;
    t.visible = visible;
  }

  hideAll(): void {
    for (const t of this.labels.values()) t.visible = false;
  }
}

export function drawZones(
  g: Graphics,
  cam: Camera,
  snap: Snapshot,
  egoS: number,
  labels: ZoneLabels,
): void {
  const acc = snap.hfds.acc;
  if (!acc.active) {
    labels.hideAll();
    return;
  }
  const w = snap.road.laneWidthFt;
  const laneY = (snap.ego.laneId - 1) * w;
  const top = screenY(cam, laneY + w / 2) + 2;
  const height = 5;
  const coastEnd = acc.coastStartFt ?? acc.trailDistanceFt;
  const bands: Array<[keyof typeof BAND, number, number]> = [
    ['Safety', 0, acc.safetyCushionFt],
    ['Coast', acc.safetyCushionFt, Math.min(coastEnd, acc.selectionDistanceFt)],
    ['Closing', Math.min(coastEnd, acc.selectionDistanceFt), acc.selectionDistanceFt],
  ];
  for (const [name, from, to] of bands) {
    if (to <= from) {
      labels.place(name, name, 0, 0, false);
      continue;
    }
    const x0 = screenX(cam, egoS + from);
    const x1 = screenX(cam, egoS + to);
    const current = acc.zone === name;
    g.rect(x0, top, x1 - x0, height).fill({ color: BAND[name], alpha: current ? 0.9 : 0.45 });
    labels.place(name, name, x0 + 2, top + height + 1, x1 - x0 > 40);
  }
  // Selection-distance marker (R4.1).
  const xs = screenX(cam, egoS + acc.selectionDistanceFt);
  const yTop = screenY(cam, laneY + w / 2);
  const yBottom = screenY(cam, laneY - w / 2);
  for (let y = yTop; y < yBottom; y += 6) g.moveTo(xs, y).lineTo(xs, Math.min(y + 3, yBottom));
  g.stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
}
