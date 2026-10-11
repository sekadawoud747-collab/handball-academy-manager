-- Handball Academy Manager: secure cloud schema (separate ham_* tables)
-- Run in Supabase SQL Editor. This does not delete or modify existing academy_* tables.
create extension if not exists pgcrypto;

create table if not exists public.ham_teams (
  id text primary key,
  name text not null,
  coach_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.ham_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('manager','coach')),
  team_id text null references public.ham_teams(id) on delete set null,
  phone text,
  created_at timestamptz not null default now(),
  constraint ham_manager_no_team check (role <> 'manager' or team_id is null)
);
create table if not exists public.ham_players (
  id text primary key,
  name text not null,
  team_id text not null references public.ham_teams(id) on delete cascade,
  jersey_number text,
  created_at timestamptz not null default now()
);
create table if not exists public.ham_attendance (
  id text primary key,
  player_id text not null references public.ham_players(id) on delete cascade,
  team_id text not null references public.ham_teams(id) on delete cascade,
  attendance_date date not null,
  status text not null check (status in ('present','absent','excused')),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  unique(player_id, attendance_date)
);

create or replace function public.ham_is_manager()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.ham_profiles p where p.user_id = auth.uid() and p.role = 'manager'); $$;
create or replace function public.ham_my_team_id()
returns text language sql stable security definer set search_path = public
as $$ select p.team_id from public.ham_profiles p where p.user_id = auth.uid() and p.role = 'coach' limit 1; $$;
revoke all on function public.ham_is_manager() from public;
revoke all on function public.ham_my_team_id() from public;
grant execute on function public.ham_is_manager() to authenticated;
grant execute on function public.ham_my_team_id() to authenticated;

alter table public.ham_teams enable row level security;
alter table public.ham_profiles enable row level security;
alter table public.ham_players enable row level security;
alter table public.ham_attendance enable row level security;

drop policy if exists ham_teams_read on public.ham_teams;
create policy ham_teams_read on public.ham_teams for select to authenticated using (public.ham_is_manager() or id = public.ham_my_team_id());
drop policy if exists ham_teams_manager_write on public.ham_teams;
create policy ham_teams_manager_write on public.ham_teams for all to authenticated using (public.ham_is_manager()) with check (public.ham_is_manager());

drop policy if exists ham_profiles_read_self_or_manager on public.ham_profiles;
create policy ham_profiles_read_self_or_manager on public.ham_profiles for select to authenticated using (user_id = auth.uid() or public.ham_is_manager());
drop policy if exists ham_profiles_manager_write on public.ham_profiles;
create policy ham_profiles_manager_write on public.ham_profiles for all to authenticated using (public.ham_is_manager()) with check (public.ham_is_manager());

drop policy if exists ham_players_read_team on public.ham_players;
create policy ham_players_read_team on public.ham_players for select to authenticated using (public.ham_is_manager() or team_id = public.ham_my_team_id());
drop policy if exists ham_players_manager_write on public.ham_players;
create policy ham_players_manager_write on public.ham_players for all to authenticated using (public.ham_is_manager()) with check (public.ham_is_manager());

drop policy if exists ham_attendance_read_team on public.ham_attendance;
create policy ham_attendance_read_team on public.ham_attendance for select to authenticated using (public.ham_is_manager() or team_id = public.ham_my_team_id());
drop policy if exists ham_attendance_write_team on public.ham_attendance;
create policy ham_attendance_write_team on public.ham_attendance for insert to authenticated with check ((public.ham_is_manager() or team_id = public.ham_my_team_id()) and updated_by = auth.uid());
drop policy if exists ham_attendance_update_team on public.ham_attendance;
create policy ham_attendance_update_team on public.ham_attendance for update to authenticated using (public.ham_is_manager() or team_id = public.ham_my_team_id()) with check ((public.ham_is_manager() or team_id = public.ham_my_team_id()) and updated_by = auth.uid());
drop policy if exists ham_attendance_delete_team on public.ham_attendance;
create policy ham_attendance_delete_team on public.ham_attendance for delete to authenticated using (public.ham_is_manager() or team_id = public.ham_my_team_id());

grant select, insert, update, delete on public.ham_teams, public.ham_profiles, public.ham_players, public.ham_attendance to authenticated;
