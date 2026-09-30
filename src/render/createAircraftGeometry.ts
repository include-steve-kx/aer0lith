import { Vector3 } from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AIRCRAFT_PARTS } from '../core/aircraftGeometry.ts';

export function createAircraftGeometry() {
  const parts = AIRCRAFT_PARTS.map(points => new ConvexGeometry(points.map(p => new Vector3(...p))));
  const geometry = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  return geometry;
}
