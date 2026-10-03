import { Euler, Quaternion, Vector3 } from 'three';
import {
  COLLISION_CONFIRM_TIME,
  COLLISION_DEEP_PENETRATION,
  COLLISION_TOLERANCE,
  FLIGHT,
} from '../core/config.ts';
import { COCKPIT_COLLISION_PROBES } from '../core/aircraftGeometry.ts';
import type {
  DriftState,
  DriftTier,
  FlightImpactSnapshot,
  FlightImpactSource,
  FlightInput,
  FlightMode,
  SafeCheckpoint,
} from '../core/types.ts';
import type { DynamicObstacleHit, DynamicObstacleProvider } from '../combat/types.ts';
import type { ProceduralTerrain } from '../world/TerrainModel.ts';
import { WingPose } from './WingPose.ts';
import {
  DEFAULT_FLIGHT_TUNING,
  sanitizeFlightTuning,
  type FlightTuningSettings,
} from './FlightTuning.ts';

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

function smoothstep(edge0: number, edge1: number, value: number): number {
  const span = Math.max(1e-6, edge1 - edge0);
  const amount = clamp((value - edge0) / span, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

export class FlightController {
  readonly wings = new WingPose();
  readonly position = new Vector3();
  /** Player/autopilot propulsion velocity. Explosion and dodge motion stay separate. */
  readonly controlVelocity = new Vector3();
  readonly previousControlVelocity = new Vector3();
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
  private readonly impactPoint = new Vector3();
  private readonly impactLocalPoint = new Vector3();
  private readonly collisionLocalPoint = new Vector3();
  private readonly impactNormal = new Vector3();
  private readonly impactVelocity = new Vector3();
  private readonly impactImpulse = new Vector3();
  private readonly obstacleHit: DynamicObstacleHit = {
    point: new Vector3(),
    localPoint: new Vector3(),
    normal: new Vector3(),
  };
  private readonly impactSnapshot = {
    point: new Vector3(),
    localPoint: new Vector3(),
    normal: new Vector3(),
    impulse: new Vector3(),
    severity: 0,
    source: 'terrain' as FlightImpactSource,
  };
  private impactCooldownRemaining = 0;
  onImpact?: (impact: FlightImpactSnapshot) => void;
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
    const probes = this.cockpitCollision ? COCKPIT_COLLISION_PROBES : this.wings.collisionProbes;
    const travel = this.previousPosition.distanceTo(this.position) + this.previousOrientation.angleTo(this.orientation) * 7;
    const steps = Math.min(16, Math.max(1, Math.ceil(travel)));
    for (let i = 0; i <= steps; i++) {
      this.blastPose.slerpQuaternions(this.previousOrientation, this.orientation, i / steps);
      this.blastPosition.lerpVectors(this.previousPosition, this.position, i / steps);
      for (const p of probes) {
        if (p instanceof Vector3) this.impactLocalPoint.copy(p);
        else this.impactLocalPoint.set(...p);
        this.samplePoint.copy(this.impactLocalPoint);
        this.samplePoint.applyQuaternion(this.blastPose).add(this.blastPosition);
        const density = this.terrain.collisionDensityAt?.(
          this.samplePoint.x,
          this.samplePoint.y,
          this.samplePoint.z,
        ) ?? this.terrain.densityAt(this.samplePoint.x, this.samplePoint.y, this.samplePoint.z);
        if (density > 0) {
          this.resolveSurfaceImpact(this.impactLocalPoint, this.samplePoint, 'terrain');
          return;
        }
      }
    }
  }
  /** Catch thin terrain crossed by tiered boost between endpoint checks. */
  private checkHighSpeedTerrainSweep(): void {
    const distance = this.previousPosition.distanceTo(this.position);
    const steps = Math.ceil(distance);
    if (steps <= 1 || this.mode === 'crashed') return;
    const probes = this.cockpitCollision ? COCKPIT_COLLISION_PROBES : this.wings.collisionProbes;
    for (let index = 1; index < steps; index += 1) {
      const amount = index / steps;
      this.blastPose.slerpQuaternions(this.previousOrientation, this.orientation, amount);
      this.blastPosition.lerpVectors(this.previousPosition, this.position, amount);
      for (const probe of probes) {
        if (probe instanceof Vector3) this.impactLocalPoint.copy(probe);
        else this.impactLocalPoint.set(...probe);
        this.samplePoint.copy(this.impactLocalPoint);
        this.samplePoint.applyQuaternion(this.blastPose).add(this.blastPosition);
        const density = this.terrain.collisionDensityAt?.(
          this.samplePoint.x,
          this.samplePoint.y,
          this.samplePoint.z,
        ) ?? this.terrain.densityAt(this.samplePoint.x, this.samplePoint.y, this.samplePoint.z);
        if (density + COLLISION_TOLERANCE >= COLLISION_DEEP_PENETRATION) {
          this.resolveSurfaceImpact(this.impactLocalPoint, this.samplePoint, 'terrain');
          return;
        }
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
  private readonly previousCameraOrientation = new Quaternion();
  private previousRollAngle = 0;
  private readonly avoidanceTarget = new Vector3();
  private readonly avoidanceOffset = new Vector3();
  onModeChange: ((mode: FlightMode) => void) | undefined;
  private readonly terrain: ProceduralTerrain;
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly forward = new Vector3();
  private readonly samplePoint = new Vector3();
  private checkpoint: SafeCheckpoint;
  private initialCheckpoint: SafeCheckpoint;
  private checkpointTimer = 0;
  private collisionContactTime = 0;
  private previousMode: FlightMode = 'autopilot';
  private tuning: FlightTuningSettings = { ...DEFAULT_FLIGHT_TUNING };
  driftEnergy = 0;
  driftAngle = 0;
  driftTier: DriftTier = 0;
  driftState: DriftState = 'cruise';
  boostKickAvailable = false;
  private driftGraceRemaining = 0;
  private driftEnergyAtStart = 0;
  private previousDriftHeld = false;
  private previousBoostHeld = false;
  private boostSuppressed = false;
  private readonly travelDirection = new Vector3(0, 0, 1);
  private readonly kickDirection = new Vector3();

  constructor(terrain: ProceduralTerrain) {
    this.terrain = terrain;
    const start = terrain.sample(0);
    this.position.set(start.x, start.y, 0);
    this.yaw = Math.atan2(start.tangentX, 1);
    this.pitch = -Math.atan(start.tangentY);
    this.syncOrientation();
    this.forward.set(0, 0, 1).applyQuaternion(this.orientation).normalize();
    this.controlVelocity.copy(this.forward).multiplyScalar(this.speed);
    this.previousControlVelocity.copy(this.controlVelocity);
    this.previousPosition.copy(this.position);
    this.previousOrientation.copy(this.orientation);
    this.previousCameraOrientation.copy(this.cameraOrientation);
    this.initialCheckpoint = this.captureCheckpoint();
    this.checkpoint = this.captureCheckpoint();
    this.setMode('autopilot');
  }

  update(dt: number, input: FlightInput): void {
    if (dt <= 0 || this.mode === 'paused' || this.mode === 'loading') return;
    this.previousPosition.copy(this.position);
    this.previousControlVelocity.copy(this.controlVelocity);
    this.previousOrientation.copy(this.orientation);
    this.previousCameraOrientation.copy(this.cameraOrientation);
    this.previousRollAngle = this.rollAngle;
    this.impactCooldownRemaining = Math.max(0, this.impactCooldownRemaining - dt);
    const driftHeld = input.driftHeld ?? false;
    const boostHeld = input.boostHeld ?? input.throttle > 0;
    if (input.pitch !== 0 || input.roll !== 0 || input.yaw !== 0 || driftHeld) this.takeManualControl();
    this.rollCooldown = Math.max(0, this.rollCooldown - dt);
    if (this.isRolling) this.updateRoll(dt);
    else if (this.mode === 'autopilot') this.updateAutopilot(dt, boostHeld ? 1 : 0);
    else this.updateManual(dt, input);

    this.syncOrientation();
    this.forward.set(0, 0, 1).applyQuaternion(this.orientation).normalize();
    this.updateDriftAndBoost(dt, driftHeld, boostHeld);
    this.updateControlVelocity(dt, driftHeld && this.mode === 'manual');
    this.wings.update(dt, this.throttle);
    this.position.addScaledVector(this.controlVelocity, dt);
    const blastMoved = this.advanceExternal(dt);
    this.actualSpeed = this.position.distanceTo(this.previousPosition) / dt;
    if (blastMoved) this.checkBlastTerrain();
    else this.checkHighSpeedTerrainSweep();
    if (this.obstacles?.sweepShip(
      this.previousPosition,
      this.position,
      this.previousOrientation,
      this.orientation,
      this.cockpitCollision,
      this.obstacleHit,
    )) {
      this.resolveImpact(
        this.obstacleHit.localPoint,
        this.obstacleHit.point,
        this.obstacleHit.normal,
        'meteor',
      );
    }
    this.checkCollision(dt);
    this.updateCheckpoint(dt);
  }

  private updateManual(dt: number, input: FlightInput): void {
    this.pitch = clamp(this.pitch + input.pitch * this.tuning.pitchRate * dt, -1.05, 1.05);
    this.roll = clamp(this.roll + input.roll * this.tuning.rollRate * dt, -1.25, 1.25);
    this.yaw = wrapAngle(this.yaw + (
      input.yaw * this.tuning.yawRate - this.roll * this.tuning.bankYawRate
    ) * dt);

    if (Math.abs(input.roll) < 0.01) this.roll = approach(this.roll, 0, this.tuning.rollAutoLevel * dt);
    if (Math.abs(input.pitch) < 0.01) this.pitch = approach(this.pitch, 0, this.tuning.pitchAutoLevel * dt);
  }

  private updateThrottle(dt: number, throttleInput: number): void {
    const cruiseThrottle = (FLIGHT.nominalSpeed - FLIGHT.minSpeed)
      / (FLIGHT.maxSpeed - FLIGHT.minSpeed);
    if (throttleInput > 0.01) {
      this.throttle = clamp(this.throttle + throttleInput * 0.28 * dt, 0, 1);
    } else {
      this.throttle = approach(this.throttle, cruiseThrottle, 0.32 * dt);
    }
    const targetSpeed = FLIGHT.minSpeed + this.throttle * (FLIGHT.maxSpeed - FLIGHT.minSpeed);
    this.speed = approach(this.speed, targetSpeed, 15 * dt);
  }

  configure(settings: FlightTuningSettings): void {
    this.tuning = sanitizeFlightTuning(settings);
    this.driftEnergy = clamp(this.driftEnergy, 0, 100);
    this.updateDriftTier();
  }

  get settings(): Readonly<FlightTuningSettings> { return this.tuning; }
  get controllableSpeed(): number { return this.controlVelocity.length(); }
  get driftBoostActive(): boolean { return this.driftState === 'drift-boost'; }
  get boostActive(): boolean {
    return this.driftState === 'drift-boost' || this.driftState === 'normal-boost';
  }

  sampleRenderVelocity(alpha: number, target: Vector3): Vector3 {
    return target.lerpVectors(
      this.previousControlVelocity,
      this.controlVelocity,
      clamp(alpha, 0, 1),
    );
  }

  private updateDriftAndBoost(dt: number, driftHeld: boolean, boostHeld: boolean): void {
    const driftPressed = driftHeld && !this.previousDriftHeld;
    const driftReleased = !driftHeld && this.previousDriftHeld;
    const boostPressed = boostHeld && !this.previousBoostHeld;

    if (driftPressed) {
      if (this.driftState === 'drift-boost') {
        this.driftEnergy = 0;
        this.driftTier = 0;
        this.boostKickAvailable = false;
      }
      this.driftEnergyAtStart = this.driftEnergy;
      this.driftState = 'drift';
      this.boostSuppressed = boostHeld;
    }
    if (this.boostSuppressed && !boostHeld) this.boostSuppressed = false;

    if (this.mode === 'autopilot') {
      this.clearDriftEnergy();
      this.driftState = boostHeld ? 'normal-boost' : 'cruise';
    } else if (driftHeld) {
      this.driftState = 'drift';
      this.driftGraceRemaining = this.tuning.driftGraceTime;
      this.approachManualSpeed(dt, FLIGHT.nominalSpeed, this.tuning.normalAcceleration);
    } else {
      if (driftReleased && this.driftEnergy > this.driftEnergyAtStart + 1e-6) {
        this.boostKickAvailable = true;
        this.driftGraceRemaining = this.tuning.driftGraceTime;
      }
      const effectiveBoost = boostHeld && !this.boostSuppressed;
      if (effectiveBoost && this.driftEnergy > 1e-6) {
        const entering = this.driftState !== 'drift-boost';
        this.updateDriftTier();
        this.driftState = 'drift-boost';
        if (entering && boostPressed && this.boostKickAvailable) {
          this.applyDriftBoostKick(this.driftTier);
          this.boostKickAvailable = false;
        }
        this.approachManualSpeed(
          dt,
          this.tierValue(
            this.tuning.driftBoostSpeedOne,
            this.tuning.driftBoostSpeedTwo,
            this.tuning.driftBoostSpeedThree,
          ),
          this.tierValue(
            this.tuning.driftBoostAccelerationOne,
            this.tuning.driftBoostAccelerationTwo,
            this.tuning.driftBoostAccelerationThree,
          ),
        );
        this.driftEnergy = Math.max(0, this.driftEnergy - this.tierValue(
          this.tuning.driftBoostDrainOne,
          this.tuning.driftBoostDrainTwo,
          this.tuning.driftBoostDrainThree,
        ) * dt);
        this.updateDriftTier();
        if (this.driftEnergy <= 1e-6) {
          this.clearDriftEnergy();
          this.driftState = 'normal-boost';
        }
      } else {
        if (effectiveBoost) {
          this.driftState = 'normal-boost';
          this.approachManualSpeed(dt, FLIGHT.maxSpeed, this.tuning.normalAcceleration);
        } else {
          this.approachManualSpeed(dt, FLIGHT.nominalSpeed, this.tuning.normalAcceleration);
          if (this.driftEnergy > 1e-6) {
            this.driftState = 'banked';
            if (this.driftGraceRemaining > 0) {
              this.driftGraceRemaining = Math.max(0, this.driftGraceRemaining - dt);
            } else {
              this.driftEnergy = Math.max(0, this.driftEnergy - this.tuning.driftPassiveDecay * dt);
              this.updateDriftTier();
            }
          } else {
            this.clearDriftEnergy();
            this.driftState = 'cruise';
          }
        }
      }
    }

    if (this.mode !== 'autopilot') {
      const cruiseThrottle = (FLIGHT.nominalSpeed - FLIGHT.minSpeed)
        / (FLIGHT.maxSpeed - FLIGHT.minSpeed);
      const throttleTarget = this.boostActive ? 1 : cruiseThrottle;
      this.throttle = approach(this.throttle, throttleTarget, (this.boostActive ? 0.28 : 0.32) * dt);
    }
    this.previousDriftHeld = driftHeld;
    this.previousBoostHeld = boostHeld;
  }

  private updateControlVelocity(dt: number, drifting: boolean): void {
    if (this.controlVelocity.lengthSq() < 1e-8) {
      this.travelDirection.copy(this.forward);
    } else {
      this.travelDirection.copy(this.controlVelocity).normalize();
    }
    const grip = drifting ? this.tuning.driftGrip : this.tuning.normalGrip;
    const alignment = 1 - Math.exp(-Math.max(0, grip) * dt);
    if (this.mode === 'autopilot') this.travelDirection.copy(this.forward);
    else this.travelDirection.lerp(this.forward, alignment);
    if (this.travelDirection.lengthSq() < 1e-8) this.travelDirection.copy(this.forward);
    else this.travelDirection.normalize();
    this.controlVelocity.copy(this.travelDirection).multiplyScalar(Math.max(0, this.speed));
    this.speed = this.controlVelocity.length();
    this.driftAngle = Math.acos(clamp(this.forward.dot(this.travelDirection), -1, 1)) * 180 / Math.PI;

    if (drifting && !this.isRolling && this.mode === 'manual') {
      const scoringAngle = Math.min(this.tuning.driftMaxAngle, this.driftAngle);
      const angleFactor = smoothstep(
        this.tuning.driftMinAngle,
        this.tuning.driftFullAngle,
        scoringAngle,
      );
      const speedRatio = clamp(this.speed / FLIGHT.nominalSpeed, 0.5, 1.5);
      const speedFactor = 1 + (speedRatio - 1) * this.tuning.driftSpeedInfluence;
      this.driftEnergy = Math.min(
        100,
        this.driftEnergy + this.tuning.driftChargeRate * angleFactor * speedFactor * dt,
      );
      this.updateDriftTier();
    }
  }

  private approachManualSpeed(dt: number, target: number, acceleration: number): void {
    this.speed = approach(this.speed, target, Math.max(0, acceleration) * dt);
  }

  private applyDriftBoostKick(tier: DriftTier): void {
    if (tier === 0) return;
    const kick = this.tierValue(
      this.tuning.driftBoostKickOne,
      this.tuning.driftBoostKickTwo,
      this.tuning.driftBoostKickThree,
    );
    if (kick <= 0) return;
    this.kickDirection.copy(this.controlVelocity);
    if (this.kickDirection.lengthSq() < 1e-8) this.kickDirection.copy(this.forward);
    else this.kickDirection.normalize();
    this.kickDirection.lerp(this.forward, this.tuning.driftBoostNoseBias).normalize();
    this.controlVelocity.addScaledVector(this.kickDirection, kick);
    this.speed = this.controlVelocity.length();
  }

  private tierValue(one: number, two: number, three: number): number {
    return this.driftTier === 3 ? three : this.driftTier === 2 ? two : one;
  }

  private updateDriftTier(): void {
    const energy = this.driftEnergy;
    const two = this.tuning.driftTierTwo;
    const three = this.tuning.driftTierThree;
    const hysteresis = this.tuning.driftTierHysteresis;
    if (energy <= 1e-6) this.driftTier = 0;
    else if (this.driftTier === 3 && energy >= three - hysteresis) this.driftTier = 3;
    else if (this.driftTier === 2 && energy >= two - hysteresis && energy < three + hysteresis) this.driftTier = 2;
    else if (this.driftTier === 1 && energy < two + hysteresis) this.driftTier = 1;
    else this.driftTier = energy >= three ? 3 : energy >= two ? 2 : 1;
  }

  private clearDriftEnergy(): void {
    this.driftEnergy = 0;
    this.driftTier = 0;
    this.driftGraceRemaining = 0;
    this.boostKickAvailable = false;
  }

  private resetDriftState(): void {
    this.clearDriftEnergy();
    this.driftAngle = 0;
    this.driftState = 'cruise';
    this.previousDriftHeld = false;
    this.previousBoostHeld = false;
    this.boostSuppressed = false;
  }

  get isRolling(): boolean { return this.rollDirection !== 0; }
  get maneuverRollAngle(): number { return this.rollAngle; }

  /** Smooth render-only pose between fixed simulation states. Physics stays authoritative. */
  sampleRenderPose(
    alpha: number,
    position: Vector3,
    orientation: Quaternion,
    cameraOrientation: Quaternion,
  ): number {
    const amount = clamp(alpha, 0, 1);
    position.lerpVectors(this.previousPosition, this.position, amount);
    orientation.slerpQuaternions(this.previousOrientation, this.orientation, amount);
    cameraOrientation.slerpQuaternions(
      this.previousCameraOrientation,
      this.cameraOrientation,
      amount,
    );
    let currentRoll = this.rollAngle;
    if (currentRoll === 0 && Math.abs(this.previousRollAngle) > Math.PI) {
      currentRoll = Math.sign(this.previousRollAngle) * Math.PI * 2;
    }
    return this.previousRollAngle + (currentRoll - this.previousRollAngle) * amount;
  }

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
    if (throttleInput > 0.01) {
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
    if (this.impactCooldownRemaining > 0) {
      this.collisionContactTime = 0;
      return;
    }
    let deepestPenetration = 0;
    const probes = this.cockpitCollision ? COCKPIT_COLLISION_PROBES : this.wings.collisionProbes;
    const orientation = this.orientation;
    for (const offset of probes) {
      if (offset instanceof Vector3) this.impactLocalPoint.copy(offset);
      else this.impactLocalPoint.set(offset[0], offset[1], offset[2]);
      this.samplePoint.copy(this.impactLocalPoint);
      this.samplePoint.applyQuaternion(orientation).add(this.position);
      const collisionDensity = this.terrain.collisionDensityAt?.(
        this.samplePoint.x,
        this.samplePoint.y,
        this.samplePoint.z,
      ) ?? this.terrain.densityAt(this.samplePoint.x, this.samplePoint.y, this.samplePoint.z);
      const penetration = collisionDensity + COLLISION_TOLERANCE;
      if (penetration > deepestPenetration) {
        deepestPenetration = penetration;
        this.impactPoint.copy(this.samplePoint);
        this.collisionLocalPoint.copy(this.impactLocalPoint);
      }
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
      this.resolveSurfaceImpact(this.collisionLocalPoint, this.impactPoint, 'terrain');
    }
  }

  private resolveSurfaceImpact(
    localPoint: Vector3,
    worldPoint: Vector3,
    source: FlightImpactSource,
  ): void {
    const epsilon = 0.5;
    const density = (x: number, y: number, z: number) => this.terrain.collisionDensityAt?.(x, y, z)
      ?? this.terrain.densityAt(x, y, z);
    this.impactNormal.set(
      density(worldPoint.x - epsilon, worldPoint.y, worldPoint.z)
        - density(worldPoint.x + epsilon, worldPoint.y, worldPoint.z),
      density(worldPoint.x, worldPoint.y - epsilon, worldPoint.z)
        - density(worldPoint.x, worldPoint.y + epsilon, worldPoint.z),
      density(worldPoint.x, worldPoint.y, worldPoint.z - epsilon)
        - density(worldPoint.x, worldPoint.y, worldPoint.z + epsilon),
    );
    if (this.impactNormal.lengthSq() < 1e-8) {
      this.impactNormal.copy(this.controlVelocity).add(this.externalVelocity).negate();
    }
    if (this.impactNormal.lengthSq() < 1e-8) this.impactNormal.set(0, 1, 0);
    else this.impactNormal.normalize();
    this.resolveImpact(localPoint, worldPoint, this.impactNormal, source);
  }

  private resolveImpact(
    localPoint: Vector3,
    worldPoint: Vector3,
    normal: Vector3,
    source: FlightImpactSource,
  ): void {
    if (this.impactCooldownRemaining > 0) return;
    this.impactNormal.copy(normal);
    if (this.impactNormal.lengthSq() < 1e-8) this.impactNormal.copy(this.forward).negate();
    else this.impactNormal.normalize();
    this.impactVelocity.copy(this.controlVelocity).add(this.externalVelocity);
    const incomingSpeed = Math.max(0, -this.impactVelocity.dot(this.impactNormal));
    const push = clamp(
      this.tuning.impactMinPush + incomingSpeed * this.tuning.impactPushScale,
      this.tuning.impactMinPush,
      this.tuning.impactMaxPush,
    );
    this.impactImpulse.copy(this.impactNormal).multiplyScalar(push);
    this.position.copy(this.previousPosition).addScaledVector(this.impactNormal, 0.35);
    const controlIntoSurface = this.controlVelocity.dot(this.impactNormal);
    if (controlIntoSurface < 0) {
      this.controlVelocity.addScaledVector(this.impactNormal, -controlIntoSurface * 1.1);
      this.speed = this.controlVelocity.length();
    }
    this.applyExternalImpulse(this.impactImpulse, this.tuning.impactPushDuration);
    this.impactCooldownRemaining = this.tuning.impactCooldown;
    this.collisionContactTime = 0;
    this.cancelRoll();
    this.impactSnapshot.point.copy(worldPoint);
    this.impactSnapshot.localPoint.copy(localPoint);
    this.impactSnapshot.normal.copy(this.impactNormal);
    this.impactSnapshot.impulse.copy(this.impactImpulse);
    this.impactSnapshot.severity = this.tuning.impactMaxPush > 0
      ? clamp(push / this.tuning.impactMaxPush, 0, 1)
      : 0;
    this.impactSnapshot.source = source;
    this.onImpact?.(this.impactSnapshot);
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
    this.wings.reset(this.throttle);
    this.collisionContactTime = 0;
    this.syncOrientation();
    this.forward.set(0, 0, 1).applyQuaternion(this.orientation).normalize();
    this.controlVelocity.copy(this.forward).multiplyScalar(this.speed);
    this.previousControlVelocity.copy(this.controlVelocity);
    this.resetDriftState();
    this.previousPosition.copy(this.position);
    this.previousOrientation.copy(this.orientation);
    this.previousCameraOrientation.copy(this.cameraOrientation);
    this.previousRollAngle = this.rollAngle;
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
    return 0;
  }

  get hasTerrainContact(): boolean {
    return this.impactCooldownRemaining > 0 || this.collisionContactTime > 0;
  }

  private setMode(mode: FlightMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'autopilot') {
      this.resetDriftState();
      this.forward.set(0, 0, 1).applyQuaternion(this.orientation).normalize();
      this.controlVelocity.copy(this.forward).multiplyScalar(this.speed);
      this.previousControlVelocity.copy(this.controlVelocity);
    }
    this.onModeChange?.(mode);
  }
}
