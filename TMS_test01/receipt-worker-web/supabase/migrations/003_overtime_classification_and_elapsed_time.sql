begin;

-- Apply after the previously deployed migrations.
-- Twenty minutes is a classification threshold, not a submission deadline.

insert into public.experiment_config (config_key, numeric_value, description)
values (
  'task_time_limit_minutes',
  20,
  'Operational classification threshold. Workers may continue after this time, but completed sessions above it are classified as potentially inattentive.'
)
on conflict (config_key) do update
set numeric_value = excluded.numeric_value,
    description = excluded.description,
    updated_at = clock_timestamp();

alter table public.experiment_sessions
  add column if not exists elapsed_time_ms bigint,
  add column if not exists time_limit_exceeded boolean not null default false;

alter table public.experiment_sessions
  drop constraint if exists experiment_sessions_elapsed_time_nonnegative;
alter table public.experiment_sessions
  add constraint experiment_sessions_elapsed_time_nonnegative
  check (elapsed_time_ms is null or elapsed_time_ms >= 0);

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
    when p_completion_time_ms > p_time_limit_ms then 'INATTENTIVE'
    when p_task_accuracy < p_threshold then 'INATTENTIVE'
    else 'NORMAL'
  end;
$$;

create or replace function public.get_task_time_limit_ms()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (numeric_value * 60 * 1000)::bigint
  from public.experiment_config
  where config_key = 'task_time_limit_minutes';
$$;

update public.experiment_sessions
set elapsed_time_ms = case
      when started_at is null then null
      when completed_at is not null then completion_time_ms
      else greatest(0, floor(extract(epoch from (last_seen_at - started_at)) * 1000)::bigint)
    end,
    time_limit_exceeded = case
      when started_at is null then false
      when completed_at is not null then completion_time_ms > public.get_task_time_limit_ms()
      else last_seen_at > started_at + (public.get_task_time_limit_ms() * interval '1 millisecond')
    end;

update public.experiment_sessions
set participant_status = public.classify_participant(
  started_at,
  completed_at,
  task_accuracy,
  public.get_inattentive_accuracy_threshold(),
  completion_time_ms,
  public.get_task_time_limit_ms()
);

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

  if v_item_count <> 50 or v_unique_count <> 50 then
    raise exception 'Receipt order must contain 50 unique items';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(p_receipt_order) as item(value)
    where item.value !~ '^receipt_(0[1-9]|[1-4][0-9]|50)$'
  ) then
    raise exception 'Receipt order contains an invalid receipt ID';
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
      receipt_order = p_receipt_order,
      current_index = 0,
      current_shown_at = null
  where session_id = p_session_id;
end;
$$;

create or replace function public.touch_experiment_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  update public.experiment_sessions
  set last_seen_at = v_now,
      elapsed_time_ms = case
        when started_at is null then null
        when completed_at is not null then completion_time_ms
        else greatest(0, floor(extract(epoch from (v_now - started_at)) * 1000)::bigint)
      end,
      time_limit_exceeded = case
        when started_at is null then false
        when completed_at is not null then completion_time_ms > public.get_task_time_limit_ms()
        else v_now > started_at + (public.get_task_time_limit_ms() * interval '1 millisecond')
      end
  where session_id = p_session_id;
end;
$$;

create or replace function public.mark_current_task_shown(p_session_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.experiment_sessions%rowtype;
  v_shown_at timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_session
  from public.experiment_sessions
  where session_id = p_session_id
  for update;

  if not found or v_session.status <> 'started' or v_session.current_index >= v_session.total_tasks then
    raise exception 'No current task is available';
  end if;

  v_shown_at := coalesce(v_session.current_shown_at, v_now);

  update public.experiment_sessions
  set current_shown_at = v_shown_at,
      last_seen_at = v_now,
      elapsed_time_ms = greatest(0, floor(extract(epoch from (v_now - v_session.started_at)) * 1000)::bigint),
      time_limit_exceeded = v_now > v_session.started_at + (public.get_task_time_limit_ms() * interval '1 millisecond')
  where session_id = p_session_id;

  return v_shown_at;
end;
$$;

create or replace function public.save_experiment_response(
  p_session_id uuid,
  p_receipt_id text,
  p_assigned_type text,
  p_worker_answer text,
  p_is_correct boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.experiment_sessions%rowtype;
  v_expected_receipt_id text;
  v_submitted_at timestamptz := clock_timestamp();
  v_shown_at timestamptz;
  v_response_time_ms bigint;
  v_new_index integer;
begin
  select * into v_session
  from public.experiment_sessions
  where session_id = p_session_id
  for update;

  if not found or v_session.status <> 'started' then
    raise exception 'Session is not active';
  end if;

  if v_session.current_index >= v_session.total_tasks then
    raise exception 'All tasks have already been submitted';
  end if;

  v_expected_receipt_id := v_session.receipt_order ->> v_session.current_index;
  if v_expected_receipt_id is null or v_expected_receipt_id <> p_receipt_id then
    raise exception 'Receipt is not the current task';
  end if;

  v_shown_at := coalesce(v_session.current_shown_at, v_submitted_at);
  v_response_time_ms := greatest(
    0,
    floor(extract(epoch from (v_submitted_at - v_shown_at)) * 1000)::bigint
  );

  insert into public.experiment_responses (
    session_id,
    receipt_id,
    presentation_index,
    assigned_type,
    worker_answer,
    is_correct,
    shown_at,
    submitted_at,
    response_time_ms
  ) values (
    p_session_id,
    p_receipt_id,
    v_session.current_index,
    p_assigned_type,
    btrim(p_worker_answer),
    p_is_correct,
    v_shown_at,
    v_submitted_at,
    v_response_time_ms
  );

  v_new_index := v_session.current_index + 1;

  update public.experiment_sessions
  set attempted_tasks = v_session.attempted_tasks + 1,
      correct_tasks = v_session.correct_tasks + case when p_is_correct then 1 else 0 end,
      incorrect_tasks = v_session.incorrect_tasks + case when p_is_correct then 0 else 1 end,
      partial_accuracy = (
        v_session.correct_tasks + case when p_is_correct then 1 else 0 end
      )::numeric / (v_session.attempted_tasks + 1),
      current_index = v_new_index,
      current_shown_at = null,
      last_seen_at = v_submitted_at,
      elapsed_time_ms = greatest(0, floor(extract(epoch from (v_submitted_at - v_session.started_at)) * 1000)::bigint),
      time_limit_exceeded = v_submitted_at > v_session.started_at + (public.get_task_time_limit_ms() * interval '1 millisecond')
  where session_id = p_session_id;

  return v_new_index;
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
    raise exception 'Exactly 50 responses are required for completion';
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

-- The replaced session functions no longer reference the former signature.
drop function if exists public.classify_participant(timestamptz, timestamptz, numeric, numeric);

drop view if exists public.experiment_metrics;
drop view if exists public.dropout_workers;
drop view if exists public.inattentive_workers;
drop view if exists public.normal_workers;
drop view if exists public.worker_results;

create view public.worker_results
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
  updated_at
from public.experiment_sessions;

create view public.normal_workers
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
  completed_at
from public.experiment_sessions
where participant_status = 'NORMAL';

create view public.inattentive_workers
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
  completed_at
from public.experiment_sessions
where participant_status = 'INATTENTIVE';

create view public.dropout_workers
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
  last_seen_at
from public.experiment_sessions
where participant_status = 'DROPOUT';

create view public.experiment_metrics
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

comment on column public.experiment_sessions.elapsed_time_ms is
  'Persisted elapsed task time for every started session, refreshed by task loads, submissions, heartbeat, page hide, and completion.';
comment on column public.experiment_sessions.time_limit_exceeded is
  'True when elapsed task time is greater than the configured 20-minute operational threshold. It does not block task progress.';
comment on view public.inattentive_workers is
  'Completed workers below the accuracy threshold or above the time threshold; potentially inattentive operational classification only.';

revoke all on table public.worker_results from anon, authenticated;
revoke all on table public.normal_workers from anon, authenticated;
revoke all on table public.inattentive_workers from anon, authenticated;
revoke all on table public.dropout_workers from anon, authenticated;
revoke all on table public.experiment_metrics from anon, authenticated;

revoke all on function public.classify_participant(timestamptz, timestamptz, numeric, numeric, bigint, bigint) from public, anon, authenticated;
revoke all on function public.get_task_time_limit_ms() from public, anon, authenticated;
revoke all on function public.start_experiment_session(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.touch_experiment_session(uuid) from public, anon, authenticated;
revoke all on function public.mark_current_task_shown(uuid) from public, anon, authenticated;
revoke all on function public.save_experiment_response(uuid, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.complete_experiment_session(uuid) from public, anon, authenticated;

grant select on table public.worker_results to service_role;
grant select on table public.normal_workers to service_role;
grant select on table public.inattentive_workers to service_role;
grant select on table public.dropout_workers to service_role;
grant select on table public.experiment_metrics to service_role;
grant execute on function public.classify_participant(timestamptz, timestamptz, numeric, numeric, bigint, bigint) to service_role;
grant execute on function public.get_task_time_limit_ms() to service_role;
grant execute on function public.start_experiment_session(uuid, jsonb) to service_role;
grant execute on function public.touch_experiment_session(uuid) to service_role;
grant execute on function public.mark_current_task_shown(uuid) to service_role;
grant execute on function public.save_experiment_response(uuid, text, text, text, boolean) to service_role;
grant execute on function public.complete_experiment_session(uuid) to service_role;

commit;
