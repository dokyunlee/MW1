begin;

-- New sessions use the 40-receipt pool. Existing 50-task sessions and responses remain intact.
update public.experiment_config
set numeric_value = 0.90,
    description = 'Operational research threshold. A completed worker must answer at least 90 percent of the session tasks correctly to be classified as NORMAL.',
    updated_at = clock_timestamp()
where config_key = 'inattentive_accuracy_threshold';

update public.experiment_config
set description = 'Non-blocking target time used as a separate research metric; it does not determine participant_status.',
    updated_at = clock_timestamp()
where config_key = 'task_time_limit_minutes';

alter table public.experiment_sessions
  add column if not exists experiment_version text;

update public.experiment_sessions
set experiment_version = case
  when total_tasks = 50 then 'receipt50_v1'
  else 'receipt40_v1'
end
where experiment_version is null;

alter table public.experiment_sessions
  alter column experiment_version set default 'receipt40_v1',
  alter column experiment_version set not null,
  alter column total_tasks set default 40;

alter table public.experiment_sessions
  drop constraint if exists experiment_sessions_total_tasks_check,
  drop constraint if exists experiment_sessions_attempted_tasks_check,
  drop constraint if exists experiment_sessions_correct_tasks_check,
  drop constraint if exists experiment_sessions_incorrect_tasks_check,
  drop constraint if exists experiment_sessions_current_index_check;

alter table public.experiment_sessions
  add constraint experiment_sessions_total_tasks_check
    check (total_tasks in (40, 50)),
  add constraint experiment_sessions_attempted_tasks_check
    check (attempted_tasks between 0 and total_tasks),
  add constraint experiment_sessions_correct_tasks_check
    check (correct_tasks between 0 and total_tasks),
  add constraint experiment_sessions_incorrect_tasks_check
    check (incorrect_tasks between 0 and total_tasks),
  add constraint experiment_sessions_current_index_check
    check (current_index between 0 and total_tasks);

create or replace function public.classify_participant(
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_task_accuracy numeric,
  p_threshold numeric,
  p_completion_time_ms bigint,
  p_time_limit_ms bigint
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_started_at is null then null
    when p_completed_at is null then 'DROPOUT'
    when p_task_accuracy < p_threshold then 'INATTENTIVE'
    else 'NORMAL'
  end;
$$;

create or replace function public.start_experiment_session(
  p_session_id uuid,
  p_receipt_order jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.experiment_sessions%rowtype;
  v_started_at timestamptz := clock_timestamp();
  v_item_count integer;
  v_unique_count integer;
begin
  if jsonb_typeof(p_receipt_order) <> 'array' then
    raise exception 'Receipt order must be an array';
  end if;

  select count(*), count(distinct value)
  into v_item_count, v_unique_count
  from jsonb_array_elements_text(p_receipt_order);

  if v_item_count <> 40 or v_unique_count <> 40 then
    raise exception 'Receipt order must contain 40 unique eligible items';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(p_receipt_order) as item(value)
    where item.value !~ '^receipt_(0[1-9]|[1-4][0-9]|50)$'
       or item.value in (
         'receipt_01',
         'receipt_19',
         'receipt_23',
         'receipt_27',
         'receipt_33',
         'receipt_35',
         'receipt_38',
         'receipt_41',
         'receipt_46',
         'receipt_47'
       )
  ) then
    raise exception 'Receipt order contains an ineligible receipt ID';
  end if;

  select * into v_session
  from public.experiment_sessions
  where session_id = p_session_id
  for update;

  if not found then
    raise exception 'Session not found';
  end if;

  if v_session.status <> 'opened' then
    return;
  end if;

  update public.experiment_sessions
  set status = 'started',
      participant_status = 'DROPOUT',
      started_at = v_started_at,
      last_seen_at = v_started_at,
      elapsed_time_ms = 0,
      time_limit_exceeded = false,
      total_tasks = v_item_count,
      experiment_version = 'receipt40_v1',
      receipt_order = p_receipt_order,
      current_index = 0,
      current_shown_at = null
  where session_id = p_session_id;
end;
$$;

create or replace function public.complete_experiment_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.experiment_sessions%rowtype;
  v_attempted integer;
  v_correct integer;
  v_incorrect integer;
  v_accuracy numeric;
  v_completed_at timestamptz := clock_timestamp();
  v_completion_time_ms bigint;
begin
  select * into v_session
  from public.experiment_sessions
  where session_id = p_session_id
  for update;

  if not found then
    raise exception 'Session not found';
  end if;

  if v_session.status = 'completed' then
    return;
  end if;

  if v_session.status <> 'started' or v_session.started_at is null then
    raise exception 'Session has not started';
  end if;

  select count(*)::integer,
         count(*) filter (where is_correct)::integer,
         count(*) filter (where not is_correct)::integer
  into v_attempted, v_correct, v_incorrect
  from public.experiment_responses
  where session_id = p_session_id;

  if v_attempted <> v_session.total_tasks then
    raise exception 'Exactly % responses are required for completion', v_session.total_tasks;
  end if;

  v_accuracy := v_correct::numeric / v_session.total_tasks;
  v_completion_time_ms := greatest(
    0,
    floor(extract(epoch from (v_completed_at - v_session.started_at)) * 1000)::bigint
  );

  update public.experiment_sessions
  set status = 'completed',
      completed_at = v_completed_at,
      last_seen_at = v_completed_at,
      completion_time_ms = v_completion_time_ms,
      elapsed_time_ms = v_completion_time_ms,
      time_limit_exceeded = v_completion_time_ms > public.get_task_time_limit_ms(),
      attempted_tasks = v_attempted,
      correct_tasks = v_correct,
      incorrect_tasks = v_incorrect,
      task_accuracy = v_accuracy,
      partial_accuracy = v_accuracy,
      current_index = v_session.total_tasks,
      current_shown_at = null,
      participant_status = public.classify_participant(
        v_session.started_at,
        v_completed_at,
        v_accuracy,
        public.get_inattentive_accuracy_threshold(),
        v_completion_time_ms,
        public.get_task_time_limit_ms()
      )
  where session_id = p_session_id;
end;
$$;

create or replace view public.worker_results
with (security_invoker = true)
as
select
  session_id,
  status,
  participant_status,
  attempted_tasks,
  correct_tasks,
  incorrect_tasks,
  task_accuracy,
  partial_accuracy,
  completion_time_ms,
  elapsed_time_ms,
  time_limit_exceeded,
  current_index,
  total_tasks,
  receipt_order,
  opened_at,
  started_at,
  completed_at,
  last_seen_at,
  created_at,
  updated_at,
  experiment_version
from public.experiment_sessions;

create or replace view public.normal_workers
with (security_invoker = true)
as
select
  session_id,
  task_accuracy as accuracy,
  completion_time_ms,
  elapsed_time_ms,
  time_limit_exceeded,
  correct_tasks as correct,
  incorrect_tasks as incorrect,
  started_at,
  completed_at,
  total_tasks,
  experiment_version
from public.experiment_sessions
where participant_status = 'NORMAL'
  and completed_at is not null;

create or replace view public.inattentive_workers
with (security_invoker = true)
as
select
  session_id,
  task_accuracy,
  correct_tasks,
  incorrect_tasks,
  completion_time_ms,
  elapsed_time_ms,
  time_limit_exceeded,
  started_at,
  completed_at,
  total_tasks,
  experiment_version
from public.experiment_sessions
where participant_status = 'INATTENTIVE'
  and completed_at is not null;

create or replace view public.dropout_workers
with (security_invoker = true)
as
select
  session_id,
  attempted_tasks,
  correct_tasks,
  incorrect_tasks,
  partial_accuracy,
  elapsed_time_ms,
  time_limit_exceeded,
  current_index,
  receipt_order,
  started_at,
  last_seen_at,
  total_tasks,
  experiment_version
from public.experiment_sessions
where participant_status = 'DROPOUT'
  and started_at is not null
  and completed_at is null;

create or replace view public.experiment_metrics
with (security_invoker = true)
as
select
  count(*) filter (where started_at is not null)::bigint as started_sessions,
  count(*) filter (where completed_at is not null)::bigint as completed_sessions,
  count(*) filter (where started_at is not null and completed_at is null)::bigint as dropout_sessions,
  count(*) filter (where participant_status = 'NORMAL')::bigint as normal_workers,
  count(*) filter (where participant_status = 'INATTENTIVE')::bigint as inattentive_workers,
  count(*) filter (where participant_status = 'DROPOUT')::bigint as dropout_workers,
  count(*) filter (where time_limit_exceeded)::bigint as workers_over_time_limit,
  (
    count(*) filter (where started_at is not null and completed_at is null)::numeric
    / nullif(count(*) filter (where started_at is not null), 0)
  ) as dropout_rate,
  avg(task_accuracy) filter (where completed_at is not null) as mean_task_accuracy,
  avg(task_accuracy) filter (where completed_at is not null) as mean_accuracy_completed,
  percentile_cont(0.5) within group (order by task_accuracy)
    filter (where completed_at is not null) as median_task_accuracy,
  avg(task_accuracy) filter (where participant_status = 'NORMAL') as mean_accuracy_normal,
  avg(task_accuracy) filter (where participant_status = 'INATTENTIVE') as mean_accuracy_inattentive,
  avg(completion_time_ms) filter (where completed_at is not null) as mean_completion_time_ms,
  avg(elapsed_time_ms) filter (where started_at is not null) as mean_elapsed_time_ms_started,
  percentile_cont(0.5) within group (order by completion_time_ms)
    filter (where completed_at is not null) as median_completion_time_ms
from public.experiment_sessions;

comment on column public.experiment_sessions.experiment_version is
  'receipt40_v1 for new 40-task sessions; receipt50_v1 preserves legacy 50-task session identity.';
comment on view public.normal_workers is
  'Completed workers with task_accuracy at or above the configured threshold.';
comment on view public.inattentive_workers is
  'Completed workers with task_accuracy below the configured threshold; elapsed time remains a separate metric.';
comment on view public.dropout_workers is
  'Sessions that started but have not completed. Partial accuracy is correct_tasks divided by attempted_tasks.';

revoke all on function public.classify_participant(timestamptz, timestamptz, numeric, numeric, bigint, bigint) from public, anon, authenticated;
revoke all on function public.start_experiment_session(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.complete_experiment_session(uuid) from public, anon, authenticated;

grant execute on function public.classify_participant(timestamptz, timestamptz, numeric, numeric, bigint, bigint) to service_role;
grant execute on function public.start_experiment_session(uuid, jsonb) to service_role;
grant execute on function public.complete_experiment_session(uuid) to service_role;

commit;
