/**
 * Road (doc 12) built from a scenario's `road` block.
 *
 * Road frame (doc 12 Position): s = distance along the road (ft), y = lateral offset (ft),
 * positive to the left. Lane L's centre is at y = (L − 1) × laneWidth, so lane 1 is at
 * y = 0 and the shoulder (lane 0) at y = −laneWidth (A-38: shoulder as wide as a lane).
 * Curves are a property of segments (curvature for UC9 checks in M3); positions stay in
 * the road frame, so the kinematic model needs no curve geometry (A-36).
 */
import { M_TO_FT } from '../../shared/constants';
import { LaneType, type RoadType } from '../../shared/domain';
import type { RoadSegmentView } from '../../shared/protocol';
import type { Scenario } from '../../shared/scenario-schema';
import { Lane } from './lane';

type SegmentSpec = Scenario['road']['segments'][number];

export class Road {
  readonly roadType: RoadType;
  readonly lengthFt: number;
  readonly travelLanes: number;
  readonly laneWidthFt: number;
  readonly laneWidthM: number;
  readonly rightShoulder: boolean;
  readonly medianBarrier: boolean;
  readonly segments: readonly SegmentSpec[];
  /** Director overrides (IR5.2, IR1; doc 14 `setRoadFlags`), applied road-wide. */
  flags: { constructionZone?: boolean; tunnel?: boolean; enabledForHfds?: boolean } = {};
  /** Director `dropLaneMarkings` (IR2): lane lines undetectable until this sim time. */
  private markingsDroppedUntil: number | null = null;

  constructor(spec: Scenario['road']) {
    this.roadType = spec.roadType;
    this.lengthFt = spec.lengthFt;
    this.travelLanes = spec.travelLanes;
    this.laneWidthM = spec.laneWidthM;
    this.laneWidthFt = spec.laneWidthM * M_TO_FT;
    this.rightShoulder = spec.rightShoulder;
    this.medianBarrier = spec.medianBarrier;
    this.segments = [...spec.segments].sort((a, b) => a.fromFt - b.fromFt);
  }

  /** Segments covering s (several may overlap). */
  segmentsAt(s: number): SegmentSpec[] {
    return this.segments.filter((g) => s >= g.fromFt && s < g.toFt);
  }

  /** Road.isConstructionZone at s (IR5.2). */
  isConstructionZone(s: number): boolean {
    return (
      this.flags.constructionZone ?? this.segmentsAt(s).some((g) => g.constructionZone === true)
    );
  }

  /** Road.isTunnel at s (IR5.2). */
  isTunnel(s: number): boolean {
    return this.flags.tunnel ?? this.segmentsAt(s).some((g) => g.tunnel === true);
  }

  /** Director `dropLaneMarkings` (IR2) for `durationS` from `t`. */
  dropMarkings(t: number, durationS: number): void {
    this.markingsDroppedUntil = t + durationS;
  }

  /** Lane markings at s and time t (IR2); missing `markings` means both visible. */
  markingsAt(s: number, t = 0): { left: boolean; right: boolean } {
    if (this.markingsDroppedUntil !== null && t < this.markingsDroppedUntil - 1e-9) {
      return { left: false, right: false };
    }
    let left = true;
    let right = true;
    for (const g of this.segmentsAt(s)) {
      if (g.markings) {
        left &&= g.markings.left;
        right &&= g.markings.right;
      }
    }
    return { left, right };
  }

  /** Road type at s: a segment `roadType` (e.g. a service drive, IR5.3) overrides the road's. */
  roadTypeAt(s: number): string {
    const seg = this.segmentsAt(s).find((g) => g.roadType !== undefined);
    return seg?.roadType ?? this.roadType;
  }

  /** IR1 / UC17: HFDS enabled at s (segment `enabledForHfds`, Director flag). */
  isEnabledForHfds(s: number): boolean {
    if (this.flags.enabledForHfds === false) return false;
    if (s >= this.lengthFt) return false;
    return !this.segmentsAt(s).some((g) => g.enabledForHfds === false);
  }

  /**
   * UC17: distance from s to the end of the HFDS-enabled stretch: the road end or the
   * start of the first segment ahead with `enabledForHfds: false` (0 if not enabled at s).
   */
  enabledDistanceAhead(s: number): number {
    if (!this.isEnabledForHfds(s)) return 0;
    let end = this.lengthFt;
    for (const g of this.segments) {
      if (g.enabledForHfds === false && g.fromFt > s) end = Math.min(end, g.fromFt);
    }
    return end - s;
  }

  /** Road.getLanes() at position s and time t: shoulder (if any) plus travel lanes. */
  getLanes(s: number, t = 0): Lane[] {
    const m = this.markingsAt(s, t);
    const lanes: Lane[] = [];
    if (this.rightShoulder)
      lanes.push(new Lane(0, this.laneWidthM, m.right, true, LaneType.Shoulder));
    for (let id = 1; id <= this.travelLanes; id++) {
      lanes.push(new Lane(id, this.laneWidthM, m.left, m.right, LaneType.Travel));
    }
    return lanes;
  }

  /** Lateral centre of a lane (ft). */
  laneCenterY(laneId: number): number {
    return (laneId - 1) * this.laneWidthFt;
  }

  /** Lane containing lateral position y (nearest centre, clamped to existing lanes). */
  laneIdAt(y: number): number {
    const raw = Math.round(y / this.laneWidthFt) + 1;
    const min = this.rightShoulder ? 0 : 1;
    return Math.min(this.travelLanes, Math.max(min, raw));
  }

  /** Paved lateral extent [right edge, left edge] in ft (shoulder edge to median). */
  pavedBounds(): { minY: number; maxY: number } {
    const half = this.laneWidthFt / 2;
    const lowest = this.rightShoulder ? 0 : 1;
    return {
      minY: this.laneCenterY(lowest) - half,
      maxY: this.laneCenterY(this.travelLanes) + half,
    };
  }

  /** Geometry near the ego for the snapshot (doc 15 B4: only the visible window). */
  visibleSegments(fromS: number, toS: number): RoadSegmentView[] {
    return this.segments
      .filter((g) => g.toFt > fromS && g.fromFt < toS)
      .map((g) => {
        const v: RoadSegmentView = { fromFt: g.fromFt, toFt: g.toFt };
        if (g.curvatureRadiusFt !== undefined) v.curvatureRadiusFt = g.curvatureRadiusFt;
        if (g.direction !== undefined) v.direction = g.direction;
        if (g.constructionZone !== undefined) v.constructionZone = g.constructionZone;
        if (g.tunnel !== undefined) v.tunnel = g.tunnel;
        if (g.markings !== undefined) v.markings = g.markings;
        return v;
      });
  }
}
