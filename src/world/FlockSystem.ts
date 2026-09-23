import {
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  InstancedBufferAttribute,
  Matrix4,
  MathUtils,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { FLOCK, PROBE } from '../core/config.ts';
import type { FlightPath, TerrainSampler } from '../core/types.ts';
import { hashString } from './Noise.ts';

export interface FlockVisualSettings {
  flockEnabled: boolean;
  flockMinSize: number;
  flockMaxSize: number;
  flockInterval: number;
  flockSpread: number;
  flockSpeed: number;
  flockColor: string;
  flockTargetColor: string;
  flockTargetThickness: number;
}

type FlockTerrain = TerrainSampler & FlightPath;

interface BoidState {
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly terrainSteer: Vector3;
  phase: number;
  scanHighlight: number;
  active: boolean;
}

interface FlockSlot {
  readonly start: number;
  active: boolean;
  count: number;
  age: number;
  lifetime: number;
  serial: number;
}

class SeededRandom {
  private state: number;

  constructor(seed: string) {
    this.state = hashString(`${seed}:flocks`) || 0x6d2b79f5;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}

const FORWARD = new Vector3(0, 0, 1);

export function fibonacciSpherePoint(index: number, count: number, target = new Vector3()): Vector3 {
  const safeCount = Math.max(1, count);
  const y = 1 - ((index + 0.5) / safeCount) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = index * Math.PI * (3 - Math.sqrt(5));
  return target.set(Math.cos(theta) * radius, y, Math.sin(theta) * radius);
}

/** An elongated square pyramid pointing along local +Z. */
function createPyramidGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  const tip = [0, 0, 2.5];
  const a = [-0.52, -0.52, -1.35];
  const b = [0.52, -0.52, -1.35];
  const c = [0.52, 0.52, -1.35];
  const d = [-0.52, 0.52, -1.35];
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([
    ...tip, ...a, ...b,
    ...tip, ...b, ...c,
    ...tip, ...c, ...d,
    ...tip, ...d, ...a,
    ...a, ...d, ...c,
    ...a, ...c, ...b,
  ]), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Twenty-four short bars form the three open strokes at each box corner.
 * They are multiplied by each bird's complete instance transform, so the
 * target stays attached through translation, rotation, and scale.
 */
function updateTargetCornerTransforms(transforms: Matrix4[], thickness: number): void {
  const halfExtents = [0.78, 0.78, 2.15] as const;
  const segmentLength = [0.54, 0.54, 0.82] as const;
  let index = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (let axis = 0; axis < 3; axis += 1) {
          const position = [
            sx * halfExtents[0],
            sy * halfExtents[1],
            sz * halfExtents[2],
          ];
          const sign = axis === 0 ? sx : axis === 1 ? sy : sz;
          const length = segmentLength[axis];
          position[axis] -= sign * length * 0.5;
          const scale = [thickness, thickness, thickness];
          scale[axis] = length;
          const matrix = transforms[index] ?? new Matrix4();
          matrix.makeScale(scale[0], scale[1], scale[2]);
          matrix.setPosition(position[0], position[1], position[2]);
          if (!transforms[index]) transforms.push(matrix);
          index += 1;
        }
      }
    }
  }
}

function createTargetCornerTransforms(): Matrix4[] {
  const transforms: Matrix4[] = [];
  updateTargetCornerTransforms(transforms, 0.16);
  return transforms;
}

export function probeEncounterStrength(
  distanceM: number,
  radiusM: number,
  influenceWidthM: number,
  expanding: boolean,
): number {
  if (!expanding || radiusM <= 0 || influenceWidthM <= 0) return 0;
  return MathUtils.clamp(1 - Math.abs(distanceM - radiusM) / influenceWidthM, 0, 1);
}

/**
 * Fixed-capacity, deterministic boid flock renderer.
 *
 * Positions remain in authoritative world coordinates. Only the instance
 * matrices are converted into the current floating-origin render frame.
 */
export class FlockSystem {
  readonly group = new Group();
  readonly capacity = FLOCK.maxFlocks * FLOCK.maxBirdsPerFlock;
  private readonly terrain: FlockTerrain;
  private readonly random: SeededRandom;
  private readonly material: MeshStandardMaterial;
  private readonly mesh: InstancedMesh;
  private readonly targetMaterial: MeshBasicMaterial;
  private readonly targetMesh: InstancedMesh;
  private readonly targetCornerTransforms = createTargetCornerTransforms();
  private readonly boids: BoidState[];
  private readonly flocks: FlockSlot[];
  private readonly dummy = new Object3D();
  private readonly planeForward = new Vector3(0, 0, 1);
  private readonly planeFuture = new Vector3();
  private readonly boidFuture = new Vector3();
  private readonly candidate = new Vector3();
  private readonly spawnCenter = new Vector3();
  private readonly spawnDirection = new Vector3();
  private readonly spherePoint = new Vector3();
  private readonly averagePosition = new Vector3();
  private readonly averageVelocity = new Vector3();
  private readonly separation = new Vector3();
  private readonly cohesion = new Vector3();
  private readonly alignment = new Vector3();
  private readonly planeAvoidance = new Vector3();
  private readonly routeSteer = new Vector3();
  private readonly acceleration = new Vector3();
  private readonly gradient = new Vector3();
  private readonly velocityDirection = new Vector3();
  private readonly renderPosition = new Vector3();
  private readonly orientation = new Quaternion();
  private readonly flutterRotation = new Quaternion();
  private readonly scale = new Vector3();
  private readonly targetMatrix = new Matrix4();
  private readonly targetTint = new Color(0xffffff);
  private readonly targetAlpha = new InstancedBufferAttribute(
    new Float32Array(this.capacity * this.targetCornerTransforms.length), 1,
  );
  private settings: FlockVisualSettings = {
    flockEnabled: true,
    flockMinSize: FLOCK.defaultMinBirdsPerFlock,
    flockMaxSize: FLOCK.defaultMaxBirdsPerFlock,
    flockInterval: FLOCK.defaultInterval,
    flockSpread: FLOCK.defaultSpread,
    flockSpeed: FLOCK.defaultSpeed,
    flockColor: '#ffffff',
    flockTargetColor: '#ffffff',
    flockTargetThickness: 0.16,
  };
  private secondsUntilSpawn: number = FLOCK.initialDelay;
  private frameIndex = 0;
  private spawnSerial = 0;
  private elapsedTime = 0;

  constructor(scene: Scene, terrain: FlockTerrain, seed: string) {
    this.terrain = terrain;
    this.random = new SeededRandom(seed);
    this.material = new MeshStandardMaterial({
      color: new Color(0xffffff),
      emissive: new Color(0xffffff).multiplyScalar(0.05),
      flatShading: true,
      roughness: 0.88,
      metalness: 0.06,
      side: DoubleSide,
      fog: true,
    });
    this.mesh = new InstancedMesh(createPyramidGeometry(), this.material, this.capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.group.add(this.mesh);
    this.targetMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.94,
      depthTest: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    // Keep RGB at the chosen tint. Each scanned bird fades independently in
    // alpha; darkening instanceColor leaves nearly opaque black brackets.
    this.targetMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float instanceAlpha;\nvarying float vTargetAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTargetAlpha = instanceAlpha;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vTargetAlpha;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vTargetAlpha;');
    };
    this.targetMaterial.customProgramCacheKey = () => 'flock-target-alpha-v1';
    this.targetMesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      this.targetMaterial,
      this.capacity * this.targetCornerTransforms.length,
    );
    this.targetMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.targetAlpha.setUsage(DynamicDrawUsage);
    this.targetMesh.geometry.setAttribute('instanceAlpha', this.targetAlpha);
    this.targetMesh.frustumCulled = false;
    this.targetMesh.renderOrder = 5;
    this.targetMesh.count = 0;
    this.group.add(this.targetMesh);
    scene.add(this.group);

    this.boids = Array.from({ length: this.capacity }, (): BoidState => ({
      position: new Vector3(),
      velocity: new Vector3(),
      terrainSteer: new Vector3(),
      phase: 0,
      scanHighlight: 0,
      active: false,
    }));
    this.flocks = Array.from({ length: FLOCK.maxFlocks }, (_, index): FlockSlot => ({
      start: index * FLOCK.maxBirdsPerFlock,
      active: false,
      count: 0,
      age: 0,
      lifetime: 0,
      serial: -1,
    }));
    this.hideInactiveInstances();
  }

  applyVisualSettings(settings: FlockVisualSettings): void {
    const wasEnabled = this.settings.flockEnabled;
    this.settings = {
      flockEnabled: settings.flockEnabled,
      flockMinSize: Math.round(MathUtils.clamp(settings.flockMinSize, 1, FLOCK.maxBirdsPerFlock)),
      flockMaxSize: Math.round(MathUtils.clamp(settings.flockMaxSize, 1, FLOCK.maxBirdsPerFlock)),
      flockInterval: Math.max(1, settings.flockInterval),
      flockSpread: Math.max(2, settings.flockSpread),
      flockSpeed: Math.max(4, settings.flockSpeed),
      flockColor: settings.flockColor,
      flockTargetColor: settings.flockTargetColor,
      flockTargetThickness: MathUtils.clamp(settings.flockTargetThickness, 0.02, 0.3),
    };
    if (this.settings.flockMinSize > this.settings.flockMaxSize) {
      this.settings.flockMinSize = this.settings.flockMaxSize;
    }
    this.material.color.set(settings.flockColor);
    this.material.emissive.set(settings.flockColor).multiplyScalar(0.05);
    this.targetTint.set(settings.flockTargetColor);
    this.targetMaterial.color.copy(this.targetTint);
    updateTargetCornerTransforms(this.targetCornerTransforms, this.settings.flockTargetThickness);
    if (!settings.flockEnabled) {
      for (const flock of this.flocks) this.releaseFlock(flock);
      this.mesh.visible = false;
      this.targetMesh.visible = false;
      this.hideInactiveInstances();
    } else {
      this.mesh.visible = true;
      this.targetMesh.visible = true;
      if (!wasEnabled) this.secondsUntilSpawn = Math.min(FLOCK.initialDelay, this.settings.flockInterval * 0.35);
      else this.secondsUntilSpawn = Math.min(this.secondsUntilSpawn, this.settings.flockInterval * 1.35);
    }
  }

  update(
    dt: number,
    planeWorldPosition: Vector3,
    planeOrientation: Quaternion,
    planeSpeed: number,
    renderOrigin: Vector3,
    frozen = false,
    probeWorldCenter?: Vector3,
    probeRadius = 0,
    probeActive = false,
    probeExpanding = false,
  ): void {
    this.planeForward.copy(FORWARD).applyQuaternion(planeOrientation).normalize();
    const safeDt = Math.max(0, Math.min(dt, 0.05));
    if (this.settings.flockEnabled && !frozen) {
      this.elapsedTime += safeDt;
      this.secondsUntilSpawn -= Math.max(0, dt);
      if (this.secondsUntilSpawn <= 0) {
        this.spawnFlock(planeWorldPosition);
        this.scheduleNextSpawn();
      }
      this.frameIndex += 1;
      for (const flock of this.flocks) {
        if (flock.active) this.updateFlock(flock, safeDt, planeWorldPosition, planeSpeed);
      }
    }
    if (!frozen) this.updateProbeTargets(
      safeDt,
      probeWorldCenter,
      probeRadius,
      probeActive,
      probeExpanding,
    );
    this.updateInstances(renderOrigin);
  }

  private spawnFlock(planePosition: Vector3): void {
    let slot = this.flocks.find((flock) => !flock.active);
    if (!slot) {
      slot = this.flocks.reduce((oldest, flock) => flock.serial < oldest.serial ? flock : oldest);
      this.releaseFlock(slot);
    }

    const distanceAhead = this.random.range(FLOCK.spawnDistanceMin, FLOCK.spawnDistanceMax);
    this.candidate.copy(this.planeForward).multiplyScalar(distanceAhead).add(planePosition);
    const spawnZ = this.candidate.z;
    const path = this.terrain.sample(spawnZ);
    this.spawnCenter.set(
      this.candidate.x + this.random.range(-0.12, 0.12) * path.width,
      this.candidate.y + this.random.range(-0.12, 0.12) * path.height,
      spawnZ,
    );
    if (this.densityAt(this.spawnCenter) > -8) this.spawnCenter.set(path.x, path.y, spawnZ);

    const crossingDirection = this.random.next() < 0.5 ? -1 : 1;
    this.spawnDirection.set(
      crossingDirection * this.random.range(0.35, 0.68),
      this.random.range(-0.12, 0.12),
      this.random.range(-0.1, 0.42),
    ).normalize();

    slot.active = true;
    slot.count = Math.floor(this.random.range(
      this.settings.flockMinSize,
      this.settings.flockMaxSize + 1,
    ));
    slot.age = 0;
    slot.lifetime = this.random.range(FLOCK.minLifetime, FLOCK.maxLifetime);
    slot.serial = this.spawnSerial;
    this.spawnSerial += 1;

    for (let localIndex = 0; localIndex < FLOCK.maxBirdsPerFlock; localIndex += 1) {
      const boid = this.boids[slot.start + localIndex];
      boid.active = localIndex < slot.count;
      if (!boid.active) continue;
      fibonacciSpherePoint(localIndex, slot.count, this.spherePoint);
      this.spherePoint.multiply(new Vector3(1, 0.58, 0.82)).multiplyScalar(this.settings.flockSpread);
      boid.position.copy(this.spawnCenter).add(this.spherePoint);
      if (this.densityAt(boid.position) > -3) {
        boid.position.lerp(this.spawnCenter, 0.72);
      }
      boid.velocity.copy(this.spawnDirection)
        .addScaledVector(this.spherePoint, 0.0035)
        .normalize()
        .multiplyScalar(this.settings.flockSpeed * this.random.range(0.88, 1.12));
      boid.terrainSteer.set(0, 0, 0);
      boid.phase = this.random.range(0, Math.PI * 2);
      boid.scanHighlight = 0;
    }
  }

  private updateFlock(
    flock: FlockSlot,
    dt: number,
    planePosition: Vector3,
    planeSpeed: number,
  ): void {
    flock.age += dt;
    const firstBoid = this.boids[flock.start];
    if (
      flock.age >= flock.lifetime
      || firstBoid.position.distanceToSquared(planePosition) > 950 * 950
      || this.candidate.copy(firstBoid.position).sub(planePosition).dot(this.planeForward) < -240
    ) {
      this.releaseFlock(flock);
      return;
    }

    this.planeFuture.copy(this.planeForward).multiplyScalar(planeSpeed * 0.75).add(planePosition);
    const neighborRadiusSq = Math.max(FLOCK.neighborRadius, this.settings.flockSpread * 1.35) ** 2;
    const separationRadiusSq = FLOCK.separationRadius ** 2;
    const desiredSpeed = this.settings.flockSpeed;

    for (let localIndex = 0; localIndex < flock.count; localIndex += 1) {
      const index = flock.start + localIndex;
      const boid = this.boids[index];
      this.averagePosition.set(0, 0, 0);
      this.averageVelocity.set(0, 0, 0);
      this.separation.set(0, 0, 0);
      let neighbors = 0;

      for (let otherLocalIndex = 0; otherLocalIndex < flock.count; otherLocalIndex += 1) {
        if (otherLocalIndex === localIndex) continue;
        const other = this.boids[flock.start + otherLocalIndex];
        const dx = other.position.x - boid.position.x;
        const dy = other.position.y - boid.position.y;
        const dz = other.position.z - boid.position.z;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq > neighborRadiusSq || distanceSq < 0.0001) continue;
        this.averagePosition.add(other.position);
        this.averageVelocity.add(other.velocity);
        neighbors += 1;
        if (distanceSq < separationRadiusSq) {
          const inverseDistance = 1 / Math.sqrt(distanceSq);
          this.separation.x -= dx * inverseDistance / distanceSq;
          this.separation.y -= dy * inverseDistance / distanceSq;
          this.separation.z -= dz * inverseDistance / distanceSq;
        }
      }

      this.alignment.set(0, 0, 0);
      this.cohesion.set(0, 0, 0);
      if (neighbors > 0) {
        this.averageVelocity.multiplyScalar(1 / neighbors);
        if (this.averageVelocity.lengthSq() > 0.0001) {
          this.alignment.copy(this.averageVelocity).normalize().multiplyScalar(desiredSpeed).sub(boid.velocity);
        }
        this.averagePosition.multiplyScalar(1 / neighbors);
        this.cohesion.copy(this.averagePosition).sub(boid.position);
        if (this.cohesion.lengthSq() > 0.0001) this.cohesion.normalize();
      }
      if (this.separation.lengthSq() > 0.0001) this.separation.normalize();

      if ((this.frameIndex + index) % 4 === 0) this.updateTerrainAvoidance(boid);
      else boid.terrainSteer.multiplyScalar(Math.exp(-dt * 0.8));

      this.updatePlaneAvoidance(boid, planePosition);
      this.updateRouteSteering(boid);
      this.acceleration.set(0, 0, 0)
        .addScaledVector(this.separation, 15)
        .addScaledVector(this.alignment, 0.42)
        .addScaledVector(this.cohesion, 5.2)
        .addScaledVector(this.routeSteer, 8.5)
        .addScaledVector(boid.terrainSteer, 34)
        .addScaledVector(this.planeAvoidance, 42);
      this.acceleration.clampLength(0, 26);
      boid.velocity.addScaledVector(this.acceleration, dt);

      const speed = boid.velocity.length();
      const minSpeed = desiredSpeed * 0.72;
      const maxSpeed = desiredSpeed * 1.22;
      if (speed > 0.0001) {
        boid.velocity.multiplyScalar(MathUtils.clamp(speed, minSpeed, maxSpeed) / speed);
      }
      boid.position.addScaledVector(boid.velocity, dt);
    }
  }

  private updateTerrainAvoidance(boid: BoidState): void {
    this.velocityDirection.copy(boid.velocity).normalize();
    const lookAhead = Math.max(14, boid.velocity.length() * 0.62);
    this.boidFuture.copy(this.velocityDirection).multiplyScalar(lookAhead).add(boid.position);
    const density = this.densityAt(this.boidFuture);
    const awareness = MathUtils.clamp(
      (density + FLOCK.terrainAwarenessDistance) / FLOCK.terrainAwarenessDistance,
      0,
      1,
    );
    if (awareness <= 0) {
      boid.terrainSteer.multiplyScalar(0.7);
      return;
    }

    const epsilon = 4;
    const x = this.boidFuture.x;
    const y = this.boidFuture.y;
    const z = this.boidFuture.z;
    this.gradient.set(
      this.terrain.densityAt(x + epsilon, y, z) - this.terrain.densityAt(x - epsilon, y, z),
      this.terrain.densityAt(x, y + epsilon, z) - this.terrain.densityAt(x, y - epsilon, z),
      this.terrain.densityAt(x, y, z + epsilon) - this.terrain.densityAt(x, y, z - epsilon),
    );
    if (this.gradient.lengthSq() > 0.0001) {
      boid.terrainSteer.copy(this.gradient).normalize().multiplyScalar(-awareness);
    } else {
      const path = this.terrain.sample(z);
      boid.terrainSteer.set(path.x - x, path.y - y, 8).normalize().multiplyScalar(awareness);
    }
  }

  private updatePlaneAvoidance(boid: BoidState, planePosition: Vector3): void {
    this.boidFuture.copy(boid.velocity).multiplyScalar(0.75).add(boid.position);
    this.planeAvoidance.copy(this.boidFuture).sub(this.planeFuture);
    const futureDistance = this.planeAvoidance.length();
    const currentDistance = boid.position.distanceTo(planePosition);
    const distance = Math.min(futureDistance, currentDistance);
    if (distance >= FLOCK.planeAvoidanceRadius || distance < 0.001) {
      this.planeAvoidance.set(0, 0, 0);
      return;
    }
    if (currentDistance <= futureDistance) this.planeAvoidance.copy(boid.position).sub(planePosition);
    this.planeAvoidance.normalize().multiplyScalar(
      1 - distance / FLOCK.planeAvoidanceRadius,
    );
  }

  private updateRouteSteering(boid: BoidState): void {
    const path = this.terrain.sample(boid.position.z + 18);
    const dx = path.x - boid.position.x;
    const dy = path.y - boid.position.y;
    const normalizedDistance = Math.hypot(dx / path.width, dy / path.height);
    const strength = MathUtils.smoothstep(normalizedDistance, 0.34, 0.82);
    this.routeSteer.set(dx, dy, 12);
    if (this.routeSteer.lengthSq() > 0.0001) this.routeSteer.normalize().multiplyScalar(strength);
  }

  private updateInstances(renderOrigin: Vector3): void {
    let targetIndex = 0;
    for (let index = 0; index < this.capacity; index += 1) {
      const boid = this.boids[index];
      if (!boid.active) {
        this.dummy.position.set(0, 0, 0);
        this.dummy.quaternion.identity();
        this.dummy.scale.setScalar(0);
      } else {
        const animationTime = boid.phase + this.elapsedTime * 7.5;
        this.renderPosition.copy(boid.position).sub(renderOrigin);
        this.renderPosition.y += Math.sin(animationTime * 0.58) * 0.24;
        this.velocityDirection.copy(boid.velocity).normalize();
        this.orientation.setFromUnitVectors(FORWARD, this.velocityDirection);
        this.flutterRotation.setFromAxisAngle(FORWARD, Math.sin(animationTime * 0.32) * 0.12);
        this.orientation.multiply(this.flutterRotation);
        const flutter = 0.94 + Math.sin(animationTime) * 0.06;
        this.scale.set(1.05 * flutter, 0.82, 1.15);
        this.dummy.position.copy(this.renderPosition);
        this.dummy.quaternion.copy(this.orientation);
        this.dummy.scale.copy(this.scale);
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(index, this.dummy.matrix);
      if (boid.active && boid.scanHighlight > 0.015) {
        const visibility = MathUtils.smoothstep(boid.scanHighlight, 0.015, 0.34);
        for (const localTransform of this.targetCornerTransforms) {
          this.targetMatrix.multiplyMatrices(this.dummy.matrix, localTransform);
          this.targetMesh.setMatrixAt(targetIndex, this.targetMatrix);
          this.targetAlpha.setX(targetIndex, visibility);
          targetIndex += 1;
        }
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.targetMesh.count = targetIndex;
    this.targetMesh.instanceMatrix.needsUpdate = true;
    this.targetAlpha.needsUpdate = true;
  }

  private updateProbeTargets(
    dt: number,
    probeWorldCenter: Vector3 | undefined,
    probeRadius: number,
    probeActive: boolean,
    probeExpanding: boolean,
  ): void {
    const decay = dt / 2.8;
    for (const boid of this.boids) {
      if (!boid.active) {
        boid.scanHighlight = 0;
        continue;
      }
      boid.scanHighlight = Math.max(0, boid.scanHighlight - decay);
      if (!probeActive || !probeWorldCenter) continue;
      const encounter = probeEncounterStrength(
        boid.position.distanceTo(probeWorldCenter),
        probeRadius,
        PROBE.influenceWidth,
        probeExpanding,
      );
      boid.scanHighlight = Math.max(boid.scanHighlight, encounter);
    }
  }

  private scheduleNextSpawn(): void {
    this.secondsUntilSpawn = this.settings.flockInterval * this.random.range(0.7, 1.3);
  }

  private releaseFlock(flock: FlockSlot): void {
    flock.active = false;
    for (let localIndex = 0; localIndex < FLOCK.maxBirdsPerFlock; localIndex += 1) {
      this.boids[flock.start + localIndex].active = false;
      this.boids[flock.start + localIndex].scanHighlight = 0;
    }
  }

  private hideInactiveInstances(): void {
    this.updateInstances(new Vector3());
  }

  private densityAt(position: Vector3): number {
    return this.terrain.collisionDensityAt?.(position.x, position.y, position.z)
      ?? this.terrain.densityAt(position.x, position.y, position.z);
  }

  get activeFlockCount(): number {
    return this.flocks.reduce((count, flock) => count + Number(flock.active), 0);
  }

  get activeBoidCount(): number {
    return this.boids.reduce((count, boid) => count + Number(boid.active), 0);
  }

  get targetPoolCapacity(): number {
    return this.capacity * this.targetCornerTransforms.length;
  }
}
