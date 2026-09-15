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
