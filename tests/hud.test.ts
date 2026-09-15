import assert from 'node:assert/strict';
import test from 'node:test';
import { Euler, Quaternion } from 'three';
import { zeroRollIndicatorRadians } from '../src/ui/Hud.ts';

test('cockpit zero-roll reference counter-rotates against aircraft bank', () => {
  const rightBank = new Quaternion().setFromEuler(new Euler(0, 0, 0.48, 'YXZ'));
  const leftBank = new Quaternion().setFromEuler(new Euler(0, 0, -0.31, 'YXZ'));

  assert.ok(Math.abs(zeroRollIndicatorRadians(rightBank) + 0.48) < 1e-9);
  assert.ok(Math.abs(zeroRollIndicatorRadians(leftBank) - 0.31) < 1e-9);
  assert.ok(Math.abs(zeroRollIndicatorRadians(new Quaternion())) < 1e-12);
});
