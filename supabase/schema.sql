-- Run this once in Supabase: Project -> SQL Editor -> New query -> paste all of this -> Run.

create table if not exists properties (
  name text primary key
);

create table if not exists bookings (
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
  source text,
  entered_by text,
  notes text,
  cancelled boolean default false,
  created_at timestamptz default now()
);

-- Row Level Security is on by default once enabled. These policies make bookings/properties
-- fully readable and writable by anyone holding your app's public "anon" key — the same
-- fully-open, link-based access model your Claude-artifact version used. If you later want
-- per-staff logins, this is the layer to tighten (ask me and I'll help set that up).
alter table properties enable row level security;
alter table bookings enable row level security;

create policy "public read properties" on properties for select using (true);
create policy "public write properties" on properties for all using (true) with check (true);
create policy "public read bookings" on bookings for select using (true);
create policy "public write bookings" on bookings for all using (true) with check (true);

insert into properties (name) values ('Whimsy Suite') on conflict do nothing;

insert into bookings (
  id, import_ref, guest, phone, property, check_in, check_out, guests,
  total_amount, guest_paid_airbnb, airbnb_payout, amount_direct, direct_mode,
  source, entered_by, notes, cancelled
) values
  ('import-HMBMYNHEAT', 'HMBMYNHEAT', 'Riya Jain', '', 'Whimsy Suite', '2026-09-04', '2026-09-05', 1, 2730, 2730, 2194.40, null, null, 'Airbnb', '', 'Imported from Airbnb (confirmation HMBMYNHEAT)', false),
  ('import-HMN4QNT2YS', 'HMN4QNT2YS', 'Krish Ramani', '', 'Whimsy Suite', '2026-09-03', '2026-09-04', 1, 2328, 2328, 1964.83, null, null, 'Airbnb', '', 'Imported from Airbnb (confirmation HMN4QNT2YS)', false),
  ('import-HMM9EEN34E', 'HMM9EEN34E', 'Avinash Singh', '', 'Whimsy Suite', '2026-08-31', '2026-09-03', 1, 6513.60, 6513.60, 6311.68, null, null, 'Airbnb', '', 'Imported from Airbnb (confirmation HMM9EEN34E)', false),
  ('import-HMYX2PPJC3', 'HMYX2PPJC3', 'Abhimanyue Singh', '', 'Whimsy Suite', '2026-08-30', '2026-08-31', 1, 2750, 2750, 2321.00, null, null, 'Airbnb', '', 'Imported from Airbnb (confirmation HMYX2PPJC3)', false),
  ('import-HMNBCJDW35', 'HMNBCJDW35', 'Gaurav Bhinda', '', 'Whimsy Suite', '2026-08-29', '2026-08-30', 1, 2388.32, 2388.32, 2314.28, null, null, 'Airbnb', '', 'Imported from Airbnb (confirmation HMNBCJDW35)', false),
  ('import-HMTQD2RCRM', 'HMTQD2RCRM', 'Gauri Khan', '', 'Whimsy Suite', '2026-08-28', '2026-08-29', 1, 2120, 2120, 2054.28, null, null, 'Airbnb', '', 'Imported from Airbnb (confirmation HMTQD2RCRM)', false),
  ('import-HMZ5FMQRYP', 'HMZ5FMQRYP', 'Nush P', '', 'Whimsy Suite', '2026-08-27', '2026-08-28', 1, 2171.20, 2171.20, 2103.89, null, null, 'Airbnb', '', 'Imported from Airbnb (confirmation HMZ5FMQRYP)', false),
  ('import-HMSBE3X99E', 'HMSBE3X99E', 'Priya Rajpoot', '', 'Whimsy Suite', '2026-08-24', '2026-08-27', 1, 6211.20, 6211.20, 5714.30, null, null, 'Airbnb', '', 'Imported from Airbnb (confirmation HMSBE3X99E)', false),
  ('import-HMJK54NN2C', 'HMJK54NN2C', 'Akshay Pathak', '', 'Whimsy Suite', '2026-08-22', '2026-08-24', 1, 2090.40, 2090.40, 1923.17, null, null, 'Airbnb', '', 'Imported from Airbnb (confirmation HMJK54NN2C)', false)
on conflict (id) do update set
  total_amount = excluded.total_amount,
  guest_paid_airbnb = excluded.guest_paid_airbnb,
  check_out = excluded.check_out;
