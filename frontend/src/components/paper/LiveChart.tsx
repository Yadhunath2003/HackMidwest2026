"use client";

import {
  CandlestickSeries,
  HistogramSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import { candleColors, chartTheme, markColors, token } from "@/lib/chart-theme";
import { symbolName, volumeMeaning } from "@/lib/format";
import { useThemeTick } from "@/lib/use-theme";
import type { PaperSession } from "@/lib/types";

/** The live paper chart: candles, an optional volume pane, BUY / SELL arrows and entry / stop / target lines. */
export function LiveChart({ session }: { session: PaperSession }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const fitted = useRef(false);
  const tick = useThemeTick();
  const candles = session.candles ?? [];
  const hasVolume = candles.some((c) => c.volume != null);

  // Build the chart once per session / timeframe / theme / volume availability.
  useEffect(() => {
    if (!container.current) return;
    const instance = createChart(container.current, { autoSize: true, ...chartTheme(), timeScale: { timeVisible: session.strategy.timeframe !== "1d", borderColor: token("border") } });
    chart.current = instance;
    price.current = instance.addSeries(CandlestickSeries, candleColors());
    markers.current = createSeriesMarkers(price.current, []);
    lines.current = [];
    if (hasVolume) {
      volume.current = instance.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false }, 1);
      instance.panes()[1]?.setHeight(90);
    }
    fitted.current = false;
    return () => {
      markers.current?.detach(); markers.current = null;
      instance.remove(); chart.current = null; price.current = null; volume.current = null; lines.current = [];
    };
  }, [session.id, session.strategy.timeframe, hasVolume, tick]);

  // Push data, markers and price lines on every refresh without rebuilding the chart.
  useEffect(() => {
    const series = price.current;
    if (!series || candles.length === 0) return;
    const colors = markColors();
    series.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    volume.current?.setData(candles.map((c) => c.volume == null ? { time: c.time as UTCTimestamp } : {
      time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? colors.volumeUp : colors.volumeDown,
    }));
    const times = new Set(candles.map((c) => c.time));
    markers.current?.setMarkers(session.signals.filter((s) => times.has(s.time)).sort((a, b) => a.time - b.time).map((s) => ({
      id: s.id, time: s.time as UTCTimestamp,
      position: s.side === "BUY" ? "belowBar" as const : "aboveBar" as const,
      shape: s.side === "BUY" ? "arrowUp" as const : "arrowDown" as const,
      color: s.side === "BUY" ? colors.buy : colors.loss, text: s.direction === "short" ? (s.action === "entry" ? "SELL SHORT" : "BUY TO COVER") : s.side, size: 2,
    })));
    for (const line of lines.current) series.removePriceLine(line);
    lines.current = session.position ? [
      series.createPriceLine({ price: session.position.entry_price, color: colors.buy, lineWidth: 1, axisLabelVisible: true, title: "Paper entry" }),
      series.createPriceLine({ price: session.position.stop, color: colors.loss, lineWidth: 1, axisLabelVisible: true, title: "Stop" }),
      series.createPriceLine({ price: session.position.target, color: colors.win, lineWidth: 1, axisLabelVisible: true, title: "Target" }),
    ] : [];
    if (!fitted.current) { chart.current?.timeScale().fitContent(); fitted.current = true; }
  }, [session, candles, tick, hasVolume]);

  return (
    <section className="space-y-2" aria-label="Live chart">
      <h2 className="text-sm font-semibold">{symbolName(session.strategy.symbol)} &middot; {session.strategy.timeframe} live chart</h2>
      <div className="relative">
        <div ref={container} role="img" aria-label={`${symbolName(session.strategy.symbol)} ${session.strategy.timeframe} candlestick chart with paper BUY and SELL markers. The signals table lists each one.`}
          className="h-[420px] w-full overflow-hidden rounded-xl border bg-chart-bg" />
        {candles.length === 0 ? (
          <p className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">Waiting for candles from the feed…</p>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {session.feed.provider} &middot; {candles.length === 0 ? "No candles yet" : hasVolume ? (volumeMeaning(session.strategy.symbol) === "Volume" ? "Volume is IEX-reported shares" : volumeMeaning(session.strategy.symbol)) : "Volume unavailable for this feed"} &middot; Checked every 15 s. The latest candle may still be forming.
      </p>
    </section>
  );
}
