-- Run this entire file in Supabase: SQL Editor -> New query -> Run.
-- It creates the permanent cloud database for public reviews and buyer requests.

create extension if not exists pgcrypto;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  text text not null check (char_length(trim(text)) > 0),
  rating integer not null check (rating between 1 and 5),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz
);

create table if not exists public.project_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  text text not null check (char_length(trim(text)) > 0),
  status text not null default 'new' check (status in ('new', 'answered')),
  admin_reply text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.telegram_admin_chats (
  chat_id bigint primary key,
  chat_type text not null default 'private',
  display_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists project_requests_touch_updated_at on public.project_requests;
create trigger project_requests_touch_updated_at
before update on public.project_requests
for each row
execute function public.touch_updated_at();

drop trigger if exists telegram_admin_chats_touch_updated_at on public.telegram_admin_chats;
create trigger telegram_admin_chats_touch_updated_at
before update on public.telegram_admin_chats
for each row
execute function public.touch_updated_at();

alter table public.reviews enable row level security;
alter table public.project_requests enable row level security;
alter table public.telegram_admin_chats enable row level security;

drop policy if exists "public can read reviews" on public.reviews;
create policy "public can read reviews"
on public.reviews
for select
to anon, authenticated
using (true);

drop policy if exists "public can create reviews" on public.reviews;
create policy "public can create reviews"
on public.reviews
for insert
to anon, authenticated
with check (true);

drop policy if exists "public can create project requests" on public.project_requests;
create policy "public can create project requests"
on public.project_requests
for insert
to anon, authenticated
with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert on public.reviews to anon, authenticated;
grant insert on public.project_requests to anon, authenticated;
