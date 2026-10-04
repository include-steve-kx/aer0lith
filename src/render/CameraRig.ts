import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { COCKPIT_EYE } from '../core/aircraftGeometry.ts';
import { CAMERA } from '../core/config.ts';
import type { CameraMode } from '../core/types.ts';
import { DEFAULT_FLIGHT_TUNING, type FlightTuningSettings } from '../flight/FlightTuning.ts';

const MODES: CameraMode[] = ['cockpit', 'chase', 'far-chase'];

export class CameraRig {
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  mode: CameraMode = 'chase';
  onChange: ((mode: CameraMode) => void) | undefined;
  private readonly desiredPosition = new Vector3();
  private readonly desiredTarget = new Vector3();
  private readonly desiredQuaternion = new Quaternion();
  private readonly lookMatrix = new Matrix4();
  private readonly forward = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly offset = new Vector3();
  private readonly lastPlanePosition = new Vector3();
  private readonly planeDelta = new Vector3();
  private readonly orbitViewDirection = new Vector3();
  private readonly aircraftUp = new Vector3();
  private readonly chaseForward = new Vector3(0, 0, 1);
  private readonly targetChaseForward = new Vector3(0, 0, 1);
  private readonly chaseUp = new Vector3(0, 1, 0);
  private readonly targetChaseUp = new Vector3(0, 1, 0);
  private readonly velocityDirection = new Vector3(0, 0, 1);
  private tuning: FlightTuningSettings = { ...DEFAULT_FLIGHT_TUNING };
  private chaseFrameReady = false;
  private orbitDragging = false;
  private orbitReturnDelay = 0;
  private hasPlanePosition = false;
  private hasCameraPose = false;
  private throttleFovBlend = 0;
  private cameraSelectionPending = false;
  private pausedOrbitRequested = false;

  constructor(aspect: number, domElement: HTMLElement) {
    this.camera = new PerspectiveCamera(CAMERA.chaseFov, aspect, 0.1, 1700);
    this.camera.position.set(0, 8, -22);
    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = true;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 260;
    this.controls.maxPolarAngle = Math.PI * 0.94;
    this.controls.addEventListener('start', () => {
      this.pausedOrbitRequested = true;
      this.cameraSelectionPending = false;
      this.synchronizeOrbitTarget();
      this.orbitDragging = true;
      this.orbitReturnDelay = Number.POSITIVE_INFINITY;
    });
    this.controls.addEventListener('end', () => {
      this.orbitDragging = false;
      this.orbitReturnDelay = 4.5;
    });
  }

  update(
    dt: number,
    planePosition: Vector3,
    planeOrientation: Quaternion,
    crash: number,
    throttleActive = false,
    paused = false,
    travelVelocity?: Vector3,
    slipIntensity = 0,
  ): void {
    // Hold the exact pose/FOV until a camera control is used. In paused orbit
    // the user owns the view; the normal return-to-chase countdown is stopped.
    if (paused && !this.cameraSelectionPending) {
      if (this.controls.enabled && this.pausedOrbitRequested) {
        this.controls.update(dt);
      }
      return;
    }
    if (this.hasPlanePosition) {
      this.planeDelta.copy(planePosition).sub(this.lastPlanePosition);
      if (this.orbitDragging || this.orbitReturnDelay > 0) {
        this.camera.position.add(this.planeDelta);
        this.controls.target.add(this.planeDelta);
      }
    } else {
      this.controls.target.copy(planePosition);
      this.hasPlanePosition = true;
    }
    this.lastPlanePosition.copy(planePosition);
    this.controls.enabled = this.mode !== 'cockpit';
    this.updateFov(dt, throttleActive, paused);
    if (this.controls.enabled && (this.orbitDragging || this.orbitReturnDelay > 0)) {
      if (!this.orbitDragging) this.orbitReturnDelay = Math.max(0, this.orbitReturnDelay - dt);
      this.controls.update(dt);
      return;
    }

    this.forward.set(0, 0, 1).applyQuaternion(planeOrientation).normalize();
    this.aircraftUp.copy(this.up).applyQuaternion(planeOrientation).normalize();
    this.updateChaseFrame(dt, travelVelocity, slipIntensity);
    if (this.mode === 'chase') {
      this.desiredPosition.copy(planePosition)
        .addScaledVector(this.chaseForward, -22)
        .addScaledVector(this.chaseUp, 8);
      this.desiredTarget.copy(planePosition)
        .addScaledVector(this.chaseForward, 16)
        .addScaledVector(this.chaseUp, 1.8);
      this.lookMatrix.lookAt(this.desiredPosition, this.desiredTarget, this.chaseUp);
      this.desiredQuaternion.setFromRotationMatrix(this.lookMatrix);
    } else if (this.mode === 'cockpit') {
      this.offset.set(...COCKPIT_EYE).applyQuaternion(planeOrientation);
      this.desiredPosition.copy(planePosition).add(this.offset);
      this.desiredTarget.copy(this.desiredPosition).addScaledVector(this.forward, 60);
      this.lookMatrix.lookAt(this.desiredPosition, this.desiredTarget, this.aircraftUp);
      this.desiredQuaternion.setFromRotationMatrix(this.lookMatrix);
    } else {
      // Keep far chase at the 260 m OrbitControls limit while raising its viewpoint.
      this.desiredPosition.copy(planePosition)
        .addScaledVector(this.chaseForward, -247.38633753705963)
        .addScaledVector(this.chaseUp, 80);
      this.desiredTarget.copy(planePosition)
        .addScaledVector(this.chaseForward, 60)
        .addScaledVector(this.chaseUp, 10);
      this.lookMatrix.lookAt(this.desiredPosition, this.desiredTarget, this.chaseUp);
      this.desiredQuaternion.setFromRotationMatrix(this.lookMatrix);
    }

    if (crash > 0 && !paused) {
      this.desiredPosition.x += (Math.random() - 0.5) * crash * 1.8;
      this.desiredPosition.y += (Math.random() - 0.5) * crash * 1.4;
    }

    const positionSmoothing = this.hasCameraPose
      ? 1 - Math.exp(-dt / Math.max(0.01, this.tuning.cameraPositionResponse))
      : 1;
    const headingSmoothing = this.hasCameraPose
      ? 1 - Math.exp(-dt / Math.max(0.01, this.tuning.cameraHeadingResponse))
      : 1;
    this.camera.position.lerp(this.desiredPosition, positionSmoothing);
    this.camera.quaternion.slerp(this.desiredQuaternion, headingSmoothing);
    this.controls.target.copy(this.desiredTarget);
    this.hasCameraPose = true;
    if (this.camera.position.distanceToSquared(this.desiredPosition) < 1e-8
      && this.camera.quaternion.angleTo(this.desiredQuaternion) < 1e-5) {
      this.cameraSelectionPending = false;
    }
  }

  configure(settings: FlightTuningSettings): void {
    this.tuning = { ...settings };
  }

  private updateChaseFrame(
    dt: number,
    travelVelocity: Vector3 | undefined,
    slipIntensity: number,
  ): void {
    this.targetChaseForward.copy(this.forward);
    const hasTravel = Boolean(travelVelocity && travelVelocity.lengthSq() > 1e-8);
    const slip = Math.max(0, Math.min(1, slipIntensity));
    const driftActive = slip > 1e-4;
    if (hasTravel && driftActive && travelVelocity) {
      this.velocityDirection.copy(travelVelocity).normalize();
      this.targetChaseForward.lerp(
        this.velocityDirection,
        this.tuning.cameraTravelInfluence * slip,
      ).normalize();
      const maxLag = this.tuning.cameraMaxLag * Math.PI / 180;
      const lag = this.forward.angleTo(this.targetChaseForward);
      if (lag > maxLag && lag > 1e-6) {
        this.targetChaseForward.lerpVectors(
          this.forward,
          this.targetChaseForward,
          maxLag / lag,
        ).normalize();
      }
    }
    this.targetChaseUp.copy(this.aircraftUp);
    if (!this.chaseFrameReady) {
      this.chaseForward.copy(this.targetChaseForward);
      this.chaseUp.copy(this.targetChaseUp);
      this.chaseFrameReady = true;
      return;
    }
    const response = driftActive
      ? this.tuning.cameraHeadingResponse
      : this.tuning.cameraRecoveryResponse;
    const forwardSmoothing = 1 - Math.exp(-dt / Math.max(0.01, response));
    const bankSmoothing = 1 - Math.exp(-dt / Math.max(0.01, this.tuning.cameraBankResponse));
    this.chaseForward.lerp(this.targetChaseForward, forwardSmoothing).normalize();
    this.chaseUp.lerp(this.targetChaseUp, bankSmoothing).normalize();
  }

  private synchronizeOrbitTarget(): void {
    if (!this.hasPlanePosition || this.mode === 'cockpit') return;
    const distanceFromPlane = this.camera.position.distanceTo(this.lastPlanePosition);
    const orbitDistance = Math.max(
      this.controls.minDistance,
      Math.min(this.controls.maxDistance, distanceFromPlane),
    );
    this.camera.getWorldDirection(this.orbitViewDirection);
    this.controls.target
      .copy(this.camera.position)
      .addScaledVector(this.orbitViewDirection, orbitDistance);
    // With the target placed directly on the current view ray, OrbitControls
    // can initialize its spherical state without changing the visible pose.
    this.controls.update(0);
  }

  setPaused(): void {
    this.cameraSelectionPending = false;
    this.pausedOrbitRequested = false;
  }

  private updateFov(dt: number, throttleActive: boolean, paused: boolean): void {
    const targetBlend = throttleActive ? 1 : 0;
    const blendTime = throttleActive ? CAMERA.throttleRiseTime : CAMERA.throttleFallTime;
    const blendSmoothing = 1 - Math.exp(-dt / blendTime);
    if (!paused) this.throttleFovBlend += (targetBlend - this.throttleFovBlend) * blendSmoothing;

    const baseFov = this.mode === 'cockpit'
      ? CAMERA.cockpitFov
      : this.mode === 'far-chase'
        ? CAMERA.farChaseFov
        : CAMERA.chaseFov;
    const desiredFov = baseFov + CAMERA.throttleFovBoost[this.mode] * this.throttleFovBlend;
    const fovSmoothing = this.hasCameraPose
      ? 1 - Math.exp(-dt / CAMERA.fovResponseTime)
      : 1;
    this.camera.fov += (desiredFov - this.camera.fov) * fovSmoothing;
    this.camera.updateProjectionMatrix();
  }

  cycle(): CameraMode {
    const current = MODES.indexOf(this.mode);
    return this.select((current + 1) % MODES.length);
  }

  select(index: number): CameraMode {
    this.cameraSelectionPending = true;
    this.mode = MODES[Math.max(0, Math.min(MODES.length - 1, index))];
    this.orbitDragging = false;
    this.orbitReturnDelay = 0;
    this.controls.enabled = this.mode !== 'cockpit';
    this.onChange?.(this.mode);
    return this.mode;
  }

  /**
   * Move every cached render-space camera position into the new floating-origin
   * frame. Relative camera/aircraft geometry remains exactly unchanged.
   */
  applyOriginShift(originShift: Vector3): void {
    this.camera.position.sub(originShift);
    this.controls.target.sub(originShift);
    this.desiredPosition.sub(originShift);
    this.desiredTarget.sub(originShift);
    if (this.hasPlanePosition) this.lastPlanePosition.sub(originShift);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
