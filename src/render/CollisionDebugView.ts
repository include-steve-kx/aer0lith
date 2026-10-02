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
import { WingPose } from '../flight/WingPose.ts';
import { createAircraftEdgeGeometry } from './createAircraftGeometry.ts';
import { PALETTE } from '../core/config.ts';

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
  private readonly aircraftGeometry;
  private readonly aircraftMarkers: Mesh[] = [];
  private readonly wings: WingPose;
  private wingRevision = -1;

  constructor(wings = new WingPose()) {
    this.wings = wings;
    this.aircraftGeometry = createAircraftEdgeGeometry(wings);
    const hull = new LineSegments(this.aircraftGeometry, this.hullMaterial);
    hull.renderOrder = 20;
    this.aircraft.add(hull);
    const markerGeometry = new IcosahedronGeometry(0.045, 0);
    for (let i = 0; i < wings.collisionProbes.length; i++) {
      const marker = new Mesh(markerGeometry, this.markerMaterial);
      marker.renderOrder = 21;
      this.aircraftMarkers.push(marker);
      this.aircraft.add(marker);
    }
    this.addShape(this.cockpit, new ConvexGeometry(COCKPIT_COLLISION_POINTS.map(p => new Vector3(...p))),
      COCKPIT_COLLISION_PROBES);
    this.group.add(this.aircraft, this.cockpit);
    this.setCockpitMode(false);
    this.group.visible = false;
    this.syncWings();
  }

  private addShape(group: Group, geometry: ConvexGeometry, probes: number[][]): void {
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

  syncWings(): void {
    if (this.wingRevision === this.wings.revision) return;
    this.wingRevision = this.wings.revision;
    this.aircraftGeometry.sync(this.wings);
    this.aircraftMarkers.forEach((marker, index) => marker.position.copy(this.wings.collisionProbes[index]));
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
