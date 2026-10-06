-- ══════════════════════════════════════════════════════════════
-- X-ORBIT Hangman — leaderboard
-- Run this once in the Supabase SQL editor.
-- ══════════════════════════════════════════════════════════════

-- One row per player, keyed by their Jitter username
create table if not exists public.hangman_scores (
    username    text primary key,
    points      bigint      not null default 0,
    games       integer     not null default 0,
    wins        integer     not null default 0,
    best_round  integer     not null default 0,
    updated_at  timestamptz not null default now()
);

create index if not exists hangman_scores_points_idx on public.hangman_scores (points desc);

-- Anyone can read the board; rows can only be written through the function below
alter table public.hangman_scores enable row level security;

drop policy if exists "hangman_scores_read" on public.hangman_scores;
create policy "hangman_scores_read" on public.hangman_scores
    for select using (true);

-- Adds one finished round to a player's totals.
-- Points are clamped to what a single round can actually award.
create or replace function public.hangman_add_score(p_username text, p_points integer, p_won boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_points integer := greatest(0, least(coalesce(p_points, 0), 500));
    v_win    integer := case when p_won then 1 else 0 end;
begin
    if p_username is null
       or not exists (select 1 from public.clients where username = p_username) then
        return;
    end if;

    insert into public.hangman_scores as s (username, points, games, wins, best_round)
    values (p_username, v_points, 1, v_win, v_points)
    on conflict (username) do update
        set points     = s.points + excluded.points,
            games      = s.games + 1,
            wins       = s.wins + excluded.wins,
            best_round = greatest(s.best_round, excluded.best_round),
            updated_at = now();
end;
$$;

grant execute on function public.hangman_add_score(text, integer, boolean) to anon, authenticated;
