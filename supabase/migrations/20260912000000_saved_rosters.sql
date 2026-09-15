-- ---------------------------------------------------------------------------
-- saved_rosters
-- ---------------------------------------------------------------------------
--
-- The other tab's answer, kept the same way. `saved_banners` remembers a set of
-- emblems and asks which units score best through it; this remembers the three
-- units and asks which banner each should be hunting.
--
-- One row is a WHOLE roster rather than three rows with a role each. The three
-- slots are picked together, the tab's headline adds them up, and half a roster
-- restored a week later would look like a finished one with a slot gone
-- missing. Saving it whole makes that unrepresentable.

create table if not exists public.saved_rosters (
  id            uuid        primary key default gen_random_uuid(),

  -- Defaulted from the JWT rather than sent by the client, so a forged user_id
  -- in a request body cannot even be expressed. The insert policy checks it
  -- again anyway: the default is a convenience, the policy is the guarantee.
  user_id       uuid        not null default auth.uid()
                            references auth.users (id) on delete cascade,

  tournament_id text        not null,
  stage         text        not null,

  -- One column per fantasy slot rather than an array, because these three are
  -- the structure of the game and not a list that could be a different length:
  -- core and support are duos, mid is one player, and every other table in this
  -- stack already spells the same three out in a check constraint.
  --
  -- The player id, not the team id. A roster follows people, and a stand-in or
  -- a transfer between periods should come back as the player who was chosen
  -- rather than as whoever now wears that jersey. Loading resolves the id
  -- against the run on screen, so a player the current run does not carry comes
  -- back as an empty slot instead of a wrong one.
  core_player_id    bigint  not null,
  mid_player_id     bigint  not null,
  support_player_id bigint  not null,

  label         text        not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists saved_rosters_owner_idx
  on public.saved_rosters (user_id, created_at desc);

alter table public.saved_rosters enable row level security;

-- Policies are dropped before they are created, so this file is safe to run
-- twice. `create policy` has no `if not exists`, and these migrations are
-- applied by pasting them into a SQL editor -- so without this a re-run dies
-- partway with "policy already exists", having already done half its work.
-- Every other statement here is guarded the same way.

drop policy if exists "saved_rosters: read own" on public.saved_rosters;
drop policy if exists "saved_rosters: insert own" on public.saved_rosters;
drop policy if exists "saved_rosters: update own" on public.saved_rosters;
drop policy if exists "saved_rosters: delete own" on public.saved_rosters;

-- `to authenticated` is what makes "continue as guest" mean what it says: the
-- anon role matches no policy here, so a guest cannot read or write a row even
-- by accident. Nothing is silently discarded server-side -- the client knows it
-- is a guest and never offers to save.
--
-- `(select auth.uid())` rather than a bare call: Postgres caches it as an
-- InitPlan instead of re-evaluating per row.
create policy "saved_rosters: read own"
  on public.saved_rosters for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "saved_rosters: insert own"
  on public.saved_rosters for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "saved_rosters: update own"
  on public.saved_rosters for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "saved_rosters: delete own"
  on public.saved_rosters for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace trigger saved_rosters_touch
  before update on public.saved_rosters
  for each row execute function public.touch_updated_at();
