import json

from app import ai, market_data
from app.report_facts import evidence_for_run, facts


def sample():
    return dict(strategy={'symbol': 'BTCUSD', 'timeframe': '1h', 'entry': {'type': 'ema_crossover'}, 'position_size_usd': 1000},
                execution={}, assumptions=[], data={}, metrics={'net_profit': -501.74, 'total_return_pct': -5.017,
                'initial_capital': 10000, 'total_fees': 768, 'total_slippage_cost': 154.2, 'num_trades': 384,
                'buy_and_hold_return_pct': -6.618, 'win_rate_pct': 27.6, 'profit_factor': .839, 'max_drawdown_pct': 7.464})


def test_correct_negative_benchmark_and_costs_override_bad_model(monkeypatch):
    monkeypatch.setattr(ai, 'is_configured', lambda: True)
    def chat(messages, **kwargs):
        context = json.loads(messages[1]['content'])['report_context']
        assert context['current_utc']
        return json.dumps(dict(summary='Underperformed; future projected data.', findings=['Costs 10.2%.'],
                               limitations=['A 72-day gap inside the test.'], next_tests=['Compare 4h candles.']))
    monkeypatch.setattr(ai, 'chat', chat)
    report = ai.generate_report(sample())
    assert 'outperformed' in report['summary']
    assert '1.601' in report['summary']
    assert '$922.20' in report['summary']
    assert '9.22%' in report['findings'][0]
    assert '$+420.46' in report['findings'][1]
    assert any('not an equal-exposure' in s for s in report['limitations'])
    assert report['next_tests'] == ['Compare 4h candles.']
    assert 'projected' not in json.dumps(report)


def test_saved_run_coverage_recomputed_from_actual_candles():
    run = sample()
    run['candles'] = [{'time': 0}, {'time': 3600}, {'time': 10800}]
    run['data'] = {'coverage': {'gap_count': 4, 'missing_intervals': 1739},
                   'limitations': ['History has 4 gap(s), totaling 1739 absent intervals.'], 'excluded_segment_candles': 723}
    evidence = evidence_for_run(run)
    assert evidence['data']['coverage']['missing_intervals'] == 1
    assert evidence['data']['candle_count'] == 3
    assert evidence['data']['limitations'] == []
    assert run['data']['coverage']['missing_intervals'] == 1739


def test_selected_segment_metadata_keeps_cache_coverage_separate(monkeypatch):
    rows = [{'time': t} for t in (0, 3600, 10800, 900000)]
    monkeypatch.setattr(market_data, '_get_cached_candles', lambda *a: (rows, {
        'coverage': {'gap_count': 2, 'missing_intervals': 247}, 'limitations': ['History has 2 gaps.']}))
    selected, meta = market_data.get_candles('BTCUSD', '1h')
    assert len(selected) == 3
    assert meta['coverage']['missing_intervals'] == 1
    assert meta['cache_coverage']['missing_intervals'] == 247
    assert not any(s.startswith('History has ') for s in meta['limitations'])
