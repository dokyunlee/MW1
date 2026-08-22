begin;

alter table public.experiment_sessions
  add column if not exists prolific_participant_id text;

comment on column public.experiment_sessions.prolific_participant_id is
  'Participant ID entered immediately before the experiment starts, used to match Prolific and experiment results.';

drop function if exists public.start_experiment_session(uuid, jsonb);

create function public.start_experiment_session(
  p_session_id uuid,
  p_receipt_order jsonb,
  p_prolific_participant_id text
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
  v_prolific_participant_id text := trim(p_prolific_participant_id);
begin
  if v_prolific_participant_id is null or v_prolific_participant_id = '' then
    raise exception 'Prolific Participant ID is required';
  end if;

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

  -- A retry or stale request must not replace the ID on an active/completed session.
  if v_session.status <> 'opened' then
    return;
  end if;

  update public.experiment_sessions
  set status = 'started',
      prolific_participant_id = v_prolific_participant_id,
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
  experiment_version,
  prolific_participant_id
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
  experiment_version,
  prolific_participant_id
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
  experiment_version,
  prolific_participant_id
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
  experiment_version,
  prolific_participant_id
from public.experiment_sessions
where participant_status = 'DROPOUT'
  and started_at is not null
  and completed_at is null;

revoke all on function public.start_experiment_session(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.start_experiment_session(uuid, jsonb, text) to service_role;

grant select on table public.worker_results to service_role;
grant select on table public.normal_workers to service_role;
grant select on table public.inattentive_workers to service_role;
grant select on table public.dropout_workers to service_role;

commit;
