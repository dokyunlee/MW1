import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getElapsedTimeSeconds,
  getTimeRemainingSeconds,
  hasTimeLimitExceeded,
} from '../lib/server/time-limit';

test('20-minute timer starts at 1200 seconds', () => {
  const startedAt = '2026-08-13T06:00:00.000Z';
  assert.equal(getTimeRemainingSeconds(startedAt, Date.parse(startedAt)), 1200);
});

test('timer resumes from server started_at after refresh', () => {
  const startedAt = '2026-08-13T06:00:00.000Z';
  const elevenMinutesLater = Date.parse(startedAt) + 11 * 60 * 1000;
  assert.equal(getTimeRemainingSeconds(startedAt, elevenMinutesLater), 540);
  assert.equal(getElapsedTimeSeconds(startedAt, elevenMinutesLater), 660);
});

test('20 minutes is a non-blocking target and never produces a negative timer', () => {
  const startedAt = '2026-08-13T06:00:00.000Z';
  const deadline = Date.parse(startedAt) + 20 * 60 * 1000;
  assert.equal(getTimeRemainingSeconds(startedAt, deadline), 0);
  assert.equal(getTimeRemainingSeconds(startedAt, deadline + 60_000), 0);
  assert.equal(hasTimeLimitExceeded(startedAt, deadline), false);
  assert.equal(hasTimeLimitExceeded(startedAt, deadline + 1), true);
  assert.equal(getElapsedTimeSeconds(startedAt, deadline + 60_000), 1260);
});
