import { Group, Mesh, MeshStandardMaterial } from 'three';
import { createAircraftGeometry } from './createAircraftGeometry.ts';
import { PALETTE } from '../core/config.ts';

export class AircraftView {
  readonly group = new Group();
  private readonly bodyMaterial = new MeshStandardMaterial({
    color: PALETTE.plane, roughness: 0.78, metalness: 0.12, flatShading: true,
  });

  constructor() {
    this.group.name = 'Lance / minimal X-wing';
    const geometry = createAircraftGeometry();
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
