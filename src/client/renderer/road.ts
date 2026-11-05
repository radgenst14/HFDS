/**
 * Road drawing (doc 15 B6): lanes, markings (solid edges, dashed dividers; faded where
 * IR2 markings are missing), right shoulder, median barrier, construction cones, tunnel
 * shading, curve labels and 100 ft distance ticks so motion is visible.
 * Curves are drawn straight in the road frame with a tint and a label (A-36).
 */
import type { Graphics } from 'pixi.js';
import type { Snapshot } from '../../shared/protocol';
import { screenX, screenY, visibleRange, type Camera } from './camera';

export const COLORS = {
  grass: 0x1d2a1f,
  asphalt: 0x3a3f45,
  shoulder: 0x4a4f55,
  white: 0xf2f2f2,
  yellow: 0xf2c14e,
  barrier: 0x9aa4ad,
  curve: 0x5b6cff,
  construction: 0xff8c1a,
  tunnel: 0x000000,
};

const DASH_FT = 10;
const GAP_FT = 30;

export function drawRoad(g: Graphics, cam: Camera, road: Snapshot['road']): void {
  const w = road.laneWidthFt;
  const lowest = road.rightShoulder ? 0 : 1;
  const yCenter = (lane: number) => (lane - 1) * w;
  const bottomFt = yCenter(lowest) - w / 2;
  const topFt = yCenter(road.travelLanes) + w / 2;
  const [s0, s1] = visibleRange(cam);
  const x0 = 0;
  const x1 = cam.width;
  const yTop = screenY(cam, topFt);
  const yBottom = screenY(cam, bottomFt);

  g.rect(0, 0, cam.width, cam.height).fill(COLORS.grass);
  g.rect(x0, yTop, x1 - x0, yBottom - yTop).fill(COLORS.asphalt);
  if (road.rightShoulder) {
    const ys = screenY(cam, yCenter(1) - w / 2);
    g.rect(x0, ys, x1 - x0, yBottom - ys).fill(COLORS.shoulder);
  }

  // Segment overlays.
  for (const seg of road.visibleSegments) {
    const sx0 = Math.max(x0, screenX(cam, seg.fromFt));
    const sx1 = Math.min(x1, screenX(cam, seg.toFt));
    if (sx1 <= sx0) continue;
    if (seg.curvatureRadiusFt !== undefined) {
      g.rect(sx0, yTop, sx1 - sx0, yBottom - yTop).fill({ color: COLORS.curve, alpha: 0.12 });
    }
    if (seg.tunnel)
      g.rect(sx0, yTop - 6, sx1 - sx0, yBottom - yTop + 12).fill({
        color: COLORS.tunnel,
        alpha: 0.35,
      });
    if (seg.constructionZone) {
      const coneY = screenY(cam, yCenter(1) - w / 2);
      for (
        let s = Math.ceil(Math.max(seg.fromFt, s0) / 40) * 40;
        s < Math.min(seg.toFt, s1);
        s += 40
      ) {
        const x = screenX(cam, s);
        g.poly([x, coneY - 6, x - 4, coneY + 4, x + 4, coneY + 4]).fill(COLORS.construction);
      }
    }
  }

  const fadedAt = (s: number): boolean =>
    road.visibleSegments.some(
      (seg) =>
        seg.markings &&
        (!seg.markings.left || !seg.markings.right) &&
        s >= seg.fromFt &&
        s < seg.toFt,
    );

  // Solid edge lines: right edge of lane 1 (white), left edge of the leftmost lane (yellow).
  const solid = (yFt: number, color: number) => {
    const y = screenY(cam, yFt);
    const step = 20;
    for (let s = Math.floor(s0 / step) * step; s < s1; s += step) {
      g.moveTo(screenX(cam, s), y)
        .lineTo(screenX(cam, s + step), y)
        .stroke({ width: 2, color, alpha: fadedAt(s) ? 0.15 : 1 });
    }
  };
  solid(yCenter(1) - w / 2, COLORS.white);
  solid(topFt, COLORS.yellow);

  // Dashed lane dividers (US 10 ft dash / 30 ft gap).
  for (let lane = 1; lane < road.travelLanes; lane++) {
    const y = screenY(cam, yCenter(lane) + w / 2);
    const period = DASH_FT + GAP_FT;
    for (let s = Math.floor(s0 / period) * period; s < s1; s += period) {
      g.moveTo(screenX(cam, s), y)
        .lineTo(screenX(cam, s + DASH_FT), y)
        .stroke({ width: 2, color: COLORS.white, alpha: fadedAt(s) ? 0.15 : 0.9 });
    }
  }

  // Median barrier.
  g.rect(x0, yTop - 5, x1 - x0, 4).fill(COLORS.barrier);

  // 100 ft distance ticks along the shoulder edge.
  for (let s = Math.ceil(s0 / 100) * 100; s < s1; s += 100) {
    const x = screenX(cam, s);
    g.moveTo(x, yBottom)
      .lineTo(x, yBottom + 6)
      .stroke({ width: 1, color: COLORS.white, alpha: 0.5 });
  }
}
