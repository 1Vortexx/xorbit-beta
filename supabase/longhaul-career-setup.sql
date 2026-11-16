-- ══════════════════════════════════════════════════════════════
-- X-ORBIT Long Haul — career stats, achievements and global leaderboard
-- Run this once in the Supabase SQL editor. Safe to run again.
-- ══════════════════════════════════════════════════════════════

-- One row per journey, keyed by an id the game makes when the journey starts.
-- The game reports a journey while it is played and once more when it ends.
create table if not exists public.longhaul_trips (
    id          uuid primary key,
    username    text             not null,
    distance_m  double precision not null default 0,
    days        integer          not null default 1,
    play_time   double precision not null default 0,     -- seconds actually played
    sites       integer          not null default 0,
    difficulty  text             not null default 'normal',
    hostile     boolean          not null default true,
    ended       boolean          not null default false,
    cause       text,
    created_at  timestamptz      not null default now(),
    updated_at  timestamptz      not null default now()
);
create index if not exists longhaul_trips_user_idx on public.longhaul_trips (username);
create index if not exists longhaul_trips_distance_idx on public.longhaul_trips (distance_m desc);

-- Achievements: { "<id>": "<unlocked at>" }
create table if not exists public.longhaul_players (
    username     text primary key,
    achievements jsonb       not null default '{}'::jsonb,
    updated_at   timestamptz not null default now()
);

-- Anyone can read; rows are only written through the functions below
alter table public.longhaul_trips   enable row level security;
alter table public.longhaul_players enable row level security;

drop policy if exists "longhaul_trips_read" on public.longhaul_trips;
create policy "longhaul_trips_read" on public.longhaul_trips for select using (true);
drop policy if exists "longhaul_players_read" on public.longhaul_players;
create policy "longhaul_players_read" on public.longhaul_players for select using (true);

-- Reports a journey's progress. Values only ever grow, a finished journey cannot be reopened,
-- and the numbers have to be physically possible:
--   distance  ≤ 75 m/s (270 km/h) for every second played
--   play time ≤ the real time passed since the last report (plus a minute of slack)
--   days      ≤ one per two minutes played (a day is 20 minutes; sleeping skips part of it)
create or replace function public.longhaul_report_trip(
    p_username   text,
    p_trip       uuid,
    p_distance   double precision,
    p_days       integer,
    p_play_time  double precision,
    p_sites      integer,
    p_difficulty text,
    p_hostile    boolean,
    p_ended      boolean,
    p_cause      text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_old   public.longhaul_trips%rowtype;
    v_play  double precision := greatest(0, least(coalesce(p_play_time, 0), 1000000));
    v_dist  double precision;
    v_days  integer          := greatest(1, least(coalesce(p_days, 1), 10000));
    v_sites integer          := greatest(0, least(coalesce(p_sites, 0), 100000));
    v_diff  text             := case when p_difficulty in ('easy', 'normal', 'hard') then p_difficulty else 'normal' end;
begin
    if p_username is null or p_trip is null
       or not exists (select 1 from public.clients where username = p_username) then
        return;
    end if;

    select * into v_old from public.longhaul_trips where id = p_trip;
    if found then
        if v_old.username <> p_username or v_old.ended then
            return;
        end if;
        v_play := least(v_play, v_old.play_time + extract(epoch from now() - v_old.updated_at) + 60);
        v_play := greatest(v_play, v_old.play_time);
    end if;

    v_dist := greatest(0, least(coalesce(p_distance, 0), v_play * 75));
    v_days := least(v_days, floor(v_play / 120)::integer + 2);

    insert into public.longhaul_trips as t
        (id, username, distance_m, days, play_time, sites, difficulty, hostile, ended, cause)
    values
        (p_trip, p_username, v_dist, v_days, v_play, v_sites, v_diff, coalesce(p_hostile, true),
         coalesce(p_ended, false), left(p_cause, 80))
    on conflict (id) do update
        set distance_m = greatest(t.distance_m, excluded.distance_m),
            days       = greatest(t.days, excluded.days),
            play_time  = excluded.play_time,
            sites      = greatest(t.sites, excluded.sites),
            ended      = excluded.ended,
            cause      = coalesce(excluded.cause, t.cause),
            updated_at = now();
end;
$$;

-- Adds unlocked achievements to a player's set (existing unlock times are kept)
create or replace function public.longhaul_add_achievements(p_username text, p_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_add jsonb;
begin
    if p_username is null or p_ids is null
       or not exists (select 1 from public.clients where username = p_username) then
        return;
    end if;

    select coalesce(jsonb_object_agg(id, to_jsonb(now())), '{}'::jsonb) into v_add
    from (select distinct id from unnest(p_ids[1:64]) as id where id ~ '^[a-z0-9_]{1,32}$') ids;

    insert into public.longhaul_players as p (username, achievements)
    values (p_username, v_add)
    on conflict (username) do update
        set achievements = excluded.achievements || p.achievements,
            updated_at   = now();
end;
$$;

grant execute on function public.longhaul_report_trip(text, uuid, double precision, integer, double precision, integer, text, boolean, boolean, text) to anon, authenticated;
grant execute on function public.longhaul_add_achievements(text, text[]) to anon, authenticated;

-- The leaderboard: one row per player. Journeys under half a kilometre don't count as trips.
create or replace view public.longhaul_board with (security_invoker = true) as
select t.username,
       max(t.distance_m)  as best_m,
       sum(t.distance_m)  as total_m,
       count(*)::integer  as trips,
       max(t.days)        as best_days,
       sum(t.play_time)   as play_time,
       coalesce((select count(*) from jsonb_object_keys(p.achievements)), 0)::integer as achievements
from public.longhaul_trips t
left join public.longhaul_players p on p.username = t.username
where t.distance_m >= 500
group by t.username, p.achievements;

grant select on public.longhaul_board to anon, authenticated;
