/** Shared model-space dimensions; +Z is forward. Keep attachments inside the hull. */
export type AircraftPoint = [number, number, number];
export const HULL_REAR: AircraftPoint[] = [
  [0, 0.8, -3.6], [1.25, 0, -3.6], [0, -0.55, -3.6], [-1.25, 0, -3.6],
];
export const HULL_POINTS: AircraftPoint[] = [...HULL_REAR, [0, 0.05, 6.3]];
export const WING_PARTS: AircraftPoint[][] = [-1, 1].flatMap(side => [-1, 1].map(tier =>
  ([
    [0.28, 0.05, 1.35], [0.35, 0.08, -3.4],
    [6, 1.9, -2.9], [1.8, 0.9, -1.6],
  ] as AircraftPoint[]).map(([x, y, z]): AircraftPoint => [x * side, y * tier, z]),
));
export const AIRCRAFT_PARTS = [HULL_POINTS, ...WING_PARTS];
export const WING_TIPS = WING_PARTS.map(points => points[2]);
export const PULSE_MUZZLE: AircraftPoint = [0, 0.05, 6.3];
export const TRAIL_ANCHORS = WING_TIPS.map(([x, y, z]): AircraftPoint => [x, y, z - 0.06]);

// The hidden wings are difficult to judge from the cockpit. Use a compact,
// faceted volume centered on the eye, aligned with the stable camera attitude.
export const COCKPIT_EYE: AircraftPoint = [0, 0.72, 2.4];
export const COCKPIT_COLLISION_POINTS: AircraftPoint[] = [
  [0, 0.72, -0.4], [0, 0.72, 5.2],
  ...[Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4].flatMap(phi =>
    Array.from({ length: 8 }, (_, i): AircraftPoint => {
      const theta = i * Math.PI / 4;
      return [1.5 * Math.sin(phi) * Math.cos(theta),
        0.72 + 1.1 * Math.sin(phi) * Math.sin(theta), 2.4 + 2.8 * Math.cos(phi)];
    })),
];
export const COCKPIT_COLLISION_PROBES: AircraftPoint[] = [...COCKPIT_COLLISION_POINTS, COCKPIT_EYE];

// Sample each individual convex part, not a hull spanning the empty spaces
// between wings. Vertices cover the extremities; midpoints cover long edges.
export const AIRCRAFT_COLLISION_PROBES: AircraftPoint[] = AIRCRAFT_PARTS.flatMap(part => {
  const points = part.map(p => [...p] as AircraftPoint);
  for (let i = 0; i < part.length; i++) {
    for (let j = i + 1; j < part.length; j++) {
      points.push(part[i].map((v, axis) => (v + part[j][axis]) * 0.5) as AircraftPoint);
    }
  }
  points.push([0, 1, 2].map(axis => part.reduce((sum, p) => sum + p[axis], 0) / part.length) as AircraftPoint);
  return points;
});
