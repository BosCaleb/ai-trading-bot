import { TIMEFRAME_META } from '@/lib/trading/markets'
import type { Bar, MarketConfig, OrderInfo, PositionInfo } from '@/lib/trading/types'

export class BrokerNotConfiguredError extends Error {
  constructor() {
    super('Broker is not configured. Set ALPACA_API_KEY and ALPACA_API_SECRET.')
    this.name = 'BrokerNotConfiguredError'
  }
}

export type TradingMode = 'paper' | 'live'

export function tradingMode(): TradingMode {
  return process.env.ALPACA_PAPER === 'false' ? 'live' : 'paper'
}

export function isBrokerConfigured(): boolean {
  return Boolean(process.env.ALPACA_API_KEY && process.env.ALPACA_API_SECRET)
}

const DATA_BASE = 'https://data.alpaca.markets'

function tradingBase(): string {
  return tradingMode() === 'live' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets'
}

function headers(): Record<string, string> {
  if (!isBrokerConfigured()) throw new BrokerNotConfiguredError()
  return {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY as string,
    'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET as string,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

export async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) }, cache: 'no-store' })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Alpaca ${init?.method ?? 'GET'} ${path} failed (${res.status}): ${body.slice(0, 300)}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

interface AlpacaAccount {
  equity: string
  cash: string
  last_equity: string
  buying_power: string
  portfolio_value: string
  status: string
}

export interface AccountInfo {
  equity: number
  cash: number
  lastEquity: number
  buyingPower: number
  dayPl: number
  dayPlPct: number
  status: string
}

export async function getAccount(): Promise<AccountInfo> {
  const a = await request<AlpacaAccount>(tradingBase(), '/v2/account')
  const equity = Number(a.equity)
  const lastEquity = Number(a.last_equity)
  return {
    equity,
    cash: Number(a.cash),
    lastEquity,
    buyingPower: Number(a.buying_power),
    dayPl: equity - lastEquity,
    dayPlPct: lastEquity > 0 ? (equity - lastEquity) / lastEquity : 0,
    status: a.status,
  }
}

interface AlpacaClock {
  is_open: boolean
  next_open: string
  next_close: string
  timestamp: string
}

export interface ClockInfo {
  isOpen: boolean
  nextOpen: string
  nextClose: string
}

export async function getClock(): Promise<ClockInfo> {
  const c = await request<AlpacaClock>(tradingBase(), '/v2/clock')
  return { isOpen: c.is_open, nextOpen: c.next_open, nextClose: c.next_close }
}

interface AlpacaPosition {
  symbol: string
  qty: string
  side: 'long' | 'short'
  avg_entry_price: string
  current_price: string
  market_value: string
  unrealized_pl: string
  unrealized_plpc: string
}

export async function getPositions(): Promise<PositionInfo[]> {
  const rows = await request<AlpacaPosition[]>(tradingBase(), '/v2/positions')
  return rows.map((p) => ({
    symbol: p.symbol,
    side: p.side,
    qty: Math.abs(Number(p.qty)),
    avgEntry: Number(p.avg_entry_price),
    currentPrice: Number(p.current_price),
    marketValue: Number(p.market_value),
    unrealizedPl: Number(p.unrealized_pl),
    unrealizedPlPct: Number(p.unrealized_plpc),
  }))
}

interface AlpacaOrder {
  id: string
  symbol: string
  side: 'buy' | 'sell'
  type: string
  qty: string | null
  notional: string | null
  filled_qty: string
  filled_avg_price: string | null
  stop_price: string | null
  status: string
  order_class: string
  submitted_at: string
  filled_at: string | null
  legs?: AlpacaOrder[] | null
}

function mapOrder(o: AlpacaOrder): OrderInfo {
  return {
    id: o.id,
    symbol: o.symbol,
    side: o.side,
    type: o.type,
    qty: o.qty ? Number(o.qty) : null,
    notional: o.notional ? Number(o.notional) : null,
    filledQty: Number(o.filled_qty ?? 0),
    filledAvgPrice: o.filled_avg_price ? Number(o.filled_avg_price) : null,
    stopPrice: o.stop_price ? Number(o.stop_price) : null,
    status: o.status,
    orderClass: o.order_class || 'simple',
    submittedAt: o.submitted_at,
    filledAt: o.filled_at,
  }
}

export async function getOrders(limit = 50): Promise<OrderInfo[]> {
  const rows = await request<AlpacaOrder[]>(tradingBase(), `/v2/orders?status=all&limit=${limit}&direction=desc&nested=true`)
  return rows.map(mapOrder)
}

export async function getOrder(id: string): Promise<OrderInfo> {
  return mapOrder(await request<AlpacaOrder>(tradingBase(), `/v2/orders/${id}`))
}

/** Every working order, listed flat (not nested) so OTO stop legs show up as their own rows. */
export async function getOpenOrders(): Promise<OrderInfo[]> {
  const rows = await request<AlpacaOrder[]>(tradingBase(), '/v2/orders?status=open&limit=500&nested=false')
  return rows.map(mapOrder)
}

interface AlpacaPortfolioHistory {
  timestamp: number[]
  equity: (number | null)[]
  profit_loss: (number | null)[]
  base_value: number
}

export interface EquityPoint {
  t: number
  equity: number
}

export async function getPortfolioHistory(period = '1M', timeframe = '1D'): Promise<EquityPoint[]> {
  const h = await request<AlpacaPortfolioHistory>(
    tradingBase(),
    `/v2/account/portfolio/history?period=${period}&timeframe=${timeframe}&intraday_reporting=extended_hours`,
  )
  return h.timestamp
    .map((t, i) => ({ t: t * 1000, equity: h.equity[i] }))
    .filter((p): p is EquityPoint => typeof p.equity === 'number' && p.equity > 0)
}

export interface AlpacaBar {
  t: string
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface StockBarsResponse {
  bars: Record<string, AlpacaBar[] | undefined>
  next_page_token: string | null
}

const ET_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function minutesIntoEasternDay(ms: number): number {
  const parts = ET_FORMAT.formatToParts(new Date(ms))
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

/** Regular US session is 09:30-16:00 ET. Intraday index bars outside it are thin and distort the mean. */
export function isRegularSession(ms: number): boolean {
  const m = minutesIntoEasternDay(ms)
  return m >= 9 * 60 + 30 && m < 16 * 60
}

export async function getBars(market: MarketConfig, limit = 200): Promise<Bar[]> {
  const meta = TIMEFRAME_META[market.timeframe]
  const start = new Date(Date.now() - meta.lookbackDays * 86_400_000).toISOString()
  const symbol = encodeURIComponent(market.symbol)

  let raw: AlpacaBar[]
  if (market.assetClass === 'crypto') {
    const res = await request<StockBarsResponse>(
      DATA_BASE,
      `/v1beta3/crypto/us/bars?symbols=${symbol}&timeframe=${market.timeframe}&start=${start}&limit=10000&sort=asc`,
    )
    raw = res.bars[market.symbol] ?? []
  } else {
    const feed = process.env.ALPACA_DATA_FEED ?? 'iex'
    const res = await request<StockBarsResponse>(
      DATA_BASE,
      `/v2/stocks/bars?symbols=${symbol}&timeframe=${market.timeframe}&start=${start}&limit=10000&adjustment=raw&feed=${feed}&sort=asc`,
    )
    raw = res.bars[market.symbol] ?? []
  }

  let bars: Bar[] = raw.map((b) => ({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))
  if (market.assetClass === 'us_equity' && market.timeframe === '15Min') {
    bars = bars.filter((b) => isRegularSession(b.t))
  }
  return bars.slice(-limit)
}

/** Drops the still-forming bar so strategies only ever evaluate closed candles. */
export function closedBars(bars: Bar[], timeframe: MarketConfig['timeframe']): Bar[] {
  if (bars.length === 0) return bars
  const durationMs = { '15Min': 15 * 60_000, '1Hour': 60 * 60_000, '4Hour': 4 * 60 * 60_000 }[timeframe]
  const lastBar = bars[bars.length - 1]
  return lastBar.t + durationMs > Date.now() ? bars.slice(0, -1) : bars
}

export interface EntryOrderInput {
  market: MarketConfig
  side: 'long' | 'short'
  qty: number
  referencePrice: number
  stopPrice: number
}

export interface EntryOrderResult {
  orderId: string
  stopOrderId: string | null
  fillPrice: number | null
  stopPrice: number
}

async function waitForFill(orderId: string, attempts = 6): Promise<OrderInfo> {
  let order = await getOrder(orderId)
  for (let i = 0; i < attempts && order.status !== 'filled'; i++) {
    await new Promise((r) => setTimeout(r, 800))
    order = await getOrder(orderId)
  }
  return order
}

/** Crypto stops are stop-limits; the limit sits this far beyond the trigger so a fast move still fills. */
const CRYPTO_STOP_LIMIT_BUFFER = 0.005

/**
 * Places a standalone good-til-cancelled stop that flattens `qty` of a position.
 * Equities get a plain stop (market on trigger); crypto only accepts stop-limit.
 */
export async function submitProtectiveStop(input: {
  market: MarketConfig
  side: 'long' | 'short'
  qty: number
  stopPrice: number
}): Promise<OrderInfo> {
  const { market, side, qty, stopPrice } = input
  const exitSide = side === 'long' ? 'sell' : 'buy'
  const body: Record<string, string> = {
    symbol: market.symbol,
    qty: String(qty),
    side: exitSide,
    time_in_force: 'gtc',
    stop_price: stopPrice.toFixed(2),
  }
  if (market.assetClass === 'crypto') {
    const buffer = side === 'long' ? 1 - CRYPTO_STOP_LIMIT_BUFFER : 1 + CRYPTO_STOP_LIMIT_BUFFER
    body.type = 'stop_limit'
    body.limit_price = (stopPrice * buffer).toFixed(2)
  } else {
    body.type = 'stop'
  }
  return mapOrder(await request<AlpacaOrder>(tradingBase(), '/v2/orders', { method: 'POST', body: JSON.stringify(body) }))
}

/**
 * Submits the entry and its protective stop.
 * Equities use a one-triggers-other order so the stop is attached atomically at the broker.
 * The OTO is good-til-cancelled: with `day`, Alpaca cancels the stop leg at the close and any
 * position carried overnight would sit unprotected.
 * Crypto does not support OTO, so a stop-limit is submitted right after the market fill.
 */
export async function submitEntry(input: EntryOrderInput): Promise<EntryOrderResult> {
  const { market, side, qty, stopPrice } = input
  const orderSide = side === 'long' ? 'buy' : 'sell'

  if (market.assetClass === 'us_equity') {
    const order = await request<AlpacaOrder>(tradingBase(), '/v2/orders', {
      method: 'POST',
      body: JSON.stringify({
        symbol: market.symbol,
        qty: String(qty),
        side: orderSide,
        type: 'market',
        time_in_force: 'gtc',
        order_class: 'oto',
        stop_loss: { stop_price: stopPrice.toFixed(2) },
      }),
    })
    const filled = await waitForFill(order.id)
    return {
      orderId: order.id,
      stopOrderId: order.legs?.[0]?.id ?? null,
      fillPrice: filled.filledAvgPrice,
      stopPrice,
    }
  }

  const order = await request<AlpacaOrder>(tradingBase(), '/v2/orders', {
    method: 'POST',
    body: JSON.stringify({
      symbol: market.symbol,
      qty: String(qty),
      side: orderSide,
      type: 'market',
      time_in_force: 'gtc',
    }),
  })
  const filled = await waitForFill(order.id)
  const fillPrice = filled.filledAvgPrice ?? input.referencePrice
  const actualStop = Number((side === 'long' ? fillPrice * 0.99 : fillPrice * 1.01).toFixed(2))
  const filledQty = filled.filledQty > 0 ? filled.filledQty : qty

  const stop = await submitProtectiveStop({ market, side, qty: filledQty, stopPrice: actualStop })

  return { orderId: order.id, stopOrderId: stop.id, fillPrice, stopPrice: actualStop }
}

/** Flattens the position and cancels any resting stop orders for it. */
export async function closePosition(market: MarketConfig): Promise<OrderInfo | null> {
  const symbol = encodeURIComponent(market.symbol.replace('/', ''))
  const order = await request<AlpacaOrder | undefined>(tradingBase(), `/v2/positions/${symbol}?cancel_orders=true`, {
    method: 'DELETE',
  })
  return order ? mapOrder(order) : null
}
