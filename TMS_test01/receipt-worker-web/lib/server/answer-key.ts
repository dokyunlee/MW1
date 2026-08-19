import 'server-only';

import answerKeySource from '@/server/answer-key.json';
import { ALL_RECEIPT_COUNT, TOTAL_TASKS } from '@/lib/constants';
import { getEligibleReceipts } from '@/lib/server/eligibility';

type RawAnswerKeyRow = {
  receipt: string;
  assigned_type: string;
  question: string;
  [key: string]: unknown;
};

export type ServerAnswerKey = {
  receiptId: string;
  fileName: string;
  assignedType: string;
  question: string;
  correctAnswer: string | number;
};

function parseRow(row: RawAnswerKeyRow): ServerAnswerKey {
  const answerGroup = row[row.assigned_type];
  if (!answerGroup || typeof answerGroup !== 'object' || !('answer' in answerGroup)) {
    throw new Error(`Answer key is missing an answer for ${row.receipt}`);
  }

  const correctAnswer = (answerGroup as { answer: unknown }).answer;
  if (typeof correctAnswer !== 'string' && typeof correctAnswer !== 'number') {
    throw new Error(`Answer key has an invalid answer for ${row.receipt}`);
  }

  return {
    receiptId: row.receipt.replace(/^receipt_en_/, 'receipt_').replace(/\.png$/i, ''),
    fileName: row.receipt,
    assignedType: row.assigned_type,
    question: row.question,
    correctAnswer,
  };
}

const parsedRows = (answerKeySource as RawAnswerKeyRow[]).map(parseRow);

if (parsedRows.length !== ALL_RECEIPT_COUNT) {
  throw new Error(`Expected ${ALL_RECEIPT_COUNT} answer-key rows, received ${parsedRows.length}`);
}

const answerKeyMap = new Map(parsedRows.map((row) => [row.receiptId, row]));

if (answerKeyMap.size !== ALL_RECEIPT_COUNT) {
  throw new Error('Answer key contains duplicate receipt IDs');
}

const eligibleRows = getEligibleReceipts(parsedRows);

if (eligibleRows.length !== TOTAL_TASKS) {
  throw new Error(`Expected ${TOTAL_TASKS} eligible receipts, received ${eligibleRows.length}`);
}

export function getEligibleReceiptIds(): string[] {
  return eligibleRows.map((row) => row.receiptId);
}

export function getAnswerKey(receiptId: string): ServerAnswerKey | null {
  return answerKeyMap.get(receiptId) ?? null;
}
