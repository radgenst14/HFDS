/**
 * Lane (doc 12). Lane IDs follow A-28: 0 = right shoulder, 1 = rightmost travel lane …
 * n = leftmost. `width` is in metres as in the SRS data dictionary (A-02).
 */
import type { LaneType } from '../../shared/domain';

export class Lane {
  constructor(
    readonly laneId: number,
    /** metres */
    readonly width: number,
    readonly leftMarkingVisible: boolean,
    readonly rightMarkingVisible: boolean,
    readonly laneType: LaneType,
  ) {}

  /** IR2: HFDS needs both lane markings. */
  bothMarkingsVisible(): boolean {
    return this.leftMarkingVisible && this.rightMarkingVisible;
  }
}
