# Storage (Supabase)

The bot keeps three things in Supabase Postgres:

| Table              | What it holds                                                                 |
| ------------------ | ----------------------------------------------------------------------------- |
| `bot_state`        | One row per mode (paper/live): peak equity, the day's starting equity, halts   |
| `trades`           | Every bot entry with its original stop and risk; exits fill in the close      |
| `equity_snapshots` | Account equity at every trading cycle                                         |

Without Supabase the bot still trades, but nothing is remembered between runs: missing stops are
restored at a generic ATR estimate instead of the original stop, and the loss limits cannot work.

## Setup (about 5 minutes, free tier)

1. Create a project at [supabase.com](https://supabase.com). Pick a region close to where the bot
   runs.
2. Open **SQL Editor**, paste the contents of `supabase/migrations/20261001120000_bot_state.sql`
   and run it. It is safe to run more than once.
3. In **Project Settings → API**, copy the **Project URL** and the **service_role** secret.
4. Add them to Vercel (and `.env.local` for local runs):

   ```
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service_role secret>
   ```

5. Redeploy. The setup panel shows "Storage connected", and each cron response includes
   `"journal": { "enabled": true, "errors": [] }`.

## Security

- The service-role key bypasses row level security. It is only read on the server; never give it a
  `NEXT_PUBLIC_` prefix or paste it into client code.
- Every table has RLS enabled with no policies, and the migration revokes the public `anon` and
  `authenticated` grants, so the project's public API key cannot read or write anything.
- If the database is unreachable, trading continues (stops and exits are never blocked by storage)
  and the failure is logged under `[cron:<tf>:journal]`.
