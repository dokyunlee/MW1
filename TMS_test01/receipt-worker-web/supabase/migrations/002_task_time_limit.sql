begin;

-- Historical migration: this previously enforced a hard 20-minute stop.
-- Do not apply it by itself. Existing deployments that ran this migration must
-- run 003_overtime_classification_and_elapsed_time.sql afterward.

create or replace function public.mark_current_task_shown(p_session_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.experiment_sessions%rowtype;
  v_shown_at timestamptz;
begin
  select * into v_session
  from public.experiment_sessions
  where session_id = p_session_id
  for update;

  if not found or v_session.status <> 'started' or v_session.current_index >= v_session.total_tasks then
    raise exception 'No current task is available';
  end if;

  if clock_timestamp() >= v_session.started_at + interval '20 minutes' then
    raise exception 'Task time limit expired';
  end if;

  v_shown_at := coalesce(v_session.current_shown_at, clock_timestamp());

  update public.experiment_sessions
  set current_shown_at = v_shown_at,
      last_seen_at = clock_timestamp()
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

  if v_submitted_at >= v_session.started_at + interval '20 minutes' then
    raise exception 'Task time limit expired';
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
      last_seen_at = v_submitted_at
  where session_id = p_session_id;

  return v_new_index;
end;
$$;

revoke all on function public.mark_current_task_shown(uuid) from public, anon, authenticated;
revoke all on function public.save_experiment_response(uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.mark_current_task_shown(uuid) to service_role;
grant execute on function public.save_experiment_response(uuid, text, text, text, boolean) to service_role;

commit;
