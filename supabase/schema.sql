-- Run this entire file in Supabase: SQL Editor -> New query -> Run.
-- It creates the permanent cloud database for public reviews and buyer requests.

create extension if not exists pgcrypto;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  text text not null check (char_length(trim(text)) > 0),
  rating integer not null check (rating between 1 and 5),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz
);

create table if not exists public.project_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_details text not null check (char_length(trim(contact_details)) > 0),
  text text not null check (char_length(trim(text)) > 0),
  status text not null default 'new' check (status in ('new', 'answered', 'rejected')),
  admin_reply text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create sequence if not exists public.project_request_number_seq;
alter table public.project_requests add column if not exists request_number bigint;
alter table public.project_requests add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.reviews add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.project_requests alter column request_number set default nextval('public.project_request_number_seq');
with numbered_requests as (
  select id, row_number() over (order by created_at asc, id asc) as request_number
  from public.project_requests
  where request_number is null
)
update public.project_requests
set request_number = numbered_requests.request_number
from numbered_requests
where public.project_requests.id = numbered_requests.id;
select setval(
  'public.project_request_number_seq',
  coalesce((select max(request_number) from public.project_requests), 0) + 1,
  false
);
alter table public.project_requests alter column request_number set not null;
alter table public.project_requests drop constraint if exists project_requests_request_number_key;
alter table public.project_requests add constraint project_requests_request_number_key unique (request_number);
alter table public.project_requests add column if not exists contact_details text;
update public.project_requests
set contact_details = 'Не указан'
where contact_details is null or char_length(trim(contact_details)) = 0;
alter table public.project_requests alter column contact_details set not null;
alter table public.project_requests drop constraint if exists project_requests_contact_details_check;
alter table public.project_requests add constraint project_requests_contact_details_check check (char_length(trim(contact_details)) > 0);

create table if not exists public.telegram_admin_chats (
  chat_id bigint primary key,
  chat_type text not null default 'private',
  display_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.request_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null default timezone('utc', now()),
  request_count integer not null default 0
);

create or replace function public.check_request_rate_limit(p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  is_allowed boolean;
begin
  insert into public.request_rate_limits (rate_key, window_started_at, request_count)
  values (p_key, timezone('utc', now()), 1)
  on conflict (rate_key) do update
  set
    window_started_at = case
      when public.request_rate_limits.window_started_at < timezone('utc', now()) - interval '10 minutes'
        then timezone('utc', now())
      else public.request_rate_limits.window_started_at
    end,
    request_count = case
      when public.request_rate_limits.window_started_at < timezone('utc', now()) - interval '10 minutes'
        then 1
      else public.request_rate_limits.request_count + 1
    end
  returning request_count <= 1 into is_allowed;

  return is_allowed;
end;
$$;

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
alter table public.request_rate_limits enable row level security;

drop policy if exists "public can read reviews" on public.reviews;
create policy "public can read reviews"
on public.reviews
for select
to anon, authenticated
using (true);

grant usage on schema public to anon, authenticated;
grant select on public.reviews to anon, authenticated;
revoke insert on public.reviews from anon, authenticated;
revoke insert on public.project_requests from anon, authenticated;
revoke all on function public.check_request_rate_limit(text) from public, anon, authenticated;
grant execute on function public.check_request_rate_limit(text) to service_role;

drop policy if exists "users can read own project requests" on public.project_requests;
create policy "users can read own project requests"
on public.project_requests
for select
to authenticated
using (user_id = auth.uid());

create index if not exists project_requests_user_id_created_at_idx
on public.project_requests (user_id, created_at desc);

do $$
begin
  alter publication supabase_realtime add table public.project_requests;
exception
  when duplicate_object then null;
end $$;
