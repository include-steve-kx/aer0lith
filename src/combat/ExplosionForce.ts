import type { Vector3 } from 'three';

/** One physical impulse at destruction; the caller combines simultaneous events. */
export function explosionImpulse(
  out: Vector3,
  ship: Vector3,
  center: Vector3,
  incomingDirection: Vector3,
  diameter: number,
  strength: number,
  radius: number,
): Vector3 {
  out.subVectors(ship, center);
  const distance = out.length();
  const d = Math.min(1, distance / radius);
  if (distance < 1e-8) out.copy(incomingDirection).negate();
  else out.divideScalar(distance);
  return out.multiplyScalar(
    strength * (1 - d * d * (3 - 2 * d)) * Math.max(0.5, Math.min(1.5, diameter / 12)),
  );
}
