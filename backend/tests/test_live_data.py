from datetime import datetime, timedelta, timezone

import pytest

from app import live_data


def test_missing_credentials_never_falls_back_to_historical_feed(monkeypatch):
    monkeypatch.delenv('ALPACA_API_KEY',raising=False)
    monkeypatch.delenv('ALPACA_API_SECRET',raising=False)
    monkeypatch.setattr(live_data,'_get',lambda *a:pytest.fail('No request without credentials'))
    with pytest.raises(ValueError,match='ALPACA_API_KEY'):live_data.fetch('TSLA','5m')


def test_oanda_access_is_checked_and_forming_candle_is_separate(monkeypatch):
    monkeypatch.setenv('OANDA_API_TOKEN','test');monkeypatch.setenv('OANDA_ACCOUNT_ID','test')
    calls=[]
    def get(url,headers,params):
        calls.append(url)
        assert url.startswith('https://api-fxpractice.oanda.com/')
        if url.endswith('instruments'):return {'instruments':[{'name':'XAU_USD'}]}
        return {'candles':[{'time':'2026-10-09T12:00:00Z','complete':True,'mid':{'o':'3000','h':'3010','l':'2990','c':'3005'},'volume':12},
                           {'time':'2026-10-09T12:05:00Z','complete':False,'mid':{'o':'3005','h':'3006','l':'3004','c':'3005'},'volume':3}]}
    monkeypatch.setattr(live_data,'_get',get)
    rows,info=live_data.fetch('XAUUSD','5m')
    assert len(rows)==1 and rows[0]['volume']==12
    assert info['forming']['volume']==3
    assert all('orders' not in url for url in calls)


def test_stock_feed_uses_iex_and_only_read_only_endpoints(monkeypatch):
    monkeypatch.setenv('ALPACA_API_KEY','test');monkeypatch.setenv('ALPACA_API_SECRET','test')
    def get(url,headers,params):
        assert url=='https://data.alpaca.markets/v2/stocks/TSLA/bars'
        assert params['feed']=='iex'
        return {'bars':[{'t':'2026-10-09T13:30:00Z','o':200,'h':201,'l':199,'c':200.5,'v':12}], 'next_page_token':None}
    monkeypatch.setattr(live_data,'_get',get)
    rows,info=live_data.fetch('TSLA','5m')
    assert len(rows)==1 and info['provider']=='Alpaca IEX'
