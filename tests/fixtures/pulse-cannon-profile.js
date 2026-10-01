import '../../src/styles.css';
import '@fontsource/share-tech-mono/400.css';
import { Vector3 } from 'three';
import { App } from '../../src/App.ts';

const markup = await (await fetch('/index.html')).text();
const template = new DOMParser().parseFromString(markup, 'text/html');
for (const script of template.querySelectorAll('script')) script.remove();
document.body.innerHTML = template.body.innerHTML;

const app = new App(document.querySelector('#app'), 'pulse-cannon-browser-profile');
const panel = document.createElement('pre');
panel.style.cssText = 'position:fixed;z-index:300;left:10px;top:10px;color:white;background:#071018e8;font:12px monospace;padding:10px;max-height:90vh;max-width:92vw;overflow:auto;pointer-events:none';
document.body.append(panel);

const baseSettings = {
  ...app.impacts.settings,
  meteorEnabled: false,
  missileEnabled: false,
  pulseEnabled: true,
  pulseDuration: 1,
};
app.meteors.configure(baseSettings);
app.missiles.configure(baseSettings);
app.impacts.configure(baseSettings);

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = fraction => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] || 0;
  return {
    mean: +(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)).toFixed(3),
    p50: +at(0.5).toFixed(3), p95: +at(0.95).toFixed(3),
    p99: +at(0.99).toFixed(3), max: +(sorted.at(-1) || 0).toFixed(3),
  };
}

function requestShot(radius) {
  app.pulse.reset();
  app.pulse.configure({ ...baseSettings, pulseRadius: radius });
  app.pulse.requestFire();
}

function spawnMeteorBurst() {
  app.meteors.reset();
  for (let index = 0; index < 48; index += 1) {
    const angle = index * Math.PI * 2 / 48;
    const local = new Vector3(
      Math.cos(angle) * 40,
      Math.sin(angle) * 40,
      80 + index * 6,
    ).applyQuaternion(app.flight.orientation).add(app.flight.position);
    app.meteors.spawnAt(local, 12, index % app.rocks.variants.length);
  }
}

function addEightMasks() {
  const direction = new Vector3(0, 0, 1).applyQuaternion(app.flight.orientation);
  const side = new Vector3(1, 0, 0).applyQuaternion(app.flight.orientation);
  for (let index = 0; index < 8; index += 1) {
    const start = app.flight.position.clone()
      .addScaledVector(direction, 60)
      .addScaledVector(side, (index - 3.5) * 2);
    const end = start.clone().addScaledVector(direction, 360);
    app.terrain.applyPulseCarve(start, end, 60);
  }
}

const phases = [
  { name: 'pulse disabled', setup: () => app.pulse.configure({ ...baseSettings, pulseEnabled: false }) },
  { name: 'pulse idle', setup: () => { app.pulse.reset(); app.pulse.configure(baseSettings); } },
  { name: '60 m shot', setup: () => requestShot(60) },
  { name: '80 m shot', setup: () => requestShot(80) },
  { name: '48 meteor 60 m shot', setup: () => { spawnMeteorBurst(); requestShot(60); } },
  { name: 'eight pending masks', setup: () => { app.pulse.reset(); addEightMasks(); } },
  { name: 'settled', setup: () => { app.pulse.reset(); } },
];
const results = [];
let phase = -1;
let phaseStart = performance.now();
let requestedAt = 0;
let firstFrameAt = 0;
let masksSettledAt = 0;
let samples = [];
let drawCalls = [];
let maxQueue = 0;
let lastPulseSyncMs = 0;
const originalPulseSync = app.pulseView.sync.bind(app.pulseView);
app.pulseView.sync = origin => {
  const start = performance.now();
  originalPulseSync(origin);
  lastPulseSyncMs = performance.now() - start;
};

function beginPhase(index) {
  phases[index].setup();
  requestedAt = performance.now();
  firstFrameAt = 0;
  masksSettledAt = 0;
  samples = [];
  drawCalls = [];
  maxQueue = 0;
  phaseStart = requestedAt;
}

function finishPhase() {
  const stable = samples.slice(Math.min(10, samples.length));
  results.push({
    phase: phases[phase].name,
    frames: samples.length,
    frameMs: stats(stable.map(sample => sample.duration)),
    pulseSyncMs: stats(stable.map(sample => sample.pulseSyncMs)),
    maxDrawCalls: Math.max(0, ...drawCalls),
    maxPulseDrawCalls: Math.max(0, ...samples.map(sample => sample.pulseDrawCalls)),
    nextFrameLatencyMs: firstFrameAt ? +(firstFrameAt - requestedAt).toFixed(3) : null,
    masksSettledLatencyMs: masksSettledAt ? +(masksSettledAt - requestedAt).toFixed(3) : null,
    maxQueue,
    generation: { ...app.terrain.generationStats },
    heapBytes: performance.memory?.usedJSHeapSize ?? null,
  });
}

const originalFrame = app.frame;
app.frame = now => {
  if (!app.running) return;
  if (phase < 0) {
    originalFrame(now);
    const generation = app.terrain.generationStats;
    panel.textContent = JSON.stringify({ phase: 'warming terrain stream', generation }, null, 2);
    if (generation.queued === 0 && generation.inFlight === 0 && generation.ready === 0) {
      phase = 0;
      beginPhase(phase);
    }
    return;
  }
  if (now - phaseStart >= 2_500) {
    finishPhase();
    phase += 1;
    if (phase >= phases.length) {
      app.running = false;
      window.pulseCannonProfileResults = {
        environment: {
          userAgent: navigator.userAgent,
          width: innerWidth,
          height: innerHeight,
          devicePixelRatio,
          hardwareConcurrency: navigator.hardwareConcurrency,
          gpuTimerAvailable: false,
        },
        seed: 'pulse-cannon-browser-profile',
        results,
      };
      panel.textContent = JSON.stringify(window.pulseCannonProfileResults, null, 2);
      return;
    }
    beginPhase(phase);
  }
  const start = performance.now();
  originalFrame(now);
  const end = performance.now();
  if (!firstFrameAt) firstFrameAt = end;
  const generation = app.terrain.generationStats;
  if (!masksSettledAt && generation.carveMasks === 0 && phase >= 2) masksSettledAt = end;
  samples.push({
    duration: end - start,
    pulseSyncMs: lastPulseSyncMs,
    pulseDrawCalls: Number(app.pulseView.plasma.visible)
      + Number(app.pulseView.electric.visible)
      + Number(app.pulseView.active),
  });
  drawCalls.push(app.renderer.info.render.calls);
  maxQueue = Math.max(maxQueue, generation.queued + generation.inFlight + generation.ready);
  panel.textContent = JSON.stringify({
    phase: phases[phase].name,
    frames: samples.length,
    lastFrameMs: samples.at(-1)?.duration,
    generation,
    completed: results,
  }, null, 2);
};

app.start();
