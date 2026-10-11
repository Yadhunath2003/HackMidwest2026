import copy
import pytest

from app import paper, storage, live_data
from app.schemas import Strategy, ExecutionSettings


def candle(t=100, o=100, h=101, l=99, c=100, v=100):
    return {'time':t,'open':o,'high':h,'low':l,'close':c,'volume':v}


def session(strategy):
    return {'history':[candle(t=i) for i in range(30)],'last_candle':29,
            'strategy':strategy.model_dump(),'execution':ExecutionSettings(commission_per_order_usd=0,slippage_bps=0).model_dump(),
            'cash':10000,'position':None,'pending':None,'marked':None,'signals':[]}


def test_warmup_and_duplicate_poll_do_not_emit_trades(monkeypatch):
    s=Strategy.model_validate({'symbol':'TSLA','timeframe':'5m','entry':{'type':'candle_only','candle_conditions':{'direction':'bullish'}}})
    state=session(s);state['history']=[];state['last_candle']=None
    rows=[candle(t=i,c=100.5) for i in range(30)]
    monkeypatch.setattr(live_data,'fetch',lambda *args,**kwargs:(rows,{}))
    first=paper.tick(state)
    assert first['signals']==[] and first['pending'] is None
    assert paper.tick(first)['signals']==[]


def test_reference_next_open_risk_stop_and_target_match_backtest(monkeypatch):
    from app.engine import run_backtest
    from app import ai_trends
    s=Strategy.model_validate({'symbol':'TSLA','timeframe':'5m','entry':{'type':'ai_reference_breakout','reference_breakout':{'volume_lookback':3}}})
    execution=ExecutionSettings(commission_per_order_usd=1,slippage_bps=2)
    rows=[candle(t=i) for i in range(30)]+[
        candle(30,100,101,98,99,300),candle(31,99,104,98.5,103,100),
        candle(32,103,120,102,115,100)]
    def assess(history,*args,**kwargs):
        return {'direction':'bearish' if history[-1]['close']<history[-1]['open'] else 'bullish',
                'confidence':.9,'start_time':history[0]['time'],'reason':'test','source':'test'}
    monkeypatch.setattr(ai_trends,'assess',assess)
    state=session(s);state['execution']=execution.model_dump()
    for row in rows[30:]:paper.process(state,row,s,execution)
    trade=run_backtest(rows,s,execution)['trades'][0]
    buy,sell=state['signals']
    assert buy['time']==trade['entry_time'] and sell['time']==trade['exit_time']
    assert buy['quantity']==trade['shares']
    assert buy['price']==pytest.approx(trade['entry_price'],abs=.0001)
    assert sell['price']==pytest.approx(trade['exit_price'],abs=.0001)
    assert state['cash']-10000==pytest.approx(trade['pnl'],abs=.01)


def test_forming_candle_fills_once_without_using_it_for_entry_rules(monkeypatch):
    s=Strategy.model_validate({'symbol':'TSLA','timeframe':'5m','entry':{'type':'candle_only','candle_conditions':{'direction':'bullish'}}})
    state=session(s);state['pending']={'side':'BUY','time':29,'reference':None}
    forming=candle(30,100,101,99,100.5)
    monkeypatch.setattr(live_data,'fetch',lambda *args,**kwargs:([],{'forming':forming}))
    first=paper.tick(state);second=paper.tick(first)
    assert len(second['signals'])==1 and second['signals'][0]['side']=='BUY'
    assert second['last_candle']==29


def test_stop_wins_over_target_and_partial():
    s=Strategy.model_validate({'symbol':'TSLA','timeframe':'5m','entry':{'type':'candle_only','candle_conditions':{'direction':'bullish'}},'partial_exit':{'fraction':.5,'profit_pct':1,'basis':'price'}})
    state=session(s);execution=ExecutionSettings(commission_per_order_usd=0,slippage_bps=0)
    state['pending']={'side':'BUY','time':29,'reference':None}
    paper.fill_pending(state,candle(30),s,execution)
    paper.protect(state,candle(31,100,110,90,100),s,execution)
    assert len(state['signals'])==2
    assert state['signals'][1]['quantity']==state['signals'][0]['quantity']
    assert state['position'] is None


def test_saved_strategy_snapshot_and_session_survive_reopen(tmp_path,monkeypatch):
    monkeypatch.setattr(storage.config,'DATABASE_PATH',tmp_path/'db.sqlite')
    strategy=Strategy.model_validate({'symbol':'TSLA','timeframe':'5m','entry':{'type':'candle_only','candle_conditions':{'direction':'bullish'}}})
    run=storage.save_run({'strategy':strategy.model_dump(),'execution':ExecutionSettings().model_dump()})
    saved=storage.save_strategy(run['id'],'My strategy')
    assert storage.save_strategy(run['id'],'Duplicate')['id']==saved['id']
    monkeypatch.setattr(live_data,'settings',lambda *args:{'configured':True})
    created=paper.create(saved)
    assert storage.paper_sessions()[0]['id']==created['id']
    with pytest.raises(ValueError,match='already running'):paper.create(saved)
    with pytest.raises(ValueError,match='Stop'):storage.delete_strategy(saved['id'])
    assert storage.stop_paper_session(created['id'])
    stale=storage.paper_sessions()[0];stale['cash']=1;storage.update_paper_session(stale)
    assert storage.paper_sessions()[0]['cash']==10000
    assert storage.delete_strategy(saved['id'])
    assert storage.delete_run(run['id'])
    assert storage.paper_sessions()[0]['status']=='stopped'


def test_save_and_delete_api_keep_caches_and_require_completed_result(tmp_path,monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    monkeypatch.setattr(storage.config,'DATABASE_PATH',tmp_path/'db.sqlite')
    cache=tmp_path/'cached.json';cache.write_text('preserve')
    strategy=Strategy.model_validate({'symbol':'TSLA','timeframe':'30m','entry':{'type':'candle_only','candle_conditions':{'direction':'bullish'}}})
    run=storage.save_run({'strategy':strategy.model_dump(),'execution':ExecutionSettings().model_dump()})
    client=TestClient(app)
    assert client.post('/api/strategies/save',json={'run_id':'missing','name':'test'}).status_code==404
    saved=client.post('/api/strategies/save',json={'run_id':run['id'],'name':'TSLA signal'}).json()
    assert client.get('/api/backtests').json()[0]['id']==run['id']
    assert client.get('/api/strategies/saved').json()[0]['id']==saved['id']
    assert client.delete('/api/backtest/'+run['id']).status_code==409
    assert client.delete('/api/strategies/saved/'+saved['id']).status_code==200
    assert client.delete('/api/backtest/'+run['id']).status_code==200
    assert cache.read_text()=='preserve'


def test_public_chart_contains_completed_and_forming_candles_without_mutating_state():
    s=Strategy.model_validate({'symbol':'BTCUSD','timeframe':'1d','entry':{'type':'ema_crossover','fast_period':9,'slow_period':21}})
    state=session(s)
    state['feed']={'forming':candle(30)}
    snapshot=copy.deepcopy(state)
    result=paper.public(state)
    assert len(result['candles'])==31
    assert result['candles'][-1]['time']==30
    assert 'history' not in result and 'pending' not in result
    assert state==snapshot
