// Development-only integration fixture. Uses the actual App, controls and render pipeline.
import "../../src/styles.css";
import "@fontsource/share-tech-mono/400.css";
import {
  Vector3,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
} from "three";
import { App } from "../../src/App.ts";
import { DEFAULT_COMBAT } from "../../src/combat/settings.ts";
import { BulletAim } from "../../src/combat/BulletSystem.ts";
import { CombatRandom } from "../../src/combat/random.ts";
const markup = new DOMParser().parseFromString(
  await (await fetch("/index.html")).text(),
  "text/html",
);
for (const script of markup.querySelectorAll("script")) script.remove();
document.body.innerHTML = markup.body.innerHTML;
const app = new App(document.querySelector("#app"), "bullet-validation");
const panel = document.createElement("section");
panel.style.cssText =
  "position:fixed;z-index:300;left:12px;top:100px;max-width:460px;padding:8px;background:#101820dd;color:#fff;font:11px monospace;pointer-events:auto";
const status = document.createElement("pre");
status.id = "bullet-validation-status";
panel.append(status);
document.body.append(panel);
const errors = [];
window.addEventListener("error", (e) => errors.push(e.message));
const originalError = console.error;
console.error = (...args) => {
  errors.push(args.map(String).join(" "));
  originalError(...args);
};
let running = false,
  automatic = false,
  start = 0,
  last = performance.now(),
  elapsed = 0,
  cycle = -1,
  frames = 0,
  steps = 0,
  destructions = 0,
  damageHits = 0,
  shots = 0,
  lastShots = 0,
  metrics = {},
  rows = [],
  snapshots = [],
  peak = {},
  lastReport = 0;
const timers = [
  "bulletUpdate",
  "resolver",
  "meteorSweep",
  "terrainDensity",
  "bulletView",
  "impacts",
  "flight",
];
const accumulated = Object.fromEntries(timers.map((k) => [k, 0]));
function wrap(owner, method, name) {
  const original = owner[method].bind(owner);
  owner[method] = (...args) => {
    const t = performance.now();
    try {
      return original(...args);
    } finally {
      if (running) accumulated[name] += performance.now() - t;
    }
  };
}
wrap(app.bullets, "update", "bulletUpdate");
wrap(app.bullets.resolver, "resolve", "resolver");
wrap(app.meteors, "sweepProjectile", "meteorSweep");
wrap(app.terrainModel, "collisionDensityAt", "terrainDensity");
wrap(app.bulletView, "sync", "bulletView");
wrap(app.impacts, "update", "impacts");
wrap(app.flight, "update", "flight");
const originalHit = app.meteors.applyHit.bind(app.meteors);
app.meteors.applyHit = (...args) => {
  const result = originalHit(...args);
  if (result === "destroyed") destructions++;
  if (result === "damaged") damageHits++;
  return result;
};
const originalBulletUpdate = app.bullets.update.bind(app.bullets);
app.bullets.update = (...args) => {
  if (running) steps++;
  return originalBulletUpdate(...args);
};
function configure(extra = {}) {
  const s = { ...DEFAULT_COMBAT, ...extra };
  app.meteors.configure(s);
  app.missiles.configure(s);
  app.bullets.configure(s);
  app.impacts.configure(s);
  app.combatView.configure(s);
}
function button(label, fn) {
  const b = document.createElement("button");
  b.textContent = label;
  b.style.cssText =
    "font:11px monospace;padding:6px;margin:2px;color:white;background:#26333d;border:1px solid #789";
  b.onclick = fn;
  panel.insertBefore(b, status);
}
const p = new Vector3(),
  dir = new Vector3();
function spawnTargets() {
  dir.set(0, 0, 1).applyQuaternion(app.flight.orientation);
  for (let i = 0; i < 8; i++) {
    p.copy(app.flight.position).addScaledVector(dir, 65 + (i % 4) * 38);
    p.x += (i < 4 ? -1 : 1) * (8 + (i % 2) * 8);
    app.meteors.spawnAt(p, 14 + (i % 3) * 5, i);
  }
  app.triggerProbe();
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    max: sorted.at(-1) ?? 0,
  };
}
function counts() {
  return {
    bullets: app.bullets.bullets.filter((b) => b.active).length,
    trails: app.bullets.trails.filter((t) => t.active).length,
    meteors: app.meteors.activeCount,
    missiles: app.missiles.missiles.filter((m) => m.active).length,
    fragments: app.impacts.fragments.filter((f) => f.active).length,
    explosions: app.impacts.explosions.filter((e) => e.active).length,
    shakes: app.impacts.shakes.filter((s) => s.active).length,
  };
}
button("Start 5-minute soak", () => {
  app.resetCombat();
  configure({
    bulletRate: 48,
    bulletSpeed: 1200,
    bulletRange: 1600,
    bulletTrailLife: 1,
    bulletTrailLength: 100,
    meteorCount: 12,
    meteorInterval: 4,
  });
  running = automatic = true;
  app.paused = false;
  start = last = performance.now();
  elapsed = 0;
  cycle = -1;
  frames = steps = destructions = damageHits = shots = 0;
  lastShots = app.bullets.shots;
  metrics = Object.fromEntries(timers.map((k) => [k, []]));
  rows = [];
  snapshots = [];
  peak = {};
  lastReport = 0;
});
button("Auto fire / targets", () => {
  automatic = !automatic;
  if (!automatic) app.input.clearFire();
  else spawnTargets();
});
button("Pause snapshot", () => {
  app.togglePause();
  automatic = false;
});
button("Cockpit", () => app.setCamera(app.cameraRig.select(0)));
button("Chase", () => app.setCamera(app.cameraRig.select(1)));
button("Far chase", () => app.setCamera(app.cameraRig.select(2)));
button("Frozen firing", () => {
  automatic = false;
  app.paused = true;
  app.bullets.reset();
  app.bullets.setCamera(
    app.cameraRig.camera,
    app.renderOrigin,
    app.flight.position,
  );
  for (let i = 0; i < 9; i++)
    app.bullets.update(
      1 / 120,
      true,
      app.flight.position,
      app.flight.orientation,
    );
  status.textContent = `Frozen shots: ${app.bullets.bullets.filter((b) => b.active).length}. Muzzle debug can toggle while paused.`;
});
button("Muzzle glass debug", () =>
  app.bullets.configure({
    ...app.bullets.settings,
    muzzleDebug: !app.bullets.settings.muzzleDebug,
  }),
);
const spreadGeometry = new BufferGeometry();
spreadGeometry.setAttribute(
  "position",
  new Float32BufferAttribute(new Float32Array(600 * 3), 3),
);
const spreadDots = new Points(
  spreadGeometry,
  new PointsMaterial({ color: "#ffdd77", size: 0.2 }),
);
spreadDots.visible = false;
app.scene.add(spreadDots);
button("Spread target plane", () => {
  const aim = new BulletAim(),
    rng = new CombatRandom("visual-spread"),
    a = spreadGeometry.getAttribute("position");
  aim.update(
    app.flight.position,
    app.flight.orientation,
    new Vector3(),
    dir.set(0, 0, 1).applyQuaternion(app.flight.orientation),
    100,
    20,
  );
  for (let i = 0; i < 600; i++) {
    aim.sample(
      app.flight.position,
      100,
      i < 200 ? 0 : i < 400 ? 0.35 : 2,
      20,
      rng,
      p,
    );
    p.sub(app.renderOrigin);
    a.setXYZ(i, p.x, p.y, p.z);
  }
  a.needsUpdate = true;
  spreadGeometry.computeBoundingSphere();
  spreadDots.visible = !spreadDots.visible;
});
button("Run input checks", () => {
  const root = document.querySelector("#app"),
    fire = document.querySelector("#fire-button"),
    checks = [];
  const key = (target, code, type = "keydown", repeat = false) =>
    target.dispatchEvent(
      new KeyboardEvent(type, {
        code,
        bubbles: true,
        cancelable: true,
        repeat,
      }),
    );
  root.focus();
  key(root, "Space");
  checks.push(["space fires", app.input.firing]);
  key(root, "Space", "keyup");
  checks.push(["release stops", !app.input.firing]);
  document.querySelector("#settings-button").focus();
  key(document.activeElement, "Space");
  checks.push(["focused button does not fire", !app.input.firing]);
  root.focus();
  key(root, "Space");
  app.input.clearFire();
  key(root, "Space", "keydown", true);
  checks.push(["repeat after clear cannot fire", !app.input.firing]);
  key(root, "Space", "keyup");
  fire.focus();
  key(fire, "Enter");
  checks.push(["fire button keyboard", app.input.firing]);
  key(fire, "Enter", "keyup");
  checks.push([
    "mobile target >=44",
    fire.getBoundingClientRect().width >= 44 &&
      fire.getBoundingClientRect().height >= 44,
  ]);
  status.textContent = JSON.stringify(checks, null, 2);
  automatic = false;
  root.focus();
});
function frame(now) {
  const delta = now - last;
  last = now;
  if (automatic && !app.paused) app.input.fireKeyboard = true;
  if (running) {
    elapsed = (now - start) / 1000;
    frames++;
    rows.push(delta);
    for (const name of timers) {
      metrics[name].push(accumulated[name]);
      accumulated[name] = 0;
    }
    shots += Math.max(0, app.bullets.shots - lastShots);
    lastShots = app.bullets.shots;
    const c = counts();
    for (const [name, value] of Object.entries(c))
      peak[name] = Math.max(peak[name] ?? 0, value);
    const nextCycle = Math.floor(elapsed / 5);
    if (nextCycle !== cycle) {
      cycle = nextCycle;
      spawnTargets();
      if (cycle % 6 === 1)
        app.bullets.configure({ ...app.bullets.settings, muzzleDebug: true });
      if (cycle % 6 === 2)
        app.bullets.configure({ ...app.bullets.settings, muzzleDebug: false });
      if (cycle % 6 === 3) app.setCamera(app.cameraRig.select(cycle % 3));
      if (cycle % 12 === 5) app.flight.startRoll(cycle % 2 ? 1 : -1);
      if (cycle % 12 === 7) {
        app.resetCombat();
        app.renderOrigin.copy(app.flight.position);
        app.syncViews();
      }
      if (cycle % 12 === 9) {
        app.paused = true;
        app.input.clearFire();
      } else if (app.paused) app.paused = false;
    }
    if (elapsed - lastReport >= 5) {
      lastReport = elapsed;
      snapshots.push({
        seconds: elapsed,
        geometry: app.renderer.info.memory.geometries,
        textures: app.renderer.info.memory.textures,
        programs: app.renderer.info.programs.length,
        heap: performance.memory?.usedJSHeapSize ?? null,
      });
      status.textContent = JSON.stringify(
        {
          seconds: Math.floor(elapsed),
          shots,
          destructions,
          damageHits,
          peak,
          errors: errors.slice(-2),
          frame: summary(rows.slice(-600)),
        },
        null,
        2,
      );
    }
    if (elapsed >= 300) {
      running = automatic = false;
      app.input.clearFire();
      app.paused = true;
      const result = {
        durationSeconds: elapsed,
        viewport: [innerWidth, innerHeight],
        pixelRatio: devicePixelRatio,
        frames,
        simulationSteps: steps,
        shots,
        destructions,
        damageHits,
        peak,
        frameMs: summary(rows),
        cpuMs: Object.fromEntries(timers.map((k) => [k, summary(metrics[k])])),
        resources: snapshots,
        errors,
      };
      status.textContent = JSON.stringify(result, null, 2);
      status.style.maxHeight = "65vh";
      status.style.overflow = "auto";
      status.dataset.complete = "true";
    }
  }
  requestAnimationFrame(frame);
}
configure();
status.textContent =
  "Ready. Space or FIRE shoots. Fixture auto-fire exercises production simulation.";
requestAnimationFrame(frame);
app.start();
