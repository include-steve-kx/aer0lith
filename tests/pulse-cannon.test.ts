import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { ImpactSystem } from '../src/combat/ImpactSystem.ts';
import { MeteorSystem } from '../src/combat/MeteorSystem.ts';
import { PulseCannonSystem } from '../src/combat/PulseCannonSystem.ts';
import { PULSE_VIEW_COMPLEXITY, PulseCannonView } from '../src/combat/PulseCannonView.ts';
import { RockLibrary } from '../src/combat/geometry.ts';
import { DEFAULT_COMBAT } from '../src/combat/settings.ts';
import { HULL_POINTS, PULSE_MUZZLE } from '../src/core/aircraftGeometry.ts';
import { ProceduralTerrain } from '../src/world/TerrainModel.ts';

const air = {
  densityAt: () => -1000,
  sample: () => ({
    x: 0, y: 0, tangentX: 0, tangentY: 0, openness: 1,
    width: 100, height: 100, floorY: -100,
  }),
};

test('Pulse Cannon snapshots an 800 m shot whose 40 m capsule reaches both visual ends', () => {
  const pulse = new PulseCannonSystem();
  const muzzle = new Vector3(10, 20, 30);
  const aim = new Vector3(110, 20, 1030);
  pulse.requestFire();
  const shot = pulse.tryFire(muzzle, aim)!;
  assert.ok(shot);
  assert.equal(shot.radius, 40);
  assert.ok(Math.abs(shot.visualStart.distanceTo(shot.visualEnd) - 800) < 1e-9);
  assert.ok(Math.abs(shot.visualStart.distanceTo(shot.carveStart) - 40) < 1e-9);
  assert.ok(Math.abs(shot.visualStart.distanceTo(shot.carveEnd) - 760) < 1e-9);
  assert.ok(Math.abs(shot.carveStart.distanceTo(shot.carveEnd) - 720) < 1e-9);
  assert.equal(pulse.visualActive, true);
  assert.equal(pulse.ready, false);
  pulse.update(DEFAULT_COMBAT.pulseDuration);
  assert.equal(pulse.visualActive, false);
  pulse.update(DEFAULT_COMBAT.pulseCooldown - DEFAULT_COMBAT.pulseDuration);
  assert.equal(pulse.ready, true);
});

test('Pulse Cannon rejects invalid, disabled, cooling, and terrain-busy requests without false activations', () => {
  const pulse = new PulseCannonSystem();
  const muzzle = new Vector3();
  pulse.requestFire();
  assert.equal(pulse.tryFire(muzzle, muzzle), undefined);
  assert.equal(pulse.ready, true);
  pulse.requestFire();
  assert.equal(pulse.tryFire(muzzle, new Vector3(0, 0, 1), false), undefined);
  assert.equal(pulse.ready, true);
  pulse.configure({ ...DEFAULT_COMBAT, pulseEnabled: false });
  pulse.requestFire();
  assert.equal(pulse.tryFire(muzzle, new Vector3(0, 0, 1)), undefined);
  pulse.configure({ ...DEFAULT_COMBAT, pulseRange: 800, pulseRadius: 80 });
  pulse.requestFire();
  const shot = pulse.tryFire(muzzle, new Vector3(0, 0, 1))!;
  assert.equal(shot.visualEnd.z, 800);
  assert.equal(shot.radius, 80);
  pulse.requestFire();
  assert.equal(pulse.tryFire(muzzle, new Vector3(0, 0, 1)), undefined);
  pulse.reset();
  assert.equal(pulse.ready, true);
  assert.equal(pulse.visualActive, false);
});

test('meteor capsule hits include sides, tangency, and rounded ends while misses survive', () => {
  const library = new RockLibrary('pulse-capsule');
  const meteors = new MeteorSystem(air, library, 'pulse-capsule');
  let callbacks = 0;
  meteors.onDestroyed = () => { callbacks += 1; };
  const side = meteors.spawnAt(new Vector3(0, 0, 240), 12, 0)!;
  side.position.x = 60 + side.radius;
  const nearCap = meteors.spawnAt(new Vector3(0, 0, 0), 12, 1)!;
  const farCap = meteors.spawnAt(new Vector3(0, 0, 480), 12, 2)!;
  const miss = meteors.spawnAt(new Vector3(0, 0, 240), 12, 3)!;
  miss.position.x = 60 + miss.radius + 0.001;
  const destroyed = meteors.destroyInCapsule(
    new Vector3(0, 0, 60),
    new Vector3(0, 0, 420),
    60,
    new Vector3(0, 0, 1),
  );
  assert.equal(destroyed, 3);
  assert.equal(callbacks, 3);
  assert.equal(side.active, false);
  assert.equal(nearCap.active, false);
  assert.equal(farCap.active, false);
  assert.equal(miss.active, true);
  assert.equal(meteors.destroyInCapsule(new Vector3(), new Vector3(), -1, new Vector3()), 0);
  meteors.dispose();
  library.dispose();
});

test('a maximum Pulse burst destroys 48 meteors once and fills bounded cosmetic pools', () => {
  const library = new RockLibrary('pulse-burst');
  const meteors = new MeteorSystem(air, library, 'pulse-burst');
  const impacts = new ImpactSystem(library, 'pulse-burst');
  impacts.configure({ ...DEFAULT_COMBAT, fragmentCount: 12 });
  meteors.onDestroyed = (rock, point, direction) => impacts.spawn(rock, point, direction);
  for (let index = 0; index < 48; index += 1) {
    const angle = index * Math.PI * 2 / 48;
    meteors.spawnAt(
      new Vector3(Math.cos(angle) * 30, Math.sin(angle) * 30, 80 + index * 6),
      12,
      index % library.variants.length,
    );
  }
  const destroyed = meteors.destroyInCapsule(
    new Vector3(0, 0, 60),
    new Vector3(0, 0, 420),
    60,
    new Vector3(0, 0, 1),
  );
  assert.equal(destroyed, 48);
  assert.equal(meteors.activeCount, 0);
  assert.equal(impacts.explosions.filter((entry) => entry.active).length, 48);
  assert.equal(impacts.fragments.filter((entry) => entry.active).length, 576);
  assert.equal(meteors.destroyInCapsule(new Vector3(0, 0, 60), new Vector3(0, 0, 420), 60, new Vector3(0, 0, 1)), 0);
  impacts.dispose();
  meteors.dispose();
  library.dispose();
});

test('ordinary lethal and proximity meteor destruction never mutate terrain carve state', () => {
  const terrain = new ProceduralTerrain('meteor-only-regression');
  const library = new RockLibrary('meteor-only-regression');
  const meteors = new MeteorSystem(terrain, library, 'meteor-only-regression');
  const impacts = new ImpactSystem(library, 'meteor-only-regression');
  meteors.onDestroyed = (rock, point, direction) => impacts.spawn(rock, point, direction);

  for (let route = 0; route < 2; route += 1) {
    const meteor = meteors.spawnAt(new Vector3(route * 30, 0, 120), 12, route)!;
    const slot = meteors.rocks.indexOf(meteor);
    assert.equal(meteors.applyHit({ slot, generation: meteor.generation }, meteor.position, new Vector3(0, 0, 1), true), 'destroyed');
  }

  const proximity = meteors.spawnAt(new Vector3(), 12, 2)!;
  meteors.updateProximity(1 / 120, new Vector3(), new Vector3(), new Quaternion());
  assert.equal(proximity.active, false);
  assert.equal(terrain.carveEventCount, 0);
  assert.equal(terrain.carveRevisionForChunk({ x: 0, y: 0, z: 0 }), 0);
  assert.equal(impacts.explosions.filter((entry) => entry.active).length, 3);

  impacts.dispose();
  meteors.dispose();
  library.dispose();
});

test('Pulse booster plume keeps both endpoints on the snapshotted world-space shot', () => {
  const pulse = new PulseCannonSystem();
  const view = new PulseCannonView(pulse, 'pulse-view');
  const plasmaGeometry = view.plasma.geometry;
  const electricGeometry = view.electric.geometry;
  const glassGeometry = view.glass.geometry;
  assert.deepEqual(PULSE_MUZZLE, HULL_POINTS.at(-1), 'the cannon muzzle is the visible nose tip');
  assert.deepEqual(PULSE_VIEW_COMPLEXITY, {
    plasmaDrawCalls: 1,
    electricDrawCalls: 1,
    refractionDrawCalls: 1,
    arcCount: 8,
    arcSegments: 16,
    beamSides: 16,
    beamRings: 24,
  });
  const muzzle = new Vector3(1000, 20, 30);
  const origin = new Vector3(900, 0, 0);
  pulse.requestFire();
  pulse.tryFire(muzzle, new Vector3(1000, 20, 1030));
  view.sync(origin);
  assert.equal(view.plasma.visible, true);
  assert.equal(view.electric.visible, true);
  assert.equal(view.electric.geometry.drawRange.count, 8 * 2);
  assert.equal(view.plasmaVisualRadius, 8);
  assert.equal(view.glassRadius, view.plasmaVisualRadius * DEFAULT_COMBAT.pulseGlassWidth);
  assert.equal(view.glass.geometry, view.plasma.geometry, 'plasma and glass reuse the exact booster plume geometry');
  assert.equal(view.glassDebug.geometry, view.plasma.geometry);
  assert.ok(view.plasma.position.equals(new Vector3(100, 20, 30)), 'plume root starts at the launch-time nose tip');
  assert.equal(view.currentVisualLength, 800);
  assert.equal(view.plasma.material.uniforms.uPower.value, 1, 'the beam appears at full strength immediately');
  assert.equal(view.plasma.material.uniforms.uLength.value, 800);
  assert.equal(view.beamLight.intensity, DEFAULT_COMBAT.pulseBeamLightIntensity);
  assert.equal(view.electricLight.intensity, DEFAULT_COMBAT.pulseElectricLightIntensity);
  assert.equal(view.electricLightWorldPosition.z, muzzle.z);
  assert.equal(view.active, true);

  const initialElectric = Array.from((view.electric.geometry.getAttribute('position').array as Float32Array).slice(0, 8 * 2 * 3));
  pulse.update(0.02);
  view.sync(origin);
  const advancedElectric = Array.from(
    (view.electric.geometry.getAttribute('position').array as Float32Array).slice(0, 8 * 2 * 3),
  );
  for (let vertex = 0; vertex < 8 * 2; vertex += 1) {
    const initialAngle = Math.atan2(initialElectric[vertex * 3 + 1] - 20, initialElectric[vertex * 3] - 100);
    const advancedAngle = Math.atan2(advancedElectric[vertex * 3 + 1] - 20, advancedElectric[vertex * 3] - 100);
    assert.ok(Math.abs(initialAngle - advancedAngle) < 1e-6, 'electric paths resize without rotating');
  }
  assert.ok(view.plasma.material.uniforms.uPower.value < 1, 'the initial flash fades monotonically');
  assert.equal(view.currentVisualLength, 800, 'fading does not move the fixed far endpoint');

  pulse.update(0.08);
  view.sync(origin);
  assert.ok(view.plasma.position.equals(new Vector3(100, 20, 30)), 'the plume root remains at the launch-time nose tip');
  const renderedForward = new Vector3(0, 0, 1).applyQuaternion(view.plasma.quaternion);
  const expectedDirection = pulse.shot.direction;
  assert.ok(renderedForward.distanceTo(expectedDirection) < 1e-9, 'the plume retains the fired direction');
  const renderedEnd = muzzle.clone().addScaledVector(renderedForward, view.currentVisualLength);
  assert.ok(renderedEnd.distanceTo(pulse.shot.visualEnd) < 1e-9, 'the plume far endpoint remains fixed in world space');
  assert.ok(pulse.shot.visualStart.equals(muzzle), 'moving the aircraft does not move visual or gameplay geometry');
  const expectedElectricLight = muzzle.clone().addScaledVector(
    expectedDirection,
    view.currentVisualLength * (0.1 / DEFAULT_COMBAT.pulseElectricTravelTime),
  );
  assert.ok(view.electricLightWorldPosition.distanceTo(expectedElectricLight) < 1e-9);

  pulse.update(0.75);
  view.sync(origin);
  assert.equal(view.plasma.visible, false, 'the tuned 0.6 second visual has expired');
  assert.equal(view.electric.visible, false, 'electricity expires with the visual');
  assert.equal(view.electricLight.intensity, 0);

  pulse.reset();
  pulse.configure({
    ...DEFAULT_COMBAT,
    pulseRadius: 80,
    pulsePlasmaRadius: 42,
    pulseGlassWidth: 1.05,
    pulseGlassLength: 0.9,
    pulsePlasmaDebug: true,
    pulseGlassDebug: true,
    pulseElectricDebug: true,
  });
  view.sync(new Vector3());
  assert.equal(view.plasma.geometry, plasmaGeometry);
  assert.equal(view.electric.geometry, electricGeometry);
  assert.equal(view.glass.geometry, glassGeometry);
  assert.equal(view.glassDebug.geometry, plasmaGeometry);
  assert.equal(view.glassDebug.material.uniforms, view.glass.material.uniforms);
  assert.equal(view.plasmaVisualRadius, 42, 'visual radius is independent from the physical shot radius');
  assert.ok(Math.abs(view.glassRadius - 42 * 1.05) < 1e-9);
  assert.equal(view.plasma.visible, true);
  assert.equal(view.glass.visible, false);
  assert.equal(view.glassDebug.visible, true);
  assert.equal(view.electric.visible, true);
  assert.equal(view.electric.geometry.drawRange.count, 8 * 16 * 2);
  const electricPositions = view.electric.geometry.getAttribute('position').array as Float32Array;
  const midpointRadii: number[] = [];
  const glassLength = view.currentVisualLength * 0.9;
  for (let vertex = 0; vertex < view.electric.geometry.drawRange.count; vertex += 1) {
    if (Math.abs(electricPositions[vertex * 3 + 2] - (muzzle.z + glassLength * 0.5)) > 1e-4) continue;
    midpointRadii.push(Math.hypot(
      electricPositions[vertex * 3] - 1000,
      electricPositions[vertex * 3 + 1] - 20,
    ));
  }
  assert.ok(midpointRadii.length > 0);
  const boosterMidpointRadius = view.glassRadius
    * Math.pow(0.5, 0.72) * 3.5 / 2.36683;
  assert.ok(
    midpointRadii.every(radius => radius >= boosterMidpointRadius - 1e-4),
    'default electricity wraps around or outside the copied booster envelope',
  );
  assert.equal(view.plasma.material.transparent, false);
  assert.equal(view.electric.material.transparent, false);
  assert.equal(view.beamLight.intensity, 0, 'solid previews do not leave gameplay lights on');
  assert.equal(view.active, false);

  pulse.configure({ ...DEFAULT_COMBAT, pulseRefraction: 0, pulseDispersion: 0 });
  view.sync(new Vector3());
  assert.equal(view.plasma.visible, false);
  assert.equal(view.glassDebug.visible, false);
  assert.equal(view.electric.visible, false);
  view.dispose();
  view.dispose();
});
