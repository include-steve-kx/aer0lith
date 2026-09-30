// Development-only, deterministic visual/stress fixture. Never imported by the application.
import '../../src/styles.css';
import '@fontsource/share-tech-mono/400.css';
import { Vector3, BoxGeometry, MeshBasicMaterial, Mesh } from 'three';
import { App } from '../../src/App.ts';
import { DEFAULT_COMBAT } from '../../src/combat/settings.ts';
const markup = await (await fetch('/index.html')).text();
const template = new DOMParser().parseFromString(markup, 'text/html');
for (const script of template.querySelectorAll('script')) script.remove();
document.body.innerHTML = template.body.innerHTML;
const app = new App(document.querySelector('#app'), 'combat-validation');
const occluder = new Mesh(
  new BoxGeometry(38, 60, 2),
  new MeshBasicMaterial({ color: '#344148' }),
);
occluder.position.set(0, 12, 60);
occluder.visible = false;
app.scene.add(occluder);
const panel = document.createElement('div');
panel.style.cssText =
  'position:fixed;left:15px;bottom:15px;z-index:200;background:#13191e;color:#eef;font:12px monospace;padding:8px;max-width:60vw';
const status = document.createElement('pre');
status.style.margin = '5px 0';
panel.append(status);
document.body.append(panel);
let completed = false;
let markerQueryCount = 0,
  measuringMarkers = false,
  markerTimes = [];
let soak = false,
  started = 0,
  lastBurst = 0,
  lastCycle = -1,
  lastReport = 0,
  frames = 0,
  peakDraws = 0,
  baseline = [];
let combatCpu = [],
  baseCpu = [],
  durations = [],
  samples = [],
  lastFrame = performance.now();
const origin = new Vector3(),
  point = new Vector3(),
  direction = new Vector3();
const counts = () => ({
  meteors: app.meteors.activeCount,
  missiles: app.missiles.missiles.filter((m) => m.active).length,
  trails: app.missiles.trails.filter((t) => t.active).length,
  fragments: app.impacts.fragments.filter((f) => f.active).length,
  explosions: app.impacts.explosions.filter((e) => e.active).length,
  shakes: app.impacts.shakes.filter((s) => s.active).length,
});
function configure(extra = {}) {
  const settings = { ...DEFAULT_COMBAT, ...extra };
  app.meteors.configure(settings);
  app.missiles.configure(settings);
  app.impacts.configure(settings);
  app.combatView.configure(settings);
}
function button(label, action) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText =
    'color:white;background:#253441;border:1px solid #607480;margin-right:6px;padding:4px';
  b.onclick = action;
  panel.prepend(b);
}
function encounter() {
  occluder.visible = false;
  app.resetCombat();
  app.paused = true;
  app.flight.position.set(0, 0, 0);
  app.flight.yaw = 0;
  app.flight.pitch = 0;
  app.flight.roll = 0;
  app.flight.orientation.identity();
  app.flight.cameraOrientation.identity();
  app.renderOrigin.set(0, 0, 0);
  app.cameraRig.select(1);
  app.cameraRig.camera.position.set(0, 12, -50);
  app.cameraRig.camera.lookAt(0, 3, 70);
  configure({ meteorSpeed: 0, meteorSpin: 0, missileEnabled: false });
  for (let i = 0; i < 6; i++) {
    const rock = app.meteors.spawnAt(
      new Vector3(
        ((i % 3) - 1) * 24,
        8 + Math.floor(i / 3) * 18,
        75 + Math.floor(i / 3) * 70,
      ),
      14 + i * 2,
      16 + i,
    );
    rock.detected = 8;
  }
  app.syncViews();
}
function impactFrame() {
  encounter();
  const rock = app.meteors.rocks[1];
  app.impacts.spawn(rock, rock.position, direction.set(0, 0, 1));
  rock.active = false;
  app.impacts.update(0.32, app.flight.position);
}
button('Cockpit ammo', () => {
  status.hidden = true;
  soak = false;
  encounter();
  app.meteors.reset();
  configure({ missileEnabled: true });
  app.missiles.reset();
  app.missiles.ammunition.set([1, 2, 3, 0]);
  app.missiles.reload.set([0.2, 0.5, 0, 0.7]);
  app.cameraRig.select(0);
});
button('Occluded marker', () => {
  soak = false;
  encounter();
  occluder.visible = true;
});
button('Encounter', () => {
  soak = false;
  encounter();
});
button('Fracture', () => {
  soak = false;
  impactFrame();
});
button('Debug glass', () =>
  app.combatView.configure({
    ...app.combatView.settings,
    explosionDebug: !app.combatView.settings.explosionDebug,
  }),
);
button('Start 5-minute soak', () => {
  app.paused = false;
  app.resetFlight();
  configure({
    meteorCount: 12,
    meteorInterval: 4,
    missileReload: 0.5,
    missileCapacity: 8,
    missileTrailLife: 6,
    fragmentCount: 12,
    fragmentLife: 5,
    explosionLife: 2,
  });
  started = performance.now();
  lastFrame = started;
  soak = true;
  completed = false;
  markerQueryCount = 0;
  markerTimes = [];
  lastBurst = 0;
  lastCycle = -1;
  samples = [];
  durations = [];
  combatCpu = [];
  baseCpu = [];
  frames = 0;
  peakDraws = 0;
});
// Measure only new simulation work, keeping renderer timing separate.
for (const [owner, method] of [
  [app.meteors, 'advance'],
  [app.meteors, 'scan'],
  [app.meteors, 'sweepShip'],
  [app.meteors, 'avoidance'],
  [app.missiles, 'update'],
  [app.impacts, 'update'],
]) {
  const original = owner[method].bind(owner);
  owner[method] = (...args) => {
    const before = performance.now();
    const result = original(...args);
    if (soak) combatCpu.push(performance.now() - before);
    return result;
  };
}
const originalRender = app.post.render.bind(app.post);
let frameDraws = 0;
app.renderer.info.autoReset = false;
app.post.render = (...args) => {
  app.renderer.info.reset();
  originalRender(...args);
  frameDraws = app.renderer.info.render.calls;
};
for (const method of ['densityAt', 'collisionDensityAt']) {
  const original = app.terrainModel[method].bind(app.terrainModel);
  app.terrainModel[method] = (...args) => {
    if (measuringMarkers) markerQueryCount++;
    return original(...args);
  };
}
const originalHud = app.combatHud.update.bind(app.combatHud);
app.combatHud.update = (...args) => {
  const before = performance.now();
  measuringMarkers = true;
  try {
    return originalHud(...args);
  } finally {
    measuringMarkers = false;
    if (soak) markerTimes.push(performance.now() - before);
  }
};
function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = completed ? 300 : soak ? (now - started) / 1000 : 0;
  if (soak) {
    frames++;
    durations.push(now - lastFrame);
    lastFrame = now;
    peakDraws = Math.max(peakDraws, frameDraws);
    // Alternate enabled/default and disabled identical poses for the first 30s; then saturate cosmetics.
    if (elapsed - lastBurst > 0.4) {
      lastBurst = elapsed;
      const p = app.flight.position,
        q = app.flight.orientation;
      for (let i = 0; i < 8; i++) {
        point
          .set(((i % 4) - 1.5) * 22, (i % 2 ? 1 : -1) * 22, 150 + (i % 3) * 35)
          .applyQuaternion(q)
          .add(p);
        const rock = app.meteors.spawnAt(point, 12 + (i % 3) * 6, 16 + i);
        if (rock) {
          rock.detected = 8;
          if (i < 6) {
            app.impacts.spawn(
              rock,
              rock.position,
              direction.set(0, 0, 1).applyQuaternion(q),
            );
            rock.active = false;
          }
        }
      }
      app.triggerProbe();
    }
    const cycle = Math.floor(elapsed / 30);
    if (cycle !== lastCycle) {
      lastCycle = cycle;
      if (cycle > 0) {
        app.resetCombat();
        app.cameraRig.select(cycle % 3);
        app.combatView.configure({
          ...app.combatView.settings,
          explosionDebug: cycle % 4 === 1,
        });
        if (cycle % 3 === 0) {
          app.flight.position.z += 3500;
          const path = app.terrainModel.sample(app.flight.position.z);
          app.flight.position.x = path.x;
          app.flight.position.y = path.y;
          app.maybeRebase();
        }
        if (cycle % 5 === 0) {
          app.missiles.clearFlights();
          app.impacts.reset();
        }
      }
    }
    if (elapsed >= 300) {
      completed = true;
      soak = false;
      app.paused = true;
    }
  }
  if (now - lastReport > 1000) {
    lastReport = now;
    const sorted = durations.slice(-600).sort((a, b) => a - b),
      cpu = combatCpu.splice(0),
      memory = { ...app.renderer.info.memory };
    const report = {
      elapsed: Math.round(elapsed),
      completed,
      markerTerrainQueries: markerQueryCount,
      markerP95Ms: markerTimes.length
        ? +markerTimes
            .slice()
            .sort((a, b) => a - b)
            [Math.floor(markerTimes.length * 0.95)].toFixed(3)
        : null,
      frames,
      pools: counts(),
      draws: frameDraws,
      peakDraws,
      gpu: memory,
      programs: app.renderer.info.programs?.length,
      heapMB: performance.memory
        ? Math.round(performance.memory.usedJSHeapSize / 1048576)
        : null,
      p95FrameMs: sorted.length
        ? +sorted[Math.floor(sorted.length * 0.95)].toFixed(2)
        : null,
      medianFrameMs: sorted.length
        ? +sorted[Math.floor(sorted.length / 2)].toFixed(2)
        : null,
      simulationCalls: cpu.length,
      simulationTotalMs: +cpu.reduce((a, b) => a + b, 0).toFixed(2),
      launches: app.missiles.launches,
    };
    if (soak || (completed && frames > 0)) samples.push(report);
    status.textContent =
      JSON.stringify(report, null, 2) +
      (soak
        ? '\nSOAK RUNNING'
        : completed
          ? '\nFIVE-MINUTE CHECK COMPLETE'
          : '\nREADY / PAUSED');
    if (!soak && frames > 0) {
      const result = document.createElement('details');
      result.innerHTML = '<summary>Soak results</summary>';
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(samples);
      result.append(pre);
      panel.append(result);
      frames = 0;
    }
  }
}
encounter();
app.start();
requestAnimationFrame(frame);
