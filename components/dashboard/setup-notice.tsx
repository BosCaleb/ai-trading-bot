import { KeyRound } from 'lucide-react'

const BROKER_VARS = ['ALPACA_API_KEY', 'ALPACA_API_SECRET', 'DASHBOARD_PASSWORD', 'CRON_SECRET']
const OPTIONAL_VARS = ['ALPACA_PAPER (default true)', 'DASHBOARD_USER', 'BOT_ENABLED (default true)']
const SMS_VARS = ['BULKSMS_TOKEN_ID', 'BULKSMS_TOKEN_SECRET', 'ALERT_TO_NUMBERS (comma-separated)']
const STATE_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']

export function SetupNotice({ smsConfigured, stateConfigured }: { smsConfigured: boolean; stateConfigured: boolean }) {
  return (
    <section aria-labelledby="setup-heading" className="flex flex-col gap-4 rounded-lg border border-primary/40 bg-primary/5 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-primary" aria-hidden="true" />
        <h2 id="setup-heading" className="text-sm font-semibold">
          Connect the broker to go live
        </h2>
      </div>
      <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
        The strategies, risk filters and schedules are all in place. The desk trades through Alpaca (SPY, QQQ, GLD, USO and BTC/USD) and starts in
        paper mode. Add these variables in the Vars section of project settings; the dashboard fills in the moment they land.
      </p>
      <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <VarGroup title="Required" vars={BROKER_VARS} />
        <VarGroup title={stateConfigured ? 'Storage connected' : 'Storage (Supabase)'} vars={STATE_VARS} />
        <VarGroup title="Optional" vars={OPTIONAL_VARS} />
        <VarGroup title={smsConfigured ? 'SMS connected' : 'SMS (BulkSMS)'} vars={SMS_VARS} />
      </div>
    </section>
  )
}

function VarGroup({ title, vars }: { title: string; vars: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="tracking-wider text-muted-foreground uppercase">{title}</span>
      <ul className="flex flex-col gap-1 font-mono">
        {vars.map((v) => (
          <li key={v} className="rounded-sm bg-background/60 px-2 py-1">
            {v}
          </li>
        ))}
      </ul>
    </div>
  )
}
