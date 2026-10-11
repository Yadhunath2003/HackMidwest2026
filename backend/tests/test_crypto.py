import httpx
import pytest
from app import crypto_data, live_data
from app.engine import run_backtest
from app.schemas import Strategy, ExecutionSettings


def test_kraken_candles_separate_forming_and_preserve_btc_volume(monkeypatch):
    monkeypatch.setattr(crypto_data.httpx,'get',lambda *a,**k:httpx.Response(200,request=httpx.Request('GET','https://api.kraken.com'),json={
        'error':[],'result':{'XXBTZUSD':[[100,'60000','61000','59000','60500','60000','.12345678',3],
                                     [400,'60500','61000','60000','60700','60000','.1',2]],'last':400}}))
    rows,info=crypto_data.fetch('5m')
    assert len(rows)==1 and rows[0]['volume']==.12345678
    assert info['forming']['time']==400
    assert live_data.settings('BTCUSD')['configured']


def test_fractional_btc_entry_partial_and_final_exit():
    s=Strategy.model_validate({'symbol':'BTCUSD','timeframe':'5m','entry':{'type':'candle_only','candle_conditions':{'direction':'bullish'}},
                              'partial_exit':{'fraction':.5,'profit_pct':1,'basis':'price'}})
    candles=[{'time':i*300,'open':o,'high':h,'low':l,'close':c,'volume':1} for i,(o,h,l,c) in enumerate([
        (60000,60600,59900,60500),(60500,64000,60400,63000)])]
    r=run_backtest(candles,s,ExecutionSettings(commission_per_order_usd=0,slippage_bps=0))
    trade=r['trades'][0]
    assert 0<trade['shares']<1
    assert len(trade['exits'])==2
    assert sum(e['shares'] for e in trade['exits'])==pytest.approx(trade['shares'])
