# Spare Key — Whimsy Suite booking manager

A self-hosted rebuild of the app, using:
- **Netlify** — free hosting for the website
- **Supabase** — free Postgres database for real, reliable storage

## 1. Create the database (Supabase)

1. Go to supabase.com, sign up free, create a new project (pick any name/region/password).
2. Once it's ready, open **SQL Editor** → **New query**.
3. Paste the entire contents of `supabase/schema.sql` and click **Run**.
   This creates your tables and pre-loads your 9 existing Airbnb bookings with the corrected amounts.
4. Go to **Project Settings → API**. Copy the **Project URL** and the **anon public** key — you'll need both next.

## 2. Run it locally (optional, to test before deploying)

```
npm install
cp .env.example .env
# edit .env and paste in your Supabase URL + anon key
npm run dev
```

## 3. Deploy to Netlify

**Easiest path — drag and drop:**
1. Run `npm run build` locally (this creates a `dist` folder).
2. Go to app.netlify.com → drag the `dist` folder onto the page.
3. Once deployed, go to **Site configuration → Environment variables** and add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Trigger a redeploy (Deploys tab → Trigger deploy) so the build picks up those variables.

**Better path for ongoing updates — connect to GitHub:**
1. Push this project to a new GitHub repo.
2. In Netlify: **Add new site → Import an existing project → GitHub** → pick the repo.
3. Build command is already set via `netlify.toml` (`npm run build`, publishes `dist`).
4. Add the same two environment variables before the first deploy.
5. Every future push to the repo auto-deploys — this is what solves the "my changes aren't showing up" problem for good, since Netlify's deploy log tells you exactly what's live.

## Viewing your data directly

In Supabase, go to **Table Editor → bookings** any time to see every booking as a real spreadsheet-like table — no need to open the app for a quick look.

## Security note

The database is currently open to anyone with your Supabase anon key (which is bundled into
the app's public JS, same open-access model as before). If you want real per-staff logins later,
that's a Supabase Auth + Row Level Security change — ask and I'll help set it up.
