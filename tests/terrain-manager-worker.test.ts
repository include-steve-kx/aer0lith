import assert from 'node:assert/strict';
import test from 'node:test';
import { Scene, Vector3 } from 'three';
import { TerrainManager } from '../src/world/TerrainManager.ts';
import { ProceduralTerrain } from '../src/world/TerrainModel.ts';
import type { TerrainWorkerRequest, TerrainWorkerResponse } from '../src/world/TerrainWorkerProtocol.ts';
import { densityLatticeLength } from '../src/world/VolumeMesher.ts';

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
    this.onmessage?.({ data: {
      requestId: request.requestId,
      chunk: request.chunk,
      revision: request.revision,
      vertices: new ArrayBuffer(0),
      baseDensity: base.buffer,
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
