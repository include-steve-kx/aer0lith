export interface FlightTuningSettings {
  pitchRate: number;
  rollRate: number;
  yawRate: number;
  bankYawRate: number;
  pitchAutoLevel: number;
  rollAutoLevel: number;
  normalGrip: number;
  driftGrip: number;
  normalAcceleration: number;
  collisionRestitution: number;
  collisionFriction: number;
  collisionSeparationSpeed: number;
  impactFlashDuration: number;
  collisionSparksEnabled: boolean;
  collisionSparkAmount: number;
  collisionSparkColor: string;
  collisionSparkThickness: number;
  collisionSparkLength: number;
  collisionSparkSpeed: number;
  collisionSparkLifetime: number;
  collisionSparkSpread: number;
  driftMinAngle: number;
  driftFullAngle: number;
  driftMaxAngle: number;
  driftChargeRate: number;
  driftSpeedInfluence: number;
  driftGraceTime: number;
  driftPassiveDecay: number;
  driftTierTwo: number;
  driftTierThree: number;
  driftTierHysteresis: number;
  driftBoostSpeedOne: number;
  driftBoostSpeedTwo: number;
  driftBoostSpeedThree: number;
  driftBoostAccelerationOne: number;
  driftBoostAccelerationTwo: number;
  driftBoostAccelerationThree: number;
  driftBoostKickOne: number;
  driftBoostKickTwo: number;
  driftBoostKickThree: number;
  driftBoostDrainOne: number;
  driftBoostDrainTwo: number;
  driftBoostDrainThree: number;
  driftBoostNoseBias: number;
  cameraPositionResponse: number;
  cameraHeadingResponse: number;
  cameraRecoveryResponse: number;
  cameraTravelInfluence: number;
  cameraBankResponse: number;
  cameraMaxLag: number;
  driftCueEnabled: boolean;
  driftCueSize: number;
  driftCueOpacity: number;
  driftMeterEnabled: boolean;
  driftMeterArcLength: number;
  driftMeterRadialThickness: number;
  driftTrailResponse: number;
  driftTrailEnabled: boolean;
  driftTrailRate: number;
  driftTrailSize: number;
  driftTrailLifetime: number;
  driftTrailOpacity: number;
  driftTrailTurbulence: number;
  driftTrailColor: string;
  driftTierPulse: boolean;
  driftShakeStrength: number;
  navigationArrowEnabled: boolean;
  navigationArrowScale: number;
  navigationArrowHeadStyle: 'wire' | 'solid';
  navigationArrowHeadLength: number;
  navigationArrowHeadWidth: number;
  navigationArrowBodyLength: number;
  navigationArrowLineThickness: number;
  navigationLookAhead: number;
  navigationArrowColor: string;
  wrongWayEnabled: boolean;
  wrongWayDelay: number;
  routeHorizontalTurns: number;
  routeVerticalTurns: number;
  routeClearance: number;
  touchDeadZone: number;
  touchResponseCurve: number;
  touchPrimaryScale: number;
}

export interface TerrainGenerationSettings {
  routeHorizontalTurns: number;
  routeVerticalTurns: number;
  routeClearance: number;
}

export const DEFAULT_TERRAIN_GENERATION: TerrainGenerationSettings = {
  routeHorizontalTurns: 0.85,
  routeVerticalTurns: 0.85,
  routeClearance: 1.1,
};

export const DEFAULT_FLIGHT_TUNING: FlightTuningSettings = {
  pitchRate: 0.75,
  rollRate: 1.5,
  yawRate: 0.6,
  bankYawRate: 0.6,
  pitchAutoLevel: 0.12,
  rollAutoLevel: 0.42,
  normalGrip: 3.5,
  driftGrip: 0.35,
  normalAcceleration: 15,
  collisionRestitution: 0.18,
  collisionFriction: 0.6,
  collisionSeparationSpeed: 2,
  impactFlashDuration: 0.65,
  collisionSparksEnabled: true,
  collisionSparkAmount: 3,
  collisionSparkColor: '#ffffff',
  collisionSparkThickness: 0.15,
  collisionSparkLength: 4,
  collisionSparkSpeed: 50,
  collisionSparkLifetime: 0.8,
  collisionSparkSpread: 1,
  driftMinAngle: 6,
  driftFullAngle: 45,
  driftMaxAngle: 75,
  driftChargeRate: 100,
  driftSpeedInfluence: 1,
  driftGraceTime: 0.35,
  driftPassiveDecay: 16,
  driftTierTwo: 35,
  driftTierThree: 70,
  driftTierHysteresis: 2,
  driftBoostSpeedOne: 135,
  driftBoostSpeedTwo: 155,
  driftBoostSpeedThree: 180,
  driftBoostAccelerationOne: 24,
  driftBoostAccelerationTwo: 34,
  driftBoostAccelerationThree: 45,
  driftBoostKickOne: 4,
  driftBoostKickTwo: 7,
  driftBoostKickThree: 10,
  driftBoostDrainOne: 30,
  driftBoostDrainTwo: 36,
  driftBoostDrainThree: 44,
  driftBoostNoseBias: 0.85,
  cameraPositionResponse: 0.07,
  cameraHeadingResponse: 0.1,
  cameraRecoveryResponse: 0.1,
  cameraTravelInfluence: 0.8,
  cameraBankResponse: 0.1,
  cameraMaxLag: 24,
  driftCueEnabled: true,
  driftCueSize: 34,
  driftCueOpacity: 0.7,
  driftMeterEnabled: true,
  driftMeterArcLength: 32,
  driftMeterRadialThickness: 1.5,
  driftTrailResponse: 1,
  driftTrailEnabled: true,
  driftTrailRate: 64,
  driftTrailSize: 10,
  driftTrailLifetime: 2,
  driftTrailOpacity: 0.55,
  driftTrailTurbulence: 6,
  driftTrailColor: '#c8c8c8',
  driftTierPulse: true,
  driftShakeStrength: 0.45,
  navigationArrowEnabled: true,
  navigationArrowScale: 1,
  navigationArrowHeadStyle: 'wire',
  navigationArrowHeadLength: 7,
  navigationArrowHeadWidth: 12,
  navigationArrowBodyLength: 22,
  navigationArrowLineThickness: 1,
  navigationLookAhead: 160,
  navigationArrowColor: '#ffffff',
  wrongWayEnabled: true,
  wrongWayDelay: 0.75,
  ...DEFAULT_TERRAIN_GENERATION,
  touchDeadZone: 0.08,
  touchResponseCurve: 1,
  touchPrimaryScale: 1,
};

function bounded(value: number, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function color(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function sanitizeFlightTuning(
  settings: FlightTuningSettings,
): FlightTuningSettings {
  const next = { ...settings };
  next.driftFullAngle = Math.max(next.driftMinAngle + 1, next.driftFullAngle);
  next.driftMaxAngle = Math.max(next.driftFullAngle, next.driftMaxAngle);
  next.driftTierTwo = Math.min(98, Math.max(1, next.driftTierTwo));
  next.driftTierThree = Math.min(99, Math.max(next.driftTierTwo + 1, next.driftTierThree));
  next.driftBoostSpeedTwo = Math.max(next.driftBoostSpeedOne, next.driftBoostSpeedTwo);
  next.driftBoostSpeedThree = Math.max(next.driftBoostSpeedTwo, next.driftBoostSpeedThree);
  next.collisionRestitution = bounded(next.collisionRestitution, DEFAULT_FLIGHT_TUNING.collisionRestitution, 0, 0.8);
  next.collisionFriction = bounded(next.collisionFriction, DEFAULT_FLIGHT_TUNING.collisionFriction, 0, 2);
  next.collisionSeparationSpeed = bounded(next.collisionSeparationSpeed, DEFAULT_FLIGHT_TUNING.collisionSeparationSpeed, 0, 12);
  next.impactFlashDuration = bounded(next.impactFlashDuration, DEFAULT_FLIGHT_TUNING.impactFlashDuration, 0.1, 2);
  next.collisionSparkAmount = bounded(next.collisionSparkAmount, DEFAULT_FLIGHT_TUNING.collisionSparkAmount, 0, 6);
  next.collisionSparkThickness = bounded(next.collisionSparkThickness, DEFAULT_FLIGHT_TUNING.collisionSparkThickness, 0.01, 0.3);
  next.collisionSparkLength = bounded(next.collisionSparkLength, DEFAULT_FLIGHT_TUNING.collisionSparkLength, 0.2, 8);
  next.collisionSparkSpeed = bounded(next.collisionSparkSpeed, DEFAULT_FLIGHT_TUNING.collisionSparkSpeed, 5, 100);
  next.collisionSparkLifetime = bounded(next.collisionSparkLifetime, DEFAULT_FLIGHT_TUNING.collisionSparkLifetime, 0.05, 1.6);
  next.collisionSparkSpread = bounded(next.collisionSparkSpread, DEFAULT_FLIGHT_TUNING.collisionSparkSpread, 0, 2);
  next.collisionSparkColor = color(next.collisionSparkColor, DEFAULT_FLIGHT_TUNING.collisionSparkColor);
  next.driftMeterArcLength = bounded(next.driftMeterArcLength, DEFAULT_FLIGHT_TUNING.driftMeterArcLength, 12, 64);
  next.driftMeterRadialThickness = bounded(next.driftMeterRadialThickness, DEFAULT_FLIGHT_TUNING.driftMeterRadialThickness, 0.5, 5);
  next.navigationArrowScale = bounded(next.navigationArrowScale, DEFAULT_FLIGHT_TUNING.navigationArrowScale, 0.6, 9);
  next.navigationArrowHeadStyle = next.navigationArrowHeadStyle === 'solid' ? 'solid' : 'wire';
  next.navigationArrowHeadLength = bounded(next.navigationArrowHeadLength, DEFAULT_FLIGHT_TUNING.navigationArrowHeadLength, 3, 90);
  next.navigationArrowHeadWidth = bounded(next.navigationArrowHeadWidth, DEFAULT_FLIGHT_TUNING.navigationArrowHeadWidth, 6, 120);
  next.navigationArrowBodyLength = bounded(next.navigationArrowBodyLength, DEFAULT_FLIGHT_TUNING.navigationArrowBodyLength, 10, 210);
  next.navigationArrowHeadLength = Math.min(next.navigationArrowHeadLength, next.navigationArrowBodyLength - 2);
  next.navigationArrowLineThickness = bounded(next.navigationArrowLineThickness, DEFAULT_FLIGHT_TUNING.navigationArrowLineThickness, 0.5, 15);
  next.navigationLookAhead = bounded(next.navigationLookAhead, DEFAULT_FLIGHT_TUNING.navigationLookAhead, 80, 400);
  next.navigationArrowColor = color(next.navigationArrowColor, DEFAULT_FLIGHT_TUNING.navigationArrowColor);
  next.wrongWayDelay = bounded(next.wrongWayDelay, DEFAULT_FLIGHT_TUNING.wrongWayDelay, 0.25, 2);
  next.routeHorizontalTurns = bounded(next.routeHorizontalTurns, DEFAULT_FLIGHT_TUNING.routeHorizontalTurns, 0.5, 1.5);
  next.routeVerticalTurns = bounded(next.routeVerticalTurns, DEFAULT_FLIGHT_TUNING.routeVerticalTurns, 0.5, 1.5);
  next.routeClearance = bounded(next.routeClearance, DEFAULT_FLIGHT_TUNING.routeClearance, 0.75, 1.5);
  return next;
}
