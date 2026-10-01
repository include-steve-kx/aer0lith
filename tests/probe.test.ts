import assert from 'node:assert/strict';
import test from 'node:test';
import { PROBE } from '../src/core/config.ts';
import { ProbeScheduler } from '../src/world/ProbeScheduler.ts';

test('probe scheduler fires within its interval and manual reset restarts the timer', () => {
  const scheduler = new ProbeScheduler(() => 0.5);
  const midpoint = (PROBE.minInterval + PROBE.maxInterval) / 2;

  assert.equal(scheduler.secondsUntilNext, midpoint);
  assert.equal(scheduler.update(midpoint - 0.01), false);
  scheduler.reset();
  assert.equal(scheduler.secondsUntilNext, midpoint);
  assert.equal(scheduler.update(midpoint), true);
});

test('probe scheduler pauses its countdown while automatic scanning is disabled', () => {
  const scheduler = new ProbeScheduler(() => 0.5);
  const midpoint = (PROBE.minInterval + PROBE.maxInterval) / 2;

  assert.equal(scheduler.update(midpoint * 2, false), false);
  assert.equal(scheduler.secondsUntilNext, midpoint);
  assert.equal(scheduler.update(midpoint - 0.01, true), false);
  assert.equal(scheduler.update(0.02, true), true);
});
