import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const root = path.resolve(import.meta.dirname, '..');
  const receiptDirectory = path.join(root, 'public', 'receipts');
  const answerKeyPath = path.join(root, 'server', 'answer-key.json');
  const receiptFiles = (await readdir(receiptDirectory))
    .filter((file) => /^receipt_\d{2}\.png$/.test(file))
    .sort();
  const rows = JSON.parse(await readFile(answerKeyPath, 'utf8')) as Array<Record<string, unknown>>;
  const keyFiles = rows.map((row) => String(row['영수증'])).sort();

  assert.equal(receiptFiles.length, 50, 'Expected exactly 50 public receipt images');
  assert.equal(rows.length, 50, 'Expected exactly 50 answer-key rows');
  assert.deepEqual(receiptFiles, keyFiles, 'Receipt image set and answer key must match');

  console.log('Verified: 50 receipt images, 50 unique matching answer-key rows.');
}

void main();
