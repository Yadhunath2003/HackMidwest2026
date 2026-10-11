import pytest

from app import paper, ai_trends
from app.engine import run_backtest, compute_features, entry_signal, _crossed
from app.schemas import Strategy, ExecutionSettings
from app.execution import entry_terms


def bar(t, o=100, h=101, l=99, c=100, v=100):
    return dict(time=t, open=o, high=h, low=l, close=c, volume=v)


def short(**patch):
    return Strategy.model_validate({**dict(symbol='TSLA', timeframe='5m', direction='short',
        entry={'type': 'candle_only', 'candle_conditions': {'direction': 'bearish'}}), **patch})


ZERO = ExecutionSettings(commission_per_order_usd=0, slippage_bps=0)


@pytest.mark.parametrize('exit_bar,reason,price,pnl', [
    (bar(2, 100, 101, 95, 96), 'take_profit', 96, 40),
    (bar(2, 100, 103, 99, 102), 'stop_loss', 102, -20),
    (bar(2, 100, 103, 95, 99), 'stop_loss', 102, -20),
    (bar(2, 105, 106, 104, 105), 'stop_loss', 105, -50),
    (bar(2, 94, 95, 93, 94), 'take_profit', 94, 60),
    (bar(2, 100, 101, 98, 99), 'end_of_data', 99, 10),
])
def test_short_fills_protective_priority_gaps_and_accounting(exit_bar, reason, price, pnl):
    rows = [bar(0, 101, 102, 99, 100), bar(1), exit_bar]
    result = run_backtest(rows, short(), ZERO)
    trade = result['trades'][0]
    assert trade['direction'] == 'short'
    assert trade['entry_time'] == 1 and trade['entry_price'] == 100
    assert trade['stop_price'] == 102 and trade['target_price'] == 96
    assert trade['exit_reason'] == reason and trade['exit_price'] == price
    assert trade['pnl'] == pnl
    assert result['metrics']['net_profit'] == pnl
    assert result['equity_curve'][1]['equity'] == 10000


def test_short_adverse_slippage_and_fees():
    execution = ExecutionSettings(commission_per_order_usd=1, slippage_bps=10)
    rows = [bar(0, 101, 102, 99, 100), bar(1, 100, 101, 99, 100)]
    result = run_backtest(rows, short(), execution)
    trade = result['trades'][0]
    assert trade['entry_price'] == 99.9 and trade['exit_price'] == 100.1
    assert trade['fees'] == 2 and trade['slippage_cost'] == 2
    assert trade['pnl'] == -4 and result['metrics']['net_profit'] == -4


def test_short_partial_cover_releases_only_collateral_and_profit():
    strategy = short(partial_exit={'fraction': .5, 'profit_pct': 1, 'basis': 'price'})
    rows = [bar(0, 101, 102, 99, 100), bar(1, 100, 100.5, 98.5, 99), bar(2, 98, 99, 95, 96)]
    trade = run_backtest(rows, strategy, ZERO)['trades'][0]
    assert [e['shares'] for e in trade['exits']] == [5, 5]
    assert [e['price'] for e in trade['exits']] == [99, 96]
    assert trade['pnl'] == 25


def test_short_crossover_is_down_and_reverse_exit_is_up():
    strategy = short(entry={'type': 'ema_crossover', 'fast_period': 2, 'slow_period': 3},
                     exit_on_reverse_crossover=True, stop_loss_pct=50, take_profit_pct=50)
    closes = [100, 101, 102, 99, 98, 103, 104, 105]
    rows = [bar(i, c, c+.1, c-.1, c) for i, c in enumerate(closes)]
    features = compute_features(rows, strategy)
    assert entry_signal(features, 3, strategy) and not entry_signal(features, 5, strategy)
    trade = run_backtest(rows, strategy, ZERO)['trades'][0]
    assert trade['entry_time'] == 4 and trade['exit_reason'] == 'reverse_crossover'
    assert _crossed(features, trade['exit_time']-1, up=True)


def test_short_reference_risk_partial_account_target_matches_paper(monkeypatch):
    strategy = short(entry={'type': 'ai_reference_breakout', 'reference_breakout': {'volume_lookback': 3}},
                     partial_exit={'fraction': .5, 'profit_pct': 1, 'basis': 'account'})
    execution = ExecutionSettings(commission_per_order_usd=1, slippage_bps=2)
    rows = [bar(i) for i in range(30)] + [bar(30,100,102,99,101,300),
        bar(31,101,101.5,96,97), bar(32,97,98,96,97), bar(33,96,97,75,80)]
    monkeypatch.setattr(ai_trends, 'assess', lambda history,*a,**k: dict(
        direction='bullish' if history[-1]['close'] > history[-1]['open'] else 'bearish',
        confidence=.9, start_time=0, reason='test', source='test'))
    result = run_backtest(rows, strategy, execution)
    trade = result['trades'][0]
    assert trade['planned_stop_loss'] <= trade['risk_budget'] == 100
    assert trade['stop_price'] == 102 and trade['pnl'] == pytest.approx(200, abs=.01)
    assert len(trade['exits']) == 2
    state = dict(strategy=strategy.model_dump(), execution=execution.model_dump(), history=rows[:30],
                 last_candle=29, cash=10000, position=None, pending=None, marked=None, signals=[])
    for row in rows[30:]:
        paper.process(state,row,strategy,execution)
    assert [s['side'] for s in state['signals']] == ['SELL','BUY','BUY']
    assert [s['action'] for s in state['signals']] == ['entry','exit','exit']
    assert state['cash'] - 10000 == pytest.approx(trade['pnl'], abs=.01)
    assert state['position'] is None


def test_short_reference_invalid_stop_and_unreachable_target():
    strategy = short(entry={'type':'ai_reference_breakout','reference_breakout':{}})
    terms,error = entry_terms(strategy,ZERO,103,10000,{'high':102,'low':99})
    assert terms is None and 'stop' in error
    tiny = strategy.model_copy(update={'initial_capital': 10000000})
    terms,error = entry_terms(tiny,ZERO,100,10000000,{'high':200,'low':99})
    assert terms is None and 'nonpositive' in error


def test_bearish_pullback_mirrors_first_green_low():
    strategy = short(entry={'type':'bearish_pullback_breakout', 'pullback_breakout':{}})
    rows = [bar(0,103,104,101,102),bar(1,102,103,100,101),bar(2,101,102,99,100),
            bar(3,100,102,99.5,101),bar(4,101,101.5,97,98),bar(5,98,99,97,98)]
    result = run_backtest(rows,strategy,ZERO)
    assert result['trades'][0]['signal_time'] == 4
    assert result['trades'][0]['entry_evidence']['pattern']['first_green_low'] == 99.5


def test_short_schema_rejects_impossible_price_target_and_default_is_long():
    with pytest.raises(ValueError, match='less than 100'):
        short(take_profit_pct=100)
    raw=short().model_dump();raw.pop('direction')
    assert Strategy.model_validate(raw).direction == 'long'


def test_short_unrealized_equity_marks_the_liability():
    result = run_backtest([bar(0,101,102,99,100), bar(1,100,101,98.5,99),bar(2)],short(),ZERO)
    assert result['equity_curve'][1]['equity'] == 10010


def test_short_paper_forming_fill_is_idempotent(monkeypatch):
    from app import live_data
    strategy=short(symbol='BTCUSD')
    state=dict(strategy=strategy.model_dump(),execution=ZERO.model_dump(),history=[bar(0)],last_candle=0,
               cash=10000,position=None,pending={'action':'entry','side':'SELL','time':0},marked=None,signals=[])
    monkeypatch.setattr(live_data,'fetch',lambda *a,**k:([],{'forming':bar(1)}))
    first=paper.tick(state);second=paper.tick(first)
    assert len(second['signals']) == 1
    assert second['signals'][0]['side'] == 'SELL' and second['signals'][0]['action'] == 'entry'
    assert second['last_candle'] == 0


def test_short_detective_explains_cover_and_original_reference(monkeypatch):
    from app.detective import build_evidence, known_facts
    strategy=short(entry={'type':'bearish_pullback_breakout','pullback_breakout':{}})
    rows=[bar(0,103,104,101,102),bar(1,102,103,100,101),bar(2,101,102,99,100),
          bar(3,100,102,99.5,101),bar(4,101,101.5,97,98),bar(5,98,99,97,98)]
    result=run_backtest(rows,strategy,ZERO)
    facts=known_facts(build_evidence(result,result['trades'][0]))
    assert any('Sold short' in f for f in facts)
    assert any('First green low' in f for f in facts)


@pytest.mark.parametrize('symbol,unit', [('BTCUSD',.00000001),('XAUUSD',.01)])
def test_short_fractional_sizing_and_collateral(symbol,unit):
    strategy=short(symbol=symbol,position_size_usd=50)
    result=run_backtest([bar(0,101,102,99,100),bar(1,100,101,95,96)],strategy,ZERO)
    trade=result['trades'][0]
    assert trade['shares'] == .5
    assert trade['pnl'] == 2 and result['metrics']['final_equity'] == 10002


def test_reference_short_high_touch_invalidates_before_breakout(monkeypatch):
    strategy=short(entry={'type':'ai_reference_breakout','reference_breakout':{'volume_lookback':3}})
    rows=[bar(i) for i in range(30)]+[bar(30,100,102,99,101,300),bar(31,101,102,96,97),bar(32)]
    monkeypatch.setattr(ai_trends,'assess',lambda history,*a,**k:dict(
        direction='bullish' if history[-1]['close']>history[-1]['open'] else 'bearish', confidence=.9,start_time=0,reason='test',source='test'))
    assert not run_backtest(rows,strategy,ZERO)['trades']
