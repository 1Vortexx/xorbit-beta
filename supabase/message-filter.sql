-- Message filter (Jitter)
-- Each user's profanity filter mode: 'off', 'blur' or 'block'. Stored on the account
-- so a sender's Jitter can show "Not Received" when the reader blocks swearing.
-- Run once in the Supabase SQL editor.

alter table public.clients
    add column if not exists message_filter text not null default 'off';
