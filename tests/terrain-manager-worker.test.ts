import assert from 'node:assert/strict';
import test from 'node:test';
import { Color, Scene, Vector3 } from 'three';
import { TerrainManager } from '../src/world/TerrainManager.ts';
import { ProceduralTerrain } from '../src/world/TerrainModel.ts';
import type { TerrainWorkerRequest, TerrainWorkerResponse } from '../src/world/TerrainWorkerProtocol.ts';
import { densityLatticeLength } from '../src/world/VolumeMesher.ts';
import type { VisualSettings } from '../src/ui/SettingsPanel.ts';

class WallTerrain extends ProceduralTerrain {
  override baseDensityAt(x: number): number { return x; }
}

class AirTerrain extends ProceduralTerrain {
  override baseDensityAt(): number { return -1; }
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<TerrainWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly requests: TerrainWorkerRequest[] = [];
  terminated = false;

  constructor() { FakeWorker.instances.push(this); }
  postMessage(request: TerrainWorkerRequest): void { this.requests.push(request); }
  respond(response: Partial<TerrainWorkerResponse> = {}): void {
    const request = this.requests.at(-1)!;
    const base = new Float32Array(densityLatticeLength()).fill(1);
    const baseCrystal = new Uint8Array(densityLatticeLength()).fill(128);
    const vertices = response.vertices ?? new ArrayBuffer(0);
    this.onmessage?.({ data: {
      requestId: request.requestId,
      chunk: request.chunk,
      revision: request.revision,
      vertices,
      crystal: new Uint8Array(vertices.byteLength / 12).buffer,
      baseDensity: base.buffer,
      baseCrystal: baseCrystal.buffer,
      baseMaximum: 1,
      ...response,
    } } as MessageEvent<TerrainWorkerResponse>);
  }
  terminate(): void { this.terminated = true; }
}

function withFakeWorkers<T>(run: () => T): T {
  const original = globalThis.Worker;
  FakeWorker.instances = [];
  Object.assign(globalThis, { Worker: FakeWorker });
  try { return run(); }
  finally {
    if (original) Object.assign(globalThis, { Worker: original });
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
}

test('stale worker results are rejected and replaced by the latest carve revision', () => {
  withFakeWorkers(() => {
    const terrain = new WallTerrain('worker-stale');
    const manager = new TerrainManager(new Scene(), terrain);
    manager.update(new Vector3(), new Vector3());
    const worker = FakeWorker.instances[0];
    const initial = worker.requests[0];
    assert.ok(initial);
    assert.deepEqual(initial.generationSettings, terrain.generationSettings);
    const center = new Vector3(
      (initial.chunk.x + 0.5) * 128,
      (initial.chunk.y + 0.5) * 128,
      (initial.chunk.z + 0.5) * 128,
    );
    assert.equal(manager.applyPulseCarve(center, center.clone().add(new Vector3(20, 0, 0)), 16).applied, true);
    worker.respond();
    assert.equal(manager.generationStats.staleResults, 1);
    const replacement = worker.requests.at(-1)!;
    assert.deepEqual(replacement.chunk, initial.chunk);
    assert.ok(replacement.revision > initial.revision);
    assert.equal(replacement.carves.length, 7);
    assert.equal(replacement.baseDensity?.length, densityLatticeLength());
    worker.respond();
    manager.update(new Vector3(), new Vector3());
    const active = (manager as unknown as { active: Map<string, { revision: number }> }).active;
    assert.equal(active.get(`${initial.chunk.x},${initial.chunk.y},${initial.chunk.z}`)?.revision, replacement.revision);
    manager.dispose();
  });
});

test('completed worker geometry is installed at most once per rendered update', () => {
  withFakeWorkers(() => {
    const manager = new TerrainManager(new Scene(), new WallTerrain('worker-budget'));
    manager.update(new Vector3(), new Vector3());
    const [first, second] = FakeWorker.instances;
    first.respond();
    second.respond();
    assert.equal(manager.activeCount, 0);
    assert.equal(manager.generationStats.ready, 2);
    manager.update(new Vector3(), new Vector3());
    assert.equal(manager.activeCount, 1);
    assert.equal(manager.generationStats.ready, 1);
    manager.update(new Vector3(), new Vector3());
    assert.equal(manager.activeCount, 2);
    manager.dispose();
  });
});

test('pause defers worker installation and resume drains only one result', () => {
  withFakeWorkers(() => {
    const manager = new TerrainManager(new Scene(), new WallTerrain('worker-pause'));
    manager.update(new Vector3(), new Vector3());
    manager.setPaused(true);
    FakeWorker.instances[0].respond();
    FakeWorker.instances[1].respond();
    assert.equal(manager.activeCount, 0);
    assert.equal(manager.generationStats.inFlight, 2);
    manager.setPaused(false);
    assert.equal(manager.activeCount, 1);
    manager.update(new Vector3(), new Vector3());
    assert.equal(manager.activeCount, 2);
    manager.dispose();
  });
});

test('malformed responses requeue the latest revision and failed workers fall back safely', () => {
  withFakeWorkers(() => {
    const manager = new TerrainManager(new Scene(), new WallTerrain('worker-errors'));
    manager.update(new Vector3(), new Vector3());
    const [first, second] = FakeWorker.instances;
    const before = first.requests.length;
    first.respond({ chunk: { x: 99, y: 99, z: 99 } });
    assert.ok(first.requests.length > before);
    first.onerror?.();
    assert.equal(first.terminated, true);
    second.onmessageerror?.();
    assert.equal(second.terminated, true);
    assert.equal(manager.generationStats.inFlight, 0);
    assert.ok(manager.activeCount <= 1, 'synchronous fallback is bounded to one generated chunk');
    manager.dispose();
  });
});

test('eight pending carve masks back-pressure a ninth shot, rebase, and retire after remesh', () => {
  const original = globalThis.Worker;
  Reflect.deleteProperty(globalThis, 'Worker');
  try {
    const manager = new TerrainManager(new Scene(), new WallTerrain('mask-pool'));
    manager.update(new Vector3(), new Vector3());
    const active = (manager as unknown as {
      active: Map<string, { worldCX: number; worldCY: number; worldCZ: number }>;
      dotMaterial: { uniforms: Record<string, { value: unknown }> };
    }).active.values().next().value!;
    const base = new Vector3(
      (active.worldCX + 0.5) * 128,
      (active.worldCY + 0.5) * 128,
      (active.worldCZ + 0.5) * 128,
    );
    for (let index = 0; index < 8; index += 1) {
      const start = base.clone().add(new Vector3(0, index * 0.5, -20));
      assert.equal(manager.applyPulseCarve(start, start.clone().add(new Vector3(0, 0, 40)), 16).applied, true);
    }
    assert.equal(manager.generationStats.carveMasks, 8);
    assert.equal(manager.canAcceptPulseCarve, false);
    assert.equal(manager.applyPulseCarve(base, base.clone().add(new Vector3(1, 0, 0)), 2).applied, false);
    manager.updateRenderOrigin(new Vector3(128, 0, 0));
    const uniforms = (manager as unknown as {
      dotMaterial: { uniforms: Record<string, { value: unknown }> };
    }).dotMaterial.uniforms;
    const starts = uniforms.uCarveStarts.value as Vector3[];
    assert.equal(starts[0].x, base.x - 128);
    manager.update(new Vector3(), new Vector3(128, 0, 0));
    manager.update(new Vector3(), new Vector3(128, 0, 0));
    assert.equal(manager.generationStats.carveMasks, 0);
    assert.equal(manager.canAcceptPulseCarve, true);
    manager.dispose();
  } finally {
    if (original) Object.assign(globalThis, { Worker: original });
  }
});

test('permanently-air active chunks advance revisions without carve generation', () => {
  const original = globalThis.Worker;
  Reflect.deleteProperty(globalThis, 'Worker');
  try {
    const terrain = new AirTerrain('air-reject');
    const manager = new TerrainManager(new Scene(), terrain);
    manager.update(new Vector3(), new Vector3());
    const internal = manager as unknown as {
      active: Map<string, { worldCX: number; worldCY: number; worldCZ: number; revision: number }>;
      generationQueue: Array<{ key: string; carve: boolean }>;
    };
    const [key, active] = internal.active.entries().next().value!;
    const center = new Vector3(
      (active.worldCX + 0.5) * 128,
      (active.worldCY + 0.5) * 128,
      (active.worldCZ + 0.5) * 128,
    );
    assert.equal(manager.applyPulseCarve(center, center.clone().add(new Vector3(20, 0, 0)), 16).applied, true);
    assert.equal(active.revision, terrain.carveRevisionForChunk({ x: active.worldCX, y: active.worldCY, z: active.worldCZ }));
    assert.equal(internal.generationQueue.some((request) => request.key === key && request.carve), false);
    manager.update(new Vector3(), new Vector3());
    assert.equal(manager.generationStats.carveMasks, 0);
    manager.dispose();
  } finally {
    if (original) Object.assign(globalThis, { Worker: original });
  }
});

test('Pulse beam and traveling electric lights reach both terrain render modes', () => {
  const manager = new TerrainManager(new Scene(), new AirTerrain('pulse-lights'));
  const beamPosition = new Vector3(10, 20, 30);
  const electricPosition = new Vector3(40, 50, 60);
  const beamColor = new Color('#9ffcff');
  const electricColor = new Color('#6fe9ff');
  manager.updatePulseLights(
    beamPosition, beamColor, 500, 300,
    electricPosition, electricColor, 900, 90,
  );
  const internal = manager as unknown as {
    dotMaterial: { uniforms: Record<string, { value: unknown }> };
    meshMaterial: { uniforms: Record<string, { value: unknown }> };
  };
  assert.equal(internal.dotMaterial.uniforms, internal.meshMaterial.uniforms);
  const uniforms = internal.dotMaterial.uniforms;
  assert.ok((uniforms.uPulseBeamPosition.value as Vector3).equals(beamPosition));
  assert.ok((uniforms.uPulseElectricPosition.value as Vector3).equals(electricPosition));
  assert.equal(uniforms.uPulseBeamPower.value, 500);
  assert.equal(uniforms.uPulseBeamRange.value, 300);
  assert.equal(uniforms.uPulseElectricPower.value, 900);
  assert.equal(uniforms.uPulseElectricRange.value, 90);
  manager.dispose();
});

test('terrain scan uses a configurable sparse plus pattern and independent front stripe', () => {
  const manager = new TerrainManager(new Scene(), new AirTerrain('probe-pattern'));
  manager.applyVisualSettings({
    terrainRenderingMode: 'mesh',
    dangerDistance: 96,
    dangerSizeMultiplier: 3,
    dangerSizeFalloff: 1.2,
    terrainDotRadiusM: 0.14,
    terrainDotDensityPer100M2: 4,
    terrainColor: '#c8c8c8',
    terrainCrystalAmount: 0.27,
    terrainCrystalOpacity: 0.61,
    terrainCrystalRefraction: 1.35,
    terrainCrystalDispersion: 0.24,
    terrainCrystalColor: '#8fefff',
    meshColor: '#363d3e',
    dangerColor: '#ff0000',
    scanTerrainDistance: 300,
    scanTerrainSpeed: 260,
    scanTerrainPattern: 'plus',
    scanTerrainPatternSpacing: 14,
    scanTerrainPatternSize: 2.2,
    scanTerrainPatternColor: '#22ccff',
    scanTerrainPatternBrightness: 1.75,
    scanTerrainPatternPersistence: 6,
    scanTerrainFrontWidth: 8,
    scanTerrainFrontColor: '#44aaff',
    scanTerrainFrontBrightness: 2.25,
    scanTerrainTrailColor: '#337799',
    scanTerrainTrailLength: 180,
    scanTerrainTrailFalloff: 3.5,
    pulseTerrainTintWidth: 18,
    pulseTerrainTintStrength: 0.55,
  } as VisualSettings);
  const internal = manager as unknown as {
    dotMaterial: { uniforms: Record<string, { value: unknown }>; fragmentShader: string };
  };
  const { uniforms, fragmentShader } = internal.dotMaterial;
  assert.equal(uniforms.uProbeSpeed.value, 260);
  assert.equal(uniforms.uProbePatternType.value, 1);
  assert.equal(uniforms.uProbePatternSpacing.value, 14);
  assert.equal(uniforms.uProbePatternSize.value, 2.2);
  assert.equal((uniforms.uProbePatternColor.value as Color).getHexString(), '22ccff');
  assert.equal(uniforms.uProbePatternBrightness.value, 1.75);
  assert.equal(uniforms.uProbeAfterglowDuration.value, 6);
  assert.equal(uniforms.uProbeFrontWidth.value, 8);
  assert.equal(uniforms.uProbeLineWidth.value, 1.6,
    'stripe width does not change the narrow vertex displacement core');
  assert.equal((uniforms.uProbeFrontColor.value as Color).getHexString(), '44aaff');
  assert.equal(uniforms.uProbeFrontBrightness.value, 2.25);
  assert.equal((uniforms.uProbeTrailColor.value as Color).getHexString(), '337799');
  assert.equal(uniforms.uProbeTrailLength.value, 180);
  assert.equal(uniforms.uProbeTrailFalloff.value, 3.5);
  assert.equal(uniforms.uCrystalAmount.value, 0.27);
  assert.equal(uniforms.uCrystalOpacity.value, 0.61);
  assert.equal(uniforms.uCrystalRefraction.value, 1.35);
  assert.equal(uniforms.uCrystalDispersion.value, 0.24);
  assert.equal((uniforms.uCrystalColor.value as Color).getHexString(), '8fefff');
  assert.match(fragmentShader, /float scanPattern2d\(vec2 coordinate\)/);
  assert.match(fragmentShader, /float plusDistanceM = min/);
  assert.match(fragmentShader, /float patternMask = triplanarScanPattern\(faceNormal\) \* afterglowMask/);
  assert.match(fragmentShader, /float probeTrailMask\(\)/);
  assert.match(fragmentShader, /color = mix\(color, trailColor, trailMask\)/);
  assert.doesNotMatch(fragmentShader, /probeSurfaceMix|meshReveal|dotReveal/,
    'the bounded trail does not restore the old whole-volume reveal');

  manager.triggerProbe(new Vector3());
  manager.updateProbe(0.5, new Vector3());
  assert.equal(manager.currentProbeRadius, 130, 'configured scan speed drives propagation');
  manager.updateProbe(10, new Vector3());
  assert.equal(manager.currentProbeRadius, 300, 'configured scan distance caps the one-direction radius');
  manager.updateProbe(4, new Vector3());
  assert.equal(manager.isProbeActive, true, 'configured marker persistence outlives the former fixed duration');
  manager.updateProbe(2.1, new Vector3());
  assert.equal(manager.isProbeActive, false);
  manager.dispose();
});

test('Pulse terrain remnants use beam colors, rebase, and recycle at eight shots', () => {
  const original = globalThis.Worker;
  Reflect.deleteProperty(globalThis, 'Worker');
  try {
    const manager = new TerrainManager(new Scene(), new AirTerrain('pulse-remnants'));
    manager.update(new Vector3(), new Vector3());
    for (let index = 0; index < 9; index += 1) {
      const start = new Vector3(index * 10, index * 10, 0);
      assert.equal(
        manager.applyPulseCarve(start, start.clone().add(new Vector3(0, 0, 20)), 2, index === 8 ? '#ff3300' : '#9ffcff').applied,
        true,
      );
      manager.update(new Vector3(), new Vector3());
    }
    assert.equal(manager.generationStats.pulseScars, 8);
    manager.updateRenderOrigin(new Vector3(128, 0, 0));
    const internal = manager as unknown as {
      dotMaterial: { uniforms: Record<string, { value: unknown }>; fragmentShader: string };
    };
    const uniforms = internal.dotMaterial.uniforms;
    const starts = uniforms.uPulseScarStarts.value as Vector3[];
    const colors = uniforms.uPulseScarColors.value as Color[];
    const outer = uniforms.uPulseScarOuterRadiusSquared.value as Float32Array;
    assert.equal(uniforms.uPulseScarCount.value, 8);
    assert.ok(starts[0].equals(new Vector3(-118, 10, 0)), 'oldest remnant is recycled first');
    assert.equal(colors[7].getHexString(), 'ff3300');
    assert.equal(outer[7], 20 * 20, 'default 18 m falloff surrounds a 2 m carve');
    assert.match(internal.dotMaterial.fragmentShader, /mix\(0\.18, 1\.0/,
      'the far beam cap has greater terrain influence than the muzzle end');
    manager.update(new Vector3(10_000, 0, 10_000), new Vector3(128, 0, 0));
    assert.equal(manager.generationStats.pulseScars, 0,
      'remnants outside the desired streaming envelope stop costing shader work');
    manager.dispose();
  } finally {
    if (original) Object.assign(globalThis, { Worker: original });
  }
});
