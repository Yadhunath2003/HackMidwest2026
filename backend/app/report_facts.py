"""Recorded and calculated report facts; numerical claims are not model arithmetic."""
from datetime import datetime, timezone

from .engine import describe_range
from .import_crypto_history import coverage
from .market_data import CANDLE_SECONDS


def evidence_for_run(run):
    evidence = {key: run[key] for key in ('strategy', 'execution', 'metrics', 'data', 'assumptions')}
    data = dict(evidence['data'])
    if run.get('candles'):
        data.update(describe_range(run['candles']))
        if run['strategy']['symbol'] == 'BTCUSD':
            data.pop('cache_coverage', None)
            data['coverage'] = coverage(run['candles'], CANDLE_SECONDS[run['strategy']['timeframe']])
            data['limitations'] = [s for s in data.get('limitations', []) if not s.startswith('History has ')]
    evidence['data'] = data
    return evidence


def facts(evidence):
    m = evidence.get('metrics', {})
    required = ('net_profit', 'total_return_pct', 'initial_capital', 'total_fees', 'total_slippage_cost', 'num_trades')
    if not all(k in m for k in required):
        return None
    costs = round(m['total_fees'] + m['total_slippage_cost'], 2)
    before_costs = round(m['net_profit'] + costs, 2)
    summary = f"The backtest returned {m['total_return_pct']:+.3f}% (${m['net_profit']:+,.2f}) over {m['num_trades']} trades. Modeled fees and slippage totaled ${costs:,.2f}."
    findings = [f"Modeled costs: fees ${m['total_fees']:,.2f} plus slippage ${m['total_slippage_cost']:,.2f} = ${costs:,.2f}, or {costs / m['initial_capital'] * 100:.2f}% of starting capital.",
                f"Net profit plus modeled costs is ${before_costs:+,.2f}; this is an accounting estimate, not a separate zero-cost backtest."]
    benchmark = m.get('buy_and_hold_return_pct')
    if benchmark is not None:
        delta = m['total_return_pct'] - benchmark
        direction = 'outperformed' if delta > 0 else 'underperformed' if delta < 0 else 'matched'
        summary += f" It {direction} the price-only buy-and-hold benchmark ({benchmark:+.3f}%) by {abs(delta):.3f} percentage points."
    for key, label in (('win_rate_pct', 'Win rate'), ('profit_factor', 'Profit factor'), ('max_drawdown_pct', 'Maximum drawdown (%)')):
        findings.append(f"{label}: {m.get(key) if m.get(key) is not None else 'unavailable'}.")
    data = evidence.get('data', {})
    if data.get('start'):
        findings.append(f"Tested {data.get('candle_count')} candles from {data['start']} to {data['end']} (UTC).")
    gaps = data.get('coverage')
    if gaps:
        findings.append(f"The tested candles contain {gaps['gap_count']} gap(s), totaling {gaps['missing_intervals']} absent intervals; excluded cache segments are not part of this count.")
    limitations = list(data.get('limitations', [])) + list(evidence.get('assumptions', []))
    limitations.append('Buy-and-hold is a fully invested, price-only benchmark without modeled trading costs. Strategy exposure may differ, so this is not an equal-exposure comparison.')
    strategy = evidence.get('strategy', {})
    if strategy.get('entry', {}).get('type') != 'ai_reference_breakout' and strategy.get('position_size_usd') is not None:
        limitations.append(f"Fixed position size is ${strategy['position_size_usd']:,.2f} against ${m['initial_capital']:,.2f} starting equity; this is not fully invested buy-and-hold exposure.")
    return dict(summary=summary, findings=findings, limitations=limitations)


def with_context(evidence):
    return {**evidence, 'report_context': {'current_utc': datetime.now(timezone.utc).isoformat(),
            'verified_facts': facts(evidence), 'date_rule': 'Treat supplied UTC dates as authoritative. Do not infer simulated data from the year. Cache segments excluded from the test are not tested history.'}}
