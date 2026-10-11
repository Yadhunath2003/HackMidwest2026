import { formatTime } from "@/lib/api";
import { quantityUnit } from "@/lib/format";
import type { PaperSignal } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "./Badge";
import { NUM, TableWrap, TD, TH } from "./table";

/** Paper BUY / SELL signals, newest first. The side is a worded badge; detected time can lag the candle time. */
export function SignalTable({ signals, symbol, maxHeight }: { signals: PaperSignal[]; symbol: string; maxHeight?: number }) {
  return (
    <section className="space-y-2" aria-labelledby="signals-heading">
      <h2 id="signals-heading" className="text-sm font-semibold">Paper buy and sell signals</h2>
      {signals.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">No signals yet. Waiting for this strategy&apos;s conditions.</p>
      ) : (
        <TableWrap maxHeight={maxHeight}>
          <caption className="sr-only">Paper signals, newest first. Each BUY or SELL is marked on the live chart.</caption>
          <thead>
            <tr>
              <th className={TH}>Signal</th>
              <th className={cn(TH, "text-right")}>Candle / detected (UTC)</th>
              <th className={cn(TH, "text-right")}>Paper price</th>
              <th className={cn(TH, "text-right")}>{quantityUnit(symbol)}</th>
              <th className={TH}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {[...signals].reverse().map((s) => (
              <tr key={s.id}>
                <td className={TD}><Badge tone={s.side === "BUY" ? "brand" : "negative"}>{s.direction === "short" ? (s.action === "entry" ? "SELL SHORT" : "BUY TO COVER") : s.side}</Badge></td>
                <td className={cn(TD, NUM, "leading-5")}>
                  <span className="block">{formatTime(s.time)}</span>
                  <span className="block text-muted-foreground">{s.detected_at.slice(0, 19).replace("T", " ")}</span>
                </td>
                <td className={cn(TD, NUM)}>{s.price.toLocaleString("en-US", { style: "currency", currency: "USD" })}</td>
                <td className={cn(TD, NUM)}>{s.quantity}</td>
                <td className={cn(TD, "min-w-[220px] whitespace-normal")}>{s.reason}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </section>
  );
}
