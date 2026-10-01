import { AIRCRAFT_COLLISION_PROBES } from './aircraftGeometry.ts';

export const PALETTE = {
  background: 0x050708,
  sky: 0x101314,
  graphite: 0x151c1d,
  graphiteLight: 0x263032,
  offWhite: 0xd7ded7,
  cyan: 0x82aaa3,
  orange: 0xc88155,
  gold: 0xffee66,
  collision: 0xffe66d,
  alertRed: 0xff0000,
  terrainPoints: 0xc8c8c8,
  plane: 0xe6e6e6,
  magenta: 0xf92672,
  fog: 0x0a1112,
} as const;

export const TERRAIN = {
  /** Cubic density-field chunk dimensions, in metres. */
  chunkSize: 128,
  segments: 10,
  columns: 5,
  rows: 7,
  rowsBehind: 2,
  verticalLayers: 3,
  rebaseDistance: 2048,
} as const;

export const PROBE = {
  minInterval: 10,
  maxInterval: 30,
  speed: 300,
  maxRadius: 720,
  afterglowDuration: 5,
  lineWidth: 1.6,
  influenceWidth: 12,
  lift: 3.2,
  color: 0x8bdcff,
} as const;

export const FLIGHT = {
  fixedStep: 1 / 120,
  maxSubsteps: 5,
  minSpeed: 30,
  maxSpeed: 120,
  // Bound accumulated blasts independently of engine speed and default push strength.
  maxExternalSpeed: 180,
  nominalSpeed: 90,
  targetClearance: 44,
  safeClearance: 30,
  crashFreeze: 0.25,
  crashDuration: 0.65,
  checkpointInterval: 0.5,
} as const;

export const COLLISION_PROBES = AIRCRAFT_COLLISION_PROBES;

// Small visual penetrations are tolerated because the terrain is presented as
// discrete samples rather than an opaque surface.
export const COLLISION_TOLERANCE = -0.12;
export const COLLISION_CONFIRM_TIME = 0.04;
export const COLLISION_DEEP_PENETRATION = 0.9;

export const CAMERA = {
  transitionTime: 0.45,
  chaseFov: 58,
  cockpitFov: 70,
  farChaseFov: 52,
  throttleFovBoost: {
    cockpit: 24,
    chase: 28,
    'far-chase': 24,
  },
  throttleRiseTime: 0.18,
  throttleFallTime: 0.5,
  fovResponseTime: 0.16,
} as const;

export const WIND = {
  maxLineCount: 240,
  defaultLineCount: 120,
  behindDistance: 305,
  aheadDistance: 225,
  lateralRadius: 150,
  verticalRadius: 92,
  ribbonWidth: 0.075,
  frameResponseTime: 0.9,
  spawnFadeTime: 0.45,
} as const;

export const FLOCK = {
  maxFlocks: 3,
  maxBirdsPerFlock: 32,
  defaultMinBirdsPerFlock: 10,
  defaultMaxBirdsPerFlock: 26,
  defaultInterval: 8,
  defaultSpread: 30,
  defaultSpeed: 34,
  initialDelay: 4,
  minLifetime: 16,
  maxLifetime: 24,
  spawnDistanceMin: 260,
  spawnDistanceMax: 430,
  neighborRadius: 34,
  separationRadius: 7,
  planeAvoidanceRadius: 54,
  terrainAwarenessDistance: 20,
} as const;
