import { Camera, Euler, Quaternion, Vector3 } from 'three';

/** Temporary render-only camera offset: never accumulates in OrbitControls. */
export class BoostCameraShake {
  private blend = 0;
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly offset = new Vector3();
  private readonly euler = new Euler();
  private readonly shakeRotation = new Quaternion();
  strength = 0.65;
  frequency = 14;

  update(dt: number, boosting: boolean): void {
    this.blend += ((boosting ? 1 : 0) - this.blend) * (1 - Math.exp(-Math.max(0, dt) / 0.16));
  }

  apply(camera: Camera, time: number, speed: number): void {
    this.position.copy(camera.position); this.rotation.copy(camera.quaternion);
    const power = this.blend * this.strength * Math.min(1.5, 0.5 + speed / 120);
    const phase = time * this.frequency * Math.PI * 2;
    const x = Math.sin(phase) * 0.65 + Math.sin(phase * 1.73) * 0.35;
    const y = Math.sin(phase * 1.31 + 1.7);
    this.offset.set(x * 0.22, y * 0.16, 0).multiplyScalar(power).applyQuaternion(this.rotation);
    camera.position.add(this.offset);
    this.euler.set(y * 0.0064 * power, x * 0.0064 * power, Math.sin(phase * 0.83) * 0.004 * power);
    camera.quaternion.multiply(this.shakeRotation.setFromEuler(this.euler));
  }

  restore(camera: Camera): void {
    camera.position.copy(this.position); camera.quaternion.copy(this.rotation);
    camera.updateMatrixWorld();
  }
}
