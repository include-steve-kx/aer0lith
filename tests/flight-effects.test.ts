import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferAttribute, BufferGeometry, Mesh, Quaternion, ShaderMaterial, Vector3 } from 'three';
import { TrailView } from '../src/render/TrailView.ts';
import { TRAIL_ANCHORS } from '../src/core/aircraftGeometry.ts';
import { WakeSheetGeometry } from '../src/render/WakeSheetGeometry.ts';
import { BoostEnvelope } from '../src/render/BoostEnvelope.ts';
import { FlightEffects, DEFAULT_FLIGHT_EFFECTS } from '../src/render/FlightEffects.ts';

test('boost holds a steady flame until release, then fades at the configured speed', () => {
  const burst = new BoostEnvelope();
  burst.update(0.065, true);
  assert.ok(burst.intensity > 0.9);
  for (let i = 0; i < 600; i++) burst.update(1 / 60, true);
  assert.ok(burst.intensity >= 0.42, 'held throttle must never lose its flame');
  const held = burst.intensity;
  burst.update(0.8, false);
  assert.ok(burst.intensity > 0 && burst.intensity < held);
  burst.update(2.1, false);
  assert.equal(burst.intensity, 0);
  burst.update(0.065, true);
  assert.ok(burst.intensity > 0.9);
});

test('release duration is adjustable and pause freezes both ignition and release fade', () => {
  const fast = new BoostEnvelope(), slow = new BoostEnvelope();
  fast.fadeDuration = 1; slow.fadeDuration = 4;
  for (const burst of [fast, slow]) {
    burst.update(0.065, true);
    burst.update(0.7, false);
    const intensity = burst.intensity;
    burst.update(0, true);
    assert.equal(burst.intensity, intensity);
  }
  assert.ok(slow.intensity > fast.intensity * 2);
  slow.reset();
  assert.equal(slow.intensity, 0);
});

test('effects follow rotation and floating origin without moving on a paused appearance edit', () => {
  const effects = new FlightEffects();
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  effects.update(0.065, true, 80);
  effects.sync(new Vector3(1000, 20, 500), q, false);
  assert.ok(effects.lightPosition.distanceTo(new Vector3(994, 20, 500)) < 1e-8);
  const age = effects.burst.age;
  effects.sync(new Vector3(0, 20, 0), q, false);
  effects.configure({...DEFAULT_FLIGHT_EFFECTS, boostExhaustEnabled: false, wingWarpEnabled: false});
  assert.equal(effects.burst.age, age);
  assert.equal(effects.lightIntensity, 0);
  assert.equal(effects.hasWake, false);
  effects.configure({...DEFAULT_FLIGHT_EFFECTS, boostExhaustEnabled: true, wingWarpEnabled: true});
  assert.ok(effects.lightIntensity > 0.8);
  assert.ok(effects.lightPosition.distanceTo(new Vector3(-6, 20, 0)) < 1e-8);
  effects.sync(new Vector3(), q, true);
  assert.equal(effects.hasWake, false);
  effects.update(0.016, false, 80, true);
  assert.equal(effects.lightIntensity, 0);
  effects.sync(new Vector3(), q, false);
  assert.equal(effects.hasWake, false);
  effects.reset();
  effects.dispose();
});

test('extruded wakes share curved trail centers, honor dimensions and survive an origin rebase', () => {
  const trail = new TrailView();
  const origin = new Vector3();
  for (let i = 0; i <= 16; i++) {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), i * 0.02);
    trail.add(new Vector3(i * i * 0.15, 30 + i, i * 3), q, origin, true);
  }
  const sheet = new WakeSheetGeometry();
  sheet.rebuild(trail.pathSamples, 'left', origin, 120, 14, 0.3);
  const positions = sheet.getAttribute('position');
  const read = (i: number) => new Vector3().fromBufferAttribute(positions, i);
  // Nine vertices on each face; each ring is centered on the corresponding line sample.
  for (let ring = 0; ring < trail.sampleCount; ring++) {
    const center = read(ring * 18 + 4).add(read(ring * 18 + 13)).multiplyScalar(0.5);
    assert.ok(center.distanceTo(trail.pathSamples.at(-1 - ring)!.left) < 1e-5);
    assert.ok(Math.abs(read(ring * 18 + 4).distanceTo(read(ring * 18 + 13)) - 0.3) < 1e-5);
  }
  assert.ok(Math.abs(read(0).distanceTo(read(8)) - 3.8) < 1e-5);
  assert.ok(Math.abs(read(10 * 18).distanceTo(read(10 * 18 + 8)) - 14) < 1e-5);
  const before = read(10 * 18);
  const shift = new Vector3(2048, 0, -2048);
  sheet.rebuild(trail.pathSamples, 'left', shift, 120, 14, 0.3);
  assert.ok(read(10 * 18).distanceTo(before.sub(shift)) < 0.0002);
  sheet.dispose();
});

test('wake length clips the shared path and live shape edits do not advance the burst or trail', () => {
  const trail = new TrailView();
  for (let i = 0; i < 1000; i++) trail.add(new Vector3(0, 30, i * 2), new Quaternion(), new Vector3());
  const effects = new FlightEffects();
  effects.update(0.065, true, 80);
  effects.configure({ ...DEFAULT_FLIGHT_EFFECTS, wingWarpLength: 25 });
  effects.syncWake(trail, new Vector3());
  const mesh = effects.wakeGroup.children[0] as Mesh<WakeSheetGeometry>;
  const geometry = mesh.geometry;
  const rings = geometry.drawRange.count / (18 * 6) + 1;
  const uv = geometry.getAttribute('uv');
  assert.equal(uv.getY((rings - 1) * 18), 1);
  assert.equal(geometry.getAttribute('aDistance').getX((rings - 1) * 18), trail.pathSamples.at(-1)!.distance - 25);
  assert.ok(geometry.drawRange.count < 512 * 18 * 6);
  const age = effects.burst.age, revision = trail.revision;
  const version = (geometry.getAttribute('position') as BufferAttribute).version;
  effects.syncWake(trail, new Vector3());
  assert.equal((geometry.getAttribute('position') as BufferAttribute).version, version);
  effects.configure({ ...DEFAULT_FLIGHT_EFFECTS, wingWarpHeight: 28, wingWarpThickness: 0.8,
    boostExhaustColor: '#ff4400', boostExhaustLength: 60 });
  effects.syncWake(trail, new Vector3());
  assert.equal(effects.burst.age, age);
  assert.equal(trail.revision, revision);
  assert.equal(effects.lightColor.getHexString(), 'ff4400');
  assert.ok((geometry.getAttribute('position') as BufferAttribute).version > version);
  const plume = effects.group.children[0].children[0] as Mesh<BufferGeometry, ShaderMaterial>;
  assert.ok(plume.material.uniforms.uLength.value > 50);
  trail.clear();
  effects.syncWake(trail, new Vector3());
  assert.equal(effects.wakeGroup.visible, false);
  effects.reset();
  assert.equal(effects.hasWake, false);
  effects.dispose();
});

test('all four line trails attach just behind the four transformed X-wing tips', () => {
  const trail = new TrailView();
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.7);
  const position = new Vector3(3100, 120, 4100), origin = new Vector3(3072, 0, 4096);
  trail.add(position, q, origin, true);
  assert.equal(trail.group.children.length, 4);
  trail.pathSamples[0].tips.forEach((tip, index) => {
    const expected = new Vector3(...TRAIL_ANCHORS[index]).applyQuaternion(q).add(position);
    assert.ok(tip.distanceTo(expected) < 1e-8);
    const line = trail.group.children[index] as Mesh<BufferGeometry>;
    const rendered = new Vector3().fromBufferAttribute(line.geometry.getAttribute('position'), 0);
    assert.ok(rendered.distanceTo(expected.sub(origin)) < 1e-5);
  });
});

test('booster refraction is independent of the two side wakes and shares flame deformation', () => {
  const effects = new FlightEffects();
  effects.configure({ ...DEFAULT_FLIGHT_EFFECTS, wingWarpEnabled: false });
  effects.update(0.065, true, 55);
  assert.ok(effects.hasWake);
  assert.equal(effects.wakeGroup.children.length, 2, 'rear tunnel has been removed');
  assert.equal(effects.wakeGroup.visible, false);
  const glassGroup = effects.wakeScene.children[1];
  const glass = glassGroup.children[0] as Mesh<BufferGeometry, ShaderMaterial>;
  const flame = effects.group.children[0].children[0] as Mesh<BufferGeometry, ShaderMaterial>;
  assert.equal(glass.geometry, flame.geometry);
  assert.equal(glass.material.uniforms.uFlutter, flame.material.uniforms.uFlutter);
  assert.equal(glass.material.uniforms.uFlutterTime, flame.material.uniforms.uFlutterTime);
  effects.configure({ ...DEFAULT_FLIGHT_EFFECTS, wingWarpEnabled: false, boostGlassEnabled: false });
  assert.equal(effects.hasWake, false);
  effects.dispose();
});

test('both flame and side flutter increase with speed and freeze at zero simulation time', () => {
  const effects = new FlightEffects();
  const flame = effects.group.children[0].children[0] as Mesh<BufferGeometry, ShaderMaterial>;
  const side = effects.wakeGroup.children[0] as Mesh<BufferGeometry, ShaderMaterial>;
  effects.update(1, true, 30);
  const slowFlame = flame.material.uniforms.uFlutter.value;
  const slowSide = side.material.uniforms.uFlutter.value;
  const slowTime = flame.material.uniforms.uFlutterTime.value;
  const slowSideTime = side.material.uniforms.uFlutterTime.value;
  effects.update(1, true, 120);
  assert.ok(Math.abs((flame.material.uniforms.uFlutterTime.value - slowTime) / slowTime - 4) < 1e-8);
  assert.ok(Math.abs((side.material.uniforms.uFlutterTime.value - slowSideTime) / slowSideTime - 4) < 1e-8);
  assert.ok(flame.material.uniforms.uFlutter.value > slowFlame * 2);
  assert.ok(side.material.uniforms.uFlutter.value > slowSide * 2);
  const time = flame.material.uniforms.uFlutterTime.value;
  effects.update(0, false, 120);
  assert.equal(flame.material.uniforms.uFlutterTime.value, time);
  effects.dispose();
});

test('live trail endpoints stay attached between history samples without accumulating tiny segments', () => {
  const trail = new TrailView();
  const q = new Quaternion(), origin = new Vector3();
  trail.add(new Vector3(), q, origin, true);
  for (let i = 1; i < 100; i++) trail.add(new Vector3(0, 0, i * 0.01), q, origin);
  assert.equal(trail.sampleCount, 2);
  assert.ok(Math.abs(trail.pathSamples.at(-1)!.tips[0].z - (TRAIL_ANCHORS[0][2] + 0.99)) < 1e-8);
  trail.add(new Vector3(0, 0, 1.6), q, origin);
  trail.add(new Vector3(0, 0, 1.8), q, origin);
  assert.equal(trail.sampleCount, 3);
  assert.ok(Math.abs(trail.distanceSpan - 1.8) < 1e-8);
});

test('slender flames and compact glass have independent geometry controls and a pooled opaque preview', () => {
  const effects = new FlightEffects();
  effects.configure({ ...DEFAULT_FLIGHT_EFFECTS, wingWarpEnabled: false });
  effects.update(.065, true, 80);
  const flame = effects.group.children[0].children[0] as Mesh<BufferGeometry, ShaderMaterial>;
  const glass = effects.wakeScene.children[1].children[0] as Mesh<BufferGeometry, ShaderMaterial>;
  const debugGroup = effects.group.children[2];
  const debug = debugGroup.children[0] as Mesh<BufferGeometry, ShaderMaterial>;
  assert.equal(flame.material.uniforms.uLength.value, 54);
  assert.equal(flame.material.uniforms.uShellScale.value, .45);
  assert.equal(glass.material.uniforms.uShellScale.value, .55);
  assert.ok(Math.abs(glass.material.uniforms.uLength.value
    - 54 * DEFAULT_FLIGHT_EFFECTS.boostGlassLength) < 1e-8);
  const geometry = glass.geometry;
  effects.configure({ ...DEFAULT_FLIGHT_EFFECTS, wingWarpEnabled: false, boostGlassWidth: .8,
    boostGlassLength: .4, boostGlassDebug: true });
  assert.equal(effects.hasWake, true, 'debug preserves the refraction pass');
  assert.equal(glass.material.uniforms.uDebug.value, 1);
  assert.equal(debugGroup.visible, true); assert.equal(effects.group.children[0].visible, false);
  assert.equal(debug.geometry, glass.geometry); assert.equal(debug.material.vertexShader, glass.material.vertexShader);
  assert.equal(debug.material.uniforms, glass.material.uniforms);
  assert.equal(flame.material.uniforms.uShellScale.value, .45);
  assert.equal(glass.material.uniforms.uShellScale.value, .8);
  assert.ok(Math.abs(glass.material.uniforms.uLength.value - 54 * .4) < 1e-8);
  effects.reset();
  assert.equal(debugGroup.visible, true, 'preview remains inspectable without holding boost');
  assert.equal(debug.material.uniforms.uPower.value, 1);
  effects.configure({ ...DEFAULT_FLIGHT_EFFECTS, wingWarpEnabled: false });
  assert.equal(debugGroup.visible, false); assert.equal(glass.geometry, geometry);
  effects.dispose();
});

test('debug toggles preserve pooled glass and recover while paused, independently of boost', () => {
  const effects = new FlightEffects(), trail = new TrailView(), origin = new Vector3();
  for (let i = 0; i < 40; i++) trail.add(new Vector3(0, 20, i * 3), new Quaternion(), origin, true);
  effects.syncWake(trail, origin); effects.update(0.3, true, 80);
  const wake = effects.wakeGroup.children[0] as Mesh<BufferGeometry, ShaderMaterial>;
  const geometry = wake.geometry, count = geometry.drawRange.count;
  const boost = effects.wakeScene.children[1].children[0] as Mesh<BufferGeometry, ShaderMaterial>;
  const frozen = wake.material.uniforms.uFlutterTime.value;
  for (let i = 0; i < 20; i++) {
    for (const [side, rear] of [[true, false], [false, true], [true, true], [false, false]]) {
      effects.configure({ ...DEFAULT_FLIGHT_EFFECTS, wakeDebugEnabled: side, boostGlassDebug: rear });
      assert.equal(effects.hasWake, true, 'inspection cannot deactivate the glass pass');
      assert.equal(effects.wakeGroup.visible, true);
      assert.equal(effects.debugGroup.visible, side);
      assert.equal(wake.material.uniforms.uDebug.value, side ? 1 : 0);
      assert.equal(boost.material.uniforms.uDebug.value, rear ? 1 : 0);
      assert.equal(wake.material.uniforms.uFlutterTime.value, frozen);
      assert.equal(wake.geometry, geometry); assert.equal(geometry.drawRange.count, count);
    }
  }
  effects.update(10, false, 80);
  effects.configure({ ...DEFAULT_FLIGHT_EFFECTS, boostGlassDebug: true });
  effects.configure({ ...DEFAULT_FLIGHT_EFFECTS });
  assert.equal(effects.hasWake, true, 'side glass must survive the end of the boost');
  assert.equal(effects.wakeGroup.visible, true);
  effects.dispose();
});

test('all four flow/flutter controls integrate speed independently without phase jumps', () => {
  const effects = new FlightEffects();
  const flame = (effects.group.children[0].children[0] as Mesh<BufferGeometry, ShaderMaterial>).material.uniforms;
  const side = (effects.wakeGroup.children[0] as Mesh<BufferGeometry, ShaderMaterial>).material.uniforms;
  const phases = () => [side.uFlowDistance.value, side.uFlutterTime.value, flame.uFlowDistance.value, flame.uFlutterTime.value];
  effects.configure({ ...DEFAULT_FLIGHT_EFFECTS, wingWarpFlowRate: 2, wingWarpFlutterRate: 0.5,
    boostFlowRate: 0.25, boostFlutterRate: 3 });
  effects.update(1, true, 55);
  assert.deepEqual(phases(), [110, .5, 13.75, 3]);
  const slow = phases(); effects.update(1, true, 110);
  phases().forEach((v, i) => assert.ok(Math.abs(v - slow[i] * 3) < 1e-10, 'double speed doubles each phase increment'));
  const before = phases();
  effects.configure({ ...DEFAULT_FLIGHT_EFFECTS, wingWarpFlowRate: 0, wingWarpFlutterRate: 0,
    boostFlowRate: 0, boostFlutterRate: 0 });
  assert.deepEqual(phases(), before, 'editing controls does not rephase surfaces');
  effects.update(1, true, 120); assert.deepEqual(phases(), before, 'zero stops each independent animation');
  const controls = ['wingWarpFlowRate', 'wingWarpFlutterRate', 'boostFlowRate', 'boostFlutterRate'] as const;
  for (let i = 0; i < controls.length; i++) {
    effects.configure({ ...DEFAULT_FLIGHT_EFFECTS, wingWarpFlowRate: 0, wingWarpFlutterRate: 0,
      boostFlowRate: 0, boostFlutterRate: 0, [controls[i]]: 1 });
    const snapshot = phases(); effects.update(1, true, 55);
    phases().forEach((v, j) => assert.equal(v - snapshot[j], j === i ? (i % 2 === 0 ? 55 : 1) : 0));
  }
  effects.configure(DEFAULT_FLIGHT_EFFECTS);
  const frozen = phases(); effects.update(0, true, 120); assert.deepEqual(phases(), frozen);
  effects.update(1, true, 0); assert.deepEqual(phases(), frozen, 'zero plane speed stops all phase travel');
  effects.dispose();
});
