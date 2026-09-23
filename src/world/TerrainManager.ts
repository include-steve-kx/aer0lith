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
import {
  Float32MeshBuffer,
  polygonizeDensityChunk,
  type VolumeChunkCoordinate,
} from './VolumeMesher.ts';

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
  ): void {
    this.worldCX = worldCX;
    this.worldCY = worldCY;
    this.worldCZ = worldCZ;
    this.active = true;
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
}

function createTerrainMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uAircraftPosition: { value: new Vector3() },
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
      uProbeColor: { value: new Color(PROBE.color) },
      fogColor: { value: new Color(PALETTE.fog) },
      fogDensity: { value: 0.00165 },
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
      uniform vec3 uProbeColor;
      varying vec3 vTerrainWorldPosition;
      varying float vAlert;
      varying float vProbeInfluence;
      varying float vProbeCore;

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

      float probeRingMask() {
        float radialDistanceM = distance(vTerrainWorldPosition, uProbeCenter);
        float ringDistanceM = abs(radialDistanceM - uProbeRadius);
        float onePixelM = max(fwidth(radialDistanceM), 0.001);
        float visibleWidthM = max(onePixelM * 1.25, 0.018);
        return (1.0 - smoothstep(0.0, visibleWidthM, ringDistanceM))
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
        vec3 faceNormal = normalize(cross(dFdx(vTerrainWorldPosition), dFdy(vTerrainWorldPosition)));
        if (!gl_FrontFacing) faceNormal = -faceNormal;
        vec3 lightDirection = normalize(vec3(-0.42, 0.82, -0.38));
        float diffuse = abs(dot(faceNormal, lightDirection));
        float axialVariation = 1.0 - abs(faceNormal.y);
        float ringMask = probeRingMask();
        float afterglowMask = probeAfterglowMask();
        float probeMix = max(
          afterglowMask * 0.74,
          max(ringMask, max(vProbeCore, vProbeInfluence * 0.82))
        );

        vec3 meshColor = uMeshColor * (0.62 + diffuse * 0.76 + axialVariation * 0.16);
        // Keep the underlying terrain hue legible beneath the scan wash. The
        // narrow ring remains blue, while the revealed surface is a blend.
        float probeSurfaceMix = clamp(probeMix * 0.40, 0.0, 0.46);
        meshColor = mix(
          meshColor,
          uProbeColor * 1.04,
          probeSurfaceMix
        );
        float dangerMix = smoothstep(0.0, 0.92, vAlert);
        meshColor = mix(meshColor, uAlertColor, dangerMix);
        meshColor += uAlertColor * vAlert * 0.05;

        float dangerRadiusM = uDotRadiusM * mix(1.0, uDangerSizeMultiplier, vAlert);
        float dotMask = triplanarDot(faceNormal, dangerRadiusM);
        vec3 dotColor = mix(
          uDotColor,
          uProbeColor,
          clamp(probeMix * 0.56, 0.0, 0.62)
        );
        dotColor = mix(dotColor, uAlertColor, smoothstep(0.0, 0.92, vAlert));
        dotColor += uAlertColor * vAlert * 0.05;

        vec3 color;
        #ifdef TERRAIN_DOT_MODE
          // The normal dot view has no surface at all. A probe temporarily
          // reveals the other rendering mode—the shaded mesh—then ordered
          // coverage erodes it as the scan afterglow ages.
          float meshReveal = clamp(probeMix, 0.0, 1.0);
          float fragmentCoverage = max(dotMask, meshReveal);
          if (fragmentCoverage <= orderedCoverageThreshold()) discard;
          color = dotMask > 0.001 ? dotColor : meshColor;
          color = mix(color, uProbeColor * 1.08, ringMask);
        #else
          // The solid double-sided mesh uses the exact same masks and SDF,
          // but the probe reveals the other rendering mode's dots on top.
          float dotReveal = clamp(probeMix, 0.0, 1.0);
          color = mix(meshColor, dotColor, clamp(dotMask * dotReveal, 0.0, 1.0));
          color = mix(color, uProbeColor * 1.08, ringMask);
        #endif
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
}

interface ChunkGenerationResponse {
  requestId: number;
  chunk: VolumeChunkCoordinate;
  vertices: ArrayBuffer;
}

interface TerrainWorkerSlot {
  worker: Worker;
  busy: boolean;
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
  private readonly queuedKeys = new Set<string>();
  private readonly inFlight = new Map<number, string>();
  private readonly syncBuffer = new Float32MeshBuffer();
  private generationQueue: ChunkGenerationRequest[] = [];
  private desiredKeys = new Set<string>();
  private readonly currentRenderOrigin = new Vector3();
  private nextRequestId = 1;
  private readonly probeWorldCenter = new Vector3();
  private probeRadius = 0;
  private probeActive = false;
  private probeExpanding = false;
  private probeTailAge = 0;
  private lastCenterX = Number.NaN;
  private lastCenterY = Number.NaN;
  private lastCenterZ = Number.NaN;

  constructor(scene: Scene, terrain: ProceduralTerrain) {
    this.terrain = terrain;
    this.dotMaterial = createTerrainMaterial();
    this.meshMaterial = this.dotMaterial.clone();
    this.meshMaterial.defines = { TERRAIN_MESH_MODE: 1 };
    this.meshMaterial.uniforms = this.dotMaterial.uniforms;
    this.meshMaterial.needsUpdate = true;
    this.terrainMaterial = this.dotMaterial;

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
        slot.worker.onmessage = (event: MessageEvent<ChunkGenerationResponse>): void => {
          this.acceptWorkerResult(slot, event.data);
        };
        this.workers.push(slot);
      }
    }
  }

  update(worldPosition: Vector3, renderOrigin: Vector3): void {
    this.currentRenderOrigin.copy(renderOrigin);
    const centerX = Math.floor(worldPosition.x / TERRAIN.chunkSize);
    const centerY = Math.floor(worldPosition.y / TERRAIN.chunkSize);
    const centerZ = Math.floor(worldPosition.z / TERRAIN.chunkSize);
    if (
      centerX === this.lastCenterX
      && centerY === this.lastCenterY
      && centerZ === this.lastCenterZ
    ) return;
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
            key: `${chunk.x},${chunk.y},${chunk.z}`,
            chunk,
            // Populate the immediate flight envelope first, with a slight bias
            // toward terrain in front of the aircraft.
            priority: dx * dx + dy * dy * 1.35 + dz * dz * 0.72 - (dz > 0 ? 0.2 : 0),
          });
        }
      }
    }
    desired.sort((a, b) => a.priority - b.priority);
    this.desiredKeys = new Set(desired.map(({ key }) => key));
    this.generationQueue = this.generationQueue.filter(({ key }) => this.desiredKeys.has(key));
    this.queuedKeys.clear();
    for (const request of this.generationQueue) this.queuedKeys.add(request.key);

    for (const request of desired) {
      if (
        this.active.has(request.key)
        || this.queuedKeys.has(request.key)
        || [...this.inFlight.values()].includes(request.key)
      ) continue;
      this.generationQueue.push(request);
      this.queuedKeys.add(request.key);
    }

    if (this.workers.length === 0) this.generateSynchronously();
    else this.dispatchWorkers();
  }

  private generateSynchronously(): void {
    for (const request of this.generationQueue) {
      polygonizeDensityChunk(request.chunk, this.terrain, this.syncBuffer);
      const vertices = this.syncBuffer.data.slice(0, this.syncBuffer.length);
      this.installGeneratedChunk(request.key, request.chunk, vertices);
    }
    this.generationQueue = [];
    this.queuedKeys.clear();
    this.releaseRetiredChunks();
  }

  private dispatchWorkers(): void {
    for (const slot of this.workers) {
      if (slot.busy) continue;
      const request = this.generationQueue.shift();
      if (!request) break;
      this.queuedKeys.delete(request.key);
      const requestId = this.nextRequestId;
      this.nextRequestId += 1;
      slot.busy = true;
      this.inFlight.set(requestId, request.key);
      slot.worker.postMessage({
        requestId,
        seed: this.terrain.seedText,
        chunk: request.chunk,
      });
    }
  }

  private paused = false;
  private readonly deferredResults: Array<[TerrainWorkerSlot, ChunkGenerationResponse]> = [];

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) {
      for (const [slot, response] of this.deferredResults.splice(0)) this.acceptWorkerResult(slot, response);
    }
  }

  private acceptWorkerResult(slot: TerrainWorkerSlot, response: ChunkGenerationResponse): void {
    if (this.paused) {
      this.deferredResults.push([slot, response]);
      return;
    }
    slot.busy = false;
    const key = this.inFlight.get(response.requestId);
    this.inFlight.delete(response.requestId);
    if (key && this.desiredKeys.has(key) && !this.active.has(key)) {
      this.installGeneratedChunk(
        key,
        response.chunk,
        new Float32Array(response.vertices),
      );
    }
    this.releaseRetiredChunks();
    this.dispatchWorkers();
  }

  private installGeneratedChunk(
    key: string,
    coordinate: VolumeChunkCoordinate,
    vertices: Float32Array,
  ): void {
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
    );
    this.active.set(key, chunk);
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
      this.probeRadius += PROBE.speed * Math.max(0, dt);
      if (this.probeRadius >= PROBE.maxRadius) {
        this.probeRadius = PROBE.maxRadius;
        this.probeExpanding = false;
        this.probeTailAge = 0;
      }
    } else if (this.probeActive) {
      this.probeTailAge += Math.max(0, dt);
      if (this.probeTailAge >= PROBE.afterglowDuration) this.probeActive = false;
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
}
