import assert from 'node:assert/strict';
import test from 'node:test';
import { BoostLatch } from '../src/flight/BoostLatch.ts';

test('boost holds for five seconds, fills for two, and remains locked after release', () => {
  const boost = new BoostLatch();
  boost.setHeld('ShiftLeft', true);
  boost.update(5);
  assert.equal(boost.active, true); assert.equal(boost.progress, 0); assert.equal(boost.locked, false);
  boost.update(1);
  assert.equal(boost.progress, 0.5);
  boost.update(0);
  assert.equal(boost.progress, 0.5, 'pause cannot advance charge');
  boost.update(1);
  assert.equal(boost.progress, 1); assert.equal(boost.locked, true);
  boost.setHeld('ShiftLeft', false);
  assert.equal(boost.active, true);
  boost.update(20);
  boost.setHeld('pointer', true);
  assert.equal(boost.active, false); assert.equal(boost.locked, false);
  boost.update(10);
  assert.equal(boost.active, false, 'unlocking hold stays off until released');
  boost.setHeld('pointer', false); boost.setHeld('pointer', true);
  assert.equal(boost.active, true);
});

test('release cancels incomplete charge; repeat and overlapping sources do not unlock accidentally', () => {
  const boost = new BoostLatch();
  boost.setHeld('pointer', true); boost.update(6); boost.setHeld('pointer', false);
  assert.equal(boost.progress, 0); assert.equal(boost.active, false);
  boost.setHeld('ShiftLeft', true); boost.update(6);
  boost.setHeld('pointer', true); boost.setHeld('ShiftLeft', false); boost.update(1);
  assert.equal(boost.locked, true);
  boost.setHeld('pointer', true);
  assert.equal(boost.locked, true, 'repeated keydown does not count as another tap');
  boost.releaseAll(); assert.equal(boost.locked, true, 'intentional lock survives focus loss');
  boost.reset(); assert.equal(boost.active, false); assert.equal(boost.progress, 0);
});
