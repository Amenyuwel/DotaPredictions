-- DotaPredictions schema.
--
-- Two tables that answer two unrelated questions, and they are kept apart on
-- purpose:
--
--   runs           one immutable, published model snapshot. Public knowledge,
--                  written by engine/scripts/publish.py, read once at boot by
--                  the Express server. No browser ever reads it directly.
--   saved_banners  a signed-in user's own banner setups. Private to that user,
--                  written and read by the browser under RLS.
--
-- The project's governing property is that a wrong number does not raise. So
-- the rule here is that the database stores what was published, byte for byte,
-- and never normalises it into something that looks equally valid and means
-- something else.

-- ---------------------------------------------------------------------------
-- runs
-- ---------------------------------------------------------------------------

create table if not exists public.runs (
  run_id         text        primary key,
  tournament_id  text        not null,
  stage          text        not null,
  created_at     timestamptz not null,
  engine_version text        not null default '',
  schema_version integer     not null,
  is_current     boolean     not null default false,

  -- `json`, deliberately not `jsonb`. jsonb reorders keys, drops duplicates and
  -- re-renders every number through `numeric`; this payload carries base64
  -- Float32 matrices whose byte lengths the server checks, and nothing ever
  -- queries inside it -- every field worth filtering on is a column above. Exact
  -- text in, exact text out, with the type still refusing malformed JSON.
  payload        json        not null
);

-- The only read the server performs: newest current run, optionally pinned to a
-- tournament and stage.
create index if not exists runs_current_idx
  on public.runs (tournament_id, stage, is_current, created_at desc);

-- RLS on, and no policy, is the intended end state rather than an oversight.
-- Only the secret key (which carries BYPASSRLS) touches this table. A browser
-- holding the publishable key gets an empty result, not a leak, if a future
-- change ever points it here by mistake.
alter table public.runs enable row level security;

-- ---------------------------------------------------------------------------
-- saved_banners
-- ---------------------------------------------------------------------------

create table if not exists public.saved_banners (
  id            uuid        primary key default gen_random_uuid(),

  -- Defaulted from the JWT rather than sent by the client, so a forged user_id
  -- in a request body cannot even be expressed. The insert policy checks it
  -- again anyway: the default is a convenience, the policy is the guarantee.
  user_id       uuid        not null default auth.uid()
                            references auth.users (id) on delete cascade,

  tournament_id text        not null,
  stage         text        not null,
  role          text        not null check (role in ('core', 'mid', 'support')),

  -- Array position IS the emblem order. Two emblem traits are positional --
  -- Vampiric charges each neighbour, Benevolent pays each neighbour -- so the
  -- order is part of the answer, not presentation. Storing it as position
  -- rather than as a separate column means the two cannot drift apart.
  --
  -- No length check: a group-stage banner holds three emblems and a main-event
  -- banner five, and a future format may hold neither. Nothing in this stack is
  -- allowed to hardcode that count.
  emblem_ids    text[]      not null check (cardinality(emblem_ids) > 0),

  label         text        not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists saved_banners_owner_idx
  on public.saved_banners (user_id, created_at desc);

alter table public.saved_banners enable row level security;

-- `to authenticated` is what makes "continue as guest" mean what it says: the
-- anon role matches no policy here, so a guest cannot read or write a row even
-- by accident. Nothing is silently discarded server-side -- the client knows it
-- is a guest and never offers to save.
--
-- `(select auth.uid())` rather than a bare call: Postgres caches it as an
-- InitPlan instead of re-evaluating per row.
create policy "saved_banners: read own"
  on public.saved_banners for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "saved_banners: insert own"
  on public.saved_banners for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "saved_banners: update own"
  on public.saved_banners for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "saved_banners: delete own"
  on public.saved_banners for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger saved_banners_touch
  before update on public.saved_banners
  for each row execute function public.touch_updated_at();
