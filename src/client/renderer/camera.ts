/**
 * Top-down camera that follows the ego (doc 15 B6 road view). The road runs left → right
 * in the direction of travel; the left lanes (higher lane IDs, + y) are at the top.
 * Along-road and across-road scales differ (display only) so a 600 ft stretch fits the
 * width while the lanes still fill the height.
 */
import {
  ROAD_VIEW_MAX_LATERAL_STRETCH as MAX_LATERAL_STRETCH,
  ROAD_VIEW_MIN_RANGE_FT,
} from '../../shared/constants';

export interface Camera {
  /** px per ft along the road */
  scaleX: number;
  /** px per ft across the road */
  scaleY: number;
  /** ego front-bumper s at the anchor point */
  egoS: number;
  /** screen x of the ego front bumper */
  egoX: number;
  /** screen y of the road's lateral midline */
  midY: number;
  /** road-frame y of the midline */
  roadMidFt: number;
  width: number;
  height: number;
}

export function makeCamera(
  width: number,
  height: number,
  egoS: number,
  road: { minY: number; maxY: number },
): Camera {
  const roadWidth = road.maxY - road.minY + 12; // + median barrier and margin
  const scaleX = Math.max(0.5, Math.min(4, width / ROAD_VIEW_MIN_RANGE_FT));
  const scaleY = Math.max(
    scaleX,
    Math.min(MAX_LATERAL_STRETCH * scaleX, (height * 0.75) / roadWidth),
  );
  return {
    scaleX,
    scaleY,
    egoS,
    egoX: width * 0.25,
    midY: height * 0.55,
    roadMidFt: (road.minY + road.maxY) / 2,
    width,
    height,
  };
}

export const screenX = (c: Camera, s: number): number => (s - c.egoS) * c.scaleX + c.egoX;
export const screenY = (c: Camera, y: number): number => c.midY - (y - c.roadMidFt) * c.scaleY;
/** Visible road range [fromS, toS] in ft. */
export const visibleRange = (c: Camera): [number, number] => [
  c.egoS - c.egoX / c.scaleX,
  c.egoS + (c.width - c.egoX) / c.scaleX,
];
