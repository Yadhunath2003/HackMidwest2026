"use client";

import {
  CandlestickSeries,
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
import { candleColors, chartTheme, markColors, token } from "@/lib/chart-theme";
import { useThemeTick } from "@/lib/use-theme";
import type { BacktestRun, Trade } from "@/lib/types";

const CANDLE_SECONDS = { "5m": 300, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86_400 };

/** Candles, signal dots, B/S/P trade marks, selected-trade price lines and an optional volume pane. */
export function PriceChart({ run, selectedTrade, onSelectTrade, showVolume, onVolumeHover, fitKey }: {
  run: BacktestRun; selectedTrade: Trade | null; onSelectTrade: (trade: Trade) => void;
  showVolume: boolean; onVolumeHover: (value: number | null) => void; fitKey: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const priceSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [built, setBuilt] = useState(0);
  const tick = useThemeTick();
  const hasVolume = run.candles.some((c) => c.volume != null && Number.isFinite(c.volume));

  // Keep the latest callbacks in refs so selecting a trade doesn't rebuild the chart.
  const selectRef = useRef(onSelectTrade);
  const hoverRef = useRef(onVolumeHover);
  useEffect(() => { selectRef.current = onSelectTrade; hoverRef.current = onVolumeHover; });

  useEffect(() => {
    if (!container.current) return;
    const colors = markColors();
    const instance = createChart(container.current, { autoSize: true, ...chartTheme(), timeScale: { timeVisible: run.strategy.timeframe !== "1d", borderColor: token("border") } });
    chart.current = instance;
    const series = instance.addSeries(CandlestickSeries, candleColors());
    priceSeries.current = series;
    series.setData(run.candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));

    if (showVolume && hasVolume) {
      const volume = instance.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: true }, 1);
      volume.setData(run.candles.map((c) => c.volume != null && Number.isFinite(c.volume)
        ? { time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? colors.volumeUp : colors.volumeDown }
        : { time: c.time as UTCTimestamp }));
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0 } });
      instance.panes()[1]?.setHeight(100);
      instance.subscribeCrosshairMove((event) => {
        const point = event.seriesData.get(volume);
        hoverRef.current(point && "value" in point ? point.value : null);
      });
    }
    hoverRef.current(null);

    // Matched signal candles (dots), then the fills they led to (arrows with short text: B3, S3, P3).
    const markers: SeriesMarker<Time>[] = run.signals.map((s) => ({
      time: s.time as UTCTimestamp, position: run.strategy.direction === "short" ? "aboveBar" : "belowBar", shape: "circle", size: 0.5,
      color: s.acted ? colors.buy : colors.idle,
    }));
    for (const trade of run.trades) {
      const short=trade.direction === "short";
      markers.push({ id: `entry-${trade.id}`, time: trade.entry_time as UTCTimestamp, position: short ? "aboveBar" : "belowBar", shape: short ? "arrowDown" : "arrowUp", color: colors.buy, text: `${short ? "SELL SHORT" : "BUY"} #${trade.id}`, size: 2 });
      markers.push({ id: `exit-${trade.id}`, time: trade.exit_time as UTCTimestamp, position: short ? "belowBar" : "aboveBar", shape: short ? "arrowUp" : "arrowDown", color: trade.pnl >= 0 ? colors.win : colors.loss, text: `${short ? "BUY TO COVER" : "SELL"} #${trade.id}`, size: 2 });
      for (const exit of trade.exits ?? []) {
        if (exit.reason !== "partial_take_profit") continue;
        markers.push({ id: `partial-${trade.id}`, time: exit.time as UTCTimestamp, position: short ? "belowBar" : "aboveBar", shape: short ? "arrowUp" : "arrowDown", color: colors.partial, text: `P${trade.id}`, size: 2 });
      }
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(series, markers);

    instance.subscribeClick((event) => {
      if (typeof event.hoveredObjectId !== "string") return;
      const match = /^(?:entry|exit|partial)-(\d+)$/.exec(event.hoveredObjectId);
      const trade = match && run.trades.find((t) => t.id === Number(match[1]));
      if (trade) selectRef.current(trade);
    });
    instance.timeScale().fitContent();
    setBuilt((b) => b + 1);

    return () => { instance.remove(); chart.current = null; priceSeries.current = null; };
  }, [run, showVolume, hasVolume, tick]);

  useEffect(() => { if (fitKey > 0) chart.current?.timeScale().fitContent(); }, [fitKey]);

  // Entry / exit price lines and a zoom to the selected trade.
  useEffect(() => {
    const series = priceSeries.current;
    if (!chart.current || !series || !selectedTrade) return;
    const colors = markColors();
    const exitPrice = selectedTrade.final_exit_price ?? selectedTrade.exit_price;
    const entryLine = series.createPriceLine({ price: selectedTrade.entry_price, color: colors.buy, lineWidth: 1, axisLabelVisible: true, title: `Entry #${selectedTrade.id}` });
    const exitLine = series.createPriceLine({ price: exitPrice, color: selectedTrade.pnl >= 0 ? colors.win : colors.loss, lineWidth: 1, axisLabelVisible: true, title: `Exit #${selectedTrade.id}` });
    const padding = 25 * CANDLE_SECONDS[run.strategy.timeframe];
    chart.current.timeScale().setVisibleRange({ from: (selectedTrade.signal_time - padding) as UTCTimestamp, to: (selectedTrade.exit_time + padding) as UTCTimestamp });
    return () => {
      // The chart may already have been rebuilt (new run or theme); only clean up lines on the live series.
      if (priceSeries.current === series) { series.removePriceLine(entryLine); series.removePriceLine(exitLine); }
    };
  }, [selectedTrade, run, built]);

  return (
    <div
      ref={container}
      role="img"
      aria-label={`${run.strategy.symbol} ${run.strategy.timeframe} candlestick chart with ${run.trades.length} trades marked. The trade log lists each one.`}
      className="h-[380px] w-full overflow-hidden rounded-xl border bg-chart-bg"
    />
  );
}

/** Equity over the run: a 2px line in the buy colour on the same background and grid. */
export function EquityChart({ run }: { run: BacktestRun }) {
  const container = useRef<HTMLDivElement>(null);
  const tick = useThemeTick();

  useEffect(() => {
    if (!container.current) return;
    const instance = createChart(container.current, { autoSize: true, ...chartTheme(), timeScale: { timeVisible: run.strategy.timeframe !== "1d", borderColor: token("border") } });
    const series = instance.addSeries(LineSeries, { color: markColors().buy, lineWidth: 2 });
    series.setData(run.equity_curve.map((p) => ({ time: p.time as UTCTimestamp, value: p.equity })));
    instance.timeScale().fitContent();
    return () => instance.remove();
  }, [run, tick]);

  return <div ref={container} role="img" aria-label="Equity curve for this run" className="h-[200px] w-full overflow-hidden rounded-xl border bg-chart-bg" />;
}
