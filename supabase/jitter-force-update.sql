-- Forcing old copies of Jitter off. Run after jitter-version.sql.

-- 1. Compulsory updates (jittery.html 261117-1 and later)
-- A Jitter older than min_version shows "Update required" with no "Later" button and
-- refreshes itself after 10 seconds (it waits until a call ends). Set it AFTER the push is live:
--   update public.jitter_version set version = '261117-1', min_version = '261117-1', updated_at = now() where channel = 'beta';
alter table public.jitter_version add column if not exists min_version text;

-- 2. Banned accounts can't post, whatever page they're on
-- Copies of Jitter from before the ban screen keep working until they're reloaded, so the
-- database refuses new messages from banned senders. `blocked` is compared as text because
-- it has been stored as both true and 'true'.
create or replace function public.reject_banned_sender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.clients
    where lower(email) = lower(new.sender_email)
      and blocked::text = 'true'
  ) then
    raise exception 'Account suspended' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_banned_sender on public.dm_messages;
create trigger reject_banned_sender
  before insert on public.dm_messages
  for each row execute function public.reject_banned_sender();

drop trigger if exists reject_banned_sender on public.server_messages;
create trigger reject_banned_sender
  before insert on public.server_messages
  for each row execute function public.reject_banned_sender();
