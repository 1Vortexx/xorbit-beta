-- Devices that get Jitter push notifications (iPhone Home Screen app).
-- Only the jitter-push Edge Function (service role) reads or writes this table:
-- RLS is on with no policies, so the public key can't see or change anything.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  email      text not null,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_email_idx on public.push_subscriptions (email);

alter table public.push_subscriptions enable row level security;
