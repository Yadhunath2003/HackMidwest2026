"""Read-only real-time candle providers. No broker order endpoints are used."""
import math
import os
from datetime import datetime, timedelta, timezone

import httpx

from .market_data import NEW_YORK, _aggregate_four_hour, _is_incomplete


def settings(symbol):
    if symbol == 'BTCUSD':
        return {'configured':True,'provider':'Kraken BTC/USD','required':[], 'notice':'Public real-time feed; volume is BTC traded on Kraken. No API key needed.'}
    gold = symbol == 'XAUUSD'
    ready = bool(os.getenv('OANDA_API_TOKEN') and os.getenv('OANDA_ACCOUNT_ID')) if gold else bool(os.getenv('ALPACA_API_KEY') and os.getenv('ALPACA_API_SECRET'))
    return {'configured': ready, 'provider': 'OANDA practice' if gold else 'Alpaca IEX',
            'notice': 'Gold availability depends on your OANDA practice account and region. Volume is quote activity.' if gold else 'Real-time IEX exchange data only. Its volume differs from the consolidated share volume used in historical backtests.',
            'required': ['OANDA_API_TOKEN', 'OANDA_ACCOUNT_ID'] if gold else ['ALPACA_API_KEY', 'ALPACA_API_SECRET']}


def _get(url, headers, params):
    try:
        response = httpx.get(url, headers=headers, params=params, timeout=20)
    except httpx.HTTPError:
        raise ValueError('Could not reach the real-time feed. No new signals were generated.') from None
    if response.status_code >= 400:
        raise ValueError(f'Real-time feed returned HTTP {response.status_code}. Check credentials, instrument access and quota.')
    try:
        return response.json()
    except ValueError:
        raise ValueError('Real-time feed returned invalid JSON.') from None


def fetch(symbol, timeframe, after=None, count=1000):
    if symbol == 'BTCUSD':
        from .crypto_data import fetch as fetch_crypto
        return fetch_crypto(timeframe, after)
    info = settings(symbol)
    if not info['configured']:
        raise ValueError('Configure ' + ', '.join(info['required']) + ' in backend/.env and restart the backend.')
    now = datetime.now(timezone.utc)
    if symbol == 'XAUUSD':
        headers = {'Authorization': 'Bearer ' + os.environ['OANDA_API_TOKEN']}
        account = os.environ['OANDA_ACCOUNT_ID']
        # Practice host is deliberately fixed; these are read-only data requests.
        instruments = _get(f'https://api-fxpractice.oanda.com/v3/accounts/{account}/instruments', headers, {'instruments': 'XAU_USD'})
        if not any(i.get('name') == 'XAU_USD' for i in instruments.get('instruments', [])):
            raise ValueError('XAU_USD is not available on this OANDA practice account.')
        params = {'granularity': {'5m':'M5','30m':'M30','1h':'H1','4h':'H4','1d':'D'}[timeframe], 'price':'M', 'count': min(5000,count)}
        if after is not None:
            params.pop('count'); params.update({'from':datetime.fromtimestamp(after,timezone.utc).isoformat(), 'includeFirst':'false'})
        payload = _get('https://api-fxpractice.oanda.com/v3/instruments/XAU_USD/candles', headers, params)
        forming = next((r for r in reversed(payload.get('candles',[])) if not r.get('complete')),None)
        if forming:
            info['forming']={'time':int(datetime.fromisoformat(forming['time'].replace('Z','+00:00')).timestamp()), **{k:float(forming['mid'][v]) for k,v in [('open','o'),('high','h'),('low','l'),('close','c')]}, 'volume':forming['volume']}
        rows = [{'time':int(datetime.fromisoformat(r['time'].replace('Z','+00:00')).timestamp()),
                 **{k:float(r['mid'][v]) for k,v in [('open','o'),('high','h'),('low','l'),('close','c')]},
                 'volume':r['volume']} for r in payload.get('candles',[]) if r.get('complete')]
    else:
        seconds = {'5m':300,'30m':1800,'1h':3600,'4h':14400,'1d':86400}[timeframe]
        start = datetime.fromtimestamp(after,timezone.utc) if after else now-timedelta(seconds=count*seconds*5)
        interval = {'5m':'5Min','30m':'30Min','1h':'1Hour','4h':'1Hour','1d':'1Day'}[timeframe]
        headers={'APCA-API-KEY-ID':os.environ['ALPACA_API_KEY'],'APCA-API-SECRET-KEY':os.environ['ALPACA_API_SECRET']}
        params={'timeframe':interval,'start':start.isoformat(),'end':now.isoformat(),'feed':'iex','adjustment':'split','limit':10000,'sort':'asc'}
        raw=[]
        for _ in range(20):
            payload=_get(f'https://data.alpaca.markets/v2/stocks/{symbol}/bars',headers,params)
            raw.extend(payload.get('bars') or [])
            token=payload.get('next_page_token')
            if not token:break
            params['page_token']=token
        else:raise ValueError('Live history exceeded pagination bounds.')
        rows=[]
        all_rows=[]
        for r in raw:
            stamp=datetime.fromisoformat(r['t'].replace('Z','+00:00'))
            local=stamp.astimezone(NEW_YORK)
            if timeframe!='1d' and not (local.weekday()<5 and 570<=local.hour*60+local.minute<960):continue
            candle={'time':int(stamp.timestamp()),**{k:float(r[v]) for k,v in [('open','o'),('high','h'),('low','l'),('close','c')]},'volume':float(r['v'])}
            all_rows.append(candle)
            if _is_incomplete(stamp,'1h' if timeframe=='4h' else timeframe,now):
                if timeframe!='4h':info['forming']=candle
                continue
            rows.append(candle)
        if timeframe=='4h':
            rows=_aggregate_four_hour(rows,now)
            groups={}
            for c in all_rows:
                local=datetime.fromtimestamp(c['time'],NEW_YORK)
                opening=local.replace(hour=9,minute=30,second=0,microsecond=0)
                bucket=opening+timedelta(hours=4*int((local-opening).total_seconds()//14400))
                groups.setdefault(int(bucket.timestamp()),[]).append(c)
            if groups:
                stamp=max(groups);parts=groups[stamp]
                local=datetime.fromtimestamp(stamp,NEW_YORK)
                end=min(local+timedelta(hours=4),local.replace(hour=16,minute=0))
                if end>now.astimezone(NEW_YORK) and parts[0]['time']==stamp:
                    info['forming']={'time':stamp,'open':parts[0]['open'],'high':max(c['high'] for c in parts),
                                     'low':min(c['low'] for c in parts),'close':parts[-1]['close'],
                                     'volume':sum(c['volume'] for c in parts)}
    for r in rows + ([info['forming']] if info.get('forming') else []):
        if not all(math.isfinite(r[k]) for k in ('open','high','low','close','volume')) or min(r[k] for k in ('open','high','low','close'))<=0 or r['volume']<0 or r['high']<max(r['open'],r['close']) or r['low']>min(r['open'],r['close']):
            raise ValueError('Real-time feed supplied invalid candles; no signals generated.')
    rows=sorted({r['time']:r for r in rows}.values(),key=lambda r:r['time'])
    return rows, info
