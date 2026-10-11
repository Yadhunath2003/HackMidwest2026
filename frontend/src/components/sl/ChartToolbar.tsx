"use client";

import { ChevronDown, Maximize2 } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { formatTime, money } from "@/lib/api";
import { exitLabel, signedMoney, volumeMeaning } from "@/lib/format";
import type { Trade } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Controls above the price chart, plus the selected-trade summary card. */
export function ChartToolbar({ trades, symbol, selectedId, onSelectTrade, onFit, volume }: {
  trades: Trade[]; symbol: string; selectedId: number | null; onSelectTrade: (trade: Trade) => void; onFit: () => void;
  volume: { available: boolean; on: boolean; onToggle: (on: boolean) => void; value: number | null };
}) {
  const switchId = useId();
  const selected = trades.find((t) => t.id === selectedId) ?? null;
  const exitPrice = (t: Trade) => t.final_exit_price ?? t.exit_price;
  const label = volumeMeaning(symbol) === "Volume" ? "Volume" : volumeMeaning(symbol).replace(" (tick volume)", "");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {trades.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="lg" aria-label="Inspect trade">
                {selected ? `Trade #${selected.id}` : "Inspect trade"}<ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
              <DropdownMenuRadioGroup value={selected ? String(selected.id) : ""} onValueChange={(v) => { const t = trades.find((x) => x.id === Number(v)); if (t) onSelectTrade(t); }}>
                {trades.map((t) => (
                  <DropdownMenuRadioItem key={t.id} value={String(t.id)} className="font-mono text-xs">
                    #{t.id} &middot; Buy {t.entry_price.toFixed(2)} &rarr; {exitPrice(t).toFixed(2)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Button variant="ghost" size="lg" onClick={onFit}><Maximize2 aria-hidden />Fit</Button>
        <div className="flex items-center gap-2">
          <Switch id={switchId} checked={volume.on && volume.available} disabled={!volume.available} onCheckedChange={volume.onToggle} />
          <label htmlFor={switchId} className={cn("text-sm", !volume.available && "text-muted-foreground")}>{label}</label>
        </div>
        <p className="ml-auto font-mono text-xs text-muted-foreground" aria-live="off">
          {!volume.available ? "Volume unavailable for this feed" : volume.on && volume.value != null ? `${label} ${volume.value.toLocaleString()}` : ""}
        </p>
      </div>

      {selected ? (
        <div className="rounded-xl border bg-card px-3.5 py-2.5 text-[13px]">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <strong className="text-sm font-semibold">Trade #{selected.id}</strong>
            <span><span className="text-brand">Entry</span> <span className="font-mono">{money(selected.entry_price)} &middot; {formatTime(selected.entry_time)}</span></span>
            <span><span className={selected.pnl >= 0 ? "text-positive" : "text-negative"}>Exit</span> <span className="font-mono">{money(exitPrice(selected))} &middot; {formatTime(selected.exit_time)}</span> &middot; {exitLabel(selected.exit_reason)}</span>
          </p>
          <p className="mt-0.5">P&amp;L <span className={cn("font-mono", selected.pnl >= 0 ? "text-positive" : "text-negative")}>{signedMoney(selected.pnl)}</span> <span className="text-muted-foreground">&middot; times in UTC</span></p>
        </div>
      ) : null}
    </div>
  );
}
