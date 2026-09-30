import {
  Group,
  Vector3,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  WireframeGeometry,
} from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { COCKPIT_COLLISION_POINTS, COCKPIT_COLLISION_PROBES } from '../core/aircraftGeometry.ts';
import { createAircraftGeometry } from './createAircraftGeometry.ts';
import { COLLISION_PROBES, PALETTE } from '../core/config.ts';

export class CollisionDebugView {
  readonly group = new Group();
  private readonly hullMaterial = new LineBasicMaterial({
    color: PALETTE.collision,
    transparent: true,
    opacity: 0.88,
    depthTest: false,
    depthWrite: false,
  });
  private readonly markerMaterial = new MeshBasicMaterial({
    color: PALETTE.collision,
    wireframe: true,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  });
  private colliding = false;
  private readonly aircraft = new Group();
  private readonly cockpit = new Group();

  constructor() {
    this.addShape(this.aircraft, createAircraftGeometry(), COLLISION_PROBES);
    this.addShape(this.cockpit, new ConvexGeometry(COCKPIT_COLLISION_POINTS.map(p => new Vector3(...p))),
      COCKPIT_COLLISION_PROBES);
    this.group.add(this.aircraft, this.cockpit);
    this.setCockpitMode(false);
    this.group.visible = false;
  }

  private addShape(group: Group, geometry: ReturnType<typeof createAircraftGeometry>, probes: number[][]): void {
    const hull = new LineSegments(new WireframeGeometry(geometry), this.hullMaterial);
    geometry.dispose();
    hull.renderOrder = 20;
    group.add(hull);
    const markerGeometry = new IcosahedronGeometry(0.045, 0);
    for (const probe of probes) {
      const marker = new Mesh(markerGeometry, this.markerMaterial);
      marker.position.set(probe[0], probe[1], probe[2]);
      marker.renderOrder = 21;
      group.add(marker);
    }
  }

  setCockpitMode(active: boolean): void {
    this.aircraft.visible = !active;
    this.cockpit.visible = active;
  }

  setColliding(active: boolean): void {
    if (active === this.colliding) return;
    this.colliding = active;
    const color = active ? PALETTE.alertRed : PALETTE.collision;
    this.hullMaterial.color.setHex(color);
    this.markerMaterial.color.setHex(color);
  }

  get colorHex(): number {
    return this.hullMaterial.color.getHex();
  }
}
