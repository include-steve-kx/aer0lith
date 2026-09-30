import assert from 'node:assert/strict';
import test from 'node:test';
import { BoostLatch } from '../src/flight/BoostLatch.ts';
const tap = (b: BoostLatch, source = 'pointer') => { b.setHeld(source, true); b.setHeld(source, false); };

test('three quick presses lock across keyboard/touch; the next press unlocks until released', () => {
  const b = new BoostLatch();
  tap(b); b.update(.15); tap(b, 'ShiftLeft'); b.update(.15); tap(b);
  assert.equal(b.locked, true); assert.equal(b.active, true);
  b.update(20); b.setHeld('ShiftLeft', true);
  assert.equal(b.locked, false); assert.equal(b.active, false);
  b.update(20); assert.equal(b.active, false);
  b.setHeld('ShiftLeft', false); b.setHeld('ShiftLeft', true);
  assert.equal(b.active, true); assert.equal(b.locked, false);
});
test('long holds never lock, spaced taps expire, repeats and overlapping sources count once', () => {
  const b = new BoostLatch();
  b.setHeld('ShiftLeft', true); b.update(20);
  assert.equal(b.active, true); assert.equal(b.locked, false);
  b.setHeld('ShiftLeft', false);
  tap(b); b.update(.41); tap(b); assert.equal(b.locked, false);
  b.reset(); b.setHeld('ShiftLeft', true);
  for (let i=0;i<10;i++) b.setHeld('ShiftLeft', true);
  b.setHeld('pointer', true); b.setHeld('ShiftRight', true);
  assert.equal(b.locked, false);
  b.releaseAll(); tap(b); tap(b); assert.equal(b.locked, false);
  tap(b); assert.equal(b.locked, true);
});
test('pause cannot age tap window, focus clearing cancels partial taps, reset clears lock', () => {
  const b = new BoostLatch();
  tap(b); b.update(.3); tap(b); b.update(0); tap(b);
  assert.equal(b.locked, true);
  b.releaseAll(); assert.equal(b.locked, true);
  b.reset(); tap(b); tap(b); b.releaseAll(); tap(b);
  assert.equal(b.locked, false);
  b.reset(); assert.equal(b.active, false);
});
