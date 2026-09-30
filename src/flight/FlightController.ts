import { Euler, Quaternion, Vector3 } from 'three';
import {
  COLLISION_CONFIRM_TIME,
  COLLISION_DEEP_PENETRATION,
  COLLISION_PROBES,
  COLLISION_TOLERANCE,
  FLIGHT,
} from '../core/config.ts';
import { COCKPIT_COLLISION_PROBES } from '../core/aircraftGeometry.ts';
import type { FlightInput, FlightMode, SafeCheckpoint } from '../core/types.ts';
import type { DynamicObstacleProvider } from '../combat/types.ts';
import type { ProceduralTerrain } from '../world/TerrainModel.ts';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function approach(current: number, target: number, rate: number): number {
  const difference = target - current;
  return current + clamp(difference, -rate, rate);
}

function wrapAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

export class FlightController {
  readonly position = new Vector3();
  readonly orientation = new Quaternion();
  readonly cameraOrientation = new Quaternion();
  private readonly rollRotation = new Quaternion();
  private readonly rollAxis = new Vector3(0, 0, 1);
  private readonly dodgeAxis = new Vector3();
  private cockpitCollision = false;
  private rollDirection = 0;
  private rollElapsed = 0;
  private rollCooldown = 0;
  private rollAngle = 0;
  readonly rollDuration = 0.6;
  readonly rollTurns = 1;
  readonly rollDistance = 44;
  readonly externalVelocity = new Vector3();
  private readonly pendingImpulse = new Vector3();
  private externalRemaining = 0;
  private externalSettle = 0.8;
  private readonly blastPose = new Quaternion();
  private readonly blastPosition = new Vector3();
  applyExternalImpulse(impulse: Vector3, settle = 0.8): void {
    if (this.mode === 'crashed' || this.mode === 'loading') return;
    this.pendingImpulse.add(impulse); this.externalSettle = settle;
  }
  clearExternalImpulse(): void { this.externalVelocity.set(0, 0, 0); this.pendingImpulse.set(0, 0, 0); this.externalRemaining = 0; }
  private advanceExternal(dt: number): boolean {
    if (this.pendingImpulse.lengthSq() > 0) {
      this.externalVelocity.add(this.pendingImpulse).clampLength(0, FLIGHT.maxExternalSpeed);
      this.pendingImpulse.set(0, 0, 0); this.externalRemaining = this.externalSettle;
    }
    if (this.externalRemaining <= 0 || this.externalVelocity.lengthSq() === 0) { this.clearExternalImpulse(); return false; }
    const elapsed = Math.min(dt, this.externalRemaining), ratio = Math.max(0, 1 - elapsed / this.externalRemaining);
    this.position.addScaledVector(this.externalVelocity, elapsed * (1 + ratio) * .5);
    this.externalVelocity.multiplyScalar(ratio); this.externalRemaining = Math.max(0, this.externalRemaining - dt);
    if (this.externalRemaining < 1e-9) this.clearExternalImpulse();
    return true;
  }
  private checkBlastTerrain(): void {
    const probes = this.cockpitCollision ? COCKPIT_COLLISION_PROBES : COLLISION_PROBES;
    const travel = this.previousPosition.distanceTo(this.position) + this.previousOrientation.angleTo(this.orientation) * 7;
    const steps = Math.max(1, Math.ceil(travel));
    if (steps > 16) { this.beginCrash(); return; }
    for (let i = 0; i <= steps; i++) {
      this.blastPose.slerpQuaternions(this.previousOrientation, this.orientation, i / steps);
      this.blastPosition.lerpVectors(this.previousPosition, this.position, i / steps);
      for (const p of probes) {
        this.samplePoint.set(...p).applyQuaternion(this.blastPose).add(this.blastPosition);
        if (this.terrain.collisionDensityAt(this.samplePoint.x, this.samplePoint.y, this.samplePoint.z) > 0) { this.beginCrash(); return; }
      }
    }
  }
  /** Distance traveled per fixed step, including dodge and external forces. */
  actualSpeed: number = FLIGHT.nominalSpeed;
  speed: number = FLIGHT.nominalSpeed;
  throttle: number = (FLIGHT.nominalSpeed - FLIGHT.minSpeed) / (FLIGHT.maxSpeed - FLIGHT.minSpeed);
  mode: FlightMode = 'loading';
  yaw = 0;
  pitch = 0;
  roll = 0;
  obstacles?: DynamicObstacleProvider;
  onRecovery?: () => void;
  readonly previousPosition = new Vector3();
  private readonly previousOrientation = new Quaternion();
  private readonly avoidanceTarget = new Vector3();
  private readonly avoidanceOffset = new Vector3();
  onCrash: (() => void) | undefined;
  onModeChange: ((mode: FlightMode) => void) | undefined;
  private readonly terrain: ProceduralTerrain;
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly forward = new Vector3();
  private readonly samplePoint = new Vector3();
  private checkpoint: SafeCheckpoint;
  private initialCheckpoint: SafeCheckpoint;
  private checkpointTimer = 0;
  private crashElapsed = 0;
  private collisionContactTime = 0;
  private previousMode: FlightMode = 'autopilot';

  constructor(terrain: ProceduralTerrain) {
    this.terrain = terrain;
    const start = terrain.sample(0);
    this.position.set(start.x, start.y, 0);
    this.yaw = Math.atan2(start.tangentX, 1);
    this.pitch = -Math.atan(start.tangentY);
    this.syncOrientation();
    this.initialCheckpoint = this.captureCheckpoint();
    this.checkpoint = this.captureCheckpoint();
    this.setMode('autopilot');
  }

  update(dt: number, input: FlightInput): void {
    if (dt <= 0 || this.mode === 'paused' || this.mode === 'loading') return;
    if (this.mode === 'crashed') {
      this.crashElapsed += dt;
      if (this.crashElapsed >= FLIGHT.crashDuration) this.restoreCheckpoint();
      return;
    }

    this.previousPosition.copy(this.position);
    this.previousOrientation.copy(this.orientation);
    if (input.pitch !== 0 || input.roll !== 0 || input.yaw !== 0) this.takeManualControl();
    this.rollCooldown = Math.max(0, this.rollCooldown - dt);
    if (this.isRolling) { this.updateThrottle(dt, input.throttle); this.updateRoll(dt); }
    else if (this.mode === 'autopilot') this.updateAutopilot(dt, input.throttle);
    else this.updateManual(dt, input);

    this.syncOrientation();
    this.forward.set(0, 0, 1).applyQuaternion(this.orientation).normalize();
    this.position.addScaledVector(this.forward, this.speed * dt);
    const blastMoved = this.advanceExternal(dt);
    this.actualSpeed = this.position.distanceTo(this.previousPosition) / dt;
    if (blastMoved) this.checkBlastTerrain();
    if (this.obstacles?.sweepShip(this.previousPosition, this.position, this.previousOrientation, this.orientation, this.cockpitCollision)) this.beginCrash();
    if (this.mode !== 'autopilot' && this.crashIntensity === 0) this.checkCollision(dt);
    this.updateCheckpoint(dt);
  }

  private updateManual(dt: number, input: FlightInput): void {
    this.pitch = clamp(this.pitch + input.pitch * 0.525 * dt, -1.05, 1.05);
    this.roll = clamp(this.roll + input.roll * 1.5 * dt, -1.25, 1.25);
    this.yaw = wrapAngle(this.yaw + (input.yaw * 0.41 - this.roll * 0.44) * dt);

    if (Math.abs(input.roll) < 0.01) this.roll = approach(this.roll, 0, 0.42 * dt);
    if (Math.abs(input.pitch) < 0.01) this.pitch = approach(this.pitch, 0, 0.12 * dt);
    this.updateThrottle(dt, input.throttle);
  }

  private updateThrottle(dt: number, throttleInput: number): void {
    const cruiseThrottle = (FLIGHT.nominalSpeed - FLIGHT.minSpeed)
      / (FLIGHT.maxSpeed - FLIGHT.minSpeed);
    if (Math.abs(throttleInput) > 0.01) {
      this.throttle = clamp(this.throttle + throttleInput * 0.28 * dt, 0, 1);
    } else {
      this.throttle = approach(this.throttle, cruiseThrottle, 0.32 * dt);
    }
    const targetSpeed = FLIGHT.minSpeed + this.throttle * (FLIGHT.maxSpeed - FLIGHT.minSpeed);
    this.speed = approach(this.speed, targetSpeed, 15 * dt);
  }

  get isRolling(): boolean { return this.rollDirection !== 0; }
  get maneuverRollAngle(): number { return this.rollAngle; }

  startRoll(direction: -1 | 1): boolean {
    if (this.isRolling || this.rollCooldown > 0 || !['manual', 'autopilot'].includes(this.mode)) return false;
    this.takeManualControl();
    this.rollDirection = direction;
    this.rollElapsed = 0;
    this.rollAngle = 0;
    // From the chase camera, screen-left is model +X (+Z points forward).
    this.dodgeAxis.set(-direction, 0, 0).applyQuaternion(this.cameraOrientation).normalize();
    return true;
  }

  private updateRoll(dt: number): void {
    const ease = (t: number) => t * t * (3 - 2 * t);
    const before = ease(Math.min(1, this.rollElapsed / this.rollDuration));
    this.rollElapsed = Math.min(this.rollDuration, this.rollElapsed + dt);
    const after = ease(this.rollElapsed / this.rollDuration);
    this.position.addScaledVector(this.dodgeAxis, (after - before) * this.rollDistance);
    this.rollAngle = this.rollDirection * Math.PI * 2 * this.rollTurns * after;
    if (this.rollElapsed >= this.rollDuration) {
      this.rollDirection = 0;
      this.rollAngle = 0; // Exactly one turn returns to the original attitude.
      this.rollCooldown = 0.125;
    }
  }

  private cancelRoll(): void { this.rollDirection = 0; this.rollAngle = 0; this.rollCooldown = 0; }

  private updateAutopilot(dt: number, throttleInput: number): void {
    const blocked = this.obstacles?.avoidance(dt, this.position, this.speed, this.avoidanceTarget) ?? false;
    this.avoidanceOffset.lerp(this.avoidanceTarget, 1 - Math.exp(-3 * dt));
    const lookAhead = clamp(this.speed * 1.25, 52, 105);
    const route = this.terrain.sample(this.position.z + lookAhead);
    const localRoute = this.terrain.sample(this.position.z);
    const localDensity = this.terrain.densityAt(
      this.position.x,
      this.position.y,
      this.position.z,
    );
    // Begin steering back toward the guaranteed air core before a wall becomes
    // dangerous. This modifies desired attitude only; it never teleports or
    // directly pushes the aircraft position.
    const avoidance = clamp((localDensity + 25) / 17, 0, 1);
    const steeringRoute = this.terrain.sample(this.position.z + 22);
    const correctionGain = 0.05 + avoidance * 0.045;
    const steeringX = steeringRoute.tangentX
      + (localRoute.x + this.avoidanceOffset.x - this.position.x) * correctionGain;
    const steeringY = steeringRoute.tangentY
      + (localRoute.y + this.avoidanceOffset.y - this.position.y) * correctionGain;
    const desiredYaw = Math.atan2(steeringX, 1);
    const desiredPitch = clamp(
      -Math.atan2(steeringY, Math.hypot(steeringX, 1)),
      -0.55,
      0.45,
    );
    const yawError = wrapAngle(desiredYaw - this.yaw);
    const pitchError = desiredPitch - this.pitch;
    const desiredRoll = clamp(-yawError * 1.65, -0.82, 0.82);

    this.yaw = wrapAngle(this.yaw + clamp(yawError * (2.25 + avoidance * 0.75), -1.5, 1.5) * dt);
    this.pitch = clamp(
      this.pitch + clamp(pitchError * (2.15 + avoidance * 0.75), -1.0, 1.0) * dt,
      -0.7,
      0.58,
    );
    this.roll = approach(this.roll, desiredRoll, (1.15 + avoidance * 0.4) * dt);

    const turnPenalty = clamp(
      Math.abs(yawError) * 0.58
      + Math.abs(route.tangentX) * 0.25
      + Math.abs(route.tangentY) * 0.22
      + (1 - route.openness) * 0.12
      + avoidance * 0.22,
      0,
      0.42,
    );
    if (Math.abs(throttleInput) > 0.01) {
      const previousSpeed = this.speed;
      this.updateThrottle(dt, throttleInput);
      if (blocked) this.speed = approach(previousSpeed, 8, 45 * dt);
      return;
    }
    const cruiseThrottle = (FLIGHT.nominalSpeed - FLIGHT.minSpeed) / (FLIGHT.maxSpeed - FLIGHT.minSpeed);
    const targetThrottle = cruiseThrottle - turnPenalty;
    this.throttle = approach(this.throttle, targetThrottle, 0.22 * dt);
    const targetSpeed = FLIGHT.minSpeed + this.throttle * (FLIGHT.maxSpeed - FLIGHT.minSpeed);
    this.speed = approach(this.speed, blocked ? 8 : targetSpeed, (blocked ? 45 : 10) * dt);
  }

  private syncOrientation(): void {
    this.euler.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.cameraOrientation.setFromEuler(this.euler).normalize();
    this.orientation.copy(this.cameraOrientation)
      .multiply(this.rollRotation.setFromAxisAngle(this.rollAxis, this.rollAngle)).normalize();
  }

  setCockpitCollision(active: boolean): void {
    if (active === this.cockpitCollision) return;
    this.cockpitCollision = active;
    this.collisionContactTime = 0;
  }

  private checkCollision(dt: number): void {
    let deepestPenetration = 0;
    const probes = this.cockpitCollision ? COCKPIT_COLLISION_PROBES : COLLISION_PROBES;
    const orientation = this.orientation;
    for (const offset of probes) {
      this.samplePoint.set(offset[0], offset[1], offset[2]).applyQuaternion(orientation).add(this.position);
      const collisionDensity = this.terrain.collisionDensityAt?.(
        this.samplePoint.x,
        this.samplePoint.y,
        this.samplePoint.z,
      ) ?? this.terrain.densityAt(this.samplePoint.x, this.samplePoint.y, this.samplePoint.z);
      deepestPenetration = Math.max(
        deepestPenetration,
        collisionDensity + COLLISION_TOLERANCE,
      );
    }
    if (deepestPenetration <= 0) {
      this.collisionContactTime = 0;
      return;
    }
    this.collisionContactTime += dt;
    if (
      deepestPenetration >= COLLISION_DEEP_PENETRATION
      || this.collisionContactTime >= COLLISION_CONFIRM_TIME
    ) {
      this.collisionContactTime = 0;
      this.beginCrash();
    }
  }

  private updateCheckpoint(dt: number): void {
    if (this.mode === 'crashed' || this.isRolling || this.externalRemaining > 0 || this.pendingImpulse.lengthSq() > 0) return;
    this.checkpointTimer += dt;
    if (this.checkpointTimer < FLIGHT.checkpointInterval) return;
    this.checkpointTimer = 0;
    const path = this.terrain.sample(this.position.z);
    const routeDistance = Math.hypot(this.position.x - path.x, this.position.y - path.y);
    if (
      this.terrain.densityAt(this.position.x, this.position.y, this.position.z) <= -FLIGHT.safeClearance * 0.5
      && (!this.obstacles || this.obstacles.clearance(this.position, 15))
      && routeDistance < Math.min(path.width, path.height) * 0.65
    ) {
      this.checkpoint = this.captureCheckpoint();
    }
  }

  private beginCrash(): void {
    if (this.mode === 'crashed') return;
    this.crashElapsed = 0;
    this.actualSpeed = 0;
    this.clearExternalImpulse();
    this.cancelRoll();
    this.setMode('crashed');
    this.onCrash?.();
  }

  private captureCheckpoint(): SafeCheckpoint {
    return {
      position: this.position.clone(),
      yaw: this.yaw,
      pitch: this.pitch,
      roll: this.roll,
      speed: this.speed,
      throttle: this.throttle,
    };
  }

  private applyCheckpoint(checkpoint: SafeCheckpoint): void {
    this.clearExternalImpulse();
    this.onRecovery?.();
    this.avoidanceTarget.set(0, 0, 0);
    this.avoidanceOffset.set(0, 0, 0);
    this.cancelRoll();
    this.position.copy(checkpoint.position);
    this.yaw = checkpoint.yaw;
    this.pitch = checkpoint.pitch;
    this.roll = checkpoint.roll;
    this.speed = checkpoint.speed;
    this.actualSpeed = this.speed;
    this.throttle = checkpoint.throttle;
    this.collisionContactTime = 0;
    this.syncOrientation();
  }

  private restoreCheckpoint(): void {
    this.applyCheckpoint(this.checkpoint);
    this.speed = FLIGHT.nominalSpeed;
    this.actualSpeed = this.speed;
    this.throttle = (FLIGHT.nominalSpeed - FLIGHT.minSpeed) / (FLIGHT.maxSpeed - FLIGHT.minSpeed);
    this.setMode('autopilot');
  }

  reset(): void {
    this.applyCheckpoint(this.checkpoint ?? this.initialCheckpoint);
    this.setMode('autopilot');
  }

  resetToStart(): void {
    this.checkpoint = {
      ...this.initialCheckpoint,
      position: this.initialCheckpoint.position.clone(),
    };
    this.applyCheckpoint(this.initialCheckpoint);
    this.setMode('autopilot');
  }

  takeManualControl(): void {
    if (this.mode === 'autopilot') this.setMode('manual');
  }

  toggleAutopilot(): void {
    if (this.mode === 'crashed' || this.mode === 'loading' || this.isRolling) return;
    this.setMode(this.mode === 'autopilot' ? 'manual' : 'autopilot');
  }

  togglePause(): void {
    if (this.mode === 'crashed' || this.mode === 'loading') return;
    if (this.mode === 'paused') this.setMode(this.previousMode);
    else {
      this.previousMode = this.mode;
      this.setMode('paused');
    }
  }

  get altitudeAGL(): number {
    return -this.terrain.densityAt(this.position.x, this.position.y, this.position.z);
  }

  get crashIntensity(): number {
    if (this.mode !== 'crashed') return 0;
    return clamp(1 - this.crashElapsed / FLIGHT.crashDuration, 0, 1);
  }

  get hasTerrainContact(): boolean {
    return this.mode === 'crashed' || this.collisionContactTime > 0;
  }

  private setMode(mode: FlightMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.onModeChange?.(mode);
  }
}
