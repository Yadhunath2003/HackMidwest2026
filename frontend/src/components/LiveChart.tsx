"use client";

import { useEffect, useRef } from "react";
import { CandlestickSeries, HistogramSeries, ColorType, createChart, createSeriesMarkers,
  type IChartApi, type ISeriesApi, type IPriceLine, type ISeriesMarkersPluginApi, type Time, type UTCTimestamp } from "lightweight-charts";
import type { PaperSession } from "@/lib/types";

export default function LiveChart({ session }: { session: PaperSession }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const fitted = useRef(false);
  const markerPlugin = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
  useEffect(() => {
    if (!container.current) return;
    const instance = createChart(container.current, { autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#161b24" }, textColor: "#8b95a7" },
      grid: { vertLines: { color: "#1d2430" }, horzLines: { color: "#1d2430" } },
      timeScale: { timeVisible: session.strategy.timeframe !== "1d" } });
    chart.current = instance;
    price.current = instance.addSeries(CandlestickSeries, { upColor: "#26a69a", downColor: "#ef5350",
      wickUpColor: "#26a69a", wickDownColor: "#ef5350", borderVisible: false });
    markerPlugin.current = createSeriesMarkers(price.current, []);
    priceLines.current = [];
    volume.current = instance.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false }, 1);
    instance.panes()[1].setHeight(90);
    fitted.current = false;
    return () => { markerPlugin.current?.detach(); markerPlugin.current = null; instance.remove(); chart.current = null; price.current = null; volume.current = null; priceLines.current = []; };
  }, [session.id, session.strategy.timeframe]);

  useEffect(() => {
    if (!price.current || !volume.current || !session.candles?.length) return;
    const candles = session.candles;
    price.current.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    volume.current.setData(candles.map((c) => c.volume == null ? { time: c.time as UTCTimestamp } : {
      time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "#26a69a80" : "#ef535080" }));
    const times = new Set(candles.map((c) => c.time));
    markerPlugin.current?.setMarkers(session.signals.filter((s) => times.has(s.time))
      .sort((a, b) => a.time - b.time).map((s) => ({ id: s.id, time: s.time as UTCTimestamp,
        position: s.side === "BUY" ? "belowBar" as const : "aboveBar" as const,
        shape: s.side === "BUY" ? "arrowUp" as const : "arrowDown" as const,
        color: s.side === "BUY" ? "#4f8cff" : "#ef5350", text: `${s.side} @ ${s.price.toFixed(2)}` })));
    for (const line of priceLines.current) price.current.removePriceLine(line);
    priceLines.current = session.position ? [
      price.current.createPriceLine({ price: session.position.entry_price, color: "#4f8cff", lineWidth: 1, title: "Paper entry" }),
      price.current.createPriceLine({ price: session.position.stop, color: "#ef5350", lineWidth: 1, title: "Stop" }),
      price.current.createPriceLine({ price: session.position.target, color: "#26a69a", lineWidth: 1, title: "Target" }),
    ] : [];
    if (!fitted.current) { chart.current?.timeScale().fitContent(); fitted.current = true; }
  }, [session]);

  return <div>
    <h2>{session.strategy.symbol === "BTCUSD" ? "BTC/USD" : session.strategy.symbol} · {session.strategy.timeframe} chart</h2>
    <p className="muted">{session.feed.provider} · Updates with each feed check. The latest candle may still be forming. {session.strategy.symbol === "XAUUSD" ? "Volume is quote activity." : session.strategy.symbol === "BTCUSD" ? "Volume is traded BTC." : "Volume is IEX shares."}</p>
    {!session.candles?.length && <p>Waiting for candles from the feed…</p>}
    <div ref={container} style={{ height: 440, width: "100%" }} aria-label="Live candlestick chart with paper buy and sell markers" />
  </div>;
}
