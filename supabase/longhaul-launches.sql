-- ══════════════════════════════════════════════════════════════
-- X-ORBIT Long Haul — launch log
-- One row each time the game loads (longhaul/js/online.js → logLaunch), shown in admin/logs.html.
-- Run this once in the Supabase SQL editor. Safe to run again.
-- ══════════════════════════════════════════════════════════════

create table if not exists public.longhaul_launches (
    id           bigint generated always as identity primary key,
    launched_at  timestamptz not null default now(),
    username     text,                        -- Long Haul account (clients.username), null when playing as a guest
    signed_in    boolean     not null default false,
    platform     text        not null default 'web',   -- web | desktop (the Electron app) | xorbit (inside the X-ORBIT desktop)
    device_uuid  text,
    user_agent   text,
    page_url     text,
    referrer     text,
    has_save     boolean     not null default false,   -- a journey was saved on this device
    screen       text                                  -- e.g. 1920x1080
);
create index if not exists longhaul_launches_time_idx on public.longhaul_launches (launched_at desc);
create index if not exists longhaul_launches_user_idx on public.longhaul_launches (username, launched_at desc);

-- The game writes with the anon key and the admin logs page reads with it, like login_attempts
alter table public.longhaul_launches enable row level security;

drop policy if exists "longhaul_launches_insert" on public.longhaul_launches;
create policy "longhaul_launches_insert" on public.longhaul_launches for insert
    with check (platform in ('web', 'desktop', 'xorbit') and launched_at > now() - interval '5 minutes');
drop policy if exists "longhaul_launches_read" on public.longhaul_launches;
create policy "longhaul_launches_read" on public.longhaul_launches for select using (true);
