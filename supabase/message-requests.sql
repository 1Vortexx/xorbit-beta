-- Message requests (Jitter)
-- Lets each user choose whether people who aren't their friends can message them.
-- On by default. Run once in the Supabase SQL editor.

alter table public.clients
    add column if not exists accept_message_requests boolean not null default true;
