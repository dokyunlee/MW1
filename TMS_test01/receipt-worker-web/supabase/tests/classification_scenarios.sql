-- Run after migration 005 in a disposable/test project.
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
  v_receipt_id text;
  i integer;
begin
  select jsonb_agg(format('receipt_%s', lpad(item::text, 2, '0')) order by item)
  into v_order
  from generate_series(1, 50) as items(item)
  where item not in (1, 19, 23, 27, 33, 35, 38, 41, 46, 47);

  if jsonb_array_length(v_order) <> 40 then
    raise exception 'Eligible receipt pool must contain 40 items: %', v_order;
  end if;

  insert into public.experiment_sessions (session_id)
  values (v_normal_id), (v_inattentive_id), (v_overtime_id), (v_dropout_id), (v_opened_id);

  -- Normal boundary: 40 attempted, 36 correct, accuracy .90.
  perform public.start_experiment_session(v_normal_id, v_order);
  for i in 0..39 loop
    v_receipt_id := v_order ->> i;
    perform public.mark_current_task_shown(v_normal_id);
    perform public.save_experiment_response(
      v_normal_id,
      v_receipt_id,
      'type1',
      'test answer',
      i < 36
    );
  end loop;
  perform public.complete_experiment_session(v_normal_id);

  select * into v_row from public.experiment_sessions where session_id = v_normal_id;
  if v_row.participant_status <> 'NORMAL'
     or v_row.total_tasks <> 40
     or v_row.task_accuracy <> 0.90
     or v_row.correct_tasks <> 36
     or v_row.incorrect_tasks <> 4
     or v_row.experiment_version <> 'receipt40_v1'
     or v_row.completion_time_ms is null
     or v_row.elapsed_time_ms <> v_row.completion_time_ms then
    raise exception 'NORMAL scenario failed: %', row_to_json(v_row);
  end if;

  -- Inattentive boundary: 40 attempted, 35 correct, accuracy .875.
  perform public.start_experiment_session(v_inattentive_id, v_order);
  for i in 0..39 loop
    v_receipt_id := v_order ->> i;
    perform public.mark_current_task_shown(v_inattentive_id);
    perform public.save_experiment_response(
      v_inattentive_id,
      v_receipt_id,
      'type1',
      'test answer',
      i < 35
    );
  end loop;
  perform public.complete_experiment_session(v_inattentive_id);

  select * into v_row from public.experiment_sessions where session_id = v_inattentive_id;
  if v_row.participant_status <> 'INATTENTIVE'
     or v_row.task_accuracy <> 0.875
     or v_row.correct_tasks <> 35
     or v_row.incorrect_tasks <> 5 then
    raise exception 'INATTENTIVE scenario failed: %', row_to_json(v_row);
  end if;

  -- Elapsed time remains a metric, but 40/40 is NORMAL even after 20 minutes.
  perform public.start_experiment_session(v_overtime_id, v_order);
  update public.experiment_sessions
  set started_at = clock_timestamp() - interval '21 minutes'
  where session_id = v_overtime_id;

  for i in 0..39 loop
    v_receipt_id := v_order ->> i;
    perform public.mark_current_task_shown(v_overtime_id);
    perform public.save_experiment_response(
      v_overtime_id,
      v_receipt_id,
      'type1',
      'test answer',
      true
    );
  end loop;
  perform public.complete_experiment_session(v_overtime_id);

  select * into v_row from public.experiment_sessions where session_id = v_overtime_id;
  if v_row.participant_status <> 'NORMAL'
     or v_row.attempted_tasks <> 40
     or v_row.task_accuracy <> 1
     or not v_row.time_limit_exceeded
     or v_row.completion_time_ms <= 1200000
     or v_row.elapsed_time_ms <> v_row.completion_time_ms then
    raise exception 'OVERTIME METRIC scenario failed: %', row_to_json(v_row);
  end if;

  -- Dropout: 35 attempted. Partial accuracy is correct / attempted.
  perform public.start_experiment_session(v_dropout_id, v_order);
  for i in 0..34 loop
    v_receipt_id := v_order ->> i;
    perform public.mark_current_task_shown(v_dropout_id);
    perform public.save_experiment_response(
      v_dropout_id,
      v_receipt_id,
      'type1',
      'test answer',
      i < 30
    );
  end loop;

  select * into v_row from public.experiment_sessions where session_id = v_dropout_id;
  if v_row.participant_status <> 'DROPOUT'
     or v_row.attempted_tasks <> 35
     or v_row.correct_tasks <> 30
     or abs(v_row.partial_accuracy - (30::numeric / 35)) > 0.0000001
     or v_row.elapsed_time_ms is null
     or v_row.completed_at is not null then
    raise exception 'DROPOUT scenario failed: %', row_to_json(v_row);
  end if;

  -- Excluded receipts must not occur in any new-session order or response.
  if exists (
    select 1
    from public.experiment_sessions s,
         jsonb_array_elements_text(s.receipt_order) item
    where s.session_id in (v_normal_id, v_inattentive_id, v_overtime_id, v_dropout_id)
      and item.value in (
        'receipt_01', 'receipt_19', 'receipt_23', 'receipt_27', 'receipt_33',
        'receipt_35', 'receipt_38', 'receipt_41', 'receipt_46', 'receipt_47'
      )
  ) then
    raise exception 'Excluded receipt found in a new session order';
  end if;

  if exists (
    select 1
    from public.experiment_responses
    where session_id in (v_normal_id, v_inattentive_id, v_overtime_id, v_dropout_id)
      and receipt_id in (
        'receipt_01', 'receipt_19', 'receipt_23', 'receipt_27', 'receipt_33',
        'receipt_35', 'receipt_38', 'receipt_41', 'receipt_46', 'receipt_47'
      )
  ) then
    raise exception 'Excluded receipt response was created';
  end if;

  -- Opened only: not a classified participant and not a dropout.
  select * into v_row from public.experiment_sessions where session_id = v_opened_id;
  if v_row.started_at is not null or v_row.participant_status is not null then
    raise exception 'OPENED scenario failed: %', row_to_json(v_row);
  end if;

  raise notice 'All receipt40_v1 classification scenarios passed.';
end;
$$;

rollback;

