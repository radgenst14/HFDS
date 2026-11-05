/** Hazard markers (IR26 list): a warning diamond in the hazard's lane. */
import type { Graphics } from 'pixi.js';
import type { Snapshot } from '../../shared/protocol';
import { screenX, screenY, type Camera } from './camera';

const HAZARD_COLOR = 0xff3b30;

export function drawHazards(
  g: Graphics,
  cam: Camera,
  hazards: Snapshot['hazards'],
  laneWidthFt: number,
): void {
  const r = Math.max(5, 2.5 * cam.scaleY);
  for (const h of hazards) {
    const x = screenX(cam, h.s);
    const y = screenY(cam, (h.laneId - 1) * laneWidthFt);
    g.poly([x, y - r, x + r, y, x, y + r, x - r, y])
      .fill(HAZARD_COLOR)
      .stroke({ width: 1.5, color: 0xffffff });
  }
}
