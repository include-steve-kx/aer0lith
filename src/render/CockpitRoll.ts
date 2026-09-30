import { Camera, Quaternion, Vector3 } from 'three';
import { COCKPIT_EYE } from '../core/aircraftGeometry.ts';

/** Apply the unwrapped maneuver after camera smoothing, then restore its base. */
export class CockpitRoll {
  private readonly position = new Vector3();
  private readonly orientation = new Quaternion();
  private readonly rotation = new Quaternion();
  private readonly axis = new Vector3(0, 0, 1);
  private readonly eye = new Vector3(...COCKPIT_EYE);
  private readonly offset = new Vector3();

  apply(camera: Camera, planeBase: Quaternion, angle: number): void {
    this.position.copy(camera.position);
    this.orientation.copy(camera.quaternion);
    this.rotation.setFromAxisAngle(this.axis, angle);
    this.offset.copy(this.eye).applyQuaternion(this.rotation).sub(this.eye).applyQuaternion(planeBase);
    camera.position.add(this.offset);
    // Camera forward is local -Z; the aircraft's forward is +Z.
    camera.quaternion.multiply(this.rotation.setFromAxisAngle(this.axis, -angle));
  }

  restore(camera: Camera): void {
    camera.position.copy(this.position);
    camera.quaternion.copy(this.orientation);
    camera.updateMatrixWorld();
  }
}
