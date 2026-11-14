-- Spectator access and privacy (#6, ADR-0009): privileges, policies per role, and
-- get_race_snapshot(). Runs inside a transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- ---------------------------------------------------------------------------------------------
-- Fixtures (as the database owner). Times are relative to now(), which is fixed within the
-- transaction.
-- ---------------------------------------------------------------------------------------------
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000e1', 'public-runner@example.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'private-runner@example.test');

insert into public.organizations (id, name)
values
  ('00000000-0000-0000-0000-00000000000a', 'Organizer with published races'),
  ('00000000-0000-0000-0000-00000000000b', 'Organizer without published races');

insert into public.races (
  id, organization_id, name, starts_at, ends_at, timezone, is_published, tracking_opens_before
) values
  -- Running now.
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'Live',
   now() - interval '1 hour', now() + interval '3 hours', 'Europe/Stockholm', true, '2 hours'),
  -- Running now, but not published.
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000b', 'Unpublished',
   now() - interval '1 hour', now() + interval '3 hours', 'Europe/Stockholm', false, '2 hours'),
  -- Ended 3 hours ago: outside the default 2-hour window after the end.
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000000a', 'Ended',
   now() - interval '8 hours', now() - interval '3 hours', 'Europe/Stockholm', true, '2 hours'),
  -- Starts in 3 hours: outside the default 2-hour window before the start.
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-00000000000a', 'Soon',
   now() + interval '3 hours', now() + interval '8 hours', 'Europe/Stockholm', true, '2 hours'),
  -- Starts in 3 hours, but configured to open tracking 4 hours before the start.
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-00000000000a', 'Soon, wide window',
   now() + interval '3 hours', now() + interval '8 hours', 'Europe/Stockholm', true, '4 hours');

insert into public.participants (id, race_id, bib, display_name, user_id, visibility)
values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '1',
   'Public runner', '00000000-0000-0000-0000-0000000000e1', 'public'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', '2',
   'Private runner', '00000000-0000-0000-0000-0000000000e2', 'private'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1', '3',
   'Private, unclaimed', null, 'private'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a2', '1',
   'Public, unpublished race', null, 'public'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000a3', '1',
   'Public, ended race', null, 'public'),
  ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000a4', '1',
   'Public, race soon', null, 'public'),
  ('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000a5', '1',
   'Public, race soon with wide window', null, 'public');

-- One device and one position per participant.
insert into public.devices (id, participant_id, source_type)
select ('00000000-0000-0000-0000-0000000000c' || substr(p.id::text, 36, 1))::uuid, p.id, 'simulator'
from public.participants p;

insert into public.position_events (
  participant_id, race_id, device_id, source_type, event_id, contract_version, recorded_at, lat, lon
)
select d.participant_id, p.race_id, d.id, d.source_type, gen_random_uuid(), 1,
       now() - interval '1 minute', 59.3, 18.05
from public.devices d join public.participants p on p.id = d.participant_id;

-- ---------------------------------------------------------------------------------------------
-- Privileges (catalog): what clients are allowed to do at all
-- ---------------------------------------------------------------------------------------------
select is(
  (select count(*)::int
   from (values ('anon'), ('authenticated')) r (role_name)
   cross join (values ('public.organizations'), ('public.races'), ('public.participants'),
                      ('public.devices'), ('public.position_events'), ('public.latest_positions')) t (tbl)
   where has_table_privilege(role_name, tbl, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')),
  0,
  'clients cannot write to any core table'
);
select is(
  (select count(*)::int
   from (values ('anon'), ('authenticated')) r (role_name)
   cross join (values ('public.devices'), ('public.position_events'), ('public.latest_positions')) t (tbl)
   where has_table_privilege(role_name, tbl, 'SELECT')),
  0,
  'clients cannot read devices or position tables'
);
select is(
  has_table_privilege('anon', 'public.participants', 'SELECT'),
  false,
  'anonymous visitors cannot read participants'
);
select is(
  has_sequence_privilege('anon', 'public.position_events_id_seq', 'USAGE, SELECT, UPDATE')
  or has_sequence_privilege('authenticated', 'public.position_events_id_seq', 'USAGE, SELECT, UPDATE'),
  false,
  'clients cannot use the position_events sequence'
);
select is(
  has_schema_privilege('anon', 'private', 'USAGE')
  or has_schema_privilege('authenticated', 'private', 'USAGE'),
  false,
  'clients cannot use the private schema'
);
select is(
  has_function_privilege('anon', 'public.get_race_snapshot(uuid)', 'EXECUTE'),
  false,
  'anonymous visitors (no session) cannot call get_race_snapshot'
);
select is(
  has_function_privilege('authenticated', 'public.get_race_snapshot(uuid)', 'EXECUTE'),
  true,
  'sessions (including anonymous sign-in) can call get_race_snapshot'
);
select is(
  (select prosecdef and proconfig @> array['search_path=""']
   from pg_proc where oid = 'public.get_race_snapshot(uuid)'::regprocedure),
  true,
  'get_race_snapshot is security definer with an empty search_path'
);
select is(
  pg_get_function_result('public.get_race_snapshot(uuid)'::regprocedure),
  'TABLE(participant_id uuid, recorded_at timestamp with time zone, lat double precision, lon double precision, accuracy_m double precision)',
  'get_race_snapshot returns only the allowed columns (no names, user or device data)'
);

-- ---------------------------------------------------------------------------------------------
-- Anonymous visitor without a session (role anon)
-- ---------------------------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok('select * from public.position_events', '42501', null,
  'anon: reading position_events is denied');
select throws_ok('select * from public.latest_positions', '42501', null,
  'anon: reading latest_positions is denied');
select throws_ok('select * from public.devices', '42501', null,
  'anon: reading devices is denied');
select throws_ok('select * from public.participants', '42501', null,
  'anon: reading participants is denied');
select throws_ok(
  $$ select * from public.get_race_snapshot('00000000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'anon: calling get_race_snapshot is denied');
select set_eq(
  'select id from public.races',
  array[
    '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a3',
    '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a5'
  ]::uuid[],
  'anon: only published races are readable'
);
select set_eq(
  'select id from public.organizations',
  array['00000000-0000-0000-0000-00000000000a']::uuid[],
  'anon: only organizations with a published race are readable'
);
select throws_ok(
  $$ insert into public.races (organization_id, name, starts_at, ends_at, timezone)
     values ('00000000-0000-0000-0000-00000000000a', 'Injected', now(), now() + interval '1 hour', 'UTC') $$,
  '42501', null, 'anon: creating a race is denied');

reset role;

-- ---------------------------------------------------------------------------------------------
-- Spectator with an anonymous session (role authenticated, not a participant)
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e9","role":"authenticated","is_anonymous":true}', true);

select throws_ok('select * from public.position_events', '42501', null,
  'spectator: reading position_events is denied');
select throws_ok('select * from public.latest_positions', '42501', null,
  'spectator: reading latest_positions is denied');
select throws_ok('select * from public.devices', '42501', null,
  'spectator: reading devices is denied');
select throws_ok(
  $$ insert into public.position_events (participant_id, race_id, device_id, source_type, event_id,
       contract_version, recorded_at, lat, lon)
     values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
       '00000000-0000-0000-0000-0000000000c1', 'simulator', gen_random_uuid(), 1, now(), 0, 0) $$,
  '42501', null, 'spectator: writing a position directly is denied');
select is((select count(*)::int from public.participants), 0,
  'spectator: no participant rows are readable');

select set_eq(
  $$ select participant_id from public.get_race_snapshot('00000000-0000-0000-0000-0000000000a1') $$,
  array['00000000-0000-0000-0000-0000000000b1']::uuid[],
  'spectator: a live race shows public participants only (no private ones)'
);
select is(
  (select count(*)::int from public.get_race_snapshot('00000000-0000-0000-0000-0000000000a2')),
  0, 'spectator: an unpublished race shows nothing');
select is(
  (select count(*)::int from public.get_race_snapshot('00000000-0000-0000-0000-0000000000a3')),
  0, 'spectator: nothing after the tracking window has closed');
select is(
  (select count(*)::int from public.get_race_snapshot('00000000-0000-0000-0000-0000000000a4')),
  0, 'spectator: nothing before the tracking window opens');
select set_eq(
  $$ select participant_id from public.get_race_snapshot('00000000-0000-0000-0000-0000000000a5') $$,
  array['00000000-0000-0000-0000-0000000000b7']::uuid[],
  'spectator: a race''s configured window opens tracking earlier'
);
select is(
  (select count(*)::int from public.get_race_snapshot(gen_random_uuid())),
  0, 'spectator: an unknown race shows nothing');

-- ---------------------------------------------------------------------------------------------
-- Runners (role authenticated, with a claimed participant entry)
-- ---------------------------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select set_eq(
  $$ select participant_id from public.get_race_snapshot('00000000-0000-0000-0000-0000000000a1') $$,
  array['00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2']::uuid[],
  'private runner: sees public participants and their own position'
);
select set_eq(
  'select id from public.participants',
  array['00000000-0000-0000-0000-0000000000b2']::uuid[],
  'private runner: reads only their own participant entry'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select set_eq(
  $$ select participant_id from public.get_race_snapshot('00000000-0000-0000-0000-0000000000a1') $$,
  array['00000000-0000-0000-0000-0000000000b1']::uuid[],
  'another runner: does not see a private participant'
);

reset role;

-- ---------------------------------------------------------------------------------------------
-- Changes take effect immediately
-- ---------------------------------------------------------------------------------------------
update public.participants set visibility = 'private'
where id = '00000000-0000-0000-0000-0000000000b1';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e9","role":"authenticated","is_anonymous":true}', true);
select is(
  (select count(*)::int from public.get_race_snapshot('00000000-0000-0000-0000-0000000000a1')),
  0, 'spectator: a participant who switches to private disappears at once');
reset role;

update public.races set is_published = false where id = '00000000-0000-0000-0000-0000000000a1';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.get_race_snapshot('00000000-0000-0000-0000-0000000000a1')),
  0, 'runner: an unpublished race shows nothing, not even their own position');
reset role;

select * from finish();
rollback;
