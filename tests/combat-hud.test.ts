import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { COCKPIT_EYE, WING_TIPS } from '../src/core/aircraftGeometry.ts';
import { CombatHud } from '../src/ui/CombatHud.ts';
import { DEFAULT_COMBAT } from '../src/combat/settings.ts';
import type { MeteorSystem } from '../src/combat/MeteorSystem.ts';
import type { MissileSystem } from '../src/combat/MissileSystem.ts';

// Minimal DOM adapter: the test exercises the real HUD update and projection,
// while any attempt to ask terrain about marker visibility throws immediately.
class Node {
  className = '';
  hidden = false;
  textContent = '';
  children: Node[] = [];
  style: Record<string, string> = {};
  append(...children: Node[]): void {
    this.children.push(...children);
  }
  setAttribute(): void {}
  remove(): void {}
  getBoundingClientRect() {
    return { left: 12, right: 1268, top: 12, bottom: 708 };
  }
}

function withHudDom(run: (root: Node) => void): void {
  const names = ['document', 'window', 'getComputedStyle'];
  const previous = names.map((name) =>
    Object.getOwnPropertyDescriptor(globalThis, name),
  );
  const root = new Node();
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => new Node(),
      querySelector: () => root,
      querySelectorAll: () => [],
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerWidth: 1280, innerHeight: 720 },
  });
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: () => ({ fontSize: '10px', letterSpacing: '0.8px' }),
  });
  try {
    run(root);
  } finally {
    names.forEach((name, i) => {
      const descriptor = previous[i];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
}

test('detected 2D crosses remain visible through solid terrain without querying it', () =>
  withHudDom((root) => {
    const hud = new CombatHud(),
      camera = new PerspectiveCamera(60, 1280 / 720, 0.1, 1000);
    const meteor = {
      active: true,
      detected: 8,
      position: new Vector3(0, 0, -20),
    };
    const fail = () => {
      throw new Error('A 2D marker must not query terrain');
    };
    const meteors = {
      rocks: Array.from({ length: 48 }, (_, i) =>
        i === 0
          ? meteor
          : { active: false, detected: 0, position: new Vector3() },
      ),
      hasLineOfSight: fail,
      terrain: { densityAt: fail, collisionDensityAt: fail },
    } as unknown as MeteorSystem;
    const missiles = {
      muzzle: Array.from({ length: 4 }, () => new Vector3(0, 0, -20)),
      ammunition: new Uint8Array(4),
      reload: new Float64Array(4),
    } as unknown as MissileSystem;
    const settings = { ...DEFAULT_COMBAT, missileHud: false };
    const update = () =>
      hud.update(
        camera,
        new Vector3(),
        meteors,
        missiles,
        settings,
        false,
        true,
        0.022,
        new Quaternion(),
      );
    const cross = () =>
      root.children[0].children.find((n) => n.className === 'meteor-cross')!;
    update();
    assert.equal(cross().hidden, false);
    assert.equal(cross().style.opacity, '1');
    // Camera motion, pause (no simulation advancement), and re-rendering do not
    // introduce an occlusion test or hide a still-detected, on-screen meteor.
    camera.position.x = 1;
    update();
    assert.equal(cross().hidden, false);
    meteor.detected = 0.5;
    update();
    assert.equal(cross().hidden, false);
    assert.equal(cross().style.opacity, '0.5');
    meteor.detected = 0;
    update();
    assert.equal(cross().hidden, true);
    meteor.detected = 8;
    meteor.active = false;
    update();
    assert.equal(cross().hidden, true);
    hud.dispose();
  }));

test('cockpit magazines project ahead of four wing tips, stay separated, and survive rolls and rebases', () =>
  withHudDom((root) => {
    const hud = new CombatHud();
    const camera = new PerspectiveCamera(70, 1280 / 720, 0.1, 1000);
    const ship = new Vector3(4000, 12, 8000),
      origin = new Vector3(4096, 0, 8192),
      orientation = new Quaternion();
    const missiles = {
      muzzle: WING_TIPS.map(() => new Vector3()),
      ammunition: new Uint8Array([1, 2, 3, 0]),
      reload: new Float64Array([0.2, 0.5, 0, 0.7]),
    } as unknown as MissileSystem;
    const meteors = {
      rocks: Array.from({ length: 48 }, () => ({ active: false })),
    } as unknown as MeteorSystem;
    const labels = root.children[0].children.filter(
      (n) => n.className === 'wing-ammo',
    );
    function update() {
      WING_TIPS.forEach((p, i) =>
        missiles.muzzle[i]
          .set(...p)
          .applyQuaternion(orientation)
          .add(ship),
      );
      camera.position
        .set(...COCKPIT_EYE)
        .applyQuaternion(orientation)
        .add(ship)
        .sub(origin);
      camera.up.set(0, 1, 0).applyQuaternion(orientation);
      camera.lookAt(
        new Vector3(0, 0, 60).applyQuaternion(orientation).add(camera.position),
      );
      hud.update(
        camera,
        origin,
        meteors,
        missiles,
        DEFAULT_COMBAT,
        true,
        true,
        0.022,
        orientation,
      );
      return labels.map((label) => {
        assert.equal(label.hidden, false);
        const match = label.style.transform.match(
          /translate\(([-\d.]+)px,([-\d.]+)px\)/,
        )!;
        return [Number(match[1]), Number(match[2])];
      });
    }
    const base = update();
    assert.equal(new Set(base.map((p) => p.join(','))).size, 4);
    assert.ok(
      base.every((p) => p[1] < 500),
      'indicators belong in the flight view, not above the bottom button',
    );
    assert.ok(Math.abs(base[0][0] - base[2][0]) > 300);
    assert.ok(Math.abs(base[0][1] - base[1][1]) > 100);
    assert.deepEqual(
      labels.map((n) => n.children[0].textContent),
      ['1', '2', '3', '0'],
    );
    assert.equal(
      labels[1].children[1].children[0].style.transform,
      'scaleX(0.5)',
    );
    orientation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI * 0.75);
    const rolled = update();
    rolled.forEach((p, i) =>
      p.forEach((v, j) => assert.ok(Math.abs(v - base[i][j]) < 1e-6)),
    );
    origin.add(new Vector3(2048, 0, 2048));
    const rebased = update();
    rebased.forEach((p, i) =>
      p.forEach((v, j) => assert.ok(Math.abs(v - base[i][j]) < 1e-6)),
    );
    hud.dispose();
  }));
