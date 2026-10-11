import { formatTime, money } from "@/lib/api";
import { exitLabel, quantityUnit } from "@/lib/format";
import type { Trade } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NUM, TableWrap, TD, TH } from "./table";

/** The sell fills of one trade, shown when it has more than one exit. */
export function FillsTable({ fills, symbol, skipped }: { fills: NonNullable<Trade["exits"]>; symbol: string; skipped?: string | null }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-sm font-semibold">Sell fills</h4>
      <TableWrap>
        <thead>
          <tr>
            <th className={TH}>Time (UTC)</th>
            <th className={TH}>Reason</th>
            <th className={cn(TH, "text-right")}>{quantityUnit(symbol)}</th>
            <th className={cn(TH, "text-right")}>Price</th>
            <th className={cn(TH, "text-right")}>Fee</th>
          </tr>
        </thead>
        <tbody>
          {fills.map((f, i) => (
            <tr key={i}>
              <td className={cn(TD, "font-mono")}>{formatTime(f.time)}</td>
              <td className={TD}>{exitLabel(f.reason)}</td>
              <td className={cn(TD, NUM)}>{f.shares}</td>
              <td className={cn(TD, NUM)}>{money(f.price)}</td>
              <td className={cn(TD, NUM)}>{money(f.fee)}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <p className="text-xs text-muted-foreground">Exit price is the quantity-weighted average of all sell fills.</p>
      {skipped ? <p className="text-xs text-muted-foreground">{skipped}</p> : null}
    </div>
  );
}
