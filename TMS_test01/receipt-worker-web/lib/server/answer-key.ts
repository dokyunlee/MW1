import 'server-only';

import answerKeySource from '@/server/answer-key.json';
import { TOTAL_TASKS } from '@/lib/constants';

type RawAnswerKeyRow = {
  영수증: string;
  배정_type: string;
  질문: string;
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
  const answerGroup = row[row.배정_type];
  if (!answerGroup || typeof answerGroup !== 'object' || !('정답' in answerGroup)) {
    throw new Error(`Answer key is missing an answer for ${row.영수증}`);
  }

  const correctAnswer = (answerGroup as { 정답: unknown }).정답;
  if (typeof correctAnswer !== 'string' && typeof correctAnswer !== 'number') {
    throw new Error(`Answer key has an invalid answer for ${row.영수증}`);
  }

  return {
    receiptId: row.영수증.replace(/\.png$/i, ''),
    fileName: row.영수증,
    assignedType: row.배정_type,
    question: row.질문,
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
