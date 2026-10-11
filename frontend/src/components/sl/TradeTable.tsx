"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import { formatTime, money } from "@/lib/api";
import { exitLabel, quantityUnit, signedMoney, signedPercent } from "@/lib/format";
import type { Trade } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "./Badge";
import { NUM, TableWrap, TD, TH } from "./table";

type SortKey = "id" | "entry_time" | "entry_price" | "exit_price" | "shares" | "pnl" | "pnl_pct" | "fees" | "bars_held" | "exit_reason";

/** The sortable trade log. It also describes the chart markers in text. */
export function TradeTable({ trades, symbol, selectedId, onSelect }: {
  trades: Trade[]; symbol: string; selectedId?: number | null; onSelect: (trade: Trade) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: "id", ascending: true });

  const columns: { key: SortKey; label: string; numeric?: boolean }[] = [
    { key: "id", label: "#", numeric: true },
    { key: "entry_time", label: "Entry (UTC)" },
    { key: "entry_price", label: "Entry price", numeric: true },
    { key: "exit_price", label: "Exit price", numeric: true },
    { key: "shares", label: quantityUnit(symbol), numeric: true },
    { key: "pnl", label: "P&L", numeric: true },
    { key: "pnl_pct", label: "P&L %", numeric: true },
    { key: "fees", label: "Fees", numeric: true },
    { key: "bars_held", label: "Candles", numeric: true },
    { key: "exit_reason", label: "Exit reason" },
  ];

  const rows = useMemo(() => {
    const sorted = [...trades].sort((a, b) => {
      const [x, y] = [a[sort.key], b[sort.key]];
      return typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
    });
    return sort.ascending ? sorted : sorted.reverse();
  }, [trades, sort]);

  if (trades.length === 0) return null;

  return (
    <TableWrap maxHeight={420}>
      <caption className="sr-only">
        Trade log. Each row is one completed trade; its entry and exit are marked on the price chart as B and S arrows.
      </caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col" className={cn(TH, c.numeric && "text-right")}
              aria-sort={sort.key === c.key ? (sort.ascending ? "ascending" : "descending") : "none"}>
              <button type="button" className="inline-flex items-center gap-1 rounded-sm hover:text-foreground"
                onClick={() => setSort({ key: c.key, ascending: sort.key === c.key ? !sort.ascending : true })}>
                {c.label}
                {sort.key === c.key ? (sort.ascending ? <ArrowUp aria-hidden className="size-3" /> : <ArrowDown aria-hidden className="size-3" />) : null}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => {
          const selected = t.id === selectedId;
          const fills = t.exits?.length ?? 0;
          const tone = t.pnl >= 0 ? "text-positive" : "text-negative";
          return (
            <tr key={t.id} tabIndex={0} aria-selected={selected}
              className={cn("cursor-pointer outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", selected && "bg-accent shadow-[inset_2px_0_0_var(--brand)]")}
              onClick={() => onSelect(t)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(t); } }}>
              <td className={cn(TD, NUM)}>{t.id}</td>
              <td className={cn(TD, "font-mono")}>{formatTime(t.entry_time)}</td>
              <td className={cn(TD, NUM)}>{t.entry_price.toFixed(2)}</td>
              <td className={cn(TD, NUM)}>{t.exit_price.toFixed(2)}</td>
              <td className={cn(TD, NUM)}>{t.shares}</td>
              <td className={cn(TD, NUM, tone)}>{signedMoney(t.pnl)}</td>
              <td className={cn(TD, NUM, tone)}>{signedPercent(t.pnl_pct)}</td>
              <td className={cn(TD, NUM)}>{money(t.fees)}</td>
              <td className={cn(TD, NUM)}>{t.bars_held}</td>
              <td className={TD}>
                <span className="inline-flex items-center gap-2">{exitLabel(t.exit_reason)}{fills > 1 ? <Badge tone="warning">{fills} fills</Badge> : null}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}
