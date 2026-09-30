/** Reproducible CPU-only comparison; does not measure GPU or browser frame time.
 * Run: node --experimental-strip-types tests/bullet-profile.ts
 */
import { PerspectiveCamera, Quaternion, Vector3 } from "three";
import { performance } from "node:perf_hooks";
import { ProceduralTerrain } from "../src/world/TerrainModel.ts";
import { RockLibrary } from "../src/combat/geometry.ts";
import { MeteorSystem } from "../src/combat/MeteorSystem.ts";
import { ImpactSystem } from "../src/combat/ImpactSystem.ts";
import { MissileSystem } from "../src/combat/MissileSystem.ts";
import { BulletSystem } from "../src/combat/BulletSystem.ts";
import { BulletView } from "../src/combat/BulletView.ts";
import { DEFAULT_COMBAT } from "../src/combat/settings.ts";
const summary = (values: number[]) => {
  values.sort((a, b) => a - b);
  return {
    median: values[Math.floor(values.length * 0.5)],
    p95: values[Math.floor(values.length * 0.95)],
    max: values.at(-1),
  };
};
const results = [];
for (const mode of ["disabled", "default", "maximum"]) {
  const seed = "bullet-profile",
    terrain = new ProceduralTerrain(seed),
    library = new RockLibrary(seed),
    meteors = new MeteorSystem(terrain, library, seed),
    impacts = new ImpactSystem(library, seed),
    missiles = new MissileSystem(meteors, seed),
    bullets = new BulletSystem(meteors, seed),
    view = new BulletView(bullets);
  meteors.onDestroyed = (rock, p, d) => impacts.spawn(rock, p, d);
  const settings = {
    ...DEFAULT_COMBAT,
    bulletEnabled: mode !== "disabled",
    ...(mode === "maximum"
      ? {
          bulletRate: 48,
          bulletRange: 1600,
          bulletSpeed: 1200,
          bulletTrailLife: 1,
          bulletTrailLength: 100,
        }
      : {}),
  };
  meteors.configure(settings);
  missiles.configure(settings);
  bullets.configure(settings);
  impacts.configure(settings);
  const ship = new Vector3(),
    origin = new Vector3(),
    q = new Quaternion(),
    camera = new PerspectiveCamera(65, 844 / 390, 0.1, 1700);
  const scan = {
    id: 0,
    center: new Vector3(),
    previousRadius: 0,
    radius: 0,
    expanding: false,
  };
  const total: number[] = [],
    weapon: number[] = [],
    visual: number[] = [];
  let maxBullets = 0;
  for (let frame = 0; frame < 1800; frame++) {
    let bulletTime = 0;
    const start = performance.now();
    for (let j = 0; j < 2; j++) {
      const time = (frame * 2 + j) / 120,
        z = time * 55,
        route = terrain.sample(z);
      ship.set(route.x, route.y, z);
      q.setFromUnitVectors(
        new Vector3(0, 0, 1),
        new Vector3(route.tangentX, route.tangentY, 1).normalize(),
      );
      if ((frame * 2 + j) % 600 === 0) {
        scan.id++;
        scan.center.copy(ship);
        scan.radius = 0;
        scan.expanding = true;
      }
      scan.previousRadius = scan.radius;
      scan.radius += 250 / 120;
      scan.expanding = scan.radius < 650;
      meteors.advance(1 / 120, ship, q);
      meteors.scan(scan);
      const resolver = bullets.resolver;
      resolver.begin();
      missiles.update(1 / 120, ship, q, resolver);
      const before = performance.now();
      bullets.update(1 / 120, true, ship, q, resolver);
      resolver.resolve();
      bulletTime += performance.now() - before;
      impacts.update(1 / 120, ship);
    }
    origin.copy(ship);
    camera.position.set(0, 8, -22);
    camera.lookAt(0, 0, 100);
    camera.updateMatrixWorld();
    const beforeView = performance.now();
    view.sync(origin, camera, q);
    const viewTime = performance.now() - beforeView;
    if (frame >= 120) {
      total.push(performance.now() - start);
      weapon.push(bulletTime);
      visual.push(viewTime);
    }
    maxBullets = Math.max(
      maxBullets,
      bullets.bullets.filter((b) => b.active).length,
    );
  }
  results.push({
    mode,
    frames: total.length,
    shots: bullets.shots,
    maxBullets,
    totalCpuMs: summary(total),
    bulletsAndSharedResolutionMs: summary(weapon),
    bulletVisualBuffersMs: summary(visual),
  });
  view.dispose();
  bullets.dispose();
  missiles.dispose();
  meteors.dispose();
  impacts.dispose();
  library.dispose();
}
console.log(
  JSON.stringify(
    {
      environment: process.version,
      metric:
        "CPU-only Node simulation and visual-buffer preparation; fixed identical route and seed; excludes browser, terrain rendering and GPU; first 120 frames warm up",
      results,
    },
    null,
    2,
  ),
);
