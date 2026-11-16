-- ══════════════════════════════════════════════════════════════
-- X-ORBIT Long Haul — cloud saves (one journey per account)
-- Run this once in the Supabase SQL editor, after longhaul-career-setup.sql. Safe to run again.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.longhaul_saves (
    username  text primary key,
    trip      uuid,
    data      jsonb       not null,
    saved_at  timestamptz not null default now()
);

-- No policies: the table is only reached through the functions below
alter table public.longhaul_saves enable row level security;

-- Stores the player's journey, replacing the one before. Saves over 1.5 MB are refused.
create or replace function public.longhaul_put_save(p_username text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_trip text := p_data->>'tripId';
begin
    if p_username is null or p_data is null or jsonb_typeof(p_data) <> 'object'
       or length(p_data::text) > 1500000
       or not exists (select 1 from public.clients where username = p_username) then
        return;
    end if;

    insert into public.longhaul_saves as s (username, trip, data, saved_at)
    values (p_username,
            case when v_trip ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_trip::uuid end,
            p_data, now())
    on conflict (username) do update
        set trip = excluded.trip, data = excluded.data, saved_at = now();
end;
$$;

-- → { data, saved_at } or null
create or replace function public.longhaul_get_save(p_username text)
returns jsonb
language sql
security definer
set search_path = public
as $$
    select jsonb_build_object('data', data, 'saved_at', saved_at)
    from public.longhaul_saves where username = p_username;
$$;

-- Removes the saved journey once it has ended – only if it is still that journey
create or replace function public.longhaul_drop_save(p_username text, p_trip uuid)
returns void
language sql
security definer
set search_path = public
as $$
    delete from public.longhaul_saves where username = p_username and trip = p_trip;
$$;

grant execute on function public.longhaul_put_save(text, jsonb) to anon, authenticated;
grant execute on function public.longhaul_get_save(text) to anon, authenticated;
grant execute on function public.longhaul_drop_save(text, uuid) to anon, authenticated;
