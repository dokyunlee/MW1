import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ALL_RECEIPT_COUNT, EXCLUDED_RECEIPT_IDS, TOTAL_TASKS } from '../lib/constants';
import { getEligibleReceipts } from '../lib/server/eligibility';

async function main() {
  const root = path.resolve(import.meta.dirname, '..');
  const receiptDirectory = path.join(root, 'public', 'receipts');
  const answerKeyPath = path.join(root, 'server', 'answer-key.json');
  const receiptFiles = (await readdir(receiptDirectory))
    .filter((file) => /^receipt_en_\d{2}\.png$/.test(file))
    .sort();
  const rows = JSON.parse(await readFile(answerKeyPath, 'utf8')) as Array<Record<string, unknown>>;
  const keyFiles = rows.map((row) => String(row.receipt)).sort();

  assert.equal(receiptFiles.length, ALL_RECEIPT_COUNT, 'Expected exactly 50 public receipt images');
  assert.equal(rows.length, ALL_RECEIPT_COUNT, 'Expected exactly 50 answer-key rows');
  assert.deepEqual(receiptFiles, keyFiles, 'Receipt image set and answer key must match');

  const eligibleRows = getEligibleReceipts(
    rows.map((row) => ({
      receiptId: String(row.receipt).replace(/^receipt_en_/, 'receipt_').replace(/\.png$/i, ''),
    })),
  );
  assert.equal(eligibleRows.length, TOTAL_TASKS, 'Expected exactly 40 eligible receipts');
  for (const excludedId of EXCLUDED_RECEIPT_IDS) {
    assert.equal(eligibleRows.some((row) => row.receiptId === excludedId), false, excludedId);
  }

  console.log('Verified: 50 source assets and answer keys; 40 eligible receipts; 10 excluded.');
}

void main();
