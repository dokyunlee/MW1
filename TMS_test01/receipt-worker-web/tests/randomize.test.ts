import assert from 'node:assert/strict';
import test from 'node:test';
import { EXCLUDED_RECEIPT_IDS, TOTAL_TASKS } from '../lib/constants';
import { getEligibleReceipts } from '../lib/server/eligibility';
import { fisherYatesShuffle } from '../lib/server/randomize';

const allReceipts = Array.from({ length: 50 }, (_, index) => ({
  receiptId: `receipt_${String(index + 1).padStart(2, '0')}`,
}));
const eligibleReceiptIds = getEligibleReceipts(allReceipts).map((receipt) => receipt.receiptId);

test('eligible pool contains exactly 40 receipts and excludes the configured 10', () => {
  assert.equal(eligibleReceiptIds.length, TOTAL_TASKS);
  assert.equal(new Set(eligibleReceiptIds).size, TOTAL_TASKS);
  for (const excludedId of EXCLUDED_RECEIPT_IDS) {
    assert.equal(eligibleReceiptIds.includes(excludedId), false, excludedId);
  }
});

test('Fisher-Yates randomizes all 40 eligible receipts without mutation, omission, or duplication', () => {
  const source = [...eligibleReceiptIds];
  const before = [...source];
  const shuffled = fisherYatesShuffle(source);

  assert.deepEqual(source, before);
  assert.equal(shuffled.length, TOTAL_TASKS);
  assert.equal(new Set(shuffled).size, TOTAL_TASKS);
  assert.deepEqual([...shuffled].sort(), [...source].sort());
});

test('independent session shuffles are not fixed to one global order', () => {
  const orders = new Set(
    Array.from({ length: 5 }, () => fisherYatesShuffle(eligibleReceiptIds).join(',')),
  );
  assert.ok(orders.size > 1);
});
