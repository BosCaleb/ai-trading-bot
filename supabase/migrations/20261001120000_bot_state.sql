-- Trading desk state: loss-limit bookkeeping, trade journal and equity history.
--
-- Security: only the server talks to these tables, using the service-role key (which bypasses
-- RLS). Row level security is enabled with NO policies, so the public anon/authenticated keys
-- can neither read nor write anything here.

-- One row per trading mode, so paper results can never move live drawdown limits.
create table if not exists public.bot_state (
  mode text primary key check (mode in ('paper', 'live')),
  -- Highest equity seen; the 10% drawdown halt is measured from here.
  peak_equity numeric(18, 2),
  peak_at timestamptz,
  -- Trading day for the daily loss limit (Exness server day = UTC date) and equity at its start.
  day_key date,
  day_start_equity numeric(18, 2),
  -- Set while new entries are halted. daily_loss clears itself on the next day; drawdown and
  -- manual halts stay until someone resumes the bot.
  halt_reason text check (halt_reason in ('daily_loss', 'drawdown', 'manual')),
  halt_detail text,
  halted_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((halt_reason is null) = (halted_at is null))
);

insert into public.bot_state (mode) values ('paper'), ('live') on conflict (mode) do nothing;

-- Every bot entry, with the stop and risk it was sized on. Exits fill in the closing columns.
create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('paper', 'live')),
  market_id text not null,
  symbol text not null,
  side text not null check (side in ('long', 'short')),
  qty numeric(24, 9) not null check (qty > 0),
  entry_order_id text not null unique,
  entry_price numeric(18, 6),
  stop_price numeric(18, 6) not null,
  stop_distance numeric(18, 6) not null check (stop_distance > 0),
  risk_amount numeric(18, 2) not null check (risk_amount >= 0),
  equity_at_entry numeric(18, 2) not null,
  entry_reason text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  exit_price numeric(18, 6),
  exit_reason text,
  pnl numeric(18, 2),
  check ((closed_at is null) = (exit_reason is null))
);

-- One open trade per market per mode, mirroring the "one position per market" rule.
create unique index if not exists trades_one_open_per_market on public.trades (mode, market_id) where closed_at is null;
create index if not exists trades_opened_at on public.trades (opened_at desc);

-- Equity at every trading cycle: drawdown history and the evening report.
create table if not exists public.equity_snapshots (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  mode text not null check (mode in ('paper', 'live')),
  equity numeric(18, 2) not null,
  source text not null
);

create index if not exists equity_snapshots_mode_at on public.equity_snapshots (mode, at desc);

alter table public.bot_state enable row level security;
alter table public.trades enable row level security;
alter table public.equity_snapshots enable row level security;

-- Belt and braces on Supabase: strip the default grants from the public API roles.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.bot_state, public.trades, public.equity_snapshots from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.bot_state, public.trades, public.equity_snapshots from authenticated;
  end if;
end
$$;
