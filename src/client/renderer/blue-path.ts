/**
 * Blue path (R2, R20): the predicted path drawn as the ego corridor (ego width) with a
 * centre line. Brighter while HFDS is engaged. Display only.
 */
import type { Graphics } from 'pixi.js';
import { EGO_SIZE_CLASS, VEHICLE_DIMENSIONS_FT } from '../../shared/constants';
import type { Snapshot } from '../../shared/protocol';
import { screenX, screenY, type Camera } from './camera';

const BLUE = 0x3b82f6;

export function drawBluePath(g: Graphics, cam: Camera, snap: Snapshot): void {
  const path = snap.hfds.bluePath;
  if (path.length < 2) return;
  const engaged = !['UNAVAILABLE', 'AVAILABLE', 'STARTING'].includes(snap.hfds.mode);
  const half = VEHICLE_DIMENSIONS_FT[EGO_SIZE_CLASS].width / 2;
  const first = path[0];
  const last = path[path.length - 1];
  if (!first || !last) return;
  const x0 = screenX(cam, first.s);
  const x1 = screenX(cam, last.s);
  const top = screenY(cam, first.y + half);
  const bottom = screenY(cam, first.y - half);
  g.rect(x0, top, x1 - x0, bottom - top).fill({ color: BLUE, alpha: engaged ? 0.22 : 0.08 });
  g.moveTo(x0, screenY(cam, first.y));
  for (const p of path) g.lineTo(screenX(cam, p.s), screenY(cam, p.y));
  g.stroke({ width: 2, color: BLUE, alpha: engaged ? 0.9 : 0.35 });
}
