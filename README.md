# Shadow FX

Forex education, a private signal journal, and a VIP member area — built as
"Vertex 2.0," on the same Node/Express + Supabase stack as Vertex Chart
Scanner, so the two can merge once Vertex has enough users.

## What works right now
- Real accounts (Supabase auth) — signup, login, logout.
- Learning Hub: three lessons (forex basics, risk management, chart
  structure), each markable as complete per user.
- Signal Center: a user's own setup notes, saved to the database (not
  localStorage), private to their account.
- VIP Vault: shows locked/unlocked based on a real `is_vip` flag in the
  database. No payments yet — King grants VIP manually from `/admin`.
- Admin panel (`/admin`, gated to King's email): lists signups, toggles VIP
  per user.

## What's still a placeholder
- Pricing (R0 / R100 / R150) is shown on the landing page but nothing
  processes payments yet — upgrades are manual.
- No live market data or real trading signals — that's intentional, same
  honesty rule as the original Shadow FX starter.

## Run locally
1. `cd server && npm install`
2. Copy `server/.env.example` to `server/.env` and fill in the Supabase URL
   and anon key (Supabase dashboard -> Project Settings -> API).
3. `npm start` (or `npm run dev` to auto-restart on changes).
4. Open `http://localhost:3000`.

## Database setup
Run, in order, in the Supabase SQL editor:
1. `supabase/schema.sql`
2. `supabase/admin.sql`
