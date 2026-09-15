import {
  BufferGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  DoubleSide,
  Color,
} from 'three';
import { PALETTE } from '../core/config.ts';

function createAircraftGeometry(): BufferGeometry {
  const vertices = new Float32Array([
    0, 0.15, 6.3,
    -0.65, -0.3, 1.8,
    0.65, -0.3, 1.8,
    0, 0.9, 1.4,
    -0.55, -0.2, -4.2,
    0.55, -0.2, -4.2,
    0, 0.45, -4.4,
    -6.2, -0.12, -1.0,
    6.2, -0.12, -1.0,
    -1.25, -0.1, -3.6,
    1.25, -0.1, -3.6,
    0, 2.0, -3.3,
  ]);
  const indices = [
    0, 1, 3, 0, 3, 2, 0, 2, 1,
    1, 4, 3, 3, 4, 6, 3, 6, 5, 3, 5, 2,
    4, 5, 6, 1, 2, 5, 1, 5, 4,
    0, 7, 1, 0, 2, 8, 1, 7, 9, 1, 9, 4,
    2, 10, 8, 2, 5, 10, 7, 8, 9, 8, 10, 9,
    4, 11, 6, 4, 9, 11, 9, 10, 11, 10, 5, 11,
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export class AircraftView {
  readonly group = new Group();
  private readonly body: Mesh;
  private readonly bodyMaterial: MeshStandardMaterial;
  private readonly edgeMaterial: LineBasicMaterial;

  constructor() {
    const geometry = createAircraftGeometry();
    this.bodyMaterial = new MeshStandardMaterial({
      color: PALETTE.plane,
      roughness: 0.76,
      metalness: 0.38,
      flatShading: true,
      side: DoubleSide,
    });
    this.body = new Mesh(geometry, this.bodyMaterial);
    this.edgeMaterial = new LineBasicMaterial({
      color: PALETTE.offWhite,
      transparent: true,
      opacity: 0.3,
    });
    const edges = new LineSegments(
      new EdgesGeometry(geometry, 18),
      this.edgeMaterial,
    );
    this.group.add(this.body, edges);
  }

  setColor(value: string): void {
    const color = new Color(value);
    this.bodyMaterial.color.copy(color);
    this.edgeMaterial.color.copy(color).lerp(new Color(PALETTE.offWhite), 0.42);
  }

  setCockpitMode(active: boolean): void {
    this.body.visible = !active;
    for (const child of this.group.children) child.visible = !active;
  }
}
