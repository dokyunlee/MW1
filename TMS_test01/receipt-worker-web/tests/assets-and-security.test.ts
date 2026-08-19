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

test('20-minute target never blocks task loading, submission, or accuracy-only classification', async () => {
  const currentRoute = await readFile(
    path.join(projectRoot, 'app', 'api', 'task', 'current', 'route.ts'),
    'utf8',
  );
  const submitRoute = await readFile(
    path.join(projectRoot, 'app', 'api', 'task', 'submit', 'route.ts'),
    'utf8',
  );
  const receipt40Migration = await readFile(
    path.join(
      projectRoot,
      'supabase',
      'migrations',
      '005_receipt40_pool_and_classification.sql',
    ),
    'utf8',
  );

  assert.doesNotMatch(currentRoute, /status:\s*410|Task time limit expired/);
  assert.doesNotMatch(submitRoute, /status:\s*410|Task time limit expired|hasTimeLimitExceeded/);
  assert.doesNotMatch(receipt40Migration, /raise exception 'Task time limit expired'/);
  assert.doesNotMatch(receipt40Migration, /when p_completion_time_ms > p_time_limit_ms/);
  assert.match(receipt40Migration, /when p_task_accuracy < p_threshold then 'INATTENTIVE'/);
  assert.match(receipt40Migration, /elapsed_time_ms = v_completion_time_ms/);
});

test('Supabase migration enforces the 40-item eligible pool and preserves legacy 50-task rows', async () => {
  const receipt40Migration = await readFile(
    path.join(projectRoot, 'supabase', 'migrations', '005_receipt40_pool_and_classification.sql'),
    'utf8',
  );

  assert.match(receipt40Migration, /v_item_count <> 40 or v_unique_count <> 40/);
  assert.match(receipt40Migration, /total_tasks in \(40, 50\)/);
  assert.match(receipt40Migration, /alter column total_tasks set default 40/);
  assert.match(receipt40Migration, /experiment_version = 'receipt40_v1'/);
  for (const number of ['01', '19', '23', '27', '33', '35', '38', '41', '46', '47']) {
    assert.match(receipt40Migration, new RegExp(`'receipt_${number}'`));
  }
  assert.doesNotMatch(receipt40Migration, /update public\.experiment_sessions\s+set participant_status/);
});

test('research views use participant status and dynamic session totals', async () => {
  const receipt40Migration = await readFile(
    path.join(projectRoot, 'supabase', 'migrations', '005_receipt40_pool_and_classification.sql'),
    'utf8',
  );

  for (const viewName of ['worker_results', 'normal_workers', 'inattentive_workers', 'dropout_workers', 'experiment_metrics']) {
    assert.match(receipt40Migration, new RegExp(`view public\\.${viewName}`));
  }
  assert.match(receipt40Migration, /where participant_status = 'NORMAL'/);
  assert.match(receipt40Migration, /where participant_status = 'INATTENTIVE'/);
  assert.match(receipt40Migration, /where participant_status = 'DROPOUT'/);
  assert.match(receipt40Migration, /v_accuracy := v_correct::numeric \/ v_session\.total_tasks/);
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
