export const DRIFT_METER_VIEWBOX_SIZE = 100;
export const DRIFT_METER_CENTER = 50;
export const DRIFT_METER_OUTER_RADIUS = 50;
export const DRIFT_METER_SCREEN_RADIUS_VW = 25;

export interface DriftMeterPoint { x: number; y: number }

export interface DriftMeterSegmentGeometry {
  sectorPath: string;
  progressPath: string;
  startDegrees: number;
  endDegrees: number;
}

export interface DriftMeterGeometry {
  centerRadius: number;
  radialThickness: number;
  sweepDegrees: number;
  segments: DriftMeterSegmentGeometry[];
}

function pointOnCircle(radius: number, degrees: number): DriftMeterPoint {
  const radians = degrees * Math.PI / 180;
  return {
    x: DRIFT_METER_CENTER + Math.cos(radians) * radius,
    y: DRIFT_METER_CENTER + Math.sin(radians) * radius,
  };
}

function pointText(point: DriftMeterPoint): string {
  return `${point.x.toFixed(3)} ${point.y.toFixed(3)}`;
}

function arcPath(radius: number, startDegrees: number, endDegrees: number): string {
  const start = pointOnCircle(radius, startDegrees);
  const end = pointOnCircle(radius, endDegrees);
  const largeArc = endDegrees - startDegrees > 180 ? 1 : 0;
  return `M ${pointText(start)} A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 ${largeArc} 1 ${pointText(end)}`;
}

function annularSectorPath(
  outerRadius: number,
  innerRadius: number,
  startDegrees: number,
  endDegrees: number,
): string {
  const outerStart = pointOnCircle(outerRadius, startDegrees);
  const outerEnd = pointOnCircle(outerRadius, endDegrees);
  const innerEnd = pointOnCircle(innerRadius, endDegrees);
  const innerStart = pointOnCircle(innerRadius, startDegrees);
  const largeArc = endDegrees - startDegrees > 180 ? 1 : 0;
  return [
    `M ${pointText(outerStart)}`,
    `A ${outerRadius.toFixed(3)} ${outerRadius.toFixed(3)} 0 ${largeArc} 1 ${pointText(outerEnd)}`,
    `L ${pointText(innerEnd)}`,
    `A ${innerRadius.toFixed(3)} ${innerRadius.toFixed(3)} 0 ${largeArc} 0 ${pointText(innerStart)}`,
    'Z',
  ].join(' ');
}

/** Builds a three-part annular sector on a screen-centered, 25vw circle. */
export function createDriftMeterGeometry(
  centerlineArcLengthVw: number,
  radialThicknessVw: number,
): DriftMeterGeometry {
  const safeThicknessVw = Math.min(5, Math.max(0.5, radialThicknessVw));
  const radialThickness = safeThicknessVw * 2;
  const innerRadius = DRIFT_METER_OUTER_RADIUS - radialThickness;
  const centerRadius = (DRIFT_METER_OUTER_RADIUS + innerRadius) * 0.5;
  const centerRadiusVw = centerRadius * 0.5;
  const safeArcLengthVw = Math.min(64, Math.max(12, centerlineArcLengthVw));
  const sweepDegrees = safeArcLengthVw / centerRadiusVw * 180 / Math.PI;
  const start = -sweepDegrees * 0.5;
  const part = sweepDegrees / 3;
  const segments: DriftMeterSegmentGeometry[] = [];

  for (let index = 0; index < 3; index += 1) {
    const segmentStart = start + part * index;
    const segmentEnd = segmentStart + part;
    segments.push({
      sectorPath: annularSectorPath(DRIFT_METER_OUTER_RADIUS, innerRadius, segmentStart, segmentEnd),
      progressPath: arcPath(centerRadius, segmentStart, segmentEnd),
      startDegrees: segmentStart,
      endDegrees: segmentEnd,
    });
  }

  return { centerRadius, radialThickness, sweepDegrees, segments };
}

export function driftMeterPoint(radius: number, degrees: number): DriftMeterPoint {
  return pointOnCircle(radius, degrees);
}
