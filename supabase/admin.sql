-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- (Safe to run again.)
--
-- Admin-only functions, gated to King's email, mirroring the pattern used
-- across Vertex's admin routes.

create or replace function public.admin_set_vip(p_email text, p_vip boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if (auth.jwt() ->> 'email') is distinct from 'revealmabeba02@gmail.com' then
    raise exception 'Not authorized';
  end if;
  update public.profiles set is_vip = p_vip where email = p_email;
  return found;
end;
$$;
revoke all on function public.admin_set_vip(text, boolean) from public;
grant execute on function public.admin_set_vip(text, boolean) to authenticated;

create or replace function public.admin_list_users()
returns table (email text, is_vip boolean, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if (auth.jwt() ->> 'email') is distinct from 'revealmabeba02@gmail.com' then
    raise exception 'Not authorized';
  end if;
  return query select p.email, p.is_vip, p.created_at from public.profiles p order by p.created_at desc;
end;
$$;
revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;
