alter table public.members
  add column if not exists roster_email text,
  add column if not exists email_override text;

update public.members
set roster_email = email
where roster_email is null;

create index if not exists members_roster_email_idx on public.members (lower(roster_email));
create index if not exists members_email_override_idx on public.members (lower(email_override));
