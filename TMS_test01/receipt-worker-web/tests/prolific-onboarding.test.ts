import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { normalizeProlificParticipantId } from '../lib/prolific-participant-id';

const projectRoot = path.resolve(import.meta.dirname, '..');

test('Prolific Participant IDs are required and normalized on the server', () => {
  assert.equal(normalizeProlificParticipantId(undefined), null);
  assert.equal(normalizeProlificParticipantId(''), null);
  assert.equal(normalizeProlificParticipantId('   \n\t  '), null);
  assert.equal(normalizeProlificParticipantId('  participant_123  '), 'participant_123');
});

test('start API rejects missing IDs and sends the normalized ID to the atomic start RPC', async () => {
  const source = await readFile(
    path.join(projectRoot, 'app', 'api', 'session', 'start', 'route.ts'),
    'utf8',
  );

  assert.match(source, /normalizeProlificParticipantId\(body\.prolificParticipantId\)/);
  assert.match(source, /Prolific Participant ID is required\./);
  assert.match(source, /p_prolific_participant_id: prolificParticipantId/);
  assert.match(source, /if \(session\.status === 'opened'\)/);
});

test('onboarding separates requester and instructions and conditionally renders Start task', async () => {
  const source = await readFile(
    path.join(projectRoot, 'components', 'receipt-task-app.tsx'),
    'utf8',
  );

  assert.match(source, /type Phase = 'loading' \| 'requester' \| 'instructions' \| 'task'/);
  assert.match(source, /setPhase\('requester'\)/);
  assert.match(source, /onClick=\{\(\) => setPhase\('instructions'\)\}/);
  assert.match(source, /const hasParticipantId = prolificParticipantId\.trim\(\)\.length > 0/);
  assert.match(source, /\{hasParticipantId && \(/);
  assert.match(source, /prolificParticipantId: normalizedParticipantId/);
  assert.doesNotMatch(source, /type Phase = [^;]*'intro'/);
});

test('migration stores the ID only while atomically starting an opened session and exposes it in result views', async () => {
  const source = await readFile(
    path.join(projectRoot, 'supabase', 'migrations', '006_prolific_participant_id.sql'),
    'utf8',
  );

  assert.match(source, /add column if not exists prolific_participant_id text/);
  assert.match(source, /v_prolific_participant_id text := trim\(p_prolific_participant_id\)/);
  assert.match(source, /if v_session\.status <> 'opened' then\s+return;/);
  assert.match(source, /set status = 'started',\s+prolific_participant_id = v_prolific_participant_id,/);
  assert.match(source, /started_at = v_started_at/);

  for (const viewName of ['worker_results', 'normal_workers', 'inattentive_workers', 'dropout_workers']) {
    const viewStart = source.indexOf(`view public.${viewName}`);
    assert.notEqual(viewStart, -1);
    assert.match(source.slice(viewStart), /prolific_participant_id/);
  }
});
