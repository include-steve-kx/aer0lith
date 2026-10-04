import assert from 'node:assert/strict';
import test from 'node:test';
import { TravelDistance } from '../src/flight/TravelDistance.ts';

test('travel distance remains cumulative across render-origin-sized distances', () => {
  const distance = new TravelDistance();
  distance.reset({ x: 0, y: 0, z: 0 });
  distance.update({ x: 0, y: 0, z: 2048 });
  distance.update({ x: 0, y: 0, z: 2100 });
  assert.equal(distance.total, 2100);
});

test('reanchoring after a teleport does not manufacture distance', () => {
  const distance = new TravelDistance();
  distance.reset({ x: 0, y: 0, z: 0 });
  distance.update({ x: 3, y: 4, z: 0 });
  distance.reanchor({ x: 1000, y: 1000, z: 1000 });
  distance.update({ x: 1000, y: 1000, z: 1012 });
  assert.equal(distance.total, 17);
});

test('an invalid sample is ignored without poisoning later travel', () => {
  const distance = new TravelDistance();
  distance.reset({ x: 0, y: 0, z: 0 });
  distance.update({ x: Number.NaN, y: 0, z: 20 });
  distance.update({ x: 0, y: 0, z: 8 });
  assert.equal(distance.total, 8);
});
