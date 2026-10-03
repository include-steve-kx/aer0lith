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
  impactPushScale: number;
  impactMinPush: number;
  impactMaxPush: number;
  impactPushDuration: number;
  impactFlashDuration: number;
  impactCooldown: number;
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
  driftMeterScale: number;
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
  touchDeadZone: number;
  touchResponseCurve: number;
  touchPrimaryScale: number;
}

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
  impactPushScale: 1.1,
  impactMinPush: 18,
  impactMaxPush: 120,
  impactPushDuration: 0.45,
  impactFlashDuration: 0.65,
  impactCooldown: 0.18,
  driftMinAngle: 6,
  driftFullAngle: 45,
  driftMaxAngle: 75,
  driftChargeRate: 40,
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
  driftMeterScale: 1,
  driftTrailResponse: 1,
  driftTrailEnabled: true,
  driftTrailRate: 32,
  driftTrailSize: 4.5,
  driftTrailLifetime: 1.4,
  driftTrailOpacity: 0.55,
  driftTrailTurbulence: 3.5,
  driftTrailColor: '#c8c8c8',
  driftTierPulse: true,
  driftShakeStrength: 0.45,
  touchDeadZone: 0.08,
  touchResponseCurve: 1,
  touchPrimaryScale: 1,
};

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
  next.impactMaxPush = Math.max(next.impactMinPush, next.impactMaxPush);
  return next;
}
