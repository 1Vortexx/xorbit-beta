-- Jitter version check (see VERSION CHECK in jittery.html)
-- One row per site. When a row's version is newer than the Jitter someone is running,
-- Jitter asks them to refresh. Update it AFTER the push is live, e.g.:
--   update public.jitter_version set version = '261028-1', updated_at = now() where channel = 'beta';

create table if not exists public.jitter_version (
  channel    text primary key check (channel in ('beta', 'public')),
  version    text not null,
  updated_at timestamptz not null default now()
);

alter table public.jitter_version enable row level security;

-- Anyone can read it; nobody can change it with the public key (dashboard / service role only)
drop policy if exists "Anyone can read the Jitter version" on public.jitter_version;
create policy "Anyone can read the Jitter version"
  on public.jitter_version for select
  using (true);

insert into public.jitter_version (channel, version) values
  ('beta',   '261027-14'),
  ('public', '261027-10')
on conflict (channel) do update set version = excluded.version, updated_at = now();

-- Live updates: open copies of Jitter see a change within seconds
alter publication supabase_realtime add table public.jitter_version;

-- Dev server address for beta.xorbit.org/jitterdev (a Cloudflare quick tunnel; it changes
-- on every restart, so update the beta row each time):
--   update public.jitter_version set cloudflared_url = 'https://….trycloudflare.com' where channel = 'beta';
alter table public.jitter_version add column if not exists cloudflared_url text;
