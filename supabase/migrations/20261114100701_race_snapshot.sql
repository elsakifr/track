-- Controlled spectator access to current positions (#6, ADR-0009).
--
-- Spectators never read position tables. They call public.get_race_snapshot(race_id), which
-- returns only what the caller may see, and only while the race is published and inside its
-- tracking window. The two rules live in separate functions so other access paths (e.g. the
-- participant channel policies in #18) can reuse exactly the same rules.

-- Who may see a participant's position: public participants, and the participant themself.
-- Follower access (#18) is added by replacing this function's body; callers do not change.
create function private.can_view_participant(target_participant_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.participants p
    where p.id = target_participant_id
      and (
        p.visibility = 'public'
        or (p.user_id is not null and p.user_id = auth.uid())
      )
  );
$$;

-- Whether positions of a race may be shown now: published, and inside the race's configurable
-- tracking window.
create function private.race_is_live(target_race_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.races r
    where r.id = target_race_id
      and r.is_published
      and now() between r.starts_at - r.tracking_opens_before
                    and r.ends_at + r.tracking_closes_after
  );
$$;

revoke all on function private.can_view_participant(uuid) from public;
revoke all on function private.race_is_live(uuid) from public;

-- The current position of every participant the caller may see in a live race. A race that is
-- unknown, unpublished or outside its window returns no rows (it does not reveal whether the
-- race exists). Fixed column list: no names, user IDs, device or source data, and no history.
create function public.get_race_snapshot(target_race_id uuid)
returns table (
  participant_id uuid,
  recorded_at timestamptz,
  lat double precision,
  lon double precision,
  accuracy_m double precision
)
language sql
stable
security definer
set search_path = ''
as $$
  select lp.participant_id, lp.recorded_at, lp.lat, lp.lon, lp.accuracy_m
  from public.latest_positions lp
  where lp.race_id = target_race_id
    and private.race_is_live(target_race_id)
    and private.can_view_participant(lp.participant_id)
  order by lp.participant_id;
$$;

-- Spectators have a session (anonymous sign-in, ADR-0009), so only `authenticated` may call it.
revoke all on function public.get_race_snapshot(uuid) from public, anon;
grant execute on function public.get_race_snapshot(uuid) to authenticated;
