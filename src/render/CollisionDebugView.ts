import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  WireframeGeometry,
} from 'three';
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

  constructor() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(COLLISION_PROBES.flat(), 3));
    geometry.setIndex([
      0, 1, 2,
      0, 3, 1,
      0, 2, 3,
      1, 3, 2,
    ]);
    const hull = new LineSegments(
      new WireframeGeometry(geometry),
      this.hullMaterial,
    );
    hull.renderOrder = 20;
    this.group.add(hull);

    const markerGeometry = new IcosahedronGeometry(0.24, 0);
    for (const probe of COLLISION_PROBES) {
      const marker = new Mesh(markerGeometry, this.markerMaterial);
      marker.position.set(probe[0], probe[1], probe[2]);
      marker.renderOrder = 21;
      this.group.add(marker);
    }
    this.group.visible = false;
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
