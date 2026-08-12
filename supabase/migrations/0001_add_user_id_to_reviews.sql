-- Give reviews an owner.
--
-- Reviews store a user-entered name and free-text body, which is personal
-- data, but the table carried no reference to the author. That made the rows
-- unreachable from /api/account/delete (there was no foreign key for the
-- cascade the route assumed) and invisible to /api/account/export.
--
-- Idempotent and guarded: CI validates migrations against an empty database,
-- where public.reviews does not exist yet, so the whole body is a no-op there
-- rather than a hard failure.
--
-- Existing rows keep user_id NULL. They cannot be backfilled — nothing in the
-- row identifies who wrote it — so they stay orphaned until deleted by hand.

do $$
begin
    if to_regclass('public.reviews') is null then
        raise notice 'public.reviews not present; skipping user_id migration';
        return;
    end if;

    alter table public.reviews
        add column if not exists user_id uuid references auth.users (id) on delete cascade;

    -- New rows get their author automatically, so a client insert that omits
    -- user_id is still attributable and still deletable.
    alter table public.reviews
        alter column user_id set default auth.uid();

    create index if not exists reviews_user_id_idx on public.reviews (user_id);
end
$$;
