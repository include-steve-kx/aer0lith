import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Mesh,
  Scene,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';
import { PALETTE, PROBE, TERRAIN } from '../core/config.ts';
import type { VisualSettings } from '../ui/SettingsPanel.ts';
import type { ProceduralTerrain } from './TerrainModel.ts';
import { applyCarveSnapshotToLattice, type TerrainCarveResult } from './TerrainCarve.ts';
import type { TerrainWorkerRequest, TerrainWorkerResponse } from './TerrainWorkerProtocol.ts';
import {
  densityLatticeLength,
  Float32MeshBuffer,
  latticeMaximum,
  polygonizeDensityLattice,
  sampleDensityLattice,
  type VolumeChunkCoordinate,
} from './VolumeMesher.ts';

const MAX_CARVE_MASKS = 8;
const MAX_PULSE_SCARS = 8;

/** Converts projected dots per 100 m² into shader-grid spacing in meters. */
export function dotSpacingFromDensity(densityPer100M2: number): number {
  return Math.sqrt(100 / Math.max(0.01, densityPer100M2));
}

class TerrainChunk {
  readonly group = new Group();
  private readonly geometry = new BufferGeometry();
  private readonly vertices = new Float32MeshBuffer();
  private readonly mesh: Mesh;
  worldCX = Number.NaN;
  worldCY = Number.NaN;
  worldCZ = Number.NaN;
  revision = 0;
  active = false;

  constructor(terrainMaterial: ShaderMaterial) {
    this.geometry.setAttribute(
      'position',
      new BufferAttribute(this.vertices.data, 3).setUsage(DynamicDrawUsage),
    );
    this.mesh = new Mesh(this.geometry, terrainMaterial);
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    this.group.add(this.mesh);
    this.group.visible = false;
  }

  assignGenerated(
    worldCX: number,
    worldCY: number,
    worldCZ: number,
    origin: Vector3,
    vertices: Float32Array,
    revision: number,
  ): void {
    this.worldCX = worldCX;
    this.worldCY = worldCY;
    this.worldCZ = worldCZ;
    this.active = true;
    this.revision = revision;
    this.group.visible = true;
    this.updateRenderPosition(origin);

    const previousBuffer = (this.geometry.getAttribute('position') as BufferAttribute).array;
    this.vertices.copyFrom(vertices);
    if (previousBuffer !== this.vertices.data) {
      this.geometry.setAttribute(
        'position',
        new BufferAttribute(this.vertices.data, 3).setUsage(DynamicDrawUsage),
      );
    } else {
      this.geometry.getAttribute('position').needsUpdate = true;
    }
    this.geometry.setDrawRange(0, this.vertices.vertexCount);
    const half = TERRAIN.chunkSize * 0.5;
    this.geometry.boundingSphere = new Sphere(
      new Vector3(half, half, half),
      Math.sqrt(3) * half + PROBE.lift,
    );
    this.mesh.visible = this.vertices.vertexCount > 0;
  }

  updateRenderPosition(origin: Vector3): void {
    this.group.position.set(
      this.worldCX * TERRAIN.chunkSize - origin.x,
      this.worldCY * TERRAIN.chunkSize - origin.y,
      this.worldCZ * TERRAIN.chunkSize - origin.z,
    );
  }

  setMaterial(material: ShaderMaterial): void {
    this.mesh.material = material;
  }

  release(): void {
    this.active = false;
    this.group.visible = false;
    this.mesh.visible = false;
  }

  advanceRevision(revision: number): void {
    this.revision = Math.max(this.revision, revision);
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

function createTerrainMaterial(): ShaderMaterial {
  const carveStarts = Array.from({ length: MAX_CARVE_MASKS }, () => new Vector3());
  const carveEnds = Array.from({ length: MAX_CARVE_MASKS }, () => new Vector3());
  const pulseScarStarts = Array.from({ length: MAX_PULSE_SCARS }, () => new Vector3());
  const pulseScarEnds = Array.from({ length: MAX_PULSE_SCARS }, () => new Vector3());
  const pulseScarColors = Array.from({ length: MAX_PULSE_SCARS }, () => new Color());
  return new ShaderMaterial({
    uniforms: {
      uAircraftPosition: { value: new Vector3() },
      uBoostPosition: { value: new Vector3() },
      uBoostColor: { value: new Color() },
      uBoostPower: { value: 0 },
      uPulseBeamPosition: { value: new Vector3() },
      uPulseBeamColor: { value: new Color() },
      uPulseBeamPower: { value: 0 },
      uPulseBeamRange: { value: 1 },
      uPulseElectricPosition: { value: new Vector3() },
      uPulseElectricColor: { value: new Color() },
      uPulseElectricPower: { value: 0 },
      uPulseElectricRange: { value: 1 },
      uMeshColor: { value: new Color(0x363d3e) },
      uDotColor: { value: new Color(PALETTE.terrainPoints) },
      uAlertColor: { value: new Color(PALETTE.alertRed) },
      uDangerDistance: { value: 96 },
      uDangerSizeMultiplier: { value: 3 },
      uDangerSizeFalloff: { value: 1.2 },
      uDotRadiusM: { value: 0.14 },
      uDotSpacingM: { value: dotSpacingFromDensity(4) },
      uProbeCenter: { value: new Vector3() },
      uProbeRadius: { value: 0 },
      uProbeActive: { value: 0 },
      uProbeExpanding: { value: 0 },
      uProbeRingOpacity: { value: 0 },
      uProbeTailAge: { value: 0 },
      uProbeSpeed: { value: PROBE.speed },
      uProbeAfterglowDuration: { value: PROBE.afterglowDuration },
      uProbeLineWidth: { value: PROBE.lineWidth },
      uProbeInfluenceWidth: { value: PROBE.influenceWidth },
      uProbeLift: { value: PROBE.lift },
      uProbePatternType: { value: 1 },
      uProbePatternSpacing: { value: 8 },
      uProbePatternSize: { value: 0.5 },
      uProbePatternColor: { value: new Color(PROBE.color) },
      uProbePatternBrightness: { value: 1.4 },
      uProbeFrontWidth: { value: 14.2 },
      uProbeFrontColor: { value: new Color(PROBE.color) },
      uProbeFrontBrightness: { value: 0.75 },
      uProbeTrailColor: { value: new Color(0x6aaac8) },
      uProbeTrailLength: { value: 160 },
      uProbeTrailFalloff: { value: 2 },
      fogColor: { value: new Color(PALETTE.fog) },
      fogDensity: { value: 0.00165 },
      uCarveMaskCount: { value: 0 },
      uCarveStarts: { value: carveStarts },
      uCarveEnds: { value: carveEnds },
      uCarveRadiusSquared: { value: new Float32Array(MAX_CARVE_MASKS) },
      uPulseScarCount: { value: 0 },
      uPulseScarStarts: { value: pulseScarStarts },
      uPulseScarEnds: { value: pulseScarEnds },
      uPulseScarColors: { value: pulseScarColors },
      uPulseScarRadiusSquared: { value: new Float32Array(MAX_PULSE_SCARS) },
      uPulseScarOuterRadiusSquared: { value: new Float32Array(MAX_PULSE_SCARS) },
      uPulseScarStrength: { value: 0.55 },
    },
    side: DoubleSide,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    fog: true,
    defines: { TERRAIN_DOT_MODE: 1 },
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      uniform vec3 uAircraftPosition;
      uniform float uDangerDistance;
      uniform float uDangerSizeFalloff;
      uniform vec3 uProbeCenter;
      uniform float uProbeRadius;
      uniform float uProbeExpanding;
      uniform float uProbeRingOpacity;
      uniform float uProbeLineWidth;
      uniform float uProbeInfluenceWidth;
      uniform float uProbeLift;
      varying vec3 vTerrainWorldPosition;
      varying float vAlert;
      varying float vProbeInfluence;
      varying float vProbeCore;

      void main() {
        vec4 baseWorld = modelMatrix * vec4(position, 1.0);
        float proximity = 1.0 - smoothstep(
          5.0,
          max(5.001, uDangerDistance),
          distance(baseWorld.xyz, uAircraftPosition)
        );
        vAlert = pow(max(0.0, proximity), uDangerSizeFalloff);

        float probeDistance = distance(baseWorld.xyz, uProbeCenter);
        float probeDelta = abs(probeDistance - uProbeRadius);
        float probeVisibility = uProbeExpanding * uProbeRingOpacity;
        vProbeCore = (
          1.0 - smoothstep(0.0, max(0.001, uProbeLineWidth), probeDelta)
        ) * probeVisibility;
        vProbeInfluence = (
          1.0 - smoothstep(
            max(0.001, uProbeLineWidth),
            max(uProbeLineWidth + 0.001, uProbeInfluenceWidth),
            probeDelta
          )
        ) * probeVisibility;

        vec3 radialDirection = normalize(baseWorld.xyz - uProbeCenter + vec3(0.0001));
        vec3 renderWorldPosition = baseWorld.xyz
          + radialDirection * max(vProbeCore, vProbeInfluence) * uProbeLift;
        vTerrainWorldPosition = renderWorldPosition;
        vec4 mvPosition = viewMatrix * vec4(renderWorldPosition, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 uBoostPosition, uBoostColor;
      uniform float uBoostPower;
      uniform vec3 uPulseBeamPosition, uPulseBeamColor;
      uniform float uPulseBeamPower, uPulseBeamRange;
      uniform vec3 uPulseElectricPosition, uPulseElectricColor;
      uniform float uPulseElectricPower, uPulseElectricRange;
      uniform vec3 uMeshColor;
      uniform vec3 uDotColor;
      uniform vec3 uAlertColor;
      uniform float uDangerSizeMultiplier;
      uniform float uDotRadiusM;
      uniform float uDotSpacingM;
      uniform vec3 uProbeCenter;
      uniform float uProbeRadius;
      uniform float uProbeActive;
      uniform float uProbeExpanding;
      uniform float uProbeRingOpacity;
      uniform float uProbeTailAge;
      uniform float uProbeSpeed;
      uniform float uProbeAfterglowDuration;
      uniform float uProbePatternType;
      uniform float uProbePatternSpacing;
      uniform float uProbePatternSize;
      uniform vec3 uProbePatternColor;
      uniform float uProbePatternBrightness;
      uniform float uProbeFrontWidth;
      uniform vec3 uProbeFrontColor;
      uniform float uProbeFrontBrightness;
      uniform vec3 uProbeTrailColor;
      uniform float uProbeTrailLength;
      uniform float uProbeTrailFalloff;
      uniform float uCarveMaskCount;
      uniform vec3 uCarveStarts[8];
      uniform vec3 uCarveEnds[8];
      uniform float uCarveRadiusSquared[8];
      uniform float uPulseScarCount;
      uniform vec3 uPulseScarStarts[8];
      uniform vec3 uPulseScarEnds[8];
      uniform vec3 uPulseScarColors[8];
      uniform float uPulseScarRadiusSquared[8];
      uniform float uPulseScarOuterRadiusSquared[8];
      uniform float uPulseScarStrength;
      varying vec3 vTerrainWorldPosition;
      varying float vAlert;
      varying float vProbeInfluence;
      varying float vProbeCore;

      float segmentDistanceSquared(vec3 p, vec3 a, vec3 b) {
        vec3 ab = b - a;
        float denominator = dot(ab, ab);
        float t = denominator > 0.000001 ? clamp(dot(p - a, ab) / denominator, 0.0, 1.0) : 0.0;
        vec3 delta = p - (a + ab * t);
        return dot(delta, delta);
      }

      vec3 pulseLight(
        vec3 position,
        vec3 lightColor,
        float lightPower,
        float lightRange,
        vec3 faceNormal
      ) {
        vec3 toLight = position - vTerrainWorldPosition;
        float lightDistance = length(toLight);
        float falloff = pow(max(0.0, 1.0 - lightDistance / max(lightRange, 0.001)), 2.0);
        float facing = max(0.0, dot(faceNormal, toLight / max(lightDistance, 0.001)));
        return lightColor * lightPower * 0.004 * falloff * (0.16 + facing * 1.25);
      }

      float latticeDot(vec2 coordinate, float radiusM) {
        vec2 gridCoord = coordinate / max(uDotSpacingM, 0.0001);
        vec2 nearestVertex = (fract(gridCoord + 0.5) - 0.5) * uDotSpacingM;
        float dotDistanceM = length(nearestVertex);
        float antialiasM = max(fwidth(dotDistanceM), 0.001);
        return 1.0 - smoothstep(
          radiusM - antialiasM,
          radiusM + antialiasM,
          dotDistanceM
        );
      }

      float triplanarDot(vec3 faceNormal, float radiusM) {
        vec3 weight = pow(abs(faceNormal), vec3(8.0));
        weight /= max(weight.x + weight.y + weight.z, 0.0001);
        return latticeDot(vTerrainWorldPosition.yz, radiusM) * weight.x
          + latticeDot(vTerrainWorldPosition.xz, radiusM) * weight.y
          + latticeDot(vTerrainWorldPosition.xy, radiusM) * weight.z;
      }

      float scanPattern2d(vec2 coordinate) {
        float spacingM = max(uProbePatternSpacing, 0.001);
        vec2 cellM = (fract(coordinate / spacingM + 0.5) - 0.5) * spacingM;
        float halfSizeM = max(uProbePatternSize * 0.5, 0.001);
        float antialiasM = max(fwidth(length(cellM)), 0.001);
        float dotDistanceM = length(cellM) - halfSizeM;
        float barHalfWidthM = max(halfSizeM * 0.22, antialiasM * 0.75);
        vec2 absoluteCellM = abs(cellM);
        float horizontalDistanceM = max(
          absoluteCellM.x - halfSizeM,
          absoluteCellM.y - barHalfWidthM
        );
        float verticalDistanceM = max(
          absoluteCellM.x - barHalfWidthM,
          absoluteCellM.y - halfSizeM
        );
        float plusDistanceM = min(horizontalDistanceM, verticalDistanceM);
        float signedDistanceM = mix(dotDistanceM, plusDistanceM, step(0.5, uProbePatternType));
        return 1.0 - smoothstep(-antialiasM, antialiasM, signedDistanceM);
      }

      float triplanarScanPattern(vec3 faceNormal) {
        vec3 weight = pow(abs(faceNormal), vec3(8.0));
        weight /= max(weight.x + weight.y + weight.z, 0.0001);
        return scanPattern2d(vTerrainWorldPosition.yz) * weight.x
          + scanPattern2d(vTerrainWorldPosition.xz) * weight.y
          + scanPattern2d(vTerrainWorldPosition.xy) * weight.z;
      }

      float probeRingMask() {
        float radialDistanceM = distance(vTerrainWorldPosition, uProbeCenter);
        float ringDistanceM = abs(radialDistanceM - uProbeRadius);
        float onePixelM = max(fwidth(radialDistanceM), 0.001);
        float halfWidthM = max(uProbeFrontWidth * 0.5, onePixelM * 1.25);
        return (1.0 - smoothstep(
          max(0.0, halfWidthM - onePixelM),
          halfWidthM + onePixelM,
          ringDistanceM
        ))
          * uProbeExpanding * uProbeRingOpacity;
      }

      float probeAfterglowMask() {
        float radialDistanceM = distance(vTerrainWorldPosition, uProbeCenter);
        float distanceBehindWaveM = uProbeRadius - radialDistanceM;
        float hasBeenScanned = step(0.0, distanceBehindWaveM);
        float scanAgeS = max(0.0, distanceBehindWaveM) / max(uProbeSpeed, 0.001)
          + uProbeTailAge;
        float persistence = 1.0 - smoothstep(
          0.0,
          max(uProbeAfterglowDuration, 0.001),
          scanAgeS
        );
        return hasBeenScanned * persistence * uProbeActive;
      }

      float probeTrailMask() {
        float radialDistanceM = distance(vTerrainWorldPosition, uProbeCenter);
        float distanceBehindWaveM = uProbeRadius - radialDistanceM;
        float trailLengthM = max(uProbeTrailLength, 0.001);
        // After expansion finishes, advance the tail toward the stopped front
        // at the same configured scan speed so this broad tint remains bounded.
        float effectiveDistanceM = distanceBehindWaveM + uProbeTailAge * uProbeSpeed;
        float normalizedTrail = clamp(1.0 - effectiveDistanceM / trailLengthM, 0.0, 1.0);
        float hasBeenScanned = step(0.0, distanceBehindWaveM);
        float trailEnabled = step(0.001, uProbeTrailLength);
        return hasBeenScanned * trailEnabled
          * pow(normalizedTrail, max(uProbeTrailFalloff, 0.001))
          * uProbeActive;
      }

      // Stable ordered coverage lets dot mode have genuinely empty fragments
      // without transparent-mesh sorting or invisible depth writes. It also
      // gives the opposite-mode scan reveal a gradual, deterministic fade.
      float orderedCoverageThreshold() {
        vec2 pixel = mod(floor(gl_FragCoord.xy), 4.0);
        vec2 lowBits = mod(pixel, 2.0);
        vec2 highBits = floor(pixel * 0.5);
        float lowValue = 2.0 * lowBits.x + 3.0 * lowBits.y
          - 4.0 * lowBits.x * lowBits.y;
        float highValue = 2.0 * highBits.x + 3.0 * highBits.y
          - 4.0 * highBits.x * highBits.y;
        return (4.0 * lowValue + highValue + 0.5) / 16.0;
      }

      void main() {
        for (int i = 0; i < 8; i++) {
          if (float(i) >= uCarveMaskCount) break;
          if (segmentDistanceSquared(vTerrainWorldPosition, uCarveStarts[i], uCarveEnds[i])
            <= uCarveRadiusSquared[i]) discard;
        }
        vec3 faceNormal = normalize(cross(dFdx(vTerrainWorldPosition), dFdy(vTerrainWorldPosition)));
        if (!gl_FrontFacing) faceNormal = -faceNormal;
        vec3 lightDirection = normalize(vec3(-0.42, 0.82, -0.38));
        float diffuse = abs(dot(faceNormal, lightDirection));
        float axialVariation = 1.0 - abs(faceNormal.y);
        float ringMask = probeRingMask();
        float afterglowMask = probeAfterglowMask();
        float trailMask = probeTrailMask();
        float patternMask = triplanarScanPattern(faceNormal) * afterglowMask;

        vec3 meshColor = uMeshColor * (0.62 + diffuse * 0.76 + axialVariation * 0.16);
        float dangerMix = smoothstep(0.0, 0.92, vAlert);
        meshColor = mix(meshColor, uAlertColor, dangerMix);
        meshColor += uAlertColor * vAlert * 0.05;

        float dangerRadiusM = uDotRadiusM * mix(1.0, uDangerSizeMultiplier, vAlert);
        float dotMask = triplanarDot(faceNormal, dangerRadiusM);
        vec3 dotColor = uDotColor;
        dotColor = mix(dotColor, uAlertColor, smoothstep(0.0, 0.92, vAlert));
        dotColor += uAlertColor * vAlert * 0.05;
        vec3 patternColor = uProbePatternColor * uProbePatternBrightness;
        vec3 frontColor = uProbeFrontColor * uProbeFrontBrightness;
        vec3 trailColor = uProbeTrailColor;

        vec3 color;
        #ifdef TERRAIN_DOT_MODE
          // Retain normal terrain dots, then reveal only the sparse scanned
          // marker pattern and the advancing solid front stripe.
          float fragmentCoverage = max(dotMask, max(patternMask, ringMask));
          if (fragmentCoverage <= orderedCoverageThreshold()) discard;
          color = dotMask > 0.001 ? dotColor : meshColor;
          color = mix(color, trailColor, trailMask);
          color = mix(color, patternColor, patternMask);
          color = mix(color, frontColor, ringMask);
        #else
          color = mix(meshColor, trailColor, trailMask);
          color = mix(color, patternColor, patternMask);
          color = mix(color, frontColor, ringMask);
        #endif
        vec3 pulseScarColor = vec3(0.0);
        float pulseScarWeight = 0.0;
        float pulseScarMix = 0.0;
        for (int i = 0; i < 8; i++) {
          if (float(i) >= uPulseScarCount) break;
          vec3 axis = uPulseScarEnds[i] - uPulseScarStarts[i];
          float axisLengthSquared = dot(axis, axis);
          float along = axisLengthSquared > 0.000001
            ? clamp(dot(vTerrainWorldPosition - uPulseScarStarts[i], axis) / axisLengthSquared, 0.0, 1.0)
            : 1.0;
          vec3 radialDelta = vTerrainWorldPosition
            - (uPulseScarStarts[i] + axis * along);
          float radialDistanceSquared = dot(radialDelta, radialDelta);
          float radial = 1.0 - smoothstep(
            uPulseScarRadiusSquared[i],
            uPulseScarOuterRadiusSquared[i],
            radialDistanceSquared
          );
          // The rounded far cap receives full influence. Surfaces nearer the
          // muzzle retain only a faint trace of the same beam color.
          float axial = mix(0.18, 1.0, smoothstep(0.0, 1.0, along));
          float influence = radial * axial;
          pulseScarColor += uPulseScarColors[i] * influence;
          pulseScarWeight += influence;
          pulseScarMix = max(pulseScarMix, influence);
        }
        if (pulseScarWeight > 0.0001) {
          color = mix(
            color,
            pulseScarColor / pulseScarWeight,
            clamp(pulseScarMix * uPulseScarStrength, 0.0, 0.85)
          );
        }
        vec3 toBoost = uBoostPosition - vTerrainWorldPosition;
        float boostDistance = length(toBoost);
        float boostFalloff = pow(max(0.0, 1.0 - boostDistance / 46.0), 2.0);
        float boostDiffuse = max(0.0, dot(faceNormal, toBoost / max(boostDistance, 0.001)));
        color += uBoostColor * uBoostPower * boostFalloff * (0.2 + boostDiffuse * 1.4);
        color += pulseLight(uPulseBeamPosition, uPulseBeamColor, uPulseBeamPower, uPulseBeamRange, faceNormal);
        color += pulseLight(uPulseElectricPosition, uPulseElectricColor, uPulseElectricPower, uPulseElectricRange, faceNormal);
        gl_FragColor = vec4(color, 1.0);
        #include <fog_fragment>
      }
    `,
  });
}

interface ChunkGenerationRequest {
  key: string;
  chunk: VolumeChunkCoordinate;
  priority: number;
  revision: number;
  carve: boolean;
}

interface InFlightRequest {
  key: string;
  chunk: VolumeChunkCoordinate;
  revision: number;
}

interface TerrainWorkerSlot {
  worker: Worker;
  busy: boolean;
  requestId?: number;
}

interface CompletedChunkResult {
  key: string;
  chunk: VolumeChunkCoordinate;
  revision: number;
  vertices: Float32Array;
}

interface PendingCarveMask {
  readonly start: Vector3;
  readonly end: Vector3;
  readonly radius: number;
  readonly requiredByKey: Map<string, number>;
}

interface PulseTerrainScar {
  readonly start: Vector3;
  readonly end: Vector3;
  readonly radius: number;
  readonly color: Color;
  readonly affectedKeys: readonly string[];
}

export class TerrainManager {
  readonly group = new Group();
  private readonly terrain: ProceduralTerrain;
  private terrainMaterial: ShaderMaterial;
  private readonly dotMaterial: ShaderMaterial;
  private readonly meshMaterial: ShaderMaterial;
  private readonly chunks: TerrainChunk[];
  private readonly active = new Map<string, TerrainChunk>();
  private readonly workers: TerrainWorkerSlot[] = [];
  private readonly queuedByKey = new Map<string, ChunkGenerationRequest>();
  private readonly inFlight = new Map<number, InFlightRequest>();
  private readonly inFlightByKey = new Map<string, number>();
  private readonly requiredRevisionByKey = new Map<string, number>();
  private readonly baseDensityByKey = new Map<string, Float32Array>();
  private readonly baseMaximumByKey = new Map<string, number>();
  private readonly syncBuffer = new Float32MeshBuffer();
  private readonly syncCarvedDensity = new Float32Array(densityLatticeLength());
  private readonly completedResults: CompletedChunkResult[] = [];
  private readonly pendingCarveMasks: PendingCarveMask[] = [];
  private readonly pulseTerrainScars: PulseTerrainScar[] = [];
  private pulseTerrainTintWidth = 18;
  private generationQueue: ChunkGenerationRequest[] = [];
  private desiredKeys = new Set<string>();
  private readonly currentRenderOrigin = new Vector3();
  private nextRequestId = 1;
  private readonly probeWorldCenter = new Vector3();
  private probeRadius = 0;
  private probeActive = false;
  private probeExpanding = false;
  private probeTailAge = 0;
  private probeAfterglowDuration: number = PROBE.afterglowDuration;
  private probeSpeed: number = PROBE.speed;
  private probeTrailLength = 160;
  private lastCenterX = Number.NaN;
  private lastCenterY = Number.NaN;
  private lastCenterZ = Number.NaN;
  private readonly synchronousBudget: number;
  private disposed = false;
  private staleResultCount = 0;
  private coalescedRequestCount = 0;

  constructor(
    scene: Scene,
    terrain: ProceduralTerrain,
    options: { synchronousBudget?: number } = {},
  ) {
    this.terrain = terrain;
    this.dotMaterial = createTerrainMaterial();
    this.meshMaterial = this.dotMaterial.clone();
    this.meshMaterial.defines = { TERRAIN_MESH_MODE: 1 };
    this.meshMaterial.uniforms = this.dotMaterial.uniforms;
    this.meshMaterial.needsUpdate = true;
    this.terrainMaterial = this.dotMaterial;
    this.synchronousBudget = Math.max(1, options.synchronousBudget ?? 1);

    const supportsWorkers = typeof Worker !== 'undefined';
    // One spare Z slab lets newly generated terrain become visible before the
    // old slab is retired. Diagonal crossings reuse retired chunks as results
    // arrive, so this remains strictly bounded.
    const spareChunks = supportsWorkers ? TERRAIN.columns * TERRAIN.verticalLayers : 0;
    this.chunks = Array.from(
      { length: TERRAIN.columns * TERRAIN.verticalLayers * TERRAIN.rows + spareChunks },
      () => new TerrainChunk(this.terrainMaterial),
    );
    for (const chunk of this.chunks) this.group.add(chunk.group);
    scene.add(this.group);

    if (supportsWorkers) {
      const workerCount = Math.min(2, Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 4)));
      for (let index = 0; index < workerCount; index += 1) {
        const slot: TerrainWorkerSlot = {
          worker: new Worker(new URL('./TerrainWorker.ts', import.meta.url), { type: 'module' }),
          busy: false,
        };
        slot.worker.onmessage = (event: MessageEvent<TerrainWorkerResponse>): void => {
          this.acceptWorkerResult(slot, event.data);
        };
        slot.worker.onerror = (): void => this.handleWorkerFailure(slot);
        slot.worker.onmessageerror = (): void => this.handleWorkerFailure(slot);
        this.workers.push(slot);
      }
    }
  }

  update(worldPosition: Vector3, renderOrigin: Vector3): void {
    if (this.disposed) return;
    this.currentRenderOrigin.copy(renderOrigin);
    this.drainCompletedResults();
    this.retireSettledCarveMasks();
    const centerX = Math.floor(worldPosition.x / TERRAIN.chunkSize);
    const centerY = Math.floor(worldPosition.y / TERRAIN.chunkSize);
    const centerZ = Math.floor(worldPosition.z / TERRAIN.chunkSize);
    const centerChanged = !(
      centerX === this.lastCenterX
      && centerY === this.lastCenterY
      && centerZ === this.lastCenterZ
    );
    if (centerChanged) {
      this.lastCenterX = centerX;
      this.lastCenterY = centerY;
      this.lastCenterZ = centerZ;

      const desired: ChunkGenerationRequest[] = [];
      const verticalHalf = Math.floor(TERRAIN.verticalLayers / 2);
      for (let dz = -TERRAIN.rowsBehind; dz < TERRAIN.rows - TERRAIN.rowsBehind; dz += 1) {
        for (let dy = -verticalHalf; dy <= verticalHalf; dy += 1) {
          for (let dx = -Math.floor(TERRAIN.columns / 2); dx <= Math.floor(TERRAIN.columns / 2); dx += 1) {
            const chunk = { x: centerX + dx, y: centerY + dy, z: centerZ + dz };
            desired.push({
              key: chunkKey(chunk),
              chunk,
              // Populate the immediate flight envelope first, with a slight bias
              // toward terrain in front of the aircraft.
              priority: dx * dx + dy * dy * 1.35 + dz * dz * 0.72 - (dz > 0 ? 0.2 : 0),
              revision: this.terrain.carveRevisionForChunk(chunk),
              carve: false,
            });
          }
        }
      }
      desired.sort((a, b) => a.priority - b.priority);
      this.desiredKeys = new Set(desired.map(({ key }) => key));
      this.pruneDistantPulseScars();
      this.generationQueue = this.generationQueue.filter(({ key }) => this.desiredKeys.has(key));
      this.rebuildQueuedIndex();
      for (const key of this.requiredRevisionByKey.keys()) {
        if (!this.desiredKeys.has(key) && !this.inFlightByKey.has(key)) {
          this.requiredRevisionByKey.delete(key);
        }
      }
      for (const key of this.baseDensityByKey.keys()) {
        if (!this.desiredKeys.has(key) && !this.active.has(key) && !this.inFlightByKey.has(key)) {
          this.baseDensityByKey.delete(key);
          this.baseMaximumByKey.delete(key);
        }
      }
      for (const request of desired) {
        this.requiredRevisionByKey.set(request.key, request.revision);
        const active = this.active.get(request.key);
        if (active && active.revision >= request.revision) continue;
        if (this.inFlightByKey.has(request.key)) continue;
        this.enqueue(request);
      }
    }

    if (this.workers.length === 0) this.generateSynchronously();
    else this.dispatchWorkers();
  }

  private generateSynchronously(): void {
    let generated = 0;
    while (generated < this.synchronousBudget) {
      const request = this.generationQueue.shift();
      if (!request) break;
      this.queuedByKey.delete(request.key);
      let baseDensity = this.baseDensityByKey.get(request.key);
      if (!baseDensity) {
        baseDensity = sampleDensityLattice(request.chunk, {
          densityAt: this.terrain.baseDensityAt.bind(this.terrain),
        });
        this.baseDensityByKey.set(request.key, baseDensity);
        this.baseMaximumByKey.set(request.key, latticeMaximum(baseDensity));
        this.terrain.primeCollisionBaseLattice(request.chunk, baseDensity);
      }
      const carves = this.terrain.carveSnapshotForChunk(request.chunk);
      const density = carves.length === 0 ? baseDensity : applyCarveSnapshotToLattice(
        request.chunk, baseDensity, carves, this.syncCarvedDensity,
      );
      polygonizeDensityLattice(density, this.syncBuffer);
      const vertices = this.syncBuffer.data.slice(0, this.syncBuffer.length);
      this.installGeneratedChunk(request.key, request.chunk, vertices, request.revision);
      generated += 1;
    }
    this.releaseRetiredChunks();
  }

  private dispatchWorkers(): void {
    for (const slot of this.workers) {
      if (slot.busy) continue;
      const request = this.generationQueue.shift();
      if (!request) break;
      this.queuedByKey.delete(request.key);
      const requestId = this.nextRequestId;
      this.nextRequestId += 1;
      slot.busy = true;
      slot.requestId = requestId;
      this.inFlight.set(requestId, {
        key: request.key,
        chunk: request.chunk,
        revision: request.revision,
      });
      this.inFlightByKey.set(request.key, requestId);
      const carves = this.terrain.carveSnapshotForChunk(request.chunk);
      const baseDensity = this.baseDensityByKey.get(request.key);
      if (baseDensity) this.baseDensityByKey.delete(request.key);
      const message: TerrainWorkerRequest = {
        requestId,
        seed: this.terrain.seedText,
        chunk: request.chunk,
        revision: request.revision,
        carves,
        baseDensity,
      };
      const transfer: Transferable[] = [carves.buffer];
      if (baseDensity) transfer.push(baseDensity.buffer);
      slot.worker.postMessage(message, transfer);
    }
  }

  private paused = false;
  private readonly deferredResults: Array<[TerrainWorkerSlot, TerrainWorkerResponse]> = [];

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) {
      for (const [slot, response] of this.deferredResults.splice(0)) this.acceptWorkerResult(slot, response);
      this.drainCompletedResults();
    }
  }

  private acceptWorkerResult(slot: TerrainWorkerSlot, response: TerrainWorkerResponse): void {
    if (this.disposed) return;
    if (this.paused) {
      this.deferredResults.push([slot, response]);
      return;
    }
    const expectedRequestId = slot.requestId;
    slot.busy = false;
    slot.requestId = undefined;
    const request = expectedRequestId === undefined
      ? undefined
      : this.inFlight.get(expectedRequestId);
    if (expectedRequestId !== undefined) this.inFlight.delete(expectedRequestId);
    if (request) this.inFlightByKey.delete(request.key);
    const valid = request
      && response
      && response.requestId === expectedRequestId
      && response.chunk
      && response.chunk.x === request.chunk.x
      && response.chunk.y === request.chunk.y
      && response.chunk.z === request.chunk.z
      && response.revision === request.revision
      && response.vertices instanceof ArrayBuffer
      && response.vertices.byteLength % (Float32Array.BYTES_PER_ELEMENT * 3) === 0
      && response.vertices.byteLength <= maximumChunkVertexBytes()
      && response.baseDensity instanceof ArrayBuffer
      && response.baseDensity.byteLength === densityLatticeLength() * Float32Array.BYTES_PER_ELEMENT
      && Number.isFinite(response.baseMaximum);
    if (valid && this.desiredKeys.has(request.key)) {
      const baseDensity = new Float32Array(response.baseDensity);
      this.baseDensityByKey.set(request.key, baseDensity);
      this.baseMaximumByKey.set(request.key, response.baseMaximum);
      this.terrain.primeCollisionBaseLattice(response.chunk, baseDensity);
      const requiredRevision = this.requiredRevisionByKey.get(request.key) ?? 0;
      if (response.revision >= requiredRevision) {
        this.completedResults.push({
          key: request.key,
          chunk: response.chunk,
          revision: response.revision,
          vertices: new Float32Array(response.vertices),
        });
      } else {
        this.staleResultCount += 1;
        this.enqueueLatest(request.key, request.chunk, true);
      }
    } else if (request && this.desiredKeys.has(request.key)) {
      this.enqueueLatest(request.key, request.chunk, true);
    }
    this.releaseRetiredChunks();
    this.dispatchWorkers();
  }

  /** Install at most one completed geometry per update. */
  private drainCompletedResults(): void {
    while (this.completedResults.length > 0) {
      const result = this.completedResults.shift()!;
      if (!this.desiredKeys.has(result.key)) continue;
      const requiredRevision = this.requiredRevisionByKey.get(result.key) ?? 0;
      if (result.revision < requiredRevision) {
        this.staleResultCount += 1;
        if (!this.inFlightByKey.has(result.key)) this.enqueueLatest(result.key, result.chunk, true);
        continue;
      }
      this.installGeneratedChunk(result.key, result.chunk, result.vertices, result.revision);
      this.releaseRetiredChunks();
      break;
    }
  }

  private installGeneratedChunk(
    key: string,
    coordinate: VolumeChunkCoordinate,
    vertices: Float32Array,
    revision: number,
  ): void {
    const activeChunk = this.active.get(key);
    if (activeChunk) {
      activeChunk.assignGenerated(
        coordinate.x,
        coordinate.y,
        coordinate.z,
        this.currentRenderOrigin,
        vertices,
        revision,
      );
      return;
    }
    let chunk = this.chunks.find((candidate) => !candidate.active);
    if (!chunk) {
      const retiredEntry = [...this.active.entries()].find(([activeKey]) => (
        !this.desiredKeys.has(activeKey)
      ));
      if (!retiredEntry) return;
      const [retiredKey, retiredChunk] = retiredEntry;
      this.active.delete(retiredKey);
      retiredChunk.release();
      chunk = retiredChunk;
    }
    chunk.assignGenerated(
      coordinate.x,
      coordinate.y,
      coordinate.z,
      this.currentRenderOrigin,
      vertices,
      revision,
    );
    this.active.set(key, chunk);
  }

  get canAcceptPulseCarve(): boolean {
    if (this.disposed) return false;
    this.retireSettledCarveMasks();
    return this.pendingCarveMasks.length < MAX_CARVE_MASKS;
  }

  applyPulseCarve(
    start: Vector3,
    end: Vector3,
    radius: number,
    color = '#9ffcff',
  ): TerrainCarveResult {
    if (this.disposed || this.pendingCarveMasks.length >= MAX_CARVE_MASKS) {
      return { applied: false, affectedChunks: [] };
    }
    const result = this.terrain.applyCarveCapsule(start, end, radius);
    if (!result.applied) return result;
    this.pulseTerrainScars.push({
      start: start.clone(),
      end: end.clone(),
      radius,
      color: new Color(color),
      affectedKeys: result.affectedChunks.map(chunkKey),
    });
    if (this.pulseTerrainScars.length > MAX_PULSE_SCARS) this.pulseTerrainScars.shift();
    this.syncPulseScarUniforms();
    const requiredByKey = new Map<string, number>();
    for (const chunk of result.affectedChunks) {
      const key = chunkKey(chunk);
      const revision = this.terrain.carveRevisionForChunk(chunk);
      if (this.desiredKeys.has(key)) {
        this.requiredRevisionByKey.set(key, revision);
        const active = this.active.get(key);
        if (active) requiredByKey.set(key, revision);
        if (active && (this.baseMaximumByKey.get(key) ?? 0) < 0) {
          active.advanceRevision(revision);
          continue;
        }
        if (!this.inFlightByKey.has(key)) {
          const cx = (chunk.x + 0.5) * TERRAIN.chunkSize;
          const cy = (chunk.y + 0.5) * TERRAIN.chunkSize;
          const cz = (chunk.z + 0.5) * TERRAIN.chunkSize;
          const distance = Math.hypot(cx - start.x, cy - start.y, cz - start.z);
          this.enqueue({ key, chunk, priority: -10_000 + distance * 0.001, revision, carve: true });
        }
      }
    }
    if (requiredByKey.size > 0) {
      this.pendingCarveMasks.push({
        start: start.clone(), end: end.clone(), radius, requiredByKey,
      });
      this.syncCarveMaskUniforms();
    }
    if (this.workers.length > 0) this.dispatchWorkers();
    return result;
  }

  private enqueue(request: ChunkGenerationRequest): void {
    const queued = this.queuedByKey.get(request.key);
    if (queued) {
      queued.priority = Math.min(queued.priority, request.priority);
      queued.revision = Math.max(queued.revision, request.revision);
      queued.carve ||= request.carve;
      this.coalescedRequestCount += 1;
    } else {
      this.generationQueue.push(request);
      this.queuedByKey.set(request.key, request);
    }
    this.generationQueue.sort((a, b) => (
      Number(b.carve) - Number(a.carve) || a.priority - b.priority
    ));
  }

  private enqueueLatest(key: string, chunk: VolumeChunkCoordinate, carve: boolean): void {
    this.enqueue({
      key,
      chunk,
      priority: carve ? -10_000 : 0,
      revision: this.requiredRevisionByKey.get(key) ?? this.terrain.carveRevisionForChunk(chunk),
      carve,
    });
  }

  private rebuildQueuedIndex(): void {
    this.queuedByKey.clear();
    for (const request of this.generationQueue) this.queuedByKey.set(request.key, request);
  }

  private handleWorkerFailure(slot: TerrainWorkerSlot): void {
    if (this.disposed) return;
    const index = this.workers.indexOf(slot);
    if (index < 0) return;
    const requestId = slot.requestId;
    const request = requestId === undefined ? undefined : this.inFlight.get(requestId);
    if (requestId !== undefined && request) {
      this.inFlight.delete(requestId);
      this.inFlightByKey.delete(request.key);
      if (this.desiredKeys.has(request.key)) this.enqueueLatest(request.key, request.chunk, true);
    }
    for (let deferred = this.deferredResults.length - 1; deferred >= 0; deferred -= 1) {
      if (this.deferredResults[deferred][0] === slot) this.deferredResults.splice(deferred, 1);
    }
    slot.worker.terminate();
    this.workers.splice(index, 1);
    if (this.workers.length === 0) this.generateSynchronously();
    else this.dispatchWorkers();
  }

  private retireSettledCarveMasks(): void {
    let changed = false;
    for (let index = this.pendingCarveMasks.length - 1; index >= 0; index -= 1) {
      const mask = this.pendingCarveMasks[index];
      const settled = [...mask.requiredByKey].every(([key, revision]) => (
        !this.desiredKeys.has(key) || (this.active.get(key)?.revision ?? -1) >= revision
      ));
      if (!settled) continue;
      this.pendingCarveMasks.splice(index, 1);
      changed = true;
    }
    if (changed) this.syncCarveMaskUniforms();
  }

  private syncCarveMaskUniforms(): void {
    const uniforms = this.dotMaterial.uniforms;
    const starts = uniforms.uCarveStarts.value as Vector3[];
    const ends = uniforms.uCarveEnds.value as Vector3[];
    const radiusSquared = uniforms.uCarveRadiusSquared.value as Float32Array;
    uniforms.uCarveMaskCount.value = this.pendingCarveMasks.length;
    for (let index = 0; index < MAX_CARVE_MASKS; index += 1) {
      const mask = this.pendingCarveMasks[index];
      if (mask) {
        starts[index].copy(mask.start).sub(this.currentRenderOrigin);
        ends[index].copy(mask.end).sub(this.currentRenderOrigin);
        radiusSquared[index] = mask.radius * mask.radius;
      } else {
        starts[index].set(0, 0, 0);
        ends[index].set(0, 0, 0);
        radiusSquared[index] = 0;
      }
    }
  }

  private syncPulseScarUniforms(): void {
    const uniforms = this.dotMaterial.uniforms;
    const starts = uniforms.uPulseScarStarts.value as Vector3[];
    const ends = uniforms.uPulseScarEnds.value as Vector3[];
    const colors = uniforms.uPulseScarColors.value as Color[];
    const radiusSquared = uniforms.uPulseScarRadiusSquared.value as Float32Array;
    const outerRadiusSquared = uniforms.uPulseScarOuterRadiusSquared.value as Float32Array;
    uniforms.uPulseScarCount.value = this.pulseTerrainScars.length;
    for (let index = 0; index < MAX_PULSE_SCARS; index += 1) {
      const scar = this.pulseTerrainScars[index];
      if (scar) {
        starts[index].copy(scar.start).sub(this.currentRenderOrigin);
        ends[index].copy(scar.end).sub(this.currentRenderOrigin);
        colors[index].copy(scar.color);
        radiusSquared[index] = scar.radius * scar.radius;
        const outerRadius = scar.radius + this.pulseTerrainTintWidth;
        outerRadiusSquared[index] = outerRadius * outerRadius;
      } else {
        starts[index].set(0, 0, 0);
        ends[index].set(0, 0, 0);
        colors[index].set(0);
        radiusSquared[index] = 0;
        outerRadiusSquared[index] = 0;
      }
    }
  }

  private pruneDistantPulseScars(): void {
    const retained = this.pulseTerrainScars.filter(scar => (
      scar.affectedKeys.some(key => this.desiredKeys.has(key))
    ));
    if (retained.length === this.pulseTerrainScars.length) return;
    this.pulseTerrainScars.splice(0, this.pulseTerrainScars.length, ...retained);
    this.syncPulseScarUniforms();
  }

  private releaseRetiredChunks(): void {
    // Keep outgoing terrain visible until its replacements are complete. This
    // prevents a black seam while workers build the next slab.
    if ([...this.desiredKeys].some((key) => !this.active.has(key))) return;
    for (const [key, chunk] of this.active) {
      if (this.desiredKeys.has(key)) continue;
      chunk.release();
      this.active.delete(key);
    }
  }

  updateRenderOrigin(origin: Vector3): void {
    this.currentRenderOrigin.copy(origin);
    for (const chunk of this.active.values()) chunk.updateRenderPosition(origin);
    this.syncCarveMaskUniforms();
    this.syncPulseScarUniforms();
  }

  updateBoostLight(position: Vector3, color: Color, intensity: number): void {
    this.terrainMaterial.uniforms.uBoostPosition.value.copy(position);
    this.terrainMaterial.uniforms.uBoostColor.value.copy(color);
    this.terrainMaterial.uniforms.uBoostPower.value = intensity;
  }

  updatePulseLights(
    beamPosition: Vector3,
    beamColor: Color,
    beamIntensity: number,
    beamRange: number,
    electricPosition: Vector3,
    electricColor: Color,
    electricIntensity: number,
    electricRange: number,
  ): void {
    const uniforms = this.terrainMaterial.uniforms;
    uniforms.uPulseBeamPosition.value.copy(beamPosition);
    uniforms.uPulseBeamColor.value.copy(beamColor);
    uniforms.uPulseBeamPower.value = beamIntensity;
    uniforms.uPulseBeamRange.value = beamRange;
    uniforms.uPulseElectricPosition.value.copy(electricPosition);
    uniforms.uPulseElectricColor.value.copy(electricColor);
    uniforms.uPulseElectricPower.value = electricIntensity;
    uniforms.uPulseElectricRange.value = electricRange;
  }

  updateAircraftPosition(renderPosition: Vector3): void {
    this.terrainMaterial.uniforms.uAircraftPosition.value.copy(renderPosition);
  }

  triggerProbe(worldPosition: Vector3): void {
    this.probeWorldCenter.copy(worldPosition);
    this.probeRadius = 0;
    this.probeActive = true;
    this.probeExpanding = true;
    this.probeTailAge = 0;
    this.terrainMaterial.uniforms.uProbeActive.value = 1;
    this.terrainMaterial.uniforms.uProbeExpanding.value = 1;
  }

  updateProbe(dt: number, renderOrigin: Vector3): void {
    if (this.probeExpanding) {
      this.probeRadius += this.probeSpeed * Math.max(0, dt);
      if (this.probeRadius >= PROBE.maxRadius) {
        this.probeRadius = PROBE.maxRadius;
        this.probeExpanding = false;
        this.probeTailAge = 0;
      }
    } else if (this.probeActive) {
      this.probeTailAge += Math.max(0, dt);
      const trailDuration = this.probeTrailLength / Math.max(this.probeSpeed, 0.001);
      if (this.probeTailAge >= Math.max(this.probeAfterglowDuration, trailDuration))
        this.probeActive = false;
    }

    const fadeIn = Math.min(1, this.probeRadius / 20);
    const fadeOut = Math.min(1, Math.max(0, (1 - this.probeRadius / PROBE.maxRadius) / 0.14));
    this.terrainMaterial.uniforms.uProbeRadius.value = this.probeRadius;
    this.terrainMaterial.uniforms.uProbeCenter.value.copy(this.probeWorldCenter).sub(renderOrigin);
    this.terrainMaterial.uniforms.uProbeActive.value = this.probeActive ? 1 : 0;
    this.terrainMaterial.uniforms.uProbeExpanding.value = this.probeExpanding ? 1 : 0;
    this.terrainMaterial.uniforms.uProbeRingOpacity.value = this.probeExpanding ? fadeIn * fadeOut : 0;
    this.terrainMaterial.uniforms.uProbeTailAge.value = this.probeTailAge;
  }

  applyVisualSettings(settings: VisualSettings): void {
    const nextMaterial = settings.terrainRenderingMode === 'mesh'
      ? this.meshMaterial
      : this.dotMaterial;
    if (nextMaterial !== this.terrainMaterial) {
      this.terrainMaterial = nextMaterial;
      for (const chunk of this.chunks) chunk.setMaterial(nextMaterial);
    }
    this.terrainMaterial.uniforms.uDangerDistance.value = settings.dangerDistance;
    this.terrainMaterial.uniforms.uDangerSizeMultiplier.value = settings.dangerSizeMultiplier;
    this.terrainMaterial.uniforms.uDangerSizeFalloff.value = settings.dangerSizeFalloff;
    this.terrainMaterial.uniforms.uDotRadiusM.value = settings.terrainDotRadiusM;
    this.terrainMaterial.uniforms.uDotSpacingM.value = dotSpacingFromDensity(
      settings.terrainDotDensityPer100M2,
    );
    this.terrainMaterial.uniforms.uDotColor.value.set(settings.terrainColor);
    this.terrainMaterial.uniforms.uMeshColor.value.set(settings.meshColor);
    this.terrainMaterial.uniforms.uAlertColor.value.set(settings.dangerColor);
    this.probeSpeed = settings.scanTerrainSpeed;
    this.terrainMaterial.uniforms.uProbeSpeed.value = settings.scanTerrainSpeed;
    this.terrainMaterial.uniforms.uProbePatternType.value = settings.scanTerrainPattern === 'plus' ? 1 : 0;
    this.terrainMaterial.uniforms.uProbePatternSpacing.value = settings.scanTerrainPatternSpacing;
    this.terrainMaterial.uniforms.uProbePatternSize.value = settings.scanTerrainPatternSize;
    this.terrainMaterial.uniforms.uProbePatternColor.value.set(settings.scanTerrainPatternColor);
    this.terrainMaterial.uniforms.uProbePatternBrightness.value = settings.scanTerrainPatternBrightness;
    this.probeAfterglowDuration = settings.scanTerrainPatternPersistence;
    this.terrainMaterial.uniforms.uProbeAfterglowDuration.value = settings.scanTerrainPatternPersistence;
    this.terrainMaterial.uniforms.uProbeFrontWidth.value = settings.scanTerrainFrontWidth;
    this.terrainMaterial.uniforms.uProbeFrontColor.value.set(settings.scanTerrainFrontColor);
    this.terrainMaterial.uniforms.uProbeFrontBrightness.value = settings.scanTerrainFrontBrightness;
    this.probeTrailLength = settings.scanTerrainTrailLength;
    this.terrainMaterial.uniforms.uProbeTrailColor.value.set(settings.scanTerrainTrailColor);
    this.terrainMaterial.uniforms.uProbeTrailLength.value = settings.scanTerrainTrailLength;
    this.terrainMaterial.uniforms.uProbeTrailFalloff.value = settings.scanTerrainTrailFalloff;
    this.pulseTerrainTintWidth = settings.pulseTerrainTintWidth;
    this.terrainMaterial.uniforms.uPulseScarStrength.value = settings.pulseTerrainTintStrength;
    this.syncPulseScarUniforms();
  }

  get activeCount(): number {
    return this.active.size;
  }

  get chunkCount(): number {
    return this.chunks.length;
  }

  get currentProbeRadius(): number {
    return this.probeRadius;
  }

  get isProbeActive(): boolean {
    return this.probeActive;
  }

  get isProbeExpanding(): boolean {
    return this.probeExpanding;
  }

  /** Authoritative world-space center. Treat the returned vector as read-only. */
  get currentProbeWorldCenter(): Vector3 {
    return this.probeWorldCenter;
  }

  get generationStats(): Readonly<{
    queued: number;
    inFlight: number;
    ready: number;
    staleResults: number;
    coalescedRequests: number;
    carveEvents: number;
    carveIndexReferences: number;
    carveMasks: number;
    pulseScars: number;
  }> {
    return {
      queued: this.generationQueue.length,
      inFlight: this.inFlight.size,
      ready: this.completedResults.length,
      staleResults: this.staleResultCount,
      coalescedRequests: this.coalescedRequestCount,
      carveEvents: this.terrain.carveEventCount,
      carveIndexReferences: this.terrain.carveIndexReferenceCount,
      carveMasks: this.pendingCarveMasks.length,
      pulseScars: this.pulseTerrainScars.length,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.workers) slot.worker.terminate();
    this.workers.length = 0;
    this.generationQueue.length = 0;
    this.queuedByKey.clear();
    this.inFlight.clear();
    this.inFlightByKey.clear();
    this.requiredRevisionByKey.clear();
    this.baseDensityByKey.clear();
    this.baseMaximumByKey.clear();
    this.completedResults.length = 0;
    this.pendingCarveMasks.length = 0;
    this.pulseTerrainScars.length = 0;
    this.deferredResults.length = 0;
    for (const chunk of this.chunks) chunk.dispose();
    this.dotMaterial.dispose();
    this.meshMaterial.dispose();
    this.group.removeFromParent();
  }
}

function chunkKey(chunk: VolumeChunkCoordinate): string {
  return `${chunk.x},${chunk.y},${chunk.z}`;
}

function maximumChunkVertexBytes(): number {
  const cells = TERRAIN.segments ** 3;
  const maximumVertices = cells * 6 * 2 * 3;
  return maximumVertices * 3 * Float32Array.BYTES_PER_ELEMENT;
}
