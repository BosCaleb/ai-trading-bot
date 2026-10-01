import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { type AlpacaBar, type StockBarsResponse, isRegularSession, request } from '@/lib/broker/alpaca'
import type { Bar, MarketConfig } from '@/lib/trading/types'

const DATA_BASE = 'https://data.alpaca.markets'
const CACHE_DIR = path.join(process.cwd(), '.cache', 'bars')

/**
 * Applies the same session rule as the live `getBars`: 15-minute index bars are restricted to the
 * regular session so the backtest computes means and bands over the same bars production sees.
 */
export function applyLiveBarFilter(market: MarketConfig, bars: Bar[]): Bar[] {
  if (market.assetClass === 'us_equity' && market.timeframe === '15Min') return bars.filter((b) => isRegularSession(b.t))
  return bars
}

/** Pages through Alpaca's historical bars for [from, to). Needs ALPACA_API_KEY / ALPACA_API_SECRET. */
export async function fetchHistoricalBars(market: MarketConfig, from: Date, to: Date): Promise<Bar[]> {
  const feed = process.env.ALPACA_DATA_FEED ?? 'iex'
  const raw: AlpacaBar[] = []
  let pageToken: string | null = null

  do {
    const params = new URLSearchParams({
      symbols: market.symbol,
      timeframe: market.timeframe,
      start: from.toISOString(),
      end: to.toISOString(),
      limit: '10000',
      sort: 'asc',
    })
    if (market.assetClass === 'us_equity') {
      params.set('adjustment', 'raw')
      params.set('feed', feed)
    }
    if (pageToken) params.set('page_token', pageToken)
    const endpoint = market.assetClass === 'crypto' ? '/v1beta3/crypto/us/bars' : '/v2/stocks/bars'
    const res: StockBarsResponse = await request<StockBarsResponse>(DATA_BASE, `${endpoint}?${params}`)
    raw.push(...(res.bars[market.symbol] ?? []))
    pageToken = res.next_page_token
  } while (pageToken)

  const bars = raw.map((b) => ({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))
  return applyLiveBarFilter(market, bars)
}

function cacheFile(market: MarketConfig, from: Date, to: Date): string {
  const day = (d: Date) => d.toISOString().slice(0, 10)
  const feed = market.assetClass === 'us_equity' ? `_${process.env.ALPACA_DATA_FEED ?? 'iex'}` : ''
  return path.join(CACHE_DIR, `${market.id}_${market.timeframe}${feed}_${day(from)}_${day(to)}.json`)
}

/** Fetches once, then serves from `.cache/bars` so repeated runs are fast, free and reproducible. */
export async function loadBarsCached(market: MarketConfig, from: Date, to: Date, opts: { refresh?: boolean } = {}): Promise<Bar[]> {
  const file = cacheFile(market, from, to)
  if (!opts.refresh) {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as Bar[]
    } catch {
      // cache miss falls through to the network
    }
  }
  const bars = await fetchHistoricalBars(market, from, to)
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(file, JSON.stringify(bars))
  return bars
}

/**
 * Parses OHLCV CSV with a header row. Accepts columns named t|time|timestamp|date, o|open, h|high,
 * l|low, c|close, v|volume (case-insensitive). Timestamps may be ISO strings or unix seconds/ms.
 */
export function parseBarsCsv(text: string): Bar[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const col = (...names: string[]) => {
    const idx = header.findIndex((h) => names.includes(h))
    if (idx < 0) throw new Error(`CSV is missing a column named one of: ${names.join(', ')}`)
    return idx
  }
  const it = col('t', 'time', 'timestamp', 'date', 'datetime')
  const io = col('o', 'open')
  const ih = col('h', 'high')
  const il = col('l', 'low')
  const ic = col('c', 'close')
  const iv = col('v', 'volume')

  const parseTime = (raw: string): number => {
    const v = raw.trim()
    if (/^\d+(\.\d+)?$/.test(v)) {
      const n = Number(v)
      return n < 1e12 ? n * 1000 : n
    }
    const ms = Date.parse(v)
    if (Number.isNaN(ms)) throw new Error(`Unparseable timestamp "${v}"`)
    return ms
  }

  return lines
    .slice(1)
    .map((line) => {
      const cells = line.split(',')
      return {
        t: parseTime(cells[it]),
        o: Number(cells[io]),
        h: Number(cells[ih]),
        l: Number(cells[il]),
        c: Number(cells[ic]),
        v: Number(cells[iv]),
      }
    })
    .sort((a, b) => a.t - b.t)
}

export async function loadBarsCsv(market: MarketConfig, file: string): Promise<Bar[]> {
  return applyLiveBarFilter(market, parseBarsCsv(await readFile(file, 'utf8')))
}
