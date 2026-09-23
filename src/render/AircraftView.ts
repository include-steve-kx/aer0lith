import { Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../core/config.ts';

type Point = [number, number, number];

export class AircraftView {
  readonly group = new Group();
  private readonly bodyMaterial = new MeshStandardMaterial({
    color: PALETTE.plane, roughness: 0.78, metalness: 0.12, flatShading: true,
  });

  constructor() {
    this.group.name = 'Lance / minimal X-wing';
    const hull = (points: Point[]): ConvexGeometry =>
      new ConvexGeometry(points.map(p => new Vector3(...p)));
    // A diamond cross-section and a single pointed nose. +Z is forward.
    const parts = [hull([
      [0, 0.8, -3.6], [1.25, 0, -3.6], [0, -0.55, -3.6], [-1.25, 0, -3.6],
      [0, 0.05, 6.3],
    ])];
    // Each blade is one tetrahedron: four flat faces and no separate trim,
    // engine pods, canopy, outlines, or emissive accents.
    for (const side of [-1, 1]) {
      for (const tier of [-1, 1]) {
        parts.push(hull(([
          [0.75, 0.15, 1.0], [0.75, 0.15, -3.4],
          [6.0, 1.9, -2.9], [1.8, 0.9, -1.6],
        ] as Point[]).map(([x, y, z]) => [x * side, y * tier, z])));
      }
    }
    const geometry = mergeGeometries(parts)!;
    parts.forEach(part => part.dispose());
    const mesh = new Mesh(geometry, this.bodyMaterial);
    mesh.name = 'monochrome hull and four blades';
    this.group.add(mesh);
  }

  setColor(value: string): void {
    this.bodyMaterial.color.set(value);
  }

  setCockpitMode(active: boolean): void {
    this.group.visible = !active;
  }
}
