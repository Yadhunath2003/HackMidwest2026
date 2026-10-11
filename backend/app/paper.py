"""Persistent signal-only paper sessions. Never sends orders to a broker."""
import copy
import logging
import threading
import time
import uuid
from datetime import datetime, timezone

from . import ai_trends, live_data, storage
from .engine import compute_features, entry_signal, _crossed
from .schemas import Strategy, ExecutionSettings
from .execution import sign, entry_terms, account_target, close_value


def create(saved):
    strategy=Strategy.model_validate(saved['strategy'])
    provider=live_data.settings(strategy.symbol)
    if not provider['configured']:
        raise ValueError('Configure '+', '.join(provider['required'])+' in backend/.env, then restart the backend.')
    now=datetime.now(timezone.utc).isoformat()
    session={'id':uuid.uuid4().hex[:12],'strategy_id':saved['id'],'name':saved['name'],
             'created_at':now,'updated_at':now,'status':'running','strategy':strategy.model_dump(),
             'execution':saved['execution'],'cash':strategy.initial_capital,'history':[],
             'position':None,'pending':None,'marked':None,'signals':[],'last_candle':None,
             'message':'Connecting to the real-time feed. Historical candles warm indicators; no historical trade alerts.',
             'feed':provider,'error':None}
    storage.create_paper_session(session)
    return public(session)


def public(session):
    result={k:v for k,v in session.items() if k not in ('history','marked','pending')}
    candles={c['time']:c for c in session.get('history',[])[-300:]}
    forming=session.get('feed',{}).get('forming')
    if forming and (not candles or forming['time']>max(candles)):
        candles[forming['time']]=forming
    result['candles']=[candles[t] for t in sorted(candles)]
    return result


def emit(state, side, candle, quantity, price, reason):
    state['signals'].append({'id':uuid.uuid4().hex[:12],'side':side,'time':candle['time'],
        'detected_at':datetime.now(timezone.utc).isoformat(),'quantity':quantity,'price':round(price,4),
        'direction':state['strategy'].get('direction','long'),'action':('entry' if (side=='BUY') == (state['strategy'].get('direction','long')=='long') else 'exit'),
        'reason':reason,'stop':state['position']['stop'] if state['position'] else None,
        'target':state['position']['target'] if state['position'] else None})


def protect(state,candle,strategy,execution):
    pos=state['position']
    if not pos:return
    slip=execution.slippage_bps/10000;fee=execution.commission_per_order_usd;d=sign(strategy)
    def sell(quantity,raw,reason):
        fill=raw*(1-d*slip)
        emit(state,'SELL' if d==1 else 'BUY',candle,quantity,fill,reason)
        state['cash']+=close_value(quantity,pos['entry_price'],fill,d)-fee
        pos['realized']+=d*quantity*(fill-pos['entry_price'])-fee
        pos['quantity']=round(pos['quantity']-quantity,8)
        if pos['quantity']==0:state['position']=None
    def partial(raw):
        sell(pos['partial_quantity'],raw,'Partial profit target reached')
        del pos['partial_price']
        if pos.get('target_profit'):
            pos['target']=account_target(pos['entry_price'],pos['target_profit']-pos['realized'],fee,pos['quantity'],d,slip)
    if 'partial_price' in pos and d*(candle['open']-pos['partial_price'])>=0:partial(candle['open'])
    if candle['time']!=pos['entry_time'] and d*(candle['open']-pos['stop'])<=0:
        sell(pos['quantity'],candle['open'],'Opened beyond stop')
    elif candle['time']!=pos['entry_time'] and d*(candle['open']-pos['target'])>=0:
        sell(pos['quantity'],candle['open'],'Opened beyond profit target')
    elif (candle['low']<=pos['stop'] if d==1 else candle['high']>=pos['stop']):
        sell(pos['quantity'],pos['stop'],'Stop reached; stop takes priority when both levels are touched')
    else:
        if 'partial_price' in pos and (candle['high']>=pos['partial_price'] if d==1 else candle['low']<=pos['partial_price']):partial(pos['partial_price'])
        if (candle['high']>=pos['target'] if d==1 else candle['low']<=pos['target']):sell(pos['quantity'],pos['target'],'Profit target reached')


def fill_pending(state,candle,strategy,execution):
    pending=state['pending']
    if not pending:return
    if candle['time']<=pending['time']:return
    state['pending']=None
    slip=execution.slippage_bps/10000;fee=execution.commission_per_order_usd;d=sign(strategy)
    if pending.get('action')=='exit' or (pending.get('action') is None and pending['side']=='SELL'):
        pos=state['position']
        if pos:
            price=candle['open']*(1-d*slip)
            emit(state,'SELL' if d==1 else 'BUY',candle,pos['quantity'],price,'Reverse crossover; next open')
            state['cash']+=close_value(pos['quantity'],pos['entry_price'],price,d)-fee
            state['position']=None
        return
    if state['position']:return
    terms,error=entry_terms(strategy,execution,candle['open'],state['cash'],pending.get('reference'))
    if error:
        state['message']=error
        return
    quantity,fill=terms['quantity'],terms['entry_price']
    pos={**terms,'direction':strategy.direction,'entry_time':candle['time'],'realized':-fee}
    state['position']=pos;state['cash']-=quantity*fill+fee
    emit(state,'BUY' if d==1 else 'SELL',candle,quantity,fill,
         'Long entry at next open' if d==1 else 'Sell short at next open (paper simulation)')


def process(state,candle,strategy,execution):
    d=sign(strategy)
    fill_pending(state,candle,strategy,execution)
    protect(state,candle,strategy,execution)
    history=state['history']+[candle]
    features=compute_features(history,strategy);i=len(history)-1
    def trend(direction,context,confidence):
        judgment=ai_trends.assess(history,context,volume_kind='quote' if strategy.symbol=='XAUUSD' else 'traded')
        return judgment['direction']==direction and judgment['confidence']>=confidence
    if state['position'] is None:
        rules=strategy.entry.reference_breakout
        triggered=False
        if rules:
            if state['marked'] and (candle['low']<=state['marked']['low'] if d==1 else candle['high']>=state['marked']['high']):state['marked']=None
            rvol=features['rvol'][i]
            if d*(candle['close']-candle['open'])<0 and rvol is not None and rvol>=rules.reference_volume_min:
                if trend('bearish' if d==1 else 'bullish',rules.context_candles,rules.min_confidence):state['marked']=candle
            elif state['marked'] and d*(candle['close']-candle['open'])>0:
                body=features['anatomy'][i]['body_to_range']
                if body is not None and body>=rules.momentum_body_min and d*(candle[rules.breakout_by if d==1 or rules.breakout_by=='close' else 'low']-state['marked']['high' if d==1 else 'low'])>0:
                    triggered=trend('bullish' if d==1 else 'bearish',rules.context_candles,rules.min_confidence)
        else:
            triggered=entry_signal(features,i,strategy)
            t=strategy.entry.ai_trend
            if triggered and t:triggered=trend(t.direction,t.context_candles,t.min_confidence)
        if triggered:
            state['pending']={'action':'entry','side':'BUY' if d==1 else 'SELL','time':candle['time'],'reference':state['marked']}
            state['marked']=None
    elif strategy.exit_on_reverse_crossover and _crossed(features,i,up=d==-1):
        state['pending']={'action':'exit','side':'SELL' if d==1 else 'BUY','time':candle['time']}
    state['history']=history[-max(1200, strategy.entry.ai_trend.context_candles+100 if strategy.entry.ai_trend else 1200):]
    state['last_candle']=candle['time']


def tick(session):
    state=copy.deepcopy(session);strategy=Strategy.model_validate(state['strategy']);execution=ExecutionSettings.model_validate(state['execution'])
    candles,feed=live_data.fetch(strategy.symbol,strategy.timeframe,after=state['last_candle'],count=1200)
    state['feed']=feed
    if not state['history']:
        if not candles:raise ValueError('Feed returned no completed candles for indicator warm-up.')
        state['history']=candles[-1200:];state['last_candle']=candles[-1]['time']
        state['message']='Monitoring new candles. Historical warm-up produced no buy/sell signals.'
    else:
        for candle in candles:
            if candle['time']>state['last_candle']:process(state,candle,strategy,execution)
    forming=feed.get('forming')
    if forming and forming['time']>state['last_candle']:
        fill_pending(state,forming,strategy,execution);protect(state,forming,strategy,execution)
    state['error']=None
    return state


def monitor(stop):
    while not stop.is_set():
        try:
            for session in storage.paper_sessions(active_only=True):
                try:storage.update_paper_session(tick(session))
                except Exception as exc:
                    logging.exception('Paper session update failed')
                    session['error']=str(exc) if isinstance(exc,ValueError) else 'Signal update failed. Waiting to retry; no broker orders were submitted.'
                    storage.update_paper_session(session)
        except Exception:logging.exception('Could not load paper sessions')
        stop.wait(15)


def start_monitor():
    stop=threading.Event()
    threading.Thread(target=monitor,args=(stop,),name='paper-signals',daemon=True).start()
    return stop
