import { Camera, Euler, Quaternion, Vector3 } from 'three';

/** Temporary render-only camera offset: never accumulates in OrbitControls. */
export class BoostCameraShake {
  private blend = 0;
  private phase = 0;
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly identity = new Quaternion();
  private readonly offset = new Vector3();
  private readonly euler = new Euler();
  private readonly shakeRotation = new Quaternion();
  strength = 0.65;
  frequency = 14;

  get activeFrequency(): number { return this.strength > 0 ? this.frequency * this.blend : 0; }

  /** Use the independent boost shake envelope, which ends even during held boost. */
  update(dt: number, shakeIntensity: number): void {
    this.blend = Math.max(0, Math.min(1, shakeIntensity));
    // Integrate frequency so fading or editing it never jumps the phase.
    this.phase += Math.max(0, dt) * this.activeFrequency * Math.PI * 2;
  }

  apply(camera: Camera, speed: number, explosionPosition?: Vector3, explosionRotation?: Vector3): void {
    this.position.copy(camera.position); this.rotation.copy(camera.quaternion);

    const power = this.blend * this.strength * Math.min(1.5, 0.5 + speed / 120);
    const phase = this.phase;
    const x = Math.sin(phase) * 0.65 + Math.sin(phase * 1.73) * 0.35;
    const y = Math.sin(phase * 1.31 + 1.7);
    this.offset.set(x * 0.22, y * 0.16, 0).multiplyScalar(power);
    if (explosionPosition) this.offset.add(explosionPosition);
    this.offset.clampLength(0, .45).applyQuaternion(this.rotation);
    camera.position.add(this.offset);
    this.euler.set(y * 0.0064 * power, x * 0.0064 * power, Math.sin(phase * 0.83) * 0.004 * power);
    if (explosionRotation) { this.euler.x += explosionRotation.x; this.euler.y += explosionRotation.y; this.euler.z += explosionRotation.z; }
    this.shakeRotation.setFromEuler(this.euler);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(this.shakeRotation.w)));
    if (angle > Math.PI / 180) this.shakeRotation.slerp(this.identity, 1 - (Math.PI / 180) / angle);
    camera.quaternion.multiply(this.shakeRotation);
    camera.updateMatrixWorld();
  }

  restore(camera: Camera): void {
    camera.position.copy(this.position); camera.quaternion.copy(this.rotation);
    camera.updateMatrixWorld();
  }
}
