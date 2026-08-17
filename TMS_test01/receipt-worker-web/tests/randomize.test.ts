import assert from 'node:assert/strict';
import test from 'node:test';
import { fisherYatesShuffle } from '../lib/server/randomize';

test('Fisher-Yates keeps every item exactly once and does not mutate input', () => {
  const source = Array.from({ length: 50 }, (_, index) => `receipt_${String(index + 1).padStart(2, '0')}`);
  const before = [...source];
  const shuffled = fisherYatesShuffle(source);

  assert.deepEqual(source, before);
  assert.equal(shuffled.length, 50);
  assert.deepEqual([...shuffled].sort(), [...source].sort());
});

test('independent shuffles are not fixed to one global order', () => {
  const source = Array.from({ length: 50 }, (_, index) => index);
  const orders = new Set(Array.from({ length: 5 }, () => fisherYatesShuffle(source).join(',')));
  assert.ok(orders.size > 1);
});
