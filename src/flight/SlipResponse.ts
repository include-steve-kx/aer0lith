import type { SlipCurvePreset } from './FlightTuning.ts';

export const SLIP_CURVE_SAMPLES = 129;

export interface SlipCurveDefinition {
  preset: SlipCurvePreset;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function presetControlPoints(preset: SlipCurvePreset): [number, number, number, number] {
  if (preset === 'linear') return [1 / 3, 1 / 3, 2 / 3, 2 / 3];
  if (preset === 'early-plateau') return [0.2, 0.7, 0.45, 1];
  return [1 / 3, 0, 2 / 3, 1];
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const inverse = 1 - t;
  return inverse ** 3 * a
    + 3 * inverse ** 2 * t * b
    + 3 * inverse * t ** 2 * c
    + t ** 3 * d;
}

function sampleBezier(x: number, x1: number, y1: number, x2: number, y2: number): number {
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 14; iteration += 1) {
    const midpoint = (low + high) * 0.5;
    if (cubic(0, x1, x2, 1, midpoint) < x) low = midpoint;
    else high = midpoint;
  }
  return clamp01(cubic(0, y1, y2, 1, (low + high) * 0.5));
}

export function buildSlipCurveLookup(definition: SlipCurveDefinition, target = new Float32Array(SLIP_CURVE_SAMPLES)): Float32Array {
  const controls = definition.preset === 'custom'
    ? [definition.x1, definition.y1, definition.x2, definition.y2] as const
    : presetControlPoints(definition.preset);
  for (let index = 0; index < target.length; index += 1) {
    const x = index / (target.length - 1);
    target[index] = sampleBezier(x, ...controls);
  }
  target[0] = 0;
  target[target.length - 1] = 1;
  return target;
}

export function evaluateSlipCurve(lookup: Float32Array, normalizedSlip: number): number {
  const position = clamp01(normalizedSlip) * (lookup.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(lookup.length - 1, lower + 1);
  const amount = position - lower;
  return lookup[lower] + (lookup[upper] - lookup[lower]) * amount;
}
