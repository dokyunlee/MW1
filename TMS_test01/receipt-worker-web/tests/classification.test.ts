import assert from 'node:assert/strict';
import test from 'node:test';
import { TOTAL_TASKS } from '../lib/constants';
import {
  calculateTaskAccuracy,
  classifyParticipant,
  getMinimumCorrectForNormal,
} from '../lib/server/classification';

const startedAt = '2026-08-19T00:00:00.000Z';
const completedAt = '2026-08-19T00:20:00.000Z';

test('40-task classification boundaries are 36 NORMAL and 35 INATTENTIVE', () => {
  assert.equal(TOTAL_TASKS, 40);
  assert.equal(getMinimumCorrectForNormal(TOTAL_TASKS), 36);
  assert.equal(calculateTaskAccuracy(36, TOTAL_TASKS), 0.9);
  assert.equal(calculateTaskAccuracy(35, TOTAL_TASKS), 0.875);
  assert.equal(classifyParticipant({ startedAt, completedAt, correctTasks: 36, totalTasks: 40 }), 'NORMAL');
  assert.equal(classifyParticipant({ startedAt, completedAt, correctTasks: 35, totalTasks: 40 }), 'INATTENTIVE');
  assert.equal(classifyParticipant({ startedAt, completedAt, correctTasks: 40, totalTasks: 40 }), 'NORMAL');
});

test('incomplete workers are DROPOUT regardless of partial accuracy', () => {
  assert.equal(
    classifyParticipant({ startedAt, completedAt: null, correctTasks: 35, totalTasks: 40 }),
    'DROPOUT',
  );
  assert.equal(
    classifyParticipant({ startedAt: null, completedAt: null, correctTasks: 0, totalTasks: 40 }),
    null,
  );
});
