import { FLIGHT } from '../core/config.ts';

/** Shutter duration in seconds, independent of frame rate and render resolution. */
export function motionBlurExposure(speed: number, strength: number, startSpeed: number): number {
  if (!Number.isFinite(speed) || !Number.isFinite(strength) || !Number.isFinite(startSpeed)) return 0;
  const threshold = Math.max(0, Math.min(FLIGHT.maxSpeed - 1, startSpeed));
  const t = Math.max(0, Math.min(1, (speed - threshold) / (FLIGHT.maxSpeed - threshold)));
  return Math.max(0, Math.min(1.5, strength)) * t * t * (3 - 2 * t) / 60;
}

/** Minimum peripheral streak at 1080p; distant scenery must still convey speed. */
export function motionBlurStreak(speed: number, strength: number, startSpeed: number): number {
  return motionBlurExposure(speed, strength, startSpeed) * 60 * 40;
}
