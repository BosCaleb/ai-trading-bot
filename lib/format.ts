export function fmtMoney(n: number | null | undefined, opts: { signed?: boolean; compact?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const body = abs.toLocaleString('en-US', {
    minimumFractionDigits: opts.compact ? 0 : 2,
    maximumFractionDigits: opts.compact ? 0 : 2,
  })
  const sign = n < 0 ? '-' : opts.signed && n > 0 ? '+' : ''
  return `${sign}$${body}`
}

export function fmtPct(n: number | null | undefined, digits = 2, signed = true): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : signed && n > 0 ? '+' : ''
  return `${sign}${(Math.abs(n) * 100).toFixed(digits)}%`
}

export function fmtPrice(n: number | null | undefined, symbol?: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const digits = symbol === 'BTC' ? 0 : 2
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtQty(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

const ET_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
})

const ET_DATETIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const LOCAL_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Etc/GMT-2',
  hour: '2-digit',
  minute: '2-digit',
})

/** Report delivery time in the user's zone (GMT+2, fixed offset). */
export function fmtTimeLocal(iso: string | null | undefined): string {
  if (!iso) return '—'
  return `${LOCAL_TIME.format(new Date(iso))} GMT+2`
}

export function fmtTimeET(iso: string | null | undefined): string {
  if (!iso) return '—'
  return `${ET_TIME.format(new Date(iso))} ET`
}

export function fmtDateTimeET(iso: string | null | undefined): string {
  if (!iso) return '—'
  return `${ET_DATETIME.format(new Date(iso))} ET`
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function plClass(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return 'text-foreground'
  return n > 0 ? 'text-positive' : 'text-negative'
}
