create table if not exists public.registration_runs (
  id uuid primary key default gen_random_uuid(),
  league text not null check (league in ('mens', 'womens')),
  event_date date not null,
  status text not null check (status in ('started', 'completed', 'failed')),
  task_count integer not null default 0,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  unique (league, event_date)
);

create index if not exists registration_runs_league_event_date_idx
  on public.registration_runs (league, event_date desc);

create or replace function public.set_registration_runs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_registration_runs_updated_at on public.registration_runs;

create trigger set_registration_runs_updated_at
before update on public.registration_runs
for each row
execute function public.set_registration_runs_updated_at();

alter table public.registration_runs enable row level security;

drop policy if exists "Allow service role full access to registration runs" on public.registration_runs;
create policy "Allow service role full access to registration runs"
  on public.registration_runs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Allow admins to read registration runs" on public.registration_runs;
create policy "Allow admins to read registration runs"
  on public.registration_runs
  for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (profiles.is_admin = true or profiles.is_system_admin = true)
    )
  );
