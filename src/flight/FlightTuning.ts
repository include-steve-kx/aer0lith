export type SlipCurvePreset = 's-curve' | 'linear' | 'early-plateau' | 'custom';

export interface FlightTuningSettings {
  pitchRate: number;
  rollRate: number;
  yawRate: number;
  bankYawRate: number;
  pitchAutoLevel: number;
  rollAutoLevel: number;
  normalGrip: number;
  hardTurnGrip: number;
  turnSlipStartRate: number;
  turnSlipFullRate: number;
  gripEngageResponse: number;
  gripRecoveryResponse: number;
  normalAcceleration: number;
  normalTopSpeed: number;
  normalBoostTopSpeed: number;
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
  slipStartSpeed: number;
  slipFullSpeed: number;
  slipCurvePreset: SlipCurvePreset;
  slipCurveX1: number;
  slipCurveY1: number;
  slipCurveX2: number;
  slipCurveY2: number;
  slipChargeRate: number;
  slipCollisionSuppressTime: number;
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
  driftBoostColorOne: string;
  driftBoostColorTwo: string;
  driftBoostColorThree: string;
  driftBoostNoseBias: number;
  boostRepressWindow: number;
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
  slipVisualAttack: number;
  slipVisualRelease: number;
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
  terrainAheadDistance: number;
  terrainCrystalClusterScale: number;
  touchDeadZone: number;
  touchResponseCurve: number;
  touchPrimaryScale: number;
}

export interface TerrainGenerationSettings {
  routeHorizontalTurns: number;
  routeVerticalTurns: number;
  routeClearance: number;
  terrainAheadDistance: number;
  terrainCrystalClusterScale: number;
}

export const DEFAULT_TERRAIN_GENERATION: TerrainGenerationSettings = {
  routeHorizontalTurns: 0.85,
  routeVerticalTurns: 0.85,
  routeClearance: 1.1,
  terrainAheadDistance: 1280,
  terrainCrystalClusterScale: 1.8,
};

export const DEFAULT_FLIGHT_TUNING: FlightTuningSettings = {
  pitchRate: 1,
  rollRate: 1.5,
  yawRate: 0.6,
  bankYawRate: 0.6,
  pitchAutoLevel: 0.12,
  rollAutoLevel: 0.42,
  normalGrip: 3.5,
  hardTurnGrip: 1.25,
  turnSlipStartRate: 0.15,
  turnSlipFullRate: 0.75,
  gripEngageResponse: 0.18,
  gripRecoveryResponse: 0.3,
  normalAcceleration: 40,
  normalTopSpeed: 130,
  normalBoostTopSpeed: 200,
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
  slipStartSpeed: 12,
  slipFullSpeed: 90,
  slipCurvePreset: 's-curve',
  slipCurveX1: 1 / 3,
  slipCurveY1: 0,
  slipCurveX2: 2 / 3,
  slipCurveY2: 1,
  slipChargeRate: 20,
  slipCollisionSuppressTime: 0.35,
  driftGraceTime: 0.35,
  driftPassiveDecay: 16,
  driftTierTwo: 35,
  driftTierThree: 70,
  driftTierHysteresis: 2,
  driftBoostSpeedOne: 200,
  driftBoostSpeedTwo: 200,
  driftBoostSpeedThree: 200,
  driftBoostAccelerationOne: 24,
  driftBoostAccelerationTwo: 34,
  driftBoostAccelerationThree: 45,
  driftBoostKickOne: 4,
  driftBoostKickTwo: 7,
  driftBoostKickThree: 10,
  driftBoostDrainOne: 30,
  driftBoostDrainTwo: 36,
  driftBoostDrainThree: 44,
  driftBoostColorOne: '#59d8ff',
  driftBoostColorTwo: '#ffad42',
  driftBoostColorThree: '#ff4fc3',
  driftBoostNoseBias: 0.85,
  boostRepressWindow: 0.15,
  cameraPositionResponse: 0.07,
  cameraHeadingResponse: 0.1,
  cameraRecoveryResponse: 0.1,
  cameraTravelInfluence: 0.8,
  cameraBankResponse: 0.1,
  cameraMaxLag: 24,
  driftCueEnabled: true,
  driftCueSize: 72,
  driftCueOpacity: 0.7,
  driftMeterEnabled: true,
  driftMeterArcLength: 20,
  driftMeterRadialThickness: 0.5,
  driftTrailResponse: 1,
  slipVisualAttack: 0.12,
  slipVisualRelease: 0.3,
  driftTrailEnabled: true,
  driftTrailRate: 64,
  driftTrailSize: 10,
  driftTrailLifetime: 2,
  driftTrailOpacity: 0.55,
  driftTrailTurbulence: 6,
  driftTrailColor: '#c8c8c8',
  driftTierPulse: true,
  driftShakeStrength: 0.5,
  navigationArrowEnabled: true,
  navigationArrowScale: 1,
  navigationArrowHeadStyle: 'wire',
  navigationArrowHeadLength: 90,
  navigationArrowHeadWidth: 20,
  navigationArrowBodyLength: 210,
  navigationArrowLineThickness: 2,
  navigationLookAhead: 400,
  navigationArrowColor: '#ffffff',
  wrongWayEnabled: true,
  wrongWayDelay: 1,
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
  next.normalGrip = bounded(next.normalGrip, DEFAULT_FLIGHT_TUNING.normalGrip, 0, 12);
  next.normalTopSpeed = bounded(next.normalTopSpeed, DEFAULT_FLIGHT_TUNING.normalTopSpeed, 40, 260);
  next.normalBoostTopSpeed = bounded(
    next.normalBoostTopSpeed,
    DEFAULT_FLIGHT_TUNING.normalBoostTopSpeed,
    next.normalTopSpeed,
    320,
  );
  next.hardTurnGrip = bounded(next.hardTurnGrip, DEFAULT_FLIGHT_TUNING.hardTurnGrip, 0.25, next.normalGrip);
  next.turnSlipStartRate = bounded(next.turnSlipStartRate, DEFAULT_FLIGHT_TUNING.turnSlipStartRate, 0, 2);
  next.turnSlipFullRate = bounded(next.turnSlipFullRate, DEFAULT_FLIGHT_TUNING.turnSlipFullRate, next.turnSlipStartRate + 0.01, 4);
  next.gripEngageResponse = bounded(next.gripEngageResponse, DEFAULT_FLIGHT_TUNING.gripEngageResponse, 0.02, 2);
  next.gripRecoveryResponse = bounded(next.gripRecoveryResponse, DEFAULT_FLIGHT_TUNING.gripRecoveryResponse, 0.02, 3);
  next.slipStartSpeed = bounded(next.slipStartSpeed, DEFAULT_FLIGHT_TUNING.slipStartSpeed, 0, 100);
  next.slipFullSpeed = bounded(next.slipFullSpeed, DEFAULT_FLIGHT_TUNING.slipFullSpeed, next.slipStartSpeed + 5, 260);
  next.slipCurvePreset = ['s-curve', 'linear', 'early-plateau', 'custom'].includes(next.slipCurvePreset)
    ? next.slipCurvePreset : DEFAULT_FLIGHT_TUNING.slipCurvePreset;
  next.slipCurveX1 = bounded(next.slipCurveX1, DEFAULT_FLIGHT_TUNING.slipCurveX1, 0, 1);
  next.slipCurveX2 = bounded(next.slipCurveX2, DEFAULT_FLIGHT_TUNING.slipCurveX2, next.slipCurveX1, 1);
  next.slipCurveY1 = bounded(next.slipCurveY1, DEFAULT_FLIGHT_TUNING.slipCurveY1, 0, 1);
  next.slipCurveY2 = bounded(next.slipCurveY2, DEFAULT_FLIGHT_TUNING.slipCurveY2, next.slipCurveY1, 1);
  next.slipChargeRate = bounded(next.slipChargeRate, DEFAULT_FLIGHT_TUNING.slipChargeRate, 1, 80);
  next.slipCollisionSuppressTime = bounded(next.slipCollisionSuppressTime, DEFAULT_FLIGHT_TUNING.slipCollisionSuppressTime, 0, 2);
  next.driftTierTwo = Math.min(98, Math.max(1, next.driftTierTwo));
  next.driftTierThree = Math.min(99, Math.max(next.driftTierTwo + 1, next.driftTierThree));
  next.driftBoostDrainOne = Math.max(next.slipChargeRate + 1,
    bounded(next.driftBoostDrainOne, DEFAULT_FLIGHT_TUNING.driftBoostDrainOne, 5, 100));
  next.driftBoostDrainTwo = Math.max(next.driftBoostDrainOne,
    bounded(next.driftBoostDrainTwo, DEFAULT_FLIGHT_TUNING.driftBoostDrainTwo, 5, 100));
  next.driftBoostDrainThree = Math.max(next.driftBoostDrainTwo,
    bounded(next.driftBoostDrainThree, DEFAULT_FLIGHT_TUNING.driftBoostDrainThree, 5, 100));
  next.driftBoostColorOne = color(next.driftBoostColorOne, DEFAULT_FLIGHT_TUNING.driftBoostColorOne);
  next.driftBoostColorTwo = color(next.driftBoostColorTwo, DEFAULT_FLIGHT_TUNING.driftBoostColorTwo);
  next.driftBoostColorThree = color(next.driftBoostColorThree, DEFAULT_FLIGHT_TUNING.driftBoostColorThree);
  next.boostRepressWindow = bounded(next.boostRepressWindow, DEFAULT_FLIGHT_TUNING.boostRepressWindow, 0, 0.5);
  next.slipVisualAttack = bounded(next.slipVisualAttack, DEFAULT_FLIGHT_TUNING.slipVisualAttack, 0.02, 2);
  next.slipVisualRelease = bounded(next.slipVisualRelease, DEFAULT_FLIGHT_TUNING.slipVisualRelease, 0.02, 3);
  next.driftBoostSpeedOne = Math.max(next.normalBoostTopSpeed, next.driftBoostSpeedOne);
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
  next.driftMeterRadialThickness = bounded(next.driftMeterRadialThickness, DEFAULT_FLIGHT_TUNING.driftMeterRadialThickness, 0.1, 5);
  next.navigationArrowScale = bounded(next.navigationArrowScale, DEFAULT_FLIGHT_TUNING.navigationArrowScale, 0.6, 9);
  next.navigationArrowHeadStyle = next.navigationArrowHeadStyle === 'solid' ? 'solid' : 'wire';
  next.navigationArrowHeadLength = bounded(next.navigationArrowHeadLength, DEFAULT_FLIGHT_TUNING.navigationArrowHeadLength, 3, 180);
  next.navigationArrowHeadWidth = bounded(next.navigationArrowHeadWidth, DEFAULT_FLIGHT_TUNING.navigationArrowHeadWidth, 6, 120);
  next.navigationArrowBodyLength = bounded(next.navigationArrowBodyLength, DEFAULT_FLIGHT_TUNING.navigationArrowBodyLength, 10, 420);
  next.navigationArrowHeadLength = Math.min(next.navigationArrowHeadLength, next.navigationArrowBodyLength - 2);
  next.navigationArrowLineThickness = bounded(next.navigationArrowLineThickness, DEFAULT_FLIGHT_TUNING.navigationArrowLineThickness, 0.5, 15);
  next.navigationLookAhead = bounded(next.navigationLookAhead, DEFAULT_FLIGHT_TUNING.navigationLookAhead, 80, 800);
  next.navigationArrowColor = color(next.navigationArrowColor, DEFAULT_FLIGHT_TUNING.navigationArrowColor);
  next.wrongWayDelay = bounded(next.wrongWayDelay, DEFAULT_FLIGHT_TUNING.wrongWayDelay, 0.25, 2);
  next.routeHorizontalTurns = bounded(next.routeHorizontalTurns, DEFAULT_FLIGHT_TUNING.routeHorizontalTurns, 0.5, 1.5);
  next.routeVerticalTurns = bounded(next.routeVerticalTurns, DEFAULT_FLIGHT_TUNING.routeVerticalTurns, 0.5, 1.5);
  next.routeClearance = bounded(next.routeClearance, DEFAULT_FLIGHT_TUNING.routeClearance, 0.75, 1.5);
  next.terrainAheadDistance = bounded(
    next.terrainAheadDistance,
    DEFAULT_FLIGHT_TUNING.terrainAheadDistance,
    512,
    2560,
  );
  next.terrainCrystalClusterScale = bounded(
    next.terrainCrystalClusterScale,
    DEFAULT_FLIGHT_TUNING.terrainCrystalClusterScale,
    0.5,
    4,
  );
  return next;
}
