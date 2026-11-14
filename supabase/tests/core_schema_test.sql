-- Core schema v1 (#6): structure, integrity constraints, devices and latest_positions.
-- Runs as the database owner inside a transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

-- ---------------------------------------------------------------------------------------------
-- Structure and global safety rules
-- ---------------------------------------------------------------------------------------------
select has_table('public', 'organizations', 'organizations exists');
select has_table('public', 'races', 'races exists');
select has_table('public', 'participants', 'participants exists');
select has_table('public', 'devices', 'devices exists');
select has_table('public', 'position_events', 'position_events exists');
select has_table('public', 'latest_positions', 'latest_positions exists');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0,
  'every table in public has row-level security enabled'
);
select is(
  (select count(*)::int from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'),
  0,
  'no table in public is part of the supabase_realtime publication'
);

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------
insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-00000000000a', 'Test organizer');

insert into public.races (id, organization_id, name, starts_at, ends_at, timezone)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a',
   'Race 1', '2026-11-14 09:00+00', '2026-11-14 14:00+00', 'Europe/Stockholm'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000000a',
   'Race 2', '2026-11-15 09:00+00', '2026-11-15 14:00+00', 'Europe/Stockholm');

insert into public.participants (id, race_id, bib, display_name)
values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '1', 'Runner A'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', '2', 'Runner B'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a2', '1', 'Runner C');

-- Runner A has two devices (e.g. a phone and, later, a watch); runner B has one.
insert into public.devices (id, participant_id, source_type)
values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'mobile_app'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', 'simulator'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000b2', 'mobile_app');

-- A helper that inserts one position for runner A from device c1 (overridable).
create function pg_temp.insert_position(
  event_id uuid,
  recorded_at timestamptz,
  participant_id uuid default '00000000-0000-0000-0000-0000000000b1',
  race_id uuid default '00000000-0000-0000-0000-0000000000a1',
  device_id uuid default '00000000-0000-0000-0000-0000000000c1',
  source_type text default 'mobile_app',
  lat double precision default 59.3,
  heading double precision default null,
  received_at timestamptz default '2026-11-14 10:00+00'
) returns void language sql as $$
  insert into public.position_events (
    participant_id, race_id, device_id, source_type, event_id, contract_version,
    recorded_at, received_at, lat, lon, heading_deg
  ) values (
    participant_id, race_id, device_id, source_type, event_id, 1,
    recorded_at, received_at, lat, 18.05, heading
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- Defaults and simple checks
-- ---------------------------------------------------------------------------------------------
select is(
  (select visibility from public.participants where id = '00000000-0000-0000-0000-0000000000b1'),
  'private',
  'participants are private by default'
);
select is(
  (select is_published from public.races where id = '00000000-0000-0000-0000-0000000000a1'),
  false,
  'races are unpublished by default'
);
select is(
  (select tracking_opens_before || ' / ' || tracking_closes_after
   from public.races where id = '00000000-0000-0000-0000-0000000000a1'),
  '02:00:00 / 02:00:00',
  'the tracking window defaults to two hours before and after'
);
select throws_ok(
  $$ update public.participants set visibility = 'secret'
     where id = '00000000-0000-0000-0000-0000000000b1' $$,
  '23514', null, 'visibility accepts only public or private'
);
select throws_ok(
  $$ insert into public.devices (participant_id, source_type)
     values ('00000000-0000-0000-0000-0000000000b1', 'watch') $$,
  '23514', null, 'devices accept only known source types'
);
select throws_ok(
  $$ update public.races set ends_at = starts_at
     where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '23514', null, 'a race must end after it starts'
);
select throws_ok(
  $$ update public.races set tracking_opens_before = interval '-1 hour'
     where id = '00000000-0000-0000-0000-0000000000a1' $$,
  '23514', null, 'tracking margins cannot be negative'
);
select throws_ok(
  $$ insert into public.participants (race_id, bib, display_name)
     values ('00000000-0000-0000-0000-0000000000a1', '1', 'Duplicate bib') $$,
  '23505', null, 'a bib is unique within a race'
);

-- ---------------------------------------------------------------------------------------------
-- Position integrity
-- ---------------------------------------------------------------------------------------------
select lives_ok(
  $$ select pg_temp.insert_position('10000000-0000-4000-8000-000000000001', '2026-11-14 10:00+00') $$,
  'a valid position is stored'
);
select throws_ok(
  $$ select pg_temp.insert_position('10000000-0000-4000-8000-000000000001', '2026-11-14 10:00:05+00') $$,
  '23505', null, 'the same event_id cannot be stored twice for one participant'
);
select lives_ok(
  $$ select pg_temp.insert_position('10000000-0000-4000-8000-000000000001', '2026-11-14 10:00+00',
       participant_id => '00000000-0000-0000-0000-0000000000b2',
       device_id => '00000000-0000-0000-0000-0000000000c3') $$,
  'another participant may use the same event_id (deduplication is per participant)'
);
select throws_ok(
  $$ select pg_temp.insert_position('10000000-0000-4000-8000-000000000002', '2026-11-14 10:00+00',
       device_id => '00000000-0000-0000-0000-0000000000c3') $$,
  '23503', null, 'a position cannot reference another participant''s device'
);
select throws_ok(
  $$ select pg_temp.insert_position('10000000-0000-4000-8000-000000000003', '2026-11-14 10:00+00',
       race_id => '00000000-0000-0000-0000-0000000000a2') $$,
  '23503', null, 'a position cannot reference a race other than the participant''s'
);
select throws_ok(
  $$ select pg_temp.insert_position('10000000-0000-4000-8000-000000000004', '2026-11-14 10:00+00',
       source_type => 'simulator') $$,
  '23503', null, 'a position''s source type must match its device'
);
select throws_ok(
  $$ select pg_temp.insert_position('10000000-0000-4000-8000-000000000005', '2026-11-14 10:00+00',
       lat => 91) $$,
  '23514', null, 'latitude must be within ±90'
);
select throws_ok(
  $$ select pg_temp.insert_position('10000000-0000-4000-8000-000000000006', '2026-11-14 10:00+00',
       heading => 360) $$,
  '23514', null, 'heading must be below 360'
);
select throws_ok(
  $$ select pg_temp.insert_position('10000000-0000-4000-8000-000000000007', '2026-11-14 10:06+00') $$,
  '23514', null, 'a position more than 5 minutes ahead of its arrival is rejected (device clock ahead)'
);
select lives_ok(
  $$ select pg_temp.insert_position('10000000-0000-4000-8000-000000000008', '2026-11-14 10:04+00') $$,
  'a position up to 5 minutes ahead of its arrival is accepted (small clock skew)'
);
select throws_ok(
  $$ delete from public.devices where id = '00000000-0000-0000-0000-0000000000c1' $$,
  '23503', null, 'a device with positions cannot be deleted on its own (revoke it instead)'
);

-- ---------------------------------------------------------------------------------------------
-- latest_positions: maintained by the database, never moves backwards
-- ---------------------------------------------------------------------------------------------
-- Runner A now has positions at 10:00 and 10:04 (the latter from the clock-skew test).
select is(
  (select recorded_at from public.latest_positions
   where participant_id = '00000000-0000-0000-0000-0000000000b1'),
  '2026-11-14 10:04+00'::timestamptz,
  'latest_positions holds the newest position'
);

select pg_temp.insert_position('10000000-0000-4000-8000-000000000010', '2026-11-14 09:30+00');
select is(
  (select recorded_at from public.latest_positions
   where participant_id = '00000000-0000-0000-0000-0000000000b1'),
  '2026-11-14 10:04+00'::timestamptz,
  'a backfilled older position does not move latest_positions backwards'
);
select is(
  (select count(*)::int from public.position_events
   where participant_id = '00000000-0000-0000-0000-0000000000b1'),
  3,
  'the older position is still stored in the history'
);

-- A batch insert: latest_positions takes the newest position of the batch, whatever the order.
insert into public.position_events (
  participant_id, race_id, device_id, source_type, event_id, contract_version,
  recorded_at, received_at, lat, lon
) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000000000c1', 'mobile_app', '10000000-0000-4000-8000-000000000011', 1,
   '2026-11-14 10:07+00', '2026-11-14 10:08+00', 59.31, 18.05),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000000000c1', 'mobile_app', '10000000-0000-4000-8000-000000000012', 1,
   '2026-11-14 10:08+00', '2026-11-14 10:08+00', 59.32, 18.05),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000000000c1', 'mobile_app', '10000000-0000-4000-8000-000000000013', 1,
   '2026-11-14 10:06+00', '2026-11-14 10:08+00', 59.30, 18.05);
select is(
  (select event_id from public.latest_positions
   where participant_id = '00000000-0000-0000-0000-0000000000b1'),
  '10000000-0000-4000-8000-000000000012'::uuid,
  'after a batch insert, latest_positions holds the newest position of the batch'
);

-- A newer position from runner A's second device takes over.
select pg_temp.insert_position('10000000-0000-4000-8000-000000000020', '2026-11-14 10:09+00',
  device_id => '00000000-0000-0000-0000-0000000000c2', source_type => 'simulator',
  received_at => '2026-11-14 10:09+00');
select is(
  (select device_id from public.latest_positions
   where participant_id = '00000000-0000-0000-0000-0000000000b1'),
  '00000000-0000-0000-0000-0000000000c2'::uuid,
  'latest_positions takes the newest position from any of the participant''s devices'
);
select is(
  (select count(*)::int from public.latest_positions),
  2,
  'latest_positions has one row per participant with positions'
);

-- A direct update that would make latest_positions older is skipped.
update public.latest_positions set recorded_at = '2026-11-14 08:00+00', lat = 0
where participant_id = '00000000-0000-0000-0000-0000000000b1';
select is(
  (select recorded_at from public.latest_positions
   where participant_id = '00000000-0000-0000-0000-0000000000b1'),
  '2026-11-14 10:09+00'::timestamptz,
  'a direct update to an older position is ignored'
);

-- A duplicate resend (ignored by ingest with ON CONFLICT DO NOTHING) changes nothing.
insert into public.position_events (
  participant_id, race_id, device_id, source_type, event_id, contract_version,
  recorded_at, received_at, lat, lon
) values (
  '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000c1', 'mobile_app', '10000000-0000-4000-8000-000000000001', 1,
  '2026-11-14 11:00+00', '2026-11-14 11:00+00', 0, 0
) on conflict (participant_id, event_id) do nothing;
select is(
  (select recorded_at from public.latest_positions
   where participant_id = '00000000-0000-0000-0000-0000000000b1'),
  '2026-11-14 10:09+00'::timestamptz,
  'an ignored duplicate does not change latest_positions'
);

-- ---------------------------------------------------------------------------------------------
-- Deletion (e.g. a data-deletion request)
-- ---------------------------------------------------------------------------------------------
delete from public.participants where id = '00000000-0000-0000-0000-0000000000b1';
select is(
  (select count(*)::int from public.position_events
   where participant_id = '00000000-0000-0000-0000-0000000000b1'),
  0,
  'deleting a participant deletes their positions'
);
select is(
  (select count(*)::int from public.devices
   where participant_id = '00000000-0000-0000-0000-0000000000b1')
  + (select count(*)::int from public.latest_positions
     where participant_id = '00000000-0000-0000-0000-0000000000b1'),
  0,
  'deleting a participant deletes their devices and latest position'
);

select * from finish();
rollback;
