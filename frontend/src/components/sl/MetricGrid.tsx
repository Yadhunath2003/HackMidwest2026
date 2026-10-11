import { money } from "@/lib/api";
import { signed, signedMoney, signedPercent } from "@/lib/format";
import type { AIUsage, Metrics } from "@/lib/types";
import { MetricCard } from "./MetricCard";
import { UsageLine } from "./UsageLine";

/** The run's headline numbers: four cards plus a strip. Nulls become "n/a" with a reason. */
export function MetricGrid({ metrics, usage }: { metrics: Metrics; usage?: AIUsage | null }) {
  const n = metrics.num_trades;
  const bh = metrics.buy_and_hold_return_pct;
  const wins = metrics.win_rate_pct == null ? 0 : Math.round((metrics.win_rate_pct * n) / 100);
  const strip: [string, string][] = [
    ["Net profit", signedMoney(metrics.net_profit)],
    ["Trades", String(n)],
    ["Fees + slippage", money(metrics.total_fees + metrics.total_slippage_cost)],
  ];
  if (bh != null) strip.push(["Buy & hold", signedPercent(bh)]);

  return (
    <div className="space-y-3">
      <div className="@container">
        <div className="grid grid-cols-2 gap-3 @min-[900px]:grid-cols-4">
          <MetricCard
            label="Total return" value={signed(metrics.total_return_pct)} unit="%"
            delta={bh != null ? { value: metrics.total_return_pct - bh, unit: "pts", context: "vs buy & hold" } : null}
            context={bh == null ? "No buy & hold comparison for this period" : undefined}
          />
          <MetricCard
            label="Win rate" value={metrics.win_rate_pct == null ? "n/a" : String(Number(metrics.win_rate_pct.toFixed(1)))} unit={metrics.win_rate_pct == null ? undefined : "%"}
            context={metrics.win_rate_pct == null ? "No completed trades" : `${wins} of ${n} trades`}
          />
          <MetricCard
            label="Max drawdown" value={metrics.max_drawdown_pct > 0 ? `−${metrics.max_drawdown_pct.toFixed(2)}` : "0.00"} unit="%"
            context="Largest peak-to-trough fall"
          />
          <MetricCard
            label="Profit factor" value={metrics.profit_factor == null ? "n/a" : metrics.profit_factor.toFixed(2)}
            context={metrics.profit_factor == null ? (n === 0 ? "No completed trades" : "No losing trades") : "Gross profit ÷ gross loss"}
          />
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[13px] text-muted-foreground">
        {strip.map(([label, value]) => (
          <span key={label}>{label} <strong className="font-mono font-medium text-foreground">{value}</strong></span>
        ))}
        <UsageLine usage={usage} />
      </p>
    </div>
  );
}
