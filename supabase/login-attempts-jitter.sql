-- Marks sign-ins that came from Jitter (jittery.html) so admin/logs.html can show them.
-- Existing rows and X-ORBIT desktop sign-ins stay false.
alter table public.login_attempts
  add column if not exists is_jitter boolean not null default false;

create index if not exists login_attempts_is_jitter_idx
  on public.login_attempts (is_jitter, attempt_timestamp desc);
