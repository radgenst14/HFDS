/**
 * PixiJS road view (doc 15 B6 region 2). Draws the latest snapshot every frame,
 * interpolating positions between snapshots. Rendering only: no HFDS logic (rule 5).
 */
import { Application, Container, Graphics } from 'pixi.js';
import type { Snapshot } from '../../shared/protocol';
import { drawBluePath } from './blue-path';
import { makeCamera } from './camera';
import { drawHazards } from './hazards';
import { SnapshotBuffer } from './interpolate';
import { COLORS, drawRoad } from './road';
import { drawEgo, drawTraffic, LabelPool } from './vehicles';
import { drawZones, ZoneLabels } from './zones';

export class RoadRenderer {
  private readonly buffer = new SnapshotBuffer();
  private readonly roadLayer = new Graphics();
  private readonly overlayLayer = new Graphics();
  private readonly vehicleLayer = new Graphics();
  private readonly labelLayer = new Container();
  private readonly labels = new LabelPool(this.labelLayer);
  private readonly zoneLabels = new ZoneLabels(this.labelLayer);

  private constructor(private readonly app: Application) {
    app.stage.addChild(this.roadLayer, this.overlayLayer, this.vehicleLayer, this.labelLayer);
    app.ticker.add(() => this.draw());
  }

  static async create(host: HTMLElement): Promise<RoadRenderer> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      background: COLORS.grass,
      antialias: true,
      preference: 'webgl',
      autoDensity: true,
      resolution: Math.min(2, globalThis.devicePixelRatio || 1),
    });
    app.canvas.setAttribute('data-testid', 'road-canvas');
    app.canvas.setAttribute('aria-label', 'Top-down road view');
    host.appendChild(app.canvas);
    // PixiJS `resizeTo` only follows window resizes; follow the container too.
    new ResizeObserver(() => app.resize()).observe(host);
    return new RoadRenderer(app);
  }

  push(snapshot: Snapshot): void {
    const prev = this.buffer.latest;
    if (prev && prev.scenarioId !== snapshot.scenarioId) this.labels.clear();
    this.buffer.push(snapshot, performance.now());
  }

  private draw(): void {
    const snap = this.buffer.latest;
    const now = performance.now();
    this.roadLayer.clear();
    this.overlayLayer.clear();
    this.vehicleLayer.clear();
    if (!snap) return;
    const egoPose = this.buffer.egoPose(now) ?? { s: snap.ego.s, y: snap.ego.lateral };
    const w = snap.road.laneWidthFt;
    const lowest = snap.road.rightShoulder ? 0 : 1;
    const cam = makeCamera(this.app.screen.width, this.app.screen.height, egoPose.s, {
      minY: (lowest - 1) * w - w / 2,
      maxY: (snap.road.travelLanes - 1) * w + w / 2,
    });
    drawRoad(this.roadLayer, cam, snap.road);
    drawBluePath(this.overlayLayer, cam, snap);
    drawZones(this.overlayLayer, cam, snap, egoPose.s, this.zoneLabels);
    drawHazards(this.vehicleLayer, cam, snap.hazards, w);
    const pose = (id: number) => this.buffer.vehiclePose(id, now);
    drawTraffic(this.vehicleLayer, cam, snap.traffic, pose);
    drawEgo(this.vehicleLayer, cam, egoPose);
    this.labels.update(cam, snap.traffic, pose);
  }

  destroy(): void {
    this.app.destroy(true);
  }
}
