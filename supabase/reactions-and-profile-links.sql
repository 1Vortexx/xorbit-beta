-- Message reactions + profile links (Jitter)
-- Run once in the Supabase SQL editor.

-- One reaction per person per message, stored as { "email": "emoji" }
alter table public.dm_messages
    add column if not exists reactions jsonb not null default '{}'::jsonb;

-- Up to two web links shown on a profile, stored as ["https://...", "https://..."]
alter table public.clients
    add column if not exists profile_links jsonb not null default '[]'::jsonb;
