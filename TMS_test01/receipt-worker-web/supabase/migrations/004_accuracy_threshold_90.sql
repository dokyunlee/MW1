begin;

insert into public.experiment_config (config_key, numeric_value, description)
values (
  'inattentive_accuracy_threshold',
  0.90,
  'Operational research threshold. A completed worker must answer at least 45 of 50 tasks correctly to be eligible for NORMAL classification.'
)
on conflict (config_key) do update
set numeric_value = 0.90,
    description = excluded.description,
    updated_at = clock_timestamp();

-- Reapply the new boundary to existing rows without deleting raw responses.
update public.experiment_sessions
set participant_status = public.classify_participant(
  started_at,
  completed_at,
  task_accuracy,
  public.get_inattentive_accuracy_threshold(),
  completion_time_ms,
  public.get_task_time_limit_ms()
);

commit;
