import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '..');

test('all 50 receipt files match 50 unique answer-key rows', async () => {
  const files = (await readdir(path.join(projectRoot, 'public', 'receipts')))
    .filter((file) => /^receipt_en_\d{2}\.png$/.test(file))
    .sort();
  const key = JSON.parse(
    await readFile(path.join(projectRoot, 'server', 'answer-key.json'), 'utf8'),
  ) as Array<Record<string, unknown>>;
  const keyedFiles = key.map((row) => String(row.receipt)).sort();

  assert.equal(files.length, 50);
  assert.equal(new Set(keyedFiles).size, 50);
  assert.deepEqual(files, keyedFiles);
});

test('the English answer key maps to stable internal receipt IDs', async () => {
  const answerKeySource = await readFile(
    path.join(projectRoot, 'lib', 'server', 'answer-key.ts'),
    'utf8',
  );

  assert.match(answerKeySource, /replace\(\/\^receipt_en_\//);
  assert.match(answerKeySource, /row\.question/);
  assert.match(answerKeySource, /answerGroup as \{ answer: unknown \}/);
});

test('answer key is outside public and never imported by a Client Component', async () => {
  const publicFiles = await readdir(path.join(projectRoot, 'public'));
  assert.equal(publicFiles.includes('answer-key.json'), false);
  assert.equal(publicFiles.includes('answer_key.json'), false);

  const clientSource = await readFile(
    path.join(projectRoot, 'components', 'receipt-task-app.tsx'),
    'utf8',
  );
  assert.doesNotMatch(clientSource, /answer[-_]key|correctAnswer|isCorrect|is_correct/);
  assert.match(clientSource, /localStorage\.setItem\(SESSION_STORAGE_KEY, id\)/);
});

test('submit and complete API responses do not expose correctness or accuracy', async () => {
  const submitRoute = await readFile(
    path.join(projectRoot, 'app', 'api', 'task', 'submit', 'route.ts'),
    'utf8',
  );
  const completeRoute = await readFile(
    path.join(projectRoot, 'app', 'api', 'session', 'complete', 'route.ts'),
    'utf8',
  );

  assert.match(submitRoute, /\{ saved: true, hasMore:/);
  assert.match(completeRoute, /\{ completed: true \}/);
  assert.doesNotMatch(submitRoute, /noStoreJson\(\{[^}]*isCorrect/);
  assert.doesNotMatch(submitRoute, /noStoreJson\(\{[^}]*accuracy/);
  assert.doesNotMatch(completeRoute, /noStoreJson\(\{[^}]*accuracy/);
});

test('20-minute threshold never blocks task loading or submission', async () => {
  const currentRoute = await readFile(
    path.join(projectRoot, 'app', 'api', 'task', 'current', 'route.ts'),
    'utf8',
  );
  const submitRoute = await readFile(
    path.join(projectRoot, 'app', 'api', 'task', 'submit', 'route.ts'),
    'utf8',
  );
  const currentMigration = await readFile(
    path.join(
      projectRoot,
      'supabase',
      'migrations',
      '003_overtime_classification_and_elapsed_time.sql',
    ),
    'utf8',
  );

  assert.doesNotMatch(currentRoute, /status:\s*410|Task time limit expired/);
  assert.doesNotMatch(submitRoute, /status:\s*410|Task time limit expired|hasTimeLimitExceeded/);
  assert.doesNotMatch(currentMigration, /raise exception 'Task time limit expired'/);
  assert.match(currentMigration, /when p_completion_time_ms > p_time_limit_ms then 'INATTENTIVE'/);
  assert.match(currentMigration, /elapsed_time_ms = v_completion_time_ms/);
});

test('only completed workers with at least 90 percent accuracy can be normal', async () => {
  const initialMigration = await readFile(
    path.join(projectRoot, 'supabase', 'migrations', '001_receipt_experiment.sql'),
    'utf8',
  );
  const thresholdMigration = await readFile(
    path.join(projectRoot, 'supabase', 'migrations', '004_accuracy_threshold_90.sql'),
    'utf8',
  );

  assert.match(initialMigration, /'inattentive_accuracy_threshold',\s*0\.90/);
  assert.match(thresholdMigration, /numeric_value\s*=\s*0\.90/);
  assert.match(thresholdMigration, /set participant_status = public\.classify_participant/);
});

test('new Supabase secret keys are sent only as apikey headers', async () => {
  const supabaseClient = await readFile(
    path.join(projectRoot, 'lib', 'server', 'supabase.ts'),
    'utf8',
  );

  assert.match(supabaseClient, /serverKey\.startsWith\('sb_secret_'\)/);
  assert.match(supabaseClient, /headers\.set\('apikey', serverKey\)/);
  assert.doesNotMatch(supabaseClient, /NEXT_PUBLIC_/);
});
