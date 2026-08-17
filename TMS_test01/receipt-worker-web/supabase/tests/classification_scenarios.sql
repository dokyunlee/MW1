-- Run after the current migrations in a disposable/test project.
-- The transaction always rolls back, so no research rows are retained.
begin;

do $$
declare
  v_normal_id uuid := gen_random_uuid();
  v_inattentive_id uuid := gen_random_uuid();
  v_overtime_id uuid := gen_random_uuid();
  v_dropout_id uuid := gen_random_uuid();
  v_opened_id uuid := gen_random_uuid();
  v_order jsonb;
  v_row public.experiment_sessions%rowtype;
  i integer;
begin
  select jsonb_agg(format('receipt_%s', lpad(item::text, 2, '0')) order by item)
  into v_order
  from generate_series(1, 50) as items(item);

  insert into public.experiment_sessions (session_id)
  values (v_normal_id), (v_inattentive_id), (v_overtime_id), (v_dropout_id), (v_opened_id);

  -- Normal: 50 attempted, 45 correct, accuracy .90.
  perform public.start_experiment_session(v_normal_id, v_order);
  for i in 1..50 loop
    perform public.mark_current_task_shown(v_normal_id);
    perform public.save_experiment_response(
      v_normal_id,
      format('receipt_%s', lpad(i::text, 2, '0')),
      'type1',
      'test answer',
      i <= 45
    );
  end loop;
  perform public.complete_experiment_session(v_normal_id);

  select * into v_row from public.experiment_sessions where session_id = v_normal_id;
  if v_row.participant_status <> 'NORMAL'
     or v_row.task_accuracy <> 0.90
     or v_row.correct_tasks <> 45
     or v_row.incorrect_tasks <> 5
     or v_row.completion_time_ms is null
     or v_row.elapsed_time_ms <> v_row.completion_time_ms
     or v_row.time_limit_exceeded then
    raise exception 'NORMAL scenario failed: %', row_to_json(v_row);
  end if;

  -- Potentially inattentive: 50 attempted, 22 correct, accuracy .44.
  perform public.start_experiment_session(v_inattentive_id, v_order);
  for i in 1..50 loop
    perform public.mark_current_task_shown(v_inattentive_id);
    perform public.save_experiment_response(
      v_inattentive_id,
      format('receipt_%s', lpad(i::text, 2, '0')),
      'type1',
      'test answer',
      i <= 22
    );
  end loop;
  perform public.complete_experiment_session(v_inattentive_id);

  select * into v_row from public.experiment_sessions where session_id = v_inattentive_id;
  if v_row.participant_status <> 'INATTENTIVE'
     or v_row.task_accuracy <> 0.44
     or v_row.correct_tasks <> 22
     or v_row.incorrect_tasks <> 28 then
    raise exception 'INATTENTIVE scenario failed: %', row_to_json(v_row);
  end if;

  -- Overtime: all answers correct, but completion is after 20 minutes.
  -- The worker can still submit every task and is classified as INATTENTIVE.
  perform public.start_experiment_session(v_overtime_id, v_order);
  update public.experiment_sessions
  set started_at = clock_timestamp() - interval '21 minutes'
  where session_id = v_overtime_id;

  for i in 1..50 loop
    perform public.mark_current_task_shown(v_overtime_id);
    perform public.save_experiment_response(
      v_overtime_id,
      format('receipt_%s', lpad(i::text, 2, '0')),
      'type1',
      'test answer',
      true
    );
  end loop;
  perform public.complete_experiment_session(v_overtime_id);

  select * into v_row from public.experiment_sessions where session_id = v_overtime_id;
  if v_row.participant_status <> 'INATTENTIVE'
     or v_row.attempted_tasks <> 50
     or v_row.task_accuracy <> 1
     or not v_row.time_limit_exceeded
     or v_row.completion_time_ms <= 1200000
     or v_row.elapsed_time_ms <> v_row.completion_time_ms then
    raise exception 'OVERTIME scenario failed: %', row_to_json(v_row);
  end if;

  -- Dropout: 18 attempted, 11 correct, partial accuracy 11/18.
  perform public.start_experiment_session(v_dropout_id, v_order);
  for i in 1..18 loop
    perform public.mark_current_task_shown(v_dropout_id);
    perform public.save_experiment_response(
      v_dropout_id,
      format('receipt_%s', lpad(i::text, 2, '0')),
      'type1',
      'test answer',
      i <= 11
    );
  end loop;

  select * into v_row from public.experiment_sessions where session_id = v_dropout_id;
  if v_row.participant_status <> 'DROPOUT'
     or v_row.attempted_tasks <> 18
     or v_row.correct_tasks <> 11
     or abs(v_row.partial_accuracy - (11::numeric / 18)) > 0.0000001
     or v_row.elapsed_time_ms is null
     or v_row.completed_at is not null then
    raise exception 'DROPOUT scenario failed: %', row_to_json(v_row);
  end if;

  -- Opened only: not a classified participant and not a dropout.
  select * into v_row from public.experiment_sessions where session_id = v_opened_id;
  if v_row.started_at is not null or v_row.participant_status is not null then
    raise exception 'OPENED scenario failed: %', row_to_json(v_row);
  end if;

  raise notice 'All classification scenarios passed.';
end;
$$;

rollback;
