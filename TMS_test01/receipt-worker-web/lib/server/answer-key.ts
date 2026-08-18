import 'server-only';

import answerKeySource from '@/server/answer-key.json';
import { TOTAL_TASKS } from '@/lib/constants';

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

if (parsedRows.length !== TOTAL_TASKS) {
  throw new Error(`Expected ${TOTAL_TASKS} answer-key rows, received ${parsedRows.length}`);
}

const answerKeyMap = new Map(parsedRows.map((row) => [row.receiptId, row]));

if (answerKeyMap.size !== TOTAL_TASKS) {
  throw new Error('Answer key contains duplicate receipt IDs');
}

export function getReceiptIds(): string[] {
  return parsedRows.map((row) => row.receiptId);
}

export function getAnswerKey(receiptId: string): ServerAnswerKey | null {
  return answerKeyMap.get(receiptId) ?? null;
}
