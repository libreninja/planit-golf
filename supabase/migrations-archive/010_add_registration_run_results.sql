create table if not exists public.registration_run_results (
  id uuid primary key default gen_random_uuid(),
  league text not null check (league in ('mens', 'womens')),
  event_date date not null,
  player_name text not null,
  player_member_id text not null,
  run_order integer not null default 0,
  attempted_times text[] not null default '{}'::text[],
  reserved_time text,
  success boolean not null default false,
  error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league, event_date, player_name)
);

create index if not exists registration_run_results_league_event_date_idx
  on public.registration_run_results (league, event_date desc, run_order asc);

create or replace function public.set_registration_run_results_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_registration_run_results_updated_at on public.registration_run_results;

create trigger set_registration_run_results_updated_at
before update on public.registration_run_results
for each row
execute function public.set_registration_run_results_updated_at();

alter table public.registration_run_results enable row level security;

drop policy if exists "Allow service role full access to registration run results" on public.registration_run_results;
create policy "Allow service role full access to registration run results"
  on public.registration_run_results
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Allow admins to read registration run results" on public.registration_run_results;
create policy "Allow admins to read registration run results"
  on public.registration_run_results
  for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (profiles.is_admin = true or profiles.is_system_admin = true)
    )
  );
