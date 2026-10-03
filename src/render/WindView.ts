import {
  BufferAttribute,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { PALETTE, WIND } from '../core/config.ts';

export interface WindVisualSettings {
  windStreakCount: number;
  windStreakLength: number;
  windSpeedThreshold: number;
  windOpacity: number;
  windColor: string;
  windCountSpeedResponse?: number;
  windLengthSpeedResponse?: number;
}

const WORLD_UP = new Vector3(0, 1, 0);

function pseudoRandom(index: number, salt: number, cycle = 0): number {
  const value = Math.sin(
    index * 91.713 + salt * 47.327 + cycle * 117.119,
  ) * 43758.5453;
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * A fixed-capacity air-volume field.
 *
 * Streak centers persist in render/world space while the spawn bounds follow
 * the aircraft. The camera is used by the shader only to make each thin ribbon
 * visible; orbiting the camera never rotates the particle population.
 */
export class WindView {
  readonly group = new Group();
  readonly simulationSpace = 'world' as const;
  private readonly geometry = new InstancedBufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly headPositions = new Float32Array(WIND.maxLineCount * 3);
  private readonly fadeValues = new Float32Array(WIND.maxLineCount);
  private readonly ageValues = new Float32Array(WIND.maxLineCount);
  private readonly spawnCycles = new Uint32Array(WIND.maxLineCount);
  private readonly headAttribute: InstancedBufferAttribute;
  private readonly fadeAttribute: InstancedBufferAttribute;
  private readonly forward = new Vector3(0, 0, 1);
  private readonly targetForward = new Vector3(0, 0, 1);
  private readonly right = new Vector3(1, 0, 0);
  private readonly up = new Vector3(0, 1, 0);
  private readonly relative = new Vector3();
  private readonly spawnPosition = new Vector3();
  private readonly flowDirection = new Vector3(0, 0, -1);
  private initialized = false;
  private speed = 55;
  private baseCount: number = WIND.defaultLineCount;
  private baseLength = 22;
  private countSpeedResponse = 1;
  private lengthSpeedResponse = 1;

  constructor() {
    // One unit ribbon expanded per instance in the vertex shader. The long
    // axis is physical world length; the narrow axis faces the camera.
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array([
      0, -1, 0,
      0, 1, 0,
      1, -1, 0,
      1, 1, 0,
    ]), 3));
    this.geometry.setAttribute('uv', new BufferAttribute(new Float32Array([
      0, 0,
      0, 1,
      1, 0,
      1, 1,
    ]), 2));
    this.geometry.setIndex([0, 2, 1, 2, 3, 1]);

    this.headAttribute = new InstancedBufferAttribute(this.headPositions, 3);
    this.headAttribute.setUsage(DynamicDrawUsage);
    this.fadeAttribute = new InstancedBufferAttribute(this.fadeValues, 1);
    this.fadeAttribute.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('aHead', this.headAttribute);
    this.geometry.setAttribute('aFade', this.fadeAttribute);

    const indices = new Float32Array(WIND.maxLineCount);
    const energy = new Float32Array(WIND.maxLineCount);
    const variation = new Float32Array(WIND.maxLineCount * 2);
    for (let index = 0; index < WIND.maxLineCount; index += 1) {
      indices[index] = index;
      energy[index] = 0.56 + pseudoRandom(index, 4) * 0.44;
      variation[index * 2] = pseudoRandom(index, 5) * 2 - 1;
      variation[index * 2 + 1] = pseudoRandom(index, 6) * 2 - 1;
    }
    this.geometry.setAttribute('aIndex', new InstancedBufferAttribute(indices, 1));
    this.geometry.setAttribute('aEnergy', new InstancedBufferAttribute(energy, 1));
    this.geometry.setAttribute('aVariation', new InstancedBufferAttribute(variation, 2));
    this.geometry.instanceCount = WIND.defaultLineCount;

    this.material = new ShaderMaterial({
      uniforms: {
        uPlanePosition: { value: new Vector3() },
        uFlowDirection: { value: new Vector3(0, 0, -1) },
        uFlowRight: { value: new Vector3(1, 0, 0) },
        uFlowUp: { value: new Vector3(0, 1, 0) },
        uThrottle: { value: 0 },
        uSpeed: { value: 0 },
        uCount: { value: WIND.defaultLineCount },
        uLength: { value: 22 },
        uWidth: { value: WIND.ribbonWidth },
        uThreshold: { value: 20 },
        uOpacity: { value: 0.36 },
        uColor: { value: new Color(PALETTE.offWhite) },
        uFogColor: { value: new Color(PALETTE.sky) },
        uFogDensity: { value: 0.00165 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: DoubleSide,
      toneMapped: false,
      vertexShader: `
        attribute vec3 aHead;
        attribute float aFade;
        attribute float aEnergy;
        attribute float aIndex;
        attribute vec2 aVariation;
        uniform vec3 uPlanePosition;
        uniform vec3 uFlowDirection;
        uniform vec3 uFlowRight;
        uniform vec3 uFlowUp;
        uniform float uThrottle;
        uniform float uSpeed;
        uniform float uCount;
        uniform float uLength;
        uniform float uWidth;
        uniform float uThreshold;
        uniform float uOpacity;
        varying vec2 vRibbonUv;
        varying float vAlpha;
        varying float vFogDepth;

        void main() {
          vec3 flow = normalize(
            uFlowDirection
            + uFlowRight * aVariation.x * 0.035
            + uFlowUp * aVariation.y * 0.022
          );
          float lengthM = uLength * mix(0.68, 1.12, aEnergy);
          float widthM = uWidth * mix(0.72, 1.15, aEnergy);

          vec3 headView = (modelViewMatrix * vec4(aHead, 1.0)).xyz;
          vec3 flowView = normalize((modelViewMatrix * vec4(flow, 0.0)).xyz);
          vec3 viewDirection = normalize(-headView);
          vec3 side = cross(flowView, viewDirection);
          float sideLength = length(side);
          if (sideLength < 0.001) side = cross(flowView, vec3(0.0, 1.0, 0.0));
          side = normalize(side);

          // The visible trace extends opposite the apparent particle motion,
          // while width alone is camera-facing.
          vec3 viewPosition = headView
            - flowView * position.x * lengthM
            + side * position.y * widthM;
          vec4 clipPosition = projectionMatrix * vec4(viewPosition, 1.0);
          float speedFade = smoothstep(uThreshold, uThreshold + 12.0, uSpeed);
          float planeDistance = distance(aHead, uPlanePosition);
          float distanceFade = smoothstep(8.0, 24.0, planeDistance)
            * (1.0 - smoothstep(275.0, 345.0, planeDistance));

          vRibbonUv = uv;
          vFogDepth = max(0.0, -viewPosition.z);
          vAlpha = uOpacity
            * mix(0.72, 1.0, aEnergy)
            * mix(1.0, 1.18, uThrottle)
            * speedFade * distanceFade * clamp(uCount - aIndex, 0.0, 1.0) * aFade;
          gl_Position = clipPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        varying vec2 vRibbonUv;
        varying float vAlpha;
        varying float vFogDepth;

        void main() {
          float along = min(vRibbonUv.x, 1.0 - vRibbonUv.x);
          float endFade = smoothstep(0.0, 0.16, along);
          float across = abs(vRibbonUv.y * 2.0 - 1.0);
          float edgeWidth = max(fwidth(across) * 1.4, 0.035);
          float edgeFade = 1.0 - smoothstep(1.0 - edgeWidth, 1.0, across);
          float alpha = vAlpha * endFade * edgeFade;
          if (alpha < 0.004) discard;

          float fogFactor = 1.0 - exp(-pow(uFogDensity * vFogDepth, 2.0));
          vec3 color = mix(uColor, uFogColor, clamp(fogFactor, 0.0, 1.0));
          gl_FragColor = vec4(color, alpha * (1.0 - fogFactor * 0.55));
        }
      `,
    });

    const ribbons = new Mesh(this.geometry, this.material);
    ribbons.frustumCulled = false;
    ribbons.renderOrder = 2;
    this.group.add(ribbons);
  }

  update(
    dt: number,
    planePosition: Vector3,
    planeOrientation: Quaternion,
    speed: number,
    throttleActive: boolean | number,
    frozen = false,
    travelVelocity?: Vector3,
  ): void {
    if (travelVelocity && travelVelocity.lengthSq() > 1e-8) {
      this.targetForward.copy(travelVelocity).normalize();
    } else {
      this.targetForward.set(0, 0, 1).applyQuaternion(planeOrientation).normalize();
    }
    if (!this.initialized) {
      this.forward.copy(this.targetForward);
      this.updateFrameAxes();
      for (let index = 0; index < WIND.maxLineCount; index += 1) {
        this.spawn(index, planePosition, true);
      }
      this.initialized = true;
      this.headAttribute.needsUpdate = true;
      this.fadeAttribute.needsUpdate = true;
    } else if (!frozen) {
      const frameSmoothing = 1 - Math.exp(-dt / WIND.frameResponseTime);
      this.forward.lerp(this.targetForward, frameSmoothing).normalize();
      this.updateFrameAxes();
      this.updateParticles(dt, planePosition);
    }

    const throttleTarget = typeof throttleActive === 'number'
      ? Math.max(0, Math.min(1, throttleActive))
      : throttleActive ? 1 : 0;
    const throttle = this.material.uniforms.uThrottle.value as number;
    const throttleResponse = throttleTarget > throttle ? 0.2 : 0.5;
    const throttleSmoothing = frozen ? 0 : 1 - Math.exp(-dt / throttleResponse);
    this.material.uniforms.uThrottle.value = throttle
      + (throttleTarget - throttle) * throttleSmoothing;
    this.speed = Math.max(0, speed);
    this.updateSpeedPresentation();
    this.material.uniforms.uSpeed.value = speed;
    (this.material.uniforms.uPlanePosition.value as Vector3).copy(planePosition);
    (this.material.uniforms.uFlowDirection.value as Vector3).copy(this.flowDirection);
    (this.material.uniforms.uFlowRight.value as Vector3).copy(this.right);
    (this.material.uniforms.uFlowUp.value as Vector3).copy(this.up);
  }

  private updateFrameAxes(): void {
    this.right.crossVectors(WORLD_UP, this.forward);
    if (this.right.lengthSq() < 0.0001) this.right.set(1, 0, 0);
    else this.right.normalize();
    this.up.crossVectors(this.forward, this.right).normalize();
    this.flowDirection.copy(this.forward).multiplyScalar(-1);
  }

  private updateParticles(dt: number, planePosition: Vector3): void {
    for (let index = 0; index < WIND.maxLineCount; index += 1) {
      const offset = index * 3;
      this.relative.set(
        this.headPositions[offset] - planePosition.x,
        this.headPositions[offset + 1] - planePosition.y,
        this.headPositions[offset + 2] - planePosition.z,
      );
      const longitudinal = this.relative.dot(this.forward);
      const lateral = Math.abs(this.relative.dot(this.right));
      const vertical = Math.abs(this.relative.dot(this.up));
      if (
        longitudinal < -WIND.behindDistance
        || longitudinal > WIND.aheadDistance + 45
        || lateral > WIND.lateralRadius + 28
        || vertical > WIND.verticalRadius + 24
      ) {
        this.spawn(index, planePosition, false);
        continue;
      }

      this.ageValues[index] += dt;
      const birthFade = smoothstep(0, WIND.spawnFadeTime, this.ageValues[index]);
      const rearFade = smoothstep(
        -WIND.behindDistance,
        -WIND.behindDistance + 48,
        longitudinal,
      );
      const frontFade = 1 - smoothstep(
        WIND.aheadDistance - 35,
        WIND.aheadDistance + 35,
        longitudinal,
      );
      this.fadeValues[index] = birthFade * rearFade * frontFade;
    }
    this.headAttribute.needsUpdate = true;
    this.fadeAttribute.needsUpdate = true;
  }

  private spawn(index: number, planePosition: Vector3, initial: boolean): void {
    const cycle = this.spawnCycles[index];
    this.spawnCycles[index] += 1;
    const along = initial
      ? -WIND.behindDistance + pseudoRandom(index, 11, cycle) * (
        WIND.behindDistance + WIND.aheadDistance
      )
      : WIND.aheadDistance - 28 + pseudoRandom(index, 11, cycle) * 46;
    const angle = pseudoRandom(index, 12, cycle) * Math.PI * 2;
    // sqrt(U) samples uniform area across the whole ellipse, including its
    // center. The old +14 m inner radius left a hollow tunnel ahead of the ship.
    const radial = Math.sqrt(pseudoRandom(index, 13, cycle)) * WIND.lateralRadius;
    const lateral = Math.cos(angle) * radial;
    const vertical = Math.sin(angle) * radial * (
      WIND.verticalRadius / WIND.lateralRadius
    );

    this.spawnPosition.copy(planePosition)
      .addScaledVector(this.forward, along)
      .addScaledVector(this.right, lateral)
      .addScaledVector(this.up, vertical);
    const offset = index * 3;
    this.headPositions[offset] = this.spawnPosition.x;
    this.headPositions[offset + 1] = this.spawnPosition.y;
    this.headPositions[offset + 2] = this.spawnPosition.z;
    this.ageValues[index] = initial
      ? WIND.spawnFadeTime * (0.35 + pseudoRandom(index, 15, cycle))
      : 0;
    this.fadeValues[index] = initial ? Math.min(1, this.ageValues[index] / WIND.spawnFadeTime) : 0;
  }

  applyOriginShift(originShift: Vector3): void {
    if (!this.initialized) return;
    for (let index = 0; index < WIND.maxLineCount; index += 1) {
      const offset = index * 3;
      this.headPositions[offset] -= originShift.x;
      this.headPositions[offset + 1] -= originShift.y;
      this.headPositions[offset + 2] -= originShift.z;
    }
    this.headAttribute.needsUpdate = true;
  }

  reset(planePosition: Vector3, planeOrientation: Quaternion): void {
    this.targetForward.set(0, 0, 1).applyQuaternion(planeOrientation).normalize();
    this.forward.copy(this.targetForward);
    this.updateFrameAxes();
    for (let index = 0; index < WIND.maxLineCount; index += 1) {
      this.spawn(index, planePosition, true);
    }
    this.initialized = true;
    this.headAttribute.needsUpdate = true;
    this.fadeAttribute.needsUpdate = true;
  }

  applyVisualSettings(settings: WindVisualSettings): void {
    this.baseCount = Math.max(0, Math.min(WIND.maxLineCount, settings.windStreakCount));
    this.baseLength = settings.windStreakLength;
    this.countSpeedResponse = settings.windCountSpeedResponse ?? 1;
    this.lengthSpeedResponse = settings.windLengthSpeedResponse ?? 1;
    this.updateSpeedPresentation();
    this.material.uniforms.uThreshold.value = settings.windSpeedThreshold;
    this.material.uniforms.uOpacity.value = settings.windOpacity;
    (this.material.uniforms.uColor.value as Color).set(settings.windColor);
  }

  private updateSpeedPresentation(): void {
    const ratio = Math.max(0, Math.min(3, this.speed / 55));
    const count = Math.min(WIND.maxLineCount, this.baseCount * Math.pow(ratio, this.countSpeedResponse));
    this.geometry.instanceCount = Math.ceil(count);
    this.material.uniforms.uCount.value = count;
    this.material.uniforms.uLength.value = this.baseLength * Math.pow(ratio, this.lengthSpeedResponse);
  }

  setAtmosphere(backgroundColor: string, fogDensity: number): void {
    (this.material.uniforms.uFogColor.value as Color).set(backgroundColor);
    this.material.uniforms.uFogDensity.value = fogDensity;
  }

  getHeadPosition(index: number, target: Vector3): Vector3 {
    const safeIndex = Math.max(0, Math.min(WIND.maxLineCount - 1, Math.floor(index)));
    const offset = safeIndex * 3;
    return target.set(
      this.headPositions[offset],
      this.headPositions[offset + 1],
      this.headPositions[offset + 2],
    );
  }

  get segmentCount(): number {
    return this.geometry.instanceCount;
  }

  get throttleIntensity(): number {
    return this.material.uniforms.uThrottle.value as number;
  }

  get configuredLength(): number {
    return this.baseLength;
  }

  get effectiveLength(): number { return this.material.uniforms.uLength.value as number; }

  get configuredThreshold(): number {
    return this.material.uniforms.uThreshold.value as number;
  }

  get depthTestingEnabled(): boolean {
    return this.material.depthTest;
  }

  get capacity(): number {
    return WIND.maxLineCount;
  }
}
