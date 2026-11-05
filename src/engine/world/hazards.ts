/**
 * Road hazards (doc 12 Hazard; IR26 list). Static objects at an absolute road position.
 * Detection (`DriverAssistSystem.detectHazard()`, UC10) is M4.
 */
import type { Hazard, HazardType } from '../../shared/domain';
import type { Scenario } from '../../shared/scenario-schema';

export class HazardField {
  private readonly items: Hazard[];
  private nextId: number;

  constructor(spec: Scenario['hazards']) {
    this.items = spec.map((h) => ({
      id: h.id,
      type: h.type,
      laneId: h.laneId,
      s: h.sFt,
      detectedAt: null,
    }));
    this.nextId = Math.max(0, ...spec.map((h) => h.id)) + 1;
  }

  get all(): readonly Hazard[] {
    return this.items;
  }

  /** Director `spawnHazard` (IR26). */
  spawn(type: HazardType, laneId: number, s: number): Hazard {
    const h: Hazard = { id: this.nextId++, type, laneId, s, detectedAt: null };
    this.items.push(h);
    return h;
  }
}
