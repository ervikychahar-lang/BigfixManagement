alter table if exists public.bigfix_action_results
  add column if not exists state text,
  add column if not exists line_number integer default 0,
  add column if not exists log_excerpt text;
