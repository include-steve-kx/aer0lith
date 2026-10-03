import {
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three';
import type { FlightTuningSettings } from '../flight/FlightTuning.ts';

export interface RouteArrowOrientation {
  heading: number;
  elevation: number;
}

export interface NavigationArrowFaceGeometry {
  width: number;
  height: number;
  matrix: string;
}

export interface NavigationArrowGeometry {
  armLength: number;
  headAngleDegrees: number;
  tipDepth: number;
  faces: NavigationArrowFaceGeometry[];
}

const inverseCamera = new Quaternion();
const direction = new Vector3();
const localDirection = new Vector3();

export function navigationAngleChanged(next: number, previous: number): boolean {
  return !Number.isFinite(previous) || Math.abs(next - previous) > 0.001;
}

function fixed(value: number): string {
  return Math.abs(value) < 1e-10 ? '0' : value.toFixed(6);
}

/** Builds four true triangular faces around an arrow axis that points into -Z. */
export function navigationArrowGeometry(
  bodyLength: number,
  headLength: number,
  headWidth: number,
): NavigationArrowGeometry {
  const tipDepth = -bodyLength;
  const baseDepth = tipDepth + headLength;
  const halfWidth = headWidth * 0.5;
  const vertices = [
    [0, -halfWidth, baseDepth],
    [halfWidth, 0, baseDepth],
    [0, halfWidth, baseDepth],
    [-halfWidth, 0, baseDepth],
  ] as const;
  const faces: NavigationArrowFaceGeometry[] = [];

  for (let index = 0; index < 4; index += 1) {
    const a = vertices[index];
    const b = vertices[(index + 1) % vertices.length];
    const edgeX = b[0] - a[0];
    const edgeY = b[1] - a[1];
    const width = Math.hypot(edgeX, edgeY);
    const ex = edgeX / width;
    const ey = edgeY / width;
    const midpointX = (a[0] + b[0]) * 0.5;
    const midpointY = (a[1] + b[1]) * 0.5;
    const height = Math.hypot(midpointX, midpointY, headLength);
    const yx = midpointX / height;
    const yy = midpointY / height;
    const yz = headLength / height;
    const nx = ey * yz;
    const ny = -ex * yz;
    const nz = ex * yy - ey * yx;
    const tx = -ex * width * 0.5;
    const ty = -ey * width * 0.5;
    const matrix = `matrix3d(${[
      ex, ey, 0, 0,
      yx, yy, yz, 0,
      nx, ny, nz, 0,
      tx, ty, tipDepth, 1,
    ].map(fixed).join(',')})`;
    faces.push({ width, height, matrix });
  }

  return {
    armLength: Math.hypot(halfWidth, headLength),
    headAngleDegrees: Math.atan2(headLength, halfWidth) * 180 / Math.PI,
    tipDepth,
    faces,
  };
}

/** Converts the route vector to camera-relative yaw and pitch for the HUD. */
export function routeArrowOrientation(
  camera: PerspectiveCamera,
  planePosition: Vector3,
  targetPosition: Vector3,
  output: RouteArrowOrientation = { heading: 0, elevation: 0 },
): RouteArrowOrientation {
  direction.subVectors(targetPosition, planePosition);
  if (direction.lengthSq() < 1e-8) direction.set(0, 0, -1);
  localDirection.copy(direction).normalize()
    .applyQuaternion(inverseCamera.copy(camera.quaternion).invert());
  output.heading = Math.atan2(localDirection.x, -localDirection.z);
  output.elevation = Math.atan2(
    localDirection.y,
    Math.hypot(localDirection.x, localDirection.z),
  );
  return output;
}

/** A single CSS-transformed HUD element; no extra Three.js renderer or draw call. */
export class NavigationArrowView {
  private readonly root: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly faces: HTMLElement[];
  private readonly orientation: RouteArrowOrientation = { heading: 0, elevation: 0 };
  private enabled = true;
  private lastHeading = Number.NaN;
  private lastElevation = Number.NaN;

  constructor(root = document.getElementById('navigation-cue')) {
    if (!(root instanceof HTMLElement)) throw new Error('Missing navigation cue');
    const arrow = root.querySelector<HTMLElement>('#navigation-arrow');
    if (!arrow) throw new Error('Missing navigation arrow');
    this.root = root;
    this.arrow = arrow;
    this.faces = Array.from(arrow.querySelectorAll<HTMLElement>('.navigation-arrow-face'));
  }

  configure(settings: FlightTuningSettings): void {
    this.enabled = settings.navigationArrowEnabled;
    this.root.hidden = !this.enabled;
    this.root.style.setProperty('--navigation-arrow-scale', String(settings.navigationArrowScale));
    this.root.style.setProperty('--navigation-arrow-color', settings.navigationArrowColor);
    this.arrow.dataset.headStyle = settings.navigationArrowHeadStyle;
    const geometry = navigationArrowGeometry(
      settings.navigationArrowBodyLength,
      settings.navigationArrowHeadLength,
      settings.navigationArrowHeadWidth,
    );
    this.arrow.style.setProperty('--navigation-body-length', `${settings.navigationArrowBodyLength}px`);
    this.arrow.style.setProperty('--navigation-tip-depth', `${geometry.tipDepth}px`);
    this.arrow.style.setProperty('--navigation-head-arm-length', `${geometry.armLength}px`);
    this.arrow.style.setProperty('--navigation-head-angle', `${geometry.headAngleDegrees}deg`);
    this.arrow.style.setProperty('--navigation-head-angle-negative', `${-geometry.headAngleDegrees}deg`);
    this.arrow.style.setProperty('--navigation-line-thickness', `${settings.navigationArrowLineThickness}px`);
    for (let index = 0; index < this.faces.length; index += 1) {
      const face = geometry.faces[index];
      this.faces[index].style.width = `${face.width}px`;
      this.faces[index].style.height = `${face.height}px`;
      this.faces[index].style.transform = face.matrix;
    }
  }

  update(camera: PerspectiveCamera, planePosition: Vector3, targetPosition: Vector3): void {
    if (!this.enabled) return;
    routeArrowOrientation(camera, planePosition, targetPosition, this.orientation);
    const elevation = Math.max(-0.65, Math.min(0.65, this.orientation.elevation));
    if (navigationAngleChanged(this.orientation.heading, this.lastHeading)) {
      this.arrow.style.setProperty('--navigation-heading', `${-this.orientation.heading}rad`);
      this.lastHeading = this.orientation.heading;
    }
    if (navigationAngleChanged(elevation, this.lastElevation)) {
      this.arrow.style.setProperty('--navigation-elevation', `${elevation}rad`);
      this.lastElevation = elevation;
    }
  }

  dispose(): void {
    this.arrow.style.removeProperty('--navigation-heading');
    this.arrow.style.removeProperty('--navigation-elevation');
  }
}
