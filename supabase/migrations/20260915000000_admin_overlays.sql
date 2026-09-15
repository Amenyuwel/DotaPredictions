-- Admin-editable configuration, as an overlay on a published run.
--
-- The problem this solves: every TI moves the numbers. Emblem tiers change,
-- trait bonuses change, a stat's per-unit value changes, a roster changes. Today
-- each of those is a YAML edit plus a full re-crawl and re-publish, which is the
-- right answer when the SAMPLES change and a needlessly expensive one when only
-- the SCORING TABLE does.
--
-- The split that makes this safe is a fact about the server, not a policy:
-- `server/src/scoring/banner.ts` turns a stat line into points at REQUEST time,
-- reading `payload.scoring` (perUnit, base, quality, traits) against raw
-- per-game values in `playerSamples`. So the scoring half of a run is a pure
-- function of a table that can be replaced, and the measurement half is not.
--
--   overlayable   stats, emblem quality tiers, traits, banner colours, slot
--                 colours, team and player METADATA
--   not           playerSamples (the per-game Float32 matrices) and
--                 stageProjections (the simulated schedules). Those come from
--                 the crawler, and a player with no matrix is reported as
--                 having no data rather than scored as zero.
--
-- The project's governing property is that a wrong number does not raise. An
-- admin form is the single most direct way to produce one, so three things are
-- structural here rather than left to the UI:
--
--   1. Nothing an admin types is public until they publish it. Drafts and
--      published versions are different rows.
--   2. A published version is immutable and numbered. Reverting is publishing
--      an earlier document again as a NEW version, never an edit in place --
--      the same rule `runs` already keeps.
--   3. Every write is attributed and kept, drafts included, so "who moved this
--      multiplier" is answerable after the fact rather than reconstructable.

-- ---------------------------------------------------------------------------
-- admins
-- ---------------------------------------------------------------------------
--
-- Membership, and nothing else. No role column and no permission bits: there is
-- one privilege in this system and inventing a hierarchy before a second one
-- exists would be a guess about a requirement nobody has.
--
-- Granting admin is deliberately NOT an operation this application exposes. It
-- is an INSERT run against the database by whoever holds the keys:
--
--   insert into public.admins (user_id, email, note)
--   select id, email, 'first admin' from auth.users where email = '...';
--
-- An admin page that can mint admins is an admin page where one compromised
-- session is permanent. This way the blast radius of a stolen token is the
-- config, which is versioned and revertible, rather than the membership list.
create table if not exists public.admins (
  user_id    uuid        primary key references auth.users (id) on delete cascade,

  -- Denormalised from auth.users on purpose. It is how a human reads the audit
  -- trail, and it must survive the account being deleted -- at which point the
  -- cascade above removes this row, but every audit row still carries the
  -- address the action was taken under.
  email      text        not null default '',
  note       text        not null default '',
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- The browser reads exactly one row -- its own -- and only to decide whether to
-- render a link. This is not the authorisation check; `server/src/admin/auth.ts`
-- re-asks the question with the secret key on every admin request. A user who
-- forges this answer locally gets a menu item and a 403.
--
-- Policies are dropped before they are created, so this file is safe to run
-- twice. `create policy` has no `if not exists`, and these migrations are
-- applied by pasting them into a SQL editor -- so without this a re-run dies
-- partway with "policy already exists", having already done half its work.
-- Every other statement here is guarded the same way.

drop policy if exists "admins: read own row" on public.admins;

-- Read-only, and only ever for the caller's own id: there is no insert, update
-- or delete policy here, so the admin list is not enumerable by anyone holding
-- the publishable key, and no session can add itself.
create policy "admins: read own row"
  on public.admins for select to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- config_overlays
-- ---------------------------------------------------------------------------
--
-- One row per saved state of the configuration for a (tournament, stage).
-- Exactly one of them may be a draft; the rest are published versions, and the
-- highest published `version` is the one the server serves.
--
-- Append-only by intent: the draft row is the only one that is ever UPDATEd,
-- and publishing copies it into a fresh row rather than flipping a flag on it.
-- That is what makes "what was live on the 14th" a query rather than an
-- archaeology problem.
create table if not exists public.config_overlays (
  id            uuid        primary key default gen_random_uuid(),

  tournament_id text        not null,
  stage         text        not null,

  status        text        not null check (status in ('draft', 'published')),

  -- Null for the draft, which has no version until it becomes one. Numbered
  -- from 1 per (tournament, stage), assigned by `publish_config_overlay` under
  -- a lock so two admins publishing at once cannot both be version 4.
  version       integer     check (version is null or version >= 1),

  -- `jsonb`, and the difference from `runs.payload` is deliberate rather than
  -- an inconsistency. That column is `json` because it carries base64 Float32
  -- matrices whose byte lengths are checked downstream, so it must survive
  -- byte-for-byte. This one carries a few hundred hand-authored scalars that
  -- are read by key. jsonb's normalisations are all harmless here -- it
  -- preserves ARRAY order, which is the only ordering this document depends on
  -- (slot colours) -- and being queryable is worth having.
  --
  -- Validated against shared/overlay-schema.json before it ever reaches this
  -- column. The check below is the floor, not the contract: it only refuses a
  -- shape that could not be an overlay at all.
  doc           jsonb       not null default '{}'::jsonb
                            check (jsonb_typeof(doc) = 'object'),

  -- What the author says they changed and why. Empty is allowed for a draft and
  -- required by the API for a publish: a version nobody can explain is a
  -- version nobody can safely revert to.
  note          text        not null default '',

  -- Who. Not `references auth.users` and not cascading: the trail must outlive
  -- the account. A deleted admin's published version stays attributable.
  author_id     uuid,
  author_email  text        not null default '',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz
);

-- A published row is complete or it is not published. Caught here as well as in
-- the API, because this is the invariant every reader depends on.
alter table public.config_overlays
  drop constraint if exists config_overlays_published_is_complete;
alter table public.config_overlays
  add constraint config_overlays_published_is_complete check (
    status = 'draft'
    or (version is not null and published_at is not null and author_id is not null)
  );

-- One draft per (tournament, stage). Without this, two browser tabs become two
-- drafts and publishing picks one of them by accident.
create unique index if not exists config_overlays_one_draft_idx
  on public.config_overlays (tournament_id, stage)
  where status = 'draft';

-- Versions are dense and unique per stage. This is the index the publish
-- function takes its number from.
create unique index if not exists config_overlays_version_idx
  on public.config_overlays (tournament_id, stage, version)
  where status = 'published';

-- The server's one read: newest published version for a stage.
create index if not exists config_overlays_current_idx
  on public.config_overlays (tournament_id, stage, version desc)
  where status = 'published';

-- Same posture as `runs`: RLS on, no policy at all. The Express server holds the
-- secret key and is the only reader and the only writer. A browser pointed here
-- by a future mistake gets an empty set rather than the ability to rewrite the
-- scoring table.
alter table public.config_overlays enable row level security;

create or replace trigger config_overlays_touch
  before update on public.config_overlays
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- config_audit
-- ---------------------------------------------------------------------------
--
-- Every admin write, drafts included. The version history above answers "what
-- was live"; this answers "who touched it, when, and what did they say it was
-- for" -- including the saves that were never published, which is where a
-- mistake is usually visible earliest.
--
-- `before` and `after` are whole documents rather than a diff. A diff is
-- computed FROM these two, so storing one instead would be storing a derived
-- value and losing the ability to recompute it when the differ changes.
create table if not exists public.config_audit (
  id            bigserial   primary key,
  tournament_id text        not null,
  stage         text        not null,

  -- save_draft | publish | discard_draft
  action        text        not null,

  -- The version this action produced, for a publish. Null otherwise.
  version       integer,

  before_doc    jsonb,
  after_doc     jsonb,
  note          text        not null default '',

  author_id     uuid,
  author_email  text        not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists config_audit_scope_idx
  on public.config_audit (tournament_id, stage, created_at desc);

alter table public.config_audit enable row level security;

-- ---------------------------------------------------------------------------
-- publish_config_overlay
-- ---------------------------------------------------------------------------
--
-- Promote the draft to the next version, atomically.
--
-- A function rather than three statements from the server, because the version
-- number is read-then-written and two admins hitting Publish together would
-- otherwise both read 3 and both try to write 4. The advisory lock makes the
-- read and the write one step; the unique index is the backstop if it is ever
-- bypassed.
--
-- The draft row is NOT deleted. It is left in place holding the document that
-- was just published, so the editor opens on what is live rather than on an
-- empty form -- and so the next edit is a diff against reality.
create or replace function public.publish_config_overlay(
  p_tournament_id text,
  p_stage         text,
  p_note          text,
  p_author_id     uuid,
  p_author_email  text
)
returns public.config_overlays
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft   public.config_overlays;
  v_next    integer;
  v_result  public.config_overlays;
begin
  -- Serialise publishes for this stage only. hashtextextended over the scope
  -- key, so two different tournaments never wait on each other.
  perform pg_advisory_xact_lock(hashtextextended(p_tournament_id || '/' || p_stage, 0));

  select * into v_draft
  from public.config_overlays
  where tournament_id = p_tournament_id and stage = p_stage and status = 'draft';

  if not found then
    raise exception 'no draft to publish for %/%', p_tournament_id, p_stage
      using errcode = 'no_data_found';
  end if;

  select coalesce(max(version), 0) + 1 into v_next
  from public.config_overlays
  where tournament_id = p_tournament_id and stage = p_stage and status = 'published';

  insert into public.config_overlays
    (tournament_id, stage, status, version, doc, note,
     author_id, author_email, published_at)
  values
    (p_tournament_id, p_stage, 'published', v_next, v_draft.doc, p_note,
     p_author_id, p_author_email, now())
  returning * into v_result;

  return v_result;
end;
$$;

-- Only the secret key calls this. `security definer` lets it write past the
-- table's RLS, so it must not be reachable by a browser role -- revoke from the
-- roles PostgREST hands out, and grant to nobody: the secret key bypasses RLS
-- and does not need a grant.
revoke all on function public.publish_config_overlay(text, text, text, uuid, text)
  from public, anon, authenticated;
