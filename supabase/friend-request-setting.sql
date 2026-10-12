-- "Accept friend requests" setting (Jitter)
-- Lets each user stop receiving new friend requests. On by default.
-- Run once in the Supabase SQL editor.

alter table public.clients
    add column if not exists accept_friend_requests boolean not null default true;
