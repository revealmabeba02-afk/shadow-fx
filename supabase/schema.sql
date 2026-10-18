-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- (Safe to run again — uses create/replace and "if not exists" throughout.)
--
-- Shadow FX core schema: profiles (with VIP flag), Signal Center notes, and
-- Learning Hub progress. Built on the same Node/Express + Supabase pattern
-- as Vertex Chart Scanner.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  is_vip boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create index if not exists profiles_email_idx on public.profiles (email);

create table if not exists public.signal_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pair text not null default 'XAUUSD',
  notes text not null,
  created_at timestamptz not null default now()
);
alter table public.signal_notes enable row level security;
create index if not exists signal_notes_user_idx on public.signal_notes (user_id, created_at desc);

create table if not exists public.learning_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_slug text not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_slug)
);
alter table public.learning_progress enable row level security;

-- RLS policies
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = user_id);

drop policy if exists "manage own signal notes" on public.signal_notes;
create policy "manage own signal notes" on public.signal_notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "manage own learning progress" on public.learning_progress;
create policy "manage own learning progress" on public.learning_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Supabase does not allow a trigger on auth.users from this tooling, so a
-- profile row is created lazily: the app calls ensure_profile() once right
-- after login instead of relying on a signup trigger.
create or replace function public.ensure_profile()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email)
  values (auth.uid(), auth.jwt() ->> 'email')
  on conflict (user_id) do nothing;
end;
$$;
revoke all on function public.ensure_profile() from public;
grant execute on function public.ensure_profile() to authenticated;

create or replace function public.my_vip_status()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_vip from public.profiles where user_id = auth.uid()), false);
$$;
revoke all on function public.my_vip_status() from public;
grant execute on function public.my_vip_status() to authenticated;
