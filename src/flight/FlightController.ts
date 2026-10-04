import { Euler, Quaternion, Vector3 } from 'three';
import {
  COLLISION_CONFIRM_TIME,
  COLLISION_DEEP_PENETRATION,
  COLLISION_TOLERANCE,
  FLIGHT,
} from '../core/config.ts';
import { COCKPIT_COLLISION_PROBES } from '../core/aircraftGeometry.ts';
import type {
  BoostState,
  DriftTier,
  EnergyActivity,
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
import { buildSlipCurveLookup, evaluateSlipCurve } from './SlipResponse.ts';

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
  private readonly impactPostVelocity = new Vector3();
  private readonly impactRelativeBefore = new Vector3();
  private readonly impactRelativeAfter = new Vector3();
  private readonly impactTangent = new Vector3();
  private readonly impactExternalAfter = new Vector3();
  private readonly staticSurfaceVelocity = new Vector3();
  private readonly contactNormal = new Vector3();
  private readonly obstacleHit: DynamicObstacleHit = {
    point: new Vector3(),
    localPoint: new Vector3(),
    normal: new Vector3(),
    surfaceVelocity: new Vector3(),
  };
  private readonly impactSnapshot = {
    point: new Vector3(),
    localPoint: new Vector3(),
    normal: new Vector3(),
    surfaceVelocity: new Vector3(),
    relativeVelocityBefore: new Vector3(),
    relativeVelocityAfter: new Vector3(),
    tangentialDirection: new Vector3(),
    normalSpeed: 0,
    tangentialSpeed: 0,
    dissipatedEnergy: 0,
    dissipatedSpeed: 0,
    severity: 0,
    source: 'terrain' as FlightImpactSource,
    initialContact: true,
  };
  private contactActive = false;
  private contactSeenThisStep = false;
  private contactFreeSteps = 0;
  private contactSource: FlightImpactSource = 'terrain';
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
  private readonly previousForward = new Vector3();
  readonly effectiveVelocity = new Vector3();
  readonly slipVector = new Vector3();
  private readonly scoringVelocity = new Vector3();
  private readonly scoringSlip = new Vector3();
  private readonly samplePoint = new Vector3();
  private checkpoint: SafeCheckpoint;
  private initialCheckpoint: SafeCheckpoint;
  private checkpointTimer = 0;
  private collisionContactTime = 0;
  private previousMode: FlightMode = 'autopilot';
  private tuning: FlightTuningSettings = { ...DEFAULT_FLIGHT_TUNING };
  driftEnergy = 0;
  driftAngle = 0;
  slipSpeed = 0;
  normalizedSlip = 0;
  slipIntensity = 0;
  visualSlipIntensity = 0;
  currentChargeRate = 0;
  currentDrainRate = 0;
  driftTier: DriftTier = 0;
  boostState: BoostState = 'cruise';
  energyActivity: EnergyActivity = 'idle';
  boostKickAvailable = false;
  private driftGraceRemaining = 0;
  private previousBoostHeld = false;
  private boostReleaseLatch = 0;
  private boostHeldThisStep = false;
  private collisionChargeSuppression = 0;
  private gripReduction = 0;
  private autopilotSafetyAlignment = false;
  private readonly slipCurveLookup = new Float32Array(129);
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
    this.previousForward.copy(this.forward);
    this.controlVelocity.copy(this.forward).multiplyScalar(this.speed);
    this.previousControlVelocity.copy(this.controlVelocity);
    this.previousPosition.copy(this.position);
    this.previousOrientation.copy(this.orientation);
    this.previousCameraOrientation.copy(this.cameraOrientation);
    this.rebuildSlipCurve();
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
    this.contactSeenThisStep = false;
    const boostHeld = input.boostHeld ?? input.throttle > 0;
    this.boostHeldThisStep = boostHeld;
    if (input.pitch !== 0 || input.roll !== 0 || input.yaw !== 0) this.takeManualControl();
    this.collisionChargeSuppression = Math.max(0, this.collisionChargeSuppression - dt);
    this.rollCooldown = Math.max(0, this.rollCooldown - dt);
    if (this.isRolling) this.updateRoll(dt);
    else if (this.mode === 'autopilot') this.updateAutopilot(dt, boostHeld ? 1 : 0);
    else this.updateManual(dt, input);

    this.syncOrientation();
    this.forward.set(0, 0, 1).applyQuaternion(this.orientation).normalize();
    const boostPressed = input.boostPressed ?? (boostHeld && !this.previousBoostHeld);
    const boostReleased = input.boostReleased ?? (!boostHeld && this.previousBoostHeld);
    this.updateBoostState(dt, boostHeld, boostPressed, boostReleased);
    this.updateControlVelocity(dt);
    this.updateSlipSignal(true);
    this.updateDriftEnergy(dt);
    this.wings.update(dt, this.throttle);
    this.position.addScaledVector(this.controlVelocity, dt);
    const blastMoved = this.advanceExternal(dt);
    if (blastMoved) this.checkBlastTerrain();
    else this.checkHighSpeedTerrainSweep();
    if (!this.contactSeenThisStep && this.obstacles?.sweepShip(
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
        this.obstacleHit.surfaceVelocity,
        'meteor',
      );
    }
    if (!this.contactSeenThisStep) this.checkCollision(dt);
    this.finishContactStep();
    this.updateSlipSignal(false);
    this.updateVisualSlip(dt);
    this.actualSpeed = this.position.distanceTo(this.previousPosition) / dt;
    this.updateCheckpoint(dt);
    this.previousForward.copy(this.forward);
    this.previousBoostHeld = boostHeld;
  }

  private updateManual(dt: number, input: FlightInput): void {
    this.autopilotSafetyAlignment = false;
    this.pitch = clamp(this.pitch + input.pitch * this.tuning.pitchRate * dt, -1.05, 1.05);
    this.roll = clamp(this.roll + input.roll * this.tuning.rollRate * dt, -1.25, 1.25);
    this.yaw = wrapAngle(this.yaw + (
      input.yaw * this.tuning.yawRate - this.roll * this.tuning.bankYawRate
    ) * dt);

    if (Math.abs(input.roll) < 0.01) this.roll = approach(this.roll, 0, this.tuning.rollAutoLevel * dt);
    if (Math.abs(input.pitch) < 0.01) this.pitch = approach(this.pitch, 0, this.tuning.pitchAutoLevel * dt);
  }

  private updateThrottle(dt: number, throttleInput: number): void {
    const boostTopSpeed = this.tuning.normalBoostTopSpeed;
    const cruiseThrottle = (this.tuning.normalTopSpeed - FLIGHT.minSpeed)
      / (boostTopSpeed - FLIGHT.minSpeed);
    if (throttleInput > 0.01) {
      this.throttle = clamp(this.throttle + throttleInput * 0.28 * dt, 0, 1);
    } else {
      this.throttle = approach(this.throttle, cruiseThrottle, 0.32 * dt);
    }
    const targetSpeed = FLIGHT.minSpeed + this.throttle * (boostTopSpeed - FLIGHT.minSpeed);
    this.speed = approach(this.speed, targetSpeed, 15 * dt);
  }

  configure(settings: FlightTuningSettings): void {
    this.tuning = sanitizeFlightTuning(settings);
    this.rebuildSlipCurve();
    this.throttle = clamp(
      (this.speed - FLIGHT.minSpeed) / (this.tuning.normalBoostTopSpeed - FLIGHT.minSpeed),
      0,
      1,
    );
    this.driftEnergy = clamp(this.driftEnergy, 0, 100);
    this.updateDriftTier();
  }

  get settings(): Readonly<FlightTuningSettings> { return this.tuning; }
  get controllableSpeed(): number { return this.controlVelocity.length(); }
  get driftBoostActive(): boolean { return this.boostState === 'drift-boost'; }
  get boostActive(): boolean {
    return this.boostState !== 'cruise';
  }

  sampleRenderVelocity(alpha: number, target: Vector3): Vector3 {
    return target.lerpVectors(
      this.previousControlVelocity,
      this.controlVelocity,
      clamp(alpha, 0, 1),
    );
  }

  private updateBoostState(dt: number, boostHeld: boolean, boostPressed: boolean, boostReleased: boolean): void {
    if (boostReleased) {
      if (this.boostState === 'normal-boost' && this.driftEnergy > 1e-6) {
        this.boostReleaseLatch = this.tuning.boostRepressWindow;
      } else {
        this.boostReleaseLatch = 0;
        this.boostState = 'cruise';
      }
    }
    if (!boostHeld && this.boostReleaseLatch > 0) {
      this.boostReleaseLatch = Math.max(0, this.boostReleaseLatch - dt);
      if (this.boostReleaseLatch === 0) this.boostState = 'cruise';
    }
    if (boostPressed) {
      const canDriftBoost = this.driftEnergy > 1e-6;
      this.boostReleaseLatch = 0;
      this.boostState = canDriftBoost ? 'drift-boost' : 'normal-boost';
      if (canDriftBoost && this.boostKickAvailable) {
        this.updateDriftTier();
        this.applyDriftBoostKick(this.driftTier);
        this.boostKickAvailable = false;
      }
    } else if (boostHeld && this.boostState === 'cruise') {
      this.boostState = this.driftEnergy > 1e-6 ? 'drift-boost' : 'normal-boost';
    }

    if (this.boostState === 'drift-boost' && this.driftEnergy <= 1e-6) {
      this.boostState = boostHeld ? 'normal-boost' : 'cruise';
    }
    if (this.boostState === 'drift-boost') {
      this.updateDriftTier();
      this.approachManualSpeed(dt, this.tierValue(
        this.tuning.driftBoostSpeedOne,
        this.tuning.driftBoostSpeedTwo,
        this.tuning.driftBoostSpeedThree,
      ), this.tierValue(
        this.tuning.driftBoostAccelerationOne,
        this.tuning.driftBoostAccelerationTwo,
        this.tuning.driftBoostAccelerationThree,
      ));
    } else if (this.boostState === 'normal-boost' && this.mode !== 'autopilot') {
      this.approachManualSpeed(dt, this.tuning.normalBoostTopSpeed, this.tuning.normalAcceleration);
    } else if (this.mode !== 'autopilot') {
      this.approachManualSpeed(dt, this.tuning.normalTopSpeed, this.tuning.normalAcceleration);
    }

    if (this.mode !== 'autopilot') {
      const cruiseThrottle = (this.tuning.normalTopSpeed - FLIGHT.minSpeed)
        / (this.tuning.normalBoostTopSpeed - FLIGHT.minSpeed);
      const throttleTarget = this.boostActive ? 1 : cruiseThrottle;
      this.throttle = approach(this.throttle, throttleTarget, (this.boostActive ? 0.28 : 0.32) * dt);
    }
  }

  private updateControlVelocity(dt: number): void {
    if (this.controlVelocity.lengthSq() < 1e-8) {
      this.travelDirection.copy(this.forward);
    } else {
      this.travelDirection.copy(this.controlVelocity).normalize();
    }
    const turnRate = this.previousForward.lengthSq() > 0 && dt > 0
      ? this.previousForward.angleTo(this.forward) / dt : 0;
    const requestedReduction = this.mode === 'autopilot' ? 0 : smoothstep(
      this.tuning.turnSlipStartRate,
      this.tuning.turnSlipFullRate,
      turnRate,
    );
    const response = requestedReduction > this.gripReduction
      ? this.tuning.gripEngageResponse : this.tuning.gripRecoveryResponse;
    this.gripReduction += (requestedReduction - this.gripReduction)
      * (1 - Math.exp(-dt / Math.max(0.001, response)));
    const grip = this.mode === 'autopilot'
      ? this.tuning.normalGrip
      : this.tuning.normalGrip
        + (this.tuning.hardTurnGrip - this.tuning.normalGrip) * this.gripReduction;
    const alignment = 1 - Math.exp(-Math.max(0, grip) * dt);
    if (this.mode === 'autopilot' && this.autopilotSafetyAlignment) this.travelDirection.copy(this.forward);
    else this.travelDirection.lerp(this.forward, alignment);
    if (this.travelDirection.lengthSq() < 1e-8) this.travelDirection.copy(this.forward);
    else this.travelDirection.normalize();
    this.controlVelocity.copy(this.travelDirection).multiplyScalar(Math.max(0, this.speed));
    this.speed = this.controlVelocity.length();
  }

  private rebuildSlipCurve(): void {
    buildSlipCurveLookup({
      preset: this.tuning.slipCurvePreset,
      x1: this.tuning.slipCurveX1,
      y1: this.tuning.slipCurveY1,
      x2: this.tuning.slipCurveX2,
      y2: this.tuning.slipCurveY2,
    }, this.slipCurveLookup);
  }

  private updateSlipSignal(forScoring: boolean): void {
    this.effectiveVelocity.copy(this.controlVelocity).add(this.externalVelocity);
    const effectiveSpeed = this.effectiveVelocity.length();
    this.slipVector.copy(this.effectiveVelocity)
      .addScaledVector(this.forward, -this.effectiveVelocity.dot(this.forward));
    const reverseSpeed = Math.max(0, -this.effectiveVelocity.dot(this.forward));
    this.slipSpeed = Math.hypot(this.slipVector.length(), reverseSpeed);
    this.driftAngle = effectiveSpeed > 1e-6
      ? Math.acos(clamp(this.forward.dot(this.effectiveVelocity) / effectiveSpeed, -1, 1)) * 180 / Math.PI
      : 0;
    this.normalizedSlip = clamp(
      (this.slipSpeed - this.tuning.slipStartSpeed)
        / Math.max(1e-6, this.tuning.slipFullSpeed - this.tuning.slipStartSpeed),
      0,
      1,
    );
    this.slipIntensity = evaluateSlipCurve(this.slipCurveLookup, this.normalizedSlip);
    if (!forScoring) return;
    this.scoringVelocity.copy(this.controlVelocity);
    if (this.collisionChargeSuppression > 0 || this.contactActive) {
      this.scoringVelocity.copy(this.forward).multiplyScalar(this.controlVelocity.dot(this.forward));
    }
    this.scoringVelocity.add(this.externalVelocity);
    this.scoringSlip.copy(this.scoringVelocity)
      .addScaledVector(this.forward, -this.scoringVelocity.dot(this.forward));
    const scoringReverse = Math.max(0, -this.scoringVelocity.dot(this.forward));
    const scoringSpeed = Math.hypot(this.scoringSlip.length(), scoringReverse);
    const scoringNormalized = clamp(
      (scoringSpeed - this.tuning.slipStartSpeed)
        / Math.max(1e-6, this.tuning.slipFullSpeed - this.tuning.slipStartSpeed),
      0,
      1,
    );
    this.currentChargeRate = this.isRolling
      ? 0 : this.tuning.slipChargeRate * evaluateSlipCurve(this.slipCurveLookup, scoringNormalized);
  }

  private updateDriftEnergy(dt: number): void {
    const hadEnergy = this.driftEnergy > 1e-6;
    this.currentDrainRate = 0;
    if (this.boostState === 'drift-boost') {
      this.currentDrainRate = this.tierValue(
        this.tuning.driftBoostDrainOne,
        this.tuning.driftBoostDrainTwo,
        this.tuning.driftBoostDrainThree,
      );
      this.driftEnergy = clamp(
        this.driftEnergy + (this.currentChargeRate - this.currentDrainRate) * dt,
        0,
        100,
      );
      this.energyActivity = this.currentChargeRate > 1e-6 ? 'charging' : 'banked';
    } else if (this.currentChargeRate > 1e-6) {
      this.driftEnergy = Math.min(100, this.driftEnergy + this.currentChargeRate * dt);
      this.driftGraceRemaining = this.tuning.driftGraceTime;
      this.energyActivity = 'charging';
    } else if (this.driftEnergy > 1e-6) {
      if (this.driftGraceRemaining > 0) {
        this.driftGraceRemaining = Math.max(0, this.driftGraceRemaining - dt);
        this.energyActivity = 'banked';
      } else {
        this.driftEnergy = Math.max(0, this.driftEnergy - this.tuning.driftPassiveDecay * dt);
        this.energyActivity = this.driftEnergy > 1e-6 ? 'decaying' : 'idle';
      }
    } else {
      this.energyActivity = 'idle';
    }
    if (!hadEnergy && this.driftEnergy > 1e-6) this.boostKickAvailable = true;
    if (this.driftEnergy <= 1e-6) {
      this.clearDriftEnergy();
      if (this.boostState === 'drift-boost') {
        this.boostState = this.boostHeldThisStep ? 'normal-boost' : 'cruise';
      }
    } else {
      this.updateDriftTier();
    }
  }

  private updateVisualSlip(dt: number): void {
    const response = this.slipIntensity > this.visualSlipIntensity
      ? this.tuning.slipVisualAttack : this.tuning.slipVisualRelease;
    this.visualSlipIntensity += (this.slipIntensity - this.visualSlipIntensity)
      * (1 - Math.exp(-dt / Math.max(0.001, response)));
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
    this.currentChargeRate = 0;
    this.currentDrainRate = 0;
    this.energyActivity = 'idle';
  }

  private resetDriftState(): void {
    this.clearDriftEnergy();
    this.driftAngle = 0;
    this.slipSpeed = 0;
    this.normalizedSlip = 0;
    this.slipIntensity = 0;
    this.visualSlipIntensity = 0;
    this.boostState = 'cruise';
    this.previousBoostHeld = false;
    this.boostReleaseLatch = 0;
    this.gripReduction = 0;
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
    this.autopilotSafetyAlignment = avoidance > 0
      || Math.abs(yawError) > 0.08
      || Math.abs(pitchError) > 0.07;
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
    const cruiseThrottle = (this.tuning.normalTopSpeed - FLIGHT.minSpeed)
      / (this.tuning.normalBoostTopSpeed - FLIGHT.minSpeed);
    const targetThrottle = cruiseThrottle - turnPenalty;
    this.throttle = approach(this.throttle, targetThrottle, 0.22 * dt);
    const targetSpeed = FLIGHT.minSpeed
      + this.throttle * (this.tuning.normalBoostTopSpeed - FLIGHT.minSpeed);
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
    this.resolveImpact(
      localPoint,
      worldPoint,
      this.impactNormal,
      this.staticSurfaceVelocity,
      source,
    );
  }

  private resolveImpact(
    localPoint: Vector3,
    worldPoint: Vector3,
    normal: Vector3,
    surfaceVelocity: Vector3,
    source: FlightImpactSource,
  ): void {
    this.impactNormal.copy(normal);
    if (this.impactNormal.lengthSq() < 1e-8) this.impactNormal.copy(this.forward).negate();
    else this.impactNormal.normalize();

    const initialContact = !this.contactActive
      || this.contactSource !== source
      || this.contactNormal.dot(this.impactNormal) < 0.7;
    this.contactActive = true;
    this.contactSeenThisStep = true;
    this.contactFreeSteps = 0;
    this.contactSource = source;
    this.contactNormal.copy(this.impactNormal);
    this.collisionChargeSuppression = this.tuning.slipCollisionSuppressTime;

    this.impactVelocity.copy(this.controlVelocity).add(this.externalVelocity);
    this.impactRelativeBefore.copy(this.impactVelocity).sub(surfaceVelocity);
    const normalVelocity = this.impactRelativeBefore.dot(this.impactNormal);
    const incomingNormalSpeed = Math.max(0, -normalVelocity);
    this.impactTangent.copy(this.impactRelativeBefore)
      .addScaledVector(this.impactNormal, -normalVelocity);
    const tangentialSpeed = this.impactTangent.length();
    const tangentialLoss = Math.min(
      tangentialSpeed,
      this.tuning.collisionFriction * incomingNormalSpeed,
    );
    const tangentialScale = tangentialSpeed > 1e-8
      ? Math.max(0, (tangentialSpeed - tangentialLoss) / tangentialSpeed)
      : 0;
    this.impactRelativeAfter.copy(this.impactTangent).multiplyScalar(tangentialScale);
    let separationSpeed = normalVelocity > 0
      ? normalVelocity
      : incomingNormalSpeed * this.tuning.collisionRestitution;
    if (initialContact) {
      separationSpeed = Math.max(separationSpeed, this.tuning.collisionSeparationSpeed);
    }
    this.impactRelativeAfter.addScaledVector(this.impactNormal, separationSpeed);
    this.impactPostVelocity.copy(this.impactRelativeAfter).add(surfaceVelocity);

    // Preserve the identity of explosion displacement while filtering it through
    // the same contact plane. The controllable component supplies the exact
    // remainder, so their combined post-impact velocity is authoritative.
    const externalNormalSpeed = this.externalVelocity.dot(this.impactNormal);
    const externalNormalAfter = externalNormalSpeed < 0
      ? -externalNormalSpeed * this.tuning.collisionRestitution
      : externalNormalSpeed;
    this.impactExternalAfter.copy(this.externalVelocity)
      .addScaledVector(this.impactNormal, -externalNormalSpeed)
      .multiplyScalar(tangentialScale)
      .addScaledVector(this.impactNormal, externalNormalAfter);
    this.externalVelocity.copy(this.impactExternalAfter);
    this.controlVelocity.copy(this.impactPostVelocity).sub(this.externalVelocity);
    this.speed = this.controlVelocity.length();
    this.position.copy(this.previousPosition).addScaledVector(this.impactNormal, 0.15);
    this.collisionContactTime = 0;
    this.cancelRoll();

    const beforeSq = this.impactRelativeBefore.lengthSq();
    const afterSq = this.impactRelativeAfter.lengthSq();
    const dissipatedEnergy = Math.max(0, 0.5 * (beforeSq - afterSq));
    const dissipatedSpeed = Math.sqrt(dissipatedEnergy * 2);
    this.impactSnapshot.point.copy(worldPoint);
    this.impactSnapshot.localPoint.copy(localPoint);
    this.impactSnapshot.normal.copy(this.impactNormal);
    this.impactSnapshot.surfaceVelocity.copy(surfaceVelocity);
    this.impactSnapshot.relativeVelocityBefore.copy(this.impactRelativeBefore);
    this.impactSnapshot.relativeVelocityAfter.copy(this.impactRelativeAfter);
    this.impactSnapshot.tangentialDirection.copy(this.impactTangent);
    if (tangentialSpeed > 1e-8) this.impactSnapshot.tangentialDirection.divideScalar(tangentialSpeed);
    else this.impactSnapshot.tangentialDirection.set(0, 0, 0);
    this.impactSnapshot.normalSpeed = incomingNormalSpeed;
    this.impactSnapshot.tangentialSpeed = tangentialSpeed;
    this.impactSnapshot.dissipatedEnergy = dissipatedEnergy;
    this.impactSnapshot.dissipatedSpeed = dissipatedSpeed;
    this.impactSnapshot.severity = clamp(dissipatedSpeed / 80, 0, 1);
    this.impactSnapshot.source = source;
    this.impactSnapshot.initialContact = initialContact;
    if (initialContact || dissipatedSpeed > 0.5) this.onImpact?.(this.impactSnapshot);
  }

  private finishContactStep(): void {
    if (this.contactSeenThisStep) return;
    this.contactFreeSteps += 1;
    if (this.contactFreeSteps >= 2) {
      this.contactActive = false;
      this.contactFreeSteps = 0;
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
    this.contactActive = false;
    this.contactSeenThisStep = false;
    this.contactFreeSteps = 0;
    this.syncOrientation();
    this.forward.set(0, 0, 1).applyQuaternion(this.orientation).normalize();
    this.previousForward.copy(this.forward);
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
    return this.contactActive || this.collisionContactTime > 0;
  }

  private setMode(mode: FlightMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.onModeChange?.(mode);
  }
}
