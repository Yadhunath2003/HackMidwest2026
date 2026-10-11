// Chart colours from the design tokens, for lightweight-charts v5 (Charts.tsx, LiveChart.tsx).
// Replaces every hard-coded hex (#26a69a, #ef5350, #4f8cff, #8b95a7, #2a3342, #161b24, #ffa726).
// Everything here reads `document`: call it only inside useEffect (never during render or on the server).
import { ColorType, type DeepPartial, type ChartOptions, type IChartApi } from "lightweight-charts";

/** Custom properties come back resolved, so --chart-up: var(--positive) reads as a colour. */
export const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

export function chartTheme(): DeepPartial<ChartOptions> {
  return {
    // next/font generates the family name (e.g. "__Geist_abc123"), so read what <body> actually uses.
    layout: { background: { type: ColorType.Solid, color: token("chart-bg") }, textColor: token("chart-text"), fontFamily: getComputedStyle(document.body).fontFamily },
    grid: { vertLines: { color: token("chart-grid") }, horzLines: { color: token("chart-grid") } },
    rightPriceScale: { borderColor: token("border") },
    timeScale: { borderColor: token("border") },
  };
}

export const candleColors = () => ({
  upColor: token("chart-up"), wickUpColor: token("chart-up"),
  downColor: token("chart-down"), wickDownColor: token("chart-down"),
  borderVisible: false,
});

export const markColors = () => ({
  buy: token("chart-buy"), win: token("chart-up"), loss: token("chart-down"),
  partial: token("chart-partial"), idle: token("chart-signal-idle"),
  volumeUp: token("chart-volume-up"), volumeDown: token("chart-volume-down"),
});

/** Re-apply colours when the theme class / data-theme on <html> changes. Returns a cleanup function. */
export function followTheme(chart: IChartApi, onChange?: () => void) {
  const observer = new MutationObserver(() => { chart.applyOptions(chartTheme()); onChange?.(); });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
  return () => observer.disconnect();
}
