-- Status setting (Jitter + desktop)
-- status_detail: 'all' lets the desktop put the app you're using in clients.current_page,
--                which Jitter shows as e.g. "Sketching with Ember";
--                'minimal' keeps current_page to just 'online' / 'away'.
-- Run once in the Supabase SQL editor.

alter table public.clients
    add column if not exists status_detail text not null default 'all';
