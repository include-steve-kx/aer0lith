import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Vector3 } from 'three';
import { WING_TIPS } from '../core/aircraftGeometry.ts';
import type { TrailSample } from './TrailView.ts';

const MAX_RINGS = 512;
const HEIGHT_SEGMENTS = 8;
const RING_SIZE = 2 * (HEIGHT_SEGMENTS + 1);
const ROOT_HEIGHT = Math.abs(WING_TIPS[1][1] - WING_TIPS[0][1]);

/** An extruded ribbon centered on the exact world-space wing trail samples. */
export class WakeSheetGeometry extends BufferGeometry {
  private readonly centerPoint = new Vector3();
  private readonly up = new Vector3();
  private readonly across = new Vector3();
  private readonly point = new Vector3();

  constructor() {
    super();
    for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['aDistance', 1]] as const) {
      this.setAttribute(name, new BufferAttribute(new Float32Array(MAX_RINGS * RING_SIZE * size), size)
        .setUsage(DynamicDrawUsage));
    }
    const indices: number[] = [];
    for (let ring = 0; ring < MAX_RINGS - 1; ring++) {
      for (let edge = 0; edge < RING_SIZE; edge++) {
        const a = ring * RING_SIZE + edge;
        const b = ring * RING_SIZE + (edge + 1) % RING_SIZE;
        indices.push(a, b, a + RING_SIZE, b, b + RING_SIZE, a + RING_SIZE);
      }
    }
    // End caps are invisible under the longitudinal fade; the top/bottom edges
    // above provide real thickness without a second material or render pass.
    this.setIndex(indices);
    this.setDrawRange(0, 0);
  }

  rebuild(samples: readonly TrailSample[], side: 'left' | 'right', origin: Vector3,
    length: number, height: number, thickness: number): void {
    const head = samples.at(-1);
    if (!head || samples.length < 2) { this.setDrawRange(0, 0); return; }
    let rings = 0;
    for (let i = samples.length - 1; i >= 0 && rings < MAX_RINGS; i--) {
      const sample = samples[i];
      const newer = samples[Math.min(i + 1, samples.length - 1)];
      const age = head.distance - sample.distance;
      const mix = age > length
        ? (age - length) / Math.max(0.0001, newer.distance - sample.distance) : 0;
      this.centerPoint.copy(sample[side]).lerp(newer[side], mix).sub(origin);
      this.up.copy(sample.up).lerp(newer.up, mix).normalize();
      this.point.subVectors(newer.right, newer.left).normalize();
      this.across.subVectors(sample.right, sample.left).normalize().lerp(this.point, mix).normalize();
      const distance = Math.min(age, length);
      const rootHeight = Math.min(height, ROOT_HEIGHT);
      const sheetHeight = rootHeight + (height - rootHeight) * Math.min(1, distance / 12);
      for (let vertex = 0; vertex < RING_SIZE; vertex++) {
        const front = vertex <= HEIGHT_SEGMENTS;
        const v = front ? vertex / HEIGHT_SEGMENTS : (RING_SIZE - 1 - vertex) / HEIGHT_SEGMENTS;
        this.point.copy(this.centerPoint).addScaledVector(this.up, (v - 0.5) * sheetHeight)
          .addScaledVector(this.across, (front ? 0.5 : -0.5) * thickness);
        const index = rings * RING_SIZE + vertex;
        this.attributes.position.setXYZ(index, this.point.x, this.point.y, this.point.z);
        // Deformation direction shared by both faces preserves the extrusion.
        this.attributes.normal.setXYZ(index, this.across.x, this.across.y, this.across.z);
        this.attributes.uv.setXY(index, v, distance / length);
        this.attributes.aDistance.setX(index, head.distance - distance);
      }
      rings++;
      if (age >= length) break;
    }
    for (const attribute of Object.values(this.attributes)) attribute.needsUpdate = true;
    this.setDrawRange(0, Math.max(0, rings - 1) * RING_SIZE * 6);
  }
}
