-- Core schema v1 (#6).
-- Design: docs/architecture.md §5–§6, ADR-0008 (watch-only sources), ADR-0009 (controlled
-- spectator access).
--
-- Access model:
--   * Clients (anon, authenticated) never read or write position data or devices directly.
--   * Anonymous visitors can read published races (and their organizations); runners can read
--     their own participant entries. Spectators get positions only through
--     public.get_race_snapshot() (next migration).
--   * Only server code (service role: ingest, seed) writes.
--   * No table here is ever added to the supabase_realtime publication.

-- Internal helpers live in a schema that the API does not expose and clients cannot use.
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------------------------
-- Organizations and races
-- ---------------------------------------------------------------------------------------------

-- Minimal: an organizer that owns races. No roles or memberships yet (no organizer dashboard
-- in the MVP).
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.races (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- IANA time zone name (e.g. Europe/Stockholm), used for display.
  timezone text not null check (length(trim(timezone)) > 0),
  is_published boolean not null default false,
  -- Tracking window: positions are shown from (starts_at - tracking_opens_before) to
  -- (ends_at + tracking_closes_after). Configurable per race.
  tracking_opens_before interval not null default interval '2 hours',
  tracking_closes_after interval not null default interval '2 hours',
  created_at timestamptz not null default now(),
  constraint races_ends_after_start check (ends_at > starts_at),
  constraint races_tracking_margins check (
    tracking_opens_before between interval '0' and interval '24 hours'
    and tracking_closes_after between interval '0' and interval '24 hours'
  )
);

create index races_organization_id_idx on public.races (organization_id);

-- ---------------------------------------------------------------------------------------------
-- Participants and devices
-- ---------------------------------------------------------------------------------------------

-- One entry in one race. A person running two races has two participant rows.
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races (id) on delete cascade,
  bib text not null check (length(trim(bib)) > 0),
  display_name text not null check (length(trim(display_name)) > 0),
  -- Set when the runner claims the bib in the app; null until then.
  user_id uuid references auth.users (id) on delete set null,
  -- Private by default (architecture §6).
  visibility text not null default 'private' check (visibility in ('public', 'private')),
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint participants_bib_unique unique (race_id, bib),
  constraint participants_one_entry_per_user unique (race_id, user_id),
  -- Targets of the composite foreign keys below.
  constraint participants_id_race_unique unique (id, race_id)
);

create index participants_user_id_idx on public.participants (user_id);

-- A registered GPS source of one participant: a phone app installation, the simulator, and
-- later a watch or a vendor relay (ADR-0008). A participant can have several devices.
-- Credentials are added by #19.
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants (id) on delete cascade,
  -- Mirrors SOURCE_TYPES in packages/shared; widened by a migration when a source is added.
  source_type text not null check (source_type in ('mobile_app', 'simulator')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint devices_revoked_after_created check (revoked_at is null or revoked_at >= created_at),
  -- Target of the composite foreign keys below.
  constraint devices_id_participant_source_unique unique (id, participant_id, source_type)
);

create index devices_participant_id_idx on public.devices (participant_id);

-- ---------------------------------------------------------------------------------------------
-- Positions
-- ---------------------------------------------------------------------------------------------

-- Append-only history. Columns mirror the canonical contract v1 (packages/shared) plus the
-- server-derived fields. Checks repeat the contract's bounds as a second line of defence.
create table public.position_events (
  id bigint generated always as identity primary key,
  participant_id uuid not null,
  race_id uuid not null,
  device_id uuid not null,
  source_type text not null,
  event_id uuid not null,
  contract_version smallint not null check (contract_version >= 1),
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  accuracy_m double precision check (accuracy_m >= 0),
  altitude_m double precision check (altitude_m between -1000 and 10000),
  speed_mps double precision check (speed_mps between 0 and 100),
  heading_deg double precision check (heading_deg >= 0 and heading_deg < 360),
  -- Hard limit for device clocks running ahead. Finer plausibility checks (race window, age)
  -- belong to ingest (#9).
  constraint position_events_not_in_future check (recorded_at <= received_at + interval '5 minutes'),
  -- The event's race must be the participant's race.
  constraint position_events_participant_race_fk foreign key (participant_id, race_id)
    references public.participants (id, race_id) on delete cascade,
  -- The device must belong to the same participant, with the same source type. A position can
  -- therefore never be attributed to another participant's device. A device that has positions
  -- cannot be deleted on its own (revoke it instead); deleting the participant removes both.
  constraint position_events_device_fk foreign key (device_id, participant_id, source_type)
    references public.devices (id, participant_id, source_type),
  -- Deduplication is per participant (contract v1): resends are ignored, and one participant
  -- can never block or probe another participant's event IDs.
  constraint position_events_dedupe unique (participant_id, event_id)
);

create index position_events_participant_recorded_idx
  on public.position_events (participant_id, recorded_at);
create index position_events_race_recorded_idx on public.position_events (race_id, recorded_at);
create index position_events_device_id_idx on public.position_events (device_id);

-- The newest position of each participant, from whichever device sent it. Maintained by the
-- database from position_events (trigger below); writers only insert position_events.
create table public.latest_positions (
  participant_id uuid primary key,
  race_id uuid not null,
  device_id uuid not null,
  source_type text not null,
  event_id uuid not null,
  recorded_at timestamptz not null,
  received_at timestamptz not null,
  lat double precision not null,
  lon double precision not null,
  accuracy_m double precision,
  altitude_m double precision,
  speed_mps double precision,
  heading_deg double precision,
  constraint latest_positions_participant_race_fk foreign key (participant_id, race_id)
    references public.participants (id, race_id) on delete cascade,
  constraint latest_positions_device_fk foreign key (device_id, participant_id, source_type)
    references public.devices (id, participant_id, source_type)
);

create index latest_positions_race_id_idx on public.latest_positions (race_id);

-- After each insert statement on position_events, move latest_positions forward to the newest
-- inserted position per participant — but only if it is newer than the stored one, so an
-- offline backfill of old positions never moves a runner backwards.
create function private.update_latest_positions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.latest_positions as latest (
    participant_id, race_id, device_id, source_type, event_id, recorded_at, received_at,
    lat, lon, accuracy_m, altitude_m, speed_mps, heading_deg
  )
  select distinct on (e.participant_id)
    e.participant_id, e.race_id, e.device_id, e.source_type, e.event_id, e.recorded_at,
    e.received_at, e.lat, e.lon, e.accuracy_m, e.altitude_m, e.speed_mps, e.heading_deg
  from new_events e
  order by e.participant_id, e.recorded_at desc, e.received_at desc, e.id desc
  on conflict (participant_id) do update set
    race_id = excluded.race_id,
    device_id = excluded.device_id,
    source_type = excluded.source_type,
    event_id = excluded.event_id,
    recorded_at = excluded.recorded_at,
    received_at = excluded.received_at,
    lat = excluded.lat,
    lon = excluded.lon,
    accuracy_m = excluded.accuracy_m,
    altitude_m = excluded.altitude_m,
    speed_mps = excluded.speed_mps,
    heading_deg = excluded.heading_deg
  where excluded.recorded_at > latest.recorded_at;
  return null;
end;
$$;

create trigger position_events_update_latest
  after insert on public.position_events
  referencing new table as new_events
  for each statement
  execute function private.update_latest_positions();

-- Second line of defence for any other writer: an update that would make latest_positions
-- older (or equal) is skipped.
create function private.keep_newest_latest_position()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.recorded_at <= old.recorded_at then
    return null;
  end if;
  return new;
end;
$$;

create trigger latest_positions_keep_newest
  before update on public.latest_positions
  for each row
  execute function private.keep_newest_latest_position();

revoke all on function private.update_latest_positions() from public;
revoke all on function private.keep_newest_latest_position() from public;

-- ---------------------------------------------------------------------------------------------
-- Row-level security and privileges
-- ---------------------------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.races enable row level security;
alter table public.participants enable row level security;
alter table public.devices enable row level security;
alter table public.position_events enable row level security;
alter table public.latest_positions enable row level security;

-- Supabase grants every new table to anon and authenticated by default. Remove that, then grant
-- back only what the policies below need. Position tables and devices get nothing at all.
revoke all on table
  public.organizations,
  public.races,
  public.participants,
  public.devices,
  public.position_events,
  public.latest_positions
from anon, authenticated;
revoke all on sequence public.position_events_id_seq from anon, authenticated;

grant select on table public.organizations, public.races to anon, authenticated;
grant select on table public.participants to authenticated;

create policy "Published races are readable"
  on public.races for select
  to anon, authenticated
  using (is_published);

create policy "Organizations with a published race are readable"
  on public.organizations for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.races r
      where r.organization_id = organizations.id and r.is_published
    )
  );

create policy "Runners can read their own participant entries"
  on public.participants for select
  to authenticated
  using (user_id = (select auth.uid()));
