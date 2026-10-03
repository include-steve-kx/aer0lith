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
  driftTierPulse: boolean;
  driftShakeStrength: number;
  touchDeadZone: number;
  touchResponseCurve: number;
  touchPrimaryScale: number;
}

export const DEFAULT_FLIGHT_TUNING: FlightTuningSettings = {
  pitchRate: 0.75,
  rollRate: 2,
  yawRate: 0.6,
  bankYawRate: 0.6,
  pitchAutoLevel: 0.12,
  rollAutoLevel: 0.42,
  normalGrip: 3.5,
  driftGrip: 0.35,
  normalAcceleration: 15,
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
  cameraPositionResponse: 0.16,
  cameraHeadingResponse: 0.55,
  cameraRecoveryResponse: 0.75,
  cameraTravelInfluence: 0.85,
  cameraBankResponse: 0.35,
  cameraMaxLag: 75,
  driftCueEnabled: true,
  driftCueSize: 34,
  driftCueOpacity: 0.72,
  driftMeterEnabled: true,
  driftMeterScale: 1,
  driftTrailResponse: 1,
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
  return next;
}
