"use client";

import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { BacktestRun, Trade } from "@/lib/types";
import { formatTime, money } from "@/lib/api";

const CHART_OPTIONS = {
  autoSize: true,
  layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8b95a7" },
  grid: { vertLines: { color: "#1d2430" }, horzLines: { color: "#1d2430" } },
  timeScale: { timeVisible: true, borderColor: "#2a3342" },
  rightPriceScale: { borderColor: "#2a3342" },
};

const CANDLE_SECONDS = { "5m": 300, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86_400 };

export function PriceChart({ run, selectedTrade, onSelectTrade }: { run: BacktestRun; selectedTrade: Trade | null; onSelectTrade: (trade: Trade) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const priceSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [showVolume, setShowVolume] = useState(true);
  const [hoverVolume, setHoverVolume] = useState<number | null>(null);
  const hasVolume = run.candles.some((c) => c.volume != null && Number.isFinite(c.volume));
  const latestVolume = run.candles.findLast((c) => c.volume != null)?.volume ?? null;

  useEffect(() => {
    if (!container.current) return;
    const instance = createChart(container.current, CHART_OPTIONS);
    chart.current = instance;
    const series = instance.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      borderVisible: false,
    });
    priceSeries.current = series;
    series.setData(run.candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));

    if (showVolume && hasVolume) {
      const volume = instance.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: true,
      }, 1);
      volume.setData(run.candles.map((c) => c.volume != null && Number.isFinite(c.volume)
        ? { time: c.time as UTCTimestamp, value: c.volume,
            color: c.close >= c.open ? "#26a69a" : "#ef5350" }
        : { time: c.time as UTCTimestamp }));
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0 } });
      instance.panes()[1].setHeight(100);
      instance.subscribeCrosshairMove((event) => {
        const point = event.seriesData.get(volume);
        setHoverVolume(point && "value" in point ? point.value : null);
      });
    }
    setHoverVolume(null);

    // Matched signal candles (dots), then the fills they led to (arrows).
    const markers: SeriesMarker<Time>[] = run.signals.map((s) => ({
      time: s.time as UTCTimestamp,
      position: run.strategy.direction === "short" ? "aboveBar" : "belowBar",
      shape: "circle",
      color: s.acted ? "#4f8cff" : "#5b6578",
      size: 0.5,
    }));
    for (const trade of run.trades) {
      const short = trade.direction === "short";
      markers.push({
        id: `entry-${trade.id}`,
        time: trade.entry_time as UTCTimestamp,
        position: short ? "aboveBar" : "belowBar",
        shape: short ? "arrowDown" : "arrowUp",
        color: "#4f8cff",
        text: `${short ? "SELL SHORT" : "BUY"} / ENTRY #${trade.id} @ ${trade.entry_price.toFixed(2)}`,
        size: 2,
      });
      markers.push({
        id: `exit-${trade.id}`,
        time: trade.exit_time as UTCTimestamp,
        position: short ? "belowBar" : "aboveBar",
        shape: short ? "arrowUp" : "arrowDown",
        color: trade.pnl >= 0 ? "#26a69a" : "#ef5350",
        text: `${short ? "BUY TO COVER" : "SELL"} / EXIT #${trade.id} @ ${(trade.final_exit_price ?? trade.exit_price).toFixed(2)} (${trade.exit_reason.replaceAll("_", " ")})`,
        size: 2,
      });
      for (const exit of trade.exits ?? []) {
        if (exit.reason !== "partial_take_profit") continue;
        markers.push({ id: `partial-${trade.id}`, time: exit.time as UTCTimestamp,
          position: short ? "belowBar" : "aboveBar", shape: short ? "arrowUp" : "arrowDown", color: "#ffa726", size: 2,
          text: `PARTIAL EXIT #${trade.id}: ${exit.shares} @ ${exit.price.toFixed(2)}` });
      }
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(series, markers);
    instance.subscribeClick((event) => {
      if (typeof event.hoveredObjectId !== "string") return;
      const match = /^(?:entry|exit|partial)-(\d+)$/.exec(event.hoveredObjectId);
      const trade = match && run.trades.find((t) => t.id === Number(match[1]));
      if (trade) onSelectTrade(trade);
    });
    instance.timeScale().fitContent();

    return () => {
      instance.remove();
      chart.current = null;
      priceSeries.current = null;
    };
  }, [run, showVolume, hasVolume, onSelectTrade]);

  useEffect(() => {
    if (!chart.current || !priceSeries.current || !selectedTrade) return;
    const series = priceSeries.current;
    const entryLine = series.createPriceLine({ price: selectedTrade.entry_price, color: "#4f8cff",
      lineWidth: 2, axisLabelVisible: true, title: `${selectedTrade.direction === "short" ? "SELL SHORT" : "BUY"} / ENTRY #${selectedTrade.id}` });
    const exitLine = series.createPriceLine({ price: selectedTrade.final_exit_price ?? selectedTrade.exit_price,
      color: selectedTrade.pnl >= 0 ? "#26a69a" : "#ef5350", lineWidth: 2,
      axisLabelVisible: true, title: `${selectedTrade.direction === "short" ? "BUY TO COVER" : "SELL"} / EXIT #${selectedTrade.id}` });
    const padding = 25 * CANDLE_SECONDS[run.strategy.timeframe];
    chart.current.timeScale().setVisibleRange({
      from: (selectedTrade.signal_time - padding) as UTCTimestamp,
      to: (selectedTrade.exit_time + padding) as UTCTimestamp,
    });
    return () => {
      // The previous chart may already have been removed when the run changes.
      if (priceSeries.current === series) {
        series.removePriceLine(entryLine);
        series.removePriceLine(exitLine);
      }
    };
  }, [selectedTrade, run, showVolume, hasVolume, onSelectTrade]);

  return <>
    <div className="row" style={{ marginBottom: 8 }}>
      {run.trades.length > 0 && <label>Inspect trade
        <select value={selectedTrade?.id ?? ""} onChange={(e) => {
          const trade = run.trades.find((t) => t.id === Number(e.target.value));
          if (trade) onSelectTrade(trade);
        }}>
          <option value="" disabled>Select a trade</option>
          {run.trades.map((t) => <option key={t.id} value={t.id}>#{t.id}: {t.direction === "short" ? "Sell short" : "Buy"} {t.entry_price.toFixed(2)} → Exit {(t.final_exit_price ?? t.exit_price).toFixed(2)}</option>)}
        </select>
      </label>}
      <button onClick={() => chart.current?.timeScale().fitContent()}>Show full history</button>
      <label className="check"><input type="checkbox" checked={showVolume} disabled={!hasVolume}
        onChange={(e) => setShowVolume(e.target.checked)} />{run.strategy.symbol === "XAUUSD" ? "Quote activity (tick volume)" : "Volume"}</label>
      <span className="muted">
        {!hasVolume ? "Volume unavailable for this feed" : showVolume
          ? `${run.strategy.symbol === "XAUUSD" ? "Quote activity" : "Volume"}: ${(hoverVolume ?? latestVolume)?.toLocaleString() ?? "unavailable"}` : ""}
      </span>
    </div>
    <p className="muted">Blue arrows mark entries; green/red arrows mark exits. Up arrows are buys, down arrows are sells. Short entries say SELL SHORT and their exits say BUY TO COVER. Click a marker to inspect a trade.</p>
    {selectedTrade && <div className="notice" style={{ marginBottom: 12 }}>
      <strong>Trade #{selectedTrade.id}</strong>
      <div><span style={{ color: "#4f8cff" }}>{selectedTrade.direction === "short" ? "SELL SHORT / ENTRY" : "BUY / ENTRY"}</span> {money(selectedTrade.entry_price)} · {formatTime(selectedTrade.entry_time)} UTC</div>
      <div><span className={selectedTrade.pnl >= 0 ? "good" : "bad"}>{selectedTrade.direction === "short" ? "BUY TO COVER / EXIT" : "SELL / EXIT"}</span> {money(selectedTrade.final_exit_price ?? selectedTrade.exit_price)} · {formatTime(selectedTrade.exit_time)} UTC · {selectedTrade.exit_reason.replaceAll("_", " ")}</div>
      <div>P&amp;L: <span className={selectedTrade.pnl >= 0 ? "good" : "bad"}>{money(selectedTrade.pnl)}</span></div>
    </div>}
    <div ref={container} className="chart" />
  </>;
}

export function EquityChart({ run }: { run: BacktestRun }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const instance = createChart(container.current, CHART_OPTIONS);
    const series = instance.addSeries(LineSeries, { color: "#4f8cff", lineWidth: 2 });
    series.setData(run.equity_curve.map((p) => ({ time: p.time as UTCTimestamp, value: p.equity })));
    instance.timeScale().fitContent();
    return () => instance.remove();
  }, [run]);

  return <div ref={container} className="chart small" />;
}
