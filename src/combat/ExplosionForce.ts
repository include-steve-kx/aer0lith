import type { Vector3 } from 'three';

/** One physical impulse at destruction; the caller combines simultaneous events. */
export function explosionImpulse(
  out: Vector3,
  ship: Vector3,
  center: Vector3,
  shipVelocity: Vector3,
  fallbackDirection: Vector3,
  diameter: number,
  strength: number,
  radius: number,
  velocityAxisFactor: number,
): Vector3 {
  out.subVectors(ship, center);
  const distance = out.length();
  const d = Math.min(1, distance / radius);
  if (distance < 1e-8) out.copy(fallbackDirection).negate();
  else out.divideScalar(distance);
  out.multiplyScalar(
    strength * (1 - d * d * (3 - 2 * d)) * Math.max(0.5, Math.min(1.5, diameter / 12)),
  );
  const velocityLengthSq = shipVelocity.lengthSq();
  if (velocityLengthSq > 1e-8) {
    const projection = out.dot(shipVelocity) / velocityLengthSq;
    out.addScaledVector(shipVelocity, projection * (velocityAxisFactor - 1));
  } else {
    const fallbackLengthSq = fallbackDirection.lengthSq();
    if (fallbackLengthSq > 1e-8) {
      const projection = out.dot(fallbackDirection) / fallbackLengthSq;
      out.addScaledVector(fallbackDirection, projection * (velocityAxisFactor - 1));
    }
  }
  return out;
}
