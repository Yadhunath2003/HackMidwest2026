"use client";

import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { BacktestRun, Trade } from "@/lib/types";

const CHART_OPTIONS = {
  autoSize: true,
  layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8b95a7" },
  grid: { vertLines: { color: "#1d2430" }, horzLines: { color: "#1d2430" } },
  timeScale: { timeVisible: true, borderColor: "#2a3342" },
  rightPriceScale: { borderColor: "#2a3342" },
};

const CANDLE_SECONDS = { "5m": 300, "1d": 86_400 };

export function PriceChart({ run, selectedTrade }: { run: BacktestRun; selectedTrade: Trade | null }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);

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
    series.setData(run.candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));

    // Matched signal candles (dots), then the fills they led to (arrows).
    const markers: SeriesMarker<Time>[] = run.signals.map((s) => ({
      time: s.time as UTCTimestamp,
      position: "belowBar",
      shape: "circle",
      color: s.acted ? "#4f8cff" : "#5b6578",
      size: 0.5,
    }));
    for (const trade of run.trades) {
      markers.push({
        time: trade.entry_time as UTCTimestamp,
        position: "belowBar",
        shape: "arrowUp",
        color: "#4f8cff",
        text: `B${trade.id}`,
      });
      markers.push({
        time: trade.exit_time as UTCTimestamp,
        position: "aboveBar",
        shape: "arrowDown",
        color: trade.pnl >= 0 ? "#26a69a" : "#ef5350",
        text: `S${trade.id}`,
      });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(series, markers);
    instance.timeScale().fitContent();

    return () => {
      instance.remove();
      chart.current = null;
    };
  }, [run]);

  useEffect(() => {
    if (!chart.current || !selectedTrade) return;
    const padding = 25 * CANDLE_SECONDS[run.strategy.timeframe];
    chart.current.timeScale().setVisibleRange({
      from: (selectedTrade.signal_time - padding) as UTCTimestamp,
      to: (selectedTrade.exit_time + padding) as UTCTimestamp,
    });
  }, [selectedTrade, run]);

  return <div ref={container} className="chart" />;
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
