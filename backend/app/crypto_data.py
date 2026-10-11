"""Public Kraken BTC/USD candles for both backtests and paper signals."""
import math
import time
from datetime import datetime, timezone

import httpx

INTERVALS={'5m':5,'30m':30,'1h':60,'4h':240,'1d':1440}
CACHE_PERIOD='kraken-btc-usd-v1'


def fetch(timeframe, after=None):
    params={'pair':'XBTUSD','interval':INTERVALS[timeframe]}
    if after is not None:params['since']=after
    try:
        response=httpx.get('https://api.kraken.com/0/public/OHLC',params=params,timeout=20)
        response.raise_for_status()
        data=response.json()
    except (httpx.HTTPError,ValueError):
        raise ValueError('Could not load Kraken BTC/USD candles.') from None
    if data.get('error'):raise ValueError('Kraken rejected the BTC/USD candle request.')
    result=data.get('result',{})
    raw=next((v for k,v in result.items() if k!='last' and isinstance(v,list)),[])
    if not raw:raise ValueError('Kraken returned no BTC/USD candles.')
    rows=[]
    for r in raw:
        c={'time':int(r[0]),'open':float(r[1]),'high':float(r[2]),'low':float(r[3]),'close':float(r[4]),'volume':float(r[6])}
        if not all(math.isfinite(c[k]) for k in ('open','high','low','close','volume')) or min(c[k] for k in ('open','high','low','close'))<=0 or c['volume']<0 or c['high']<max(c['open'],c['close']) or c['low']>min(c['open'],c['close']):
            raise ValueError('Kraken returned invalid candle values.')
        rows.append(c)
    forming=rows[-1]  # Kraken always includes the current uncommitted candle last.
    seconds=INTERVALS[timeframe]*60
    candles=sorted({c['time']:c for c in rows[:-1] if c['time']+seconds<=time.time()}.values(),key=lambda c:c['time'])
    info={'configured':True,'provider':'Kraken BTC/USD','required':[],
          'notice':'Public real-time Kraken BTC/USD feed; volume is BTC traded on Kraken, not the whole crypto market.',
          'forming':forming}
    return candles,info


def fetch_history(timeframe):
    from .engine import describe_range
    rows,info=fetch(timeframe)
    if not rows:raise ValueError('No completed BTC/USD candles available.')
    now=datetime.now(timezone.utc)
    return rows,{'source':info['provider'],'symbol':'BTCUSD','timeframe':timeframe,
        'requested_period':CACHE_PERIOD,**describe_range(rows),'volume_kind':'traded',
        'volume_type':'BTC traded on Kraken.','adjustment':'Unadjusted spot USD per BTC.',
        'fetched_at':now.isoformat(),'fetched_at_epoch':int(now.timestamp()),
        'limitations':['Kraken returns up to 720 recent candles, including one forming candle. Older cached completed candles are retained.',
                       '24/7 trading; volume and prices are exchange-specific. No missing candles are invented.']}
