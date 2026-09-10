-- Wipes and recreates every table from scratch (drops all existing data).
-- Run this once in Supabase: Project -> SQL Editor -> New query -> paste all of this -> Run.
-- Afterwards, re-import your bookings from the Airbnb CSVs via the app's Import button.

drop table if exists bookings;
drop table if exists expenses;
drop table if exists properties;

create table properties (
  name text primary key
);

create table bookings (
  id text primary key,
  import_ref text unique,
  guest text,
  phone text,
  property text,
  check_in date,
  check_out date,
  guests integer,
  total_amount numeric,
  guest_paid_airbnb numeric,
  airbnb_payout numeric,
  amount_direct numeric,
  direct_mode text,
  due_amount numeric,
  source text,
  created_by text,
  updated_by text,
  notes text,
  cancelled boolean default false,
  created_at timestamptz default now()
);

-- Expenses: either "fixed" (a recurring monthly cost, e.g. WiFi/maintenance retainer — applies
-- to every month from start_date through end_date, or ongoing if end_date is null) or "one_time"
-- (a single dated cost, e.g. a repair). Used to compute monthly profit (revenue - expenses).
create table expenses (
  id text primary key,
  kind text not null default 'one_time',
  name text not null,
  category text,
  amount numeric not null default 0,
  property text,
  expense_date date,
  start_date date,
  end_date date,
  notes text,
  created_by text,
  updated_by text,
  created_at timestamptz default now()
);

-- Row Level Security is on by default once enabled. These policies make every table
-- fully readable and writable by anyone holding your app's public "anon" key — the same
-- fully-open, link-based access model this app has used from the start. If you later want
-- per-staff row-level permissions, this is the layer to tighten (ask me and I'll help set that up).
alter table properties enable row level security;
alter table bookings enable row level security;
alter table expenses enable row level security;

create policy "public read properties" on properties for select using (true);
create policy "public write properties" on properties for all using (true) with check (true);
create policy "public read bookings" on bookings for select using (true);
create policy "public write bookings" on bookings for all using (true) with check (true);
create policy "public read expenses" on expenses for select using (true);
create policy "public write expenses" on expenses for all using (true) with check (true);

insert into properties (name) values ('Whimsy Suite') on conflict do nothing;
