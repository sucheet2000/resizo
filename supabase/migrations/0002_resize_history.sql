-- Make resize_history writable and owned.
--
-- The table is read by the dashboard and the GDPR export but was never written
-- until the tool routes started recording a row per processed image. This
-- guarantees the documented schema, the owning foreign key with an ON DELETE
-- CASCADE (so a deleted account takes its history with it), and the RLS
-- policies that let a signed-in session insert and read only its own rows.
--
-- Idempotent and guarded: CI validates migrations against an empty database
-- with no auth schema, so the whole body is a no-op there. Against a live
-- Supabase project it creates the table if missing and reconciles a partial one
-- column by column, matching supabase/migrations/0001's guarded style.
--
-- Column set is the union the readers require. The dashboard
-- (app/dashboard/DashboardClient.js) and the GDPR export
-- (app/api/account/export/route.js) read original_filename, the four dimension
-- columns, output_format, original_size_bytes and resized_size_bytes, so every
-- one of those exists here or the export's explicit column select would error.
-- The writer populates filename, formats and byte sizes today; the dimension
-- columns are nullable and populated as a follow-up (they need the per-route
-- output info), so the dashboard renders "—" for them until then.

do $$
begin
    if to_regclass('auth.users') is null then
        raise notice 'auth.users not present; skipping resize_history migration';
        return;
    end if;

    create table if not exists public.resize_history (
        id uuid primary key default gen_random_uuid(),
        user_id uuid,
        original_filename text,
        original_format text,
        output_format text,
        original_width integer,
        original_height integer,
        resized_width integer,
        resized_height integer,
        original_size_bytes bigint,
        resized_size_bytes bigint,
        created_at timestamptz default now()
    );

    -- Reconcile a table that already exists but predates a column.
    alter table public.resize_history add column if not exists user_id uuid;
    alter table public.resize_history add column if not exists original_filename text;
    alter table public.resize_history add column if not exists original_format text;
    alter table public.resize_history add column if not exists output_format text;
    alter table public.resize_history add column if not exists original_width integer;
    alter table public.resize_history add column if not exists original_height integer;
    alter table public.resize_history add column if not exists resized_width integer;
    alter table public.resize_history add column if not exists resized_height integer;
    alter table public.resize_history add column if not exists original_size_bytes bigint;
    alter table public.resize_history add column if not exists resized_size_bytes bigint;
    alter table public.resize_history add column if not exists created_at timestamptz default now();

    -- New rows attribute to the caller automatically, so a session insert that
    -- omits user_id is still owned and still cascades on delete.
    alter table public.resize_history
        alter column user_id set default auth.uid();

    -- Owning foreign key with cascade, added only if no FK exists yet.
    if not exists (
        select 1 from information_schema.table_constraints
        where table_schema = 'public'
          and table_name = 'resize_history'
          and constraint_type = 'FOREIGN KEY'
    ) then
        alter table public.resize_history
            add constraint resize_history_user_id_fkey
            foreign key (user_id) references auth.users (id) on delete cascade;
    end if;

    alter table public.resize_history enable row level security;

    -- create policy has no IF NOT EXISTS before PG15, so each is guarded.
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'resize_history'
          and policyname = 'Users can view own resize history'
    ) then
        create policy "Users can view own resize history"
            on public.resize_history for select
            using (auth.uid() = user_id);
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'resize_history'
          and policyname = 'Users can insert own resize history'
    ) then
        create policy "Users can insert own resize history"
            on public.resize_history for insert
            with check (auth.uid() = user_id);
    end if;

    create index if not exists resize_history_user_id_idx on public.resize_history (user_id);
end
$$;
