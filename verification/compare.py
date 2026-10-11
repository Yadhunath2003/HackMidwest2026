"""Independent Backtrader replay. No app imports, network calls, or live-job changes."""
import argparse
import csv
import json
import math
import sqlite3
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import backtrader as bt

ROOT = Path(__file__).resolve().parents[1]


class PerOrderFee(bt.CommInfoBase):
    params = (("stocklike", True), ("commtype", bt.CommInfoBase.COMM_FIXED))

    def _getcommission(self, size, price, pseudoexec):
        return self.p.commission if size else 0


class AdverseLimitBroker(bt.brokers.BackBroker):
    """Match the app's adverse slippage on profit exits, including limit exits."""
    def _try_exec_limit(self, order, popen, phigh, plow, plimit):
        if order.issell() and phigh >= plimit:
            self._execute(order, ago=0, price=max(popen, plimit) * (1 - self.p.slip_perc))
        else:
            super()._try_exec_limit(order, popen, phigh, plow, plimit)


class ReferenceStrategy(bt.Strategy):
    params = (("run", None), ("candles", None))

    def __init__(self):
        self.rules = self.p.run['strategy']['entry']['reference_breakout']
        self.judgments = self.p.run['trend_assessments']
        self.marked = self.pending = None
        self.records = []
        self.active = None
        self.protective = []
        self.fee = self.p.run['execution']['commission_per_order_usd']
        self.slip = self.p.run['execution']['slippage_bps'] / 10000
        self.missing = set()

    def trend(self, candle, direction):
        judgment = self.judgments.get(str(candle['time']))
        if judgment is None:
            self.missing.add(candle['time'])
            return False
        return judgment['direction'] == direction and judgment['confidence'] >= self.rules['min_confidence']

    def next_open(self):
        i = len(self.data) - 1
        if self.pending is None or self.position or i >= len(self.p.candles):
            return
        stop = self.pending['low']
        self.pending = None
        opening = self.data.open[0]
        fill = opening * (1 + self.slip)
        if opening <= stop or fill <= stop:
            return
        cash = self.broker.getcash()
        risk = cash * self.rules['risk_account_pct'] / 100
        profit = cash * self.rules['target_account_pct'] / 100
        quantity = min(math.floor((cash-self.fee)/fill),
                       max(0, math.floor((risk-2*self.fee)/(fill-stop*(1-self.slip)))))
        if quantity < 1:
            return
        target = (fill + (profit+2*self.fee)/quantity)/(1-self.slip)
        self.buy(size=quantity, coc=False)
        # Stop is submitted first so ambiguous candles are resolved stop-first.
        stop_order = self.sell(size=quantity, exectype=bt.Order.Stop, price=stop)
        target_order = self.sell(size=quantity, exectype=bt.Order.Limit, price=target, oco=stop_order)
        self.protective = [stop_order, target_order]

    def notify_order(self, order):
        if order.status != order.Completed:
            return
        stamp = round(bt.num2date(order.executed.dt).replace(tzinfo=timezone.utc).timestamp())
        if order.isbuy():
            self.active = {'entry_time': stamp, 'entry_price': order.executed.price,
                           'shares': order.executed.size, 'entry_fee': order.executed.comm}
        elif self.active:
            self.records.append({**self.active, 'exit_time':stamp, 'exit_price':order.executed.price,
                'pnl': round(self.active['shares']*(order.executed.price-self.active['entry_price'])
                             -self.active['entry_fee']-order.executed.comm, 2)})
            self.active = None

    def next(self):
        i = len(self.data)-1
        if i >= len(self.p.candles):
            return
        candle = self.p.candles[i]
        if not self.position:
            if self.marked and candle['low'] <= self.marked['low']:
                self.marked = None
            n = self.rules['volume_lookback']
            prior = self.p.candles[max(0,i-n):i]
            average = sum(c['volume'] for c in prior)/n if len(prior)==n else 0
            if candle['close'] < candle['open'] and average > 0 and candle['volume']/average >= self.rules['reference_volume_min']:
                if self.trend(candle, 'bearish'):
                    self.marked = candle
            elif self.marked and candle['close'] > candle['open']:
                span = candle['high']-candle['low']
                body = (candle['close']-candle['open'])/span if span else 0
                if body >= self.rules['momentum_body_min'] and candle[self.rules['breakout_by']] > self.marked['high'] and self.trend(candle,'bullish'):
                    self.pending, self.marked = self.marked, None
        if i == len(self.p.candles)-1 and self.position:
            for order in self.protective:
                self.cancel(order)
            self.close()  # Broker cheat-on-close liquidates at the final close.


def compare(run_id):
    with sqlite3.connect(f"file:{ROOT / 'backend/data/strategylab.db'}?mode=ro", uri=True) as db:
        row = db.execute('SELECT result FROM runs WHERE id=?', (run_id,)).fetchone()
    if not row:
        raise ValueError('Run is not saved yet. Wait for it to complete.')
    run = json.loads(row[0])
    strategy = run['strategy']
    if strategy['symbol']=='XAUUSD' or strategy.get('partial_exit') or strategy['entry']['type']!='ai_reference_breakout':
        raise ValueError('This verifier currently supports stock reference-breakout strategies without partial exits.')
    candles = json.loads((ROOT / f"backend/data/candles/{strategy['symbol']}_{strategy['timeframe']}.json").read_text())['candles']
    start = round(datetime.fromisoformat(run['data']['start']).timestamp())
    end = round(datetime.fromisoformat(run['data']['end']).timestamp())
    candles = [c for c in candles if start <= c['time'] <= end]
    if len(candles)!=run['data']['candle_count']:
        raise ValueError('Cached candle coverage differs from saved run; comparison refused.')
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory)/'candles.csv'
        with path.open('w', newline='') as f:
            writer = csv.writer(f); writer.writerow(['time','open','high','low','close','volume'])
            for c in candles:
                writer.writerow([datetime.fromtimestamp(c['time'],timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),*[c[k] for k in ('open','high','low','close','volume')]])
            # One inert bar lets the broker settle the final-close liquidation.
            last = candles[-1]; price = last['close']
            writer.writerow([datetime.fromtimestamp(last['time']+60,timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),price,price,price,price,0])
        cerebro = bt.Cerebro(cheat_on_open=True)
        broker = AdverseLimitBroker(checksubmit=False)
        broker.setcash(strategy['initial_capital'])
        broker.addcommissioninfo(PerOrderFee(commission=run['execution']['commission_per_order_usd']))
        broker.set_coc(True)
        broker.set_slippage_perc(run['execution']['slippage_bps']/10000,slip_open=True,slip_out=True)
        cerebro.setbroker(broker)
        cerebro.adddata(bt.feeds.GenericCSVData(dataname=str(path),dtformat='%Y-%m-%d %H:%M:%S',timeframe=bt.TimeFrame.Minutes,openinterest=-1))
        cerebro.addstrategy(ReferenceStrategy,run=run,candles=candles)
        result = cerebro.run()[0]
    expected = run['trades']; actual = result.records
    differences=[]
    if len(expected)!=len(actual):
        differences.append({'field':'trade_count','app':len(expected),'backtrader':len(actual)})
    for i,(a,b) in enumerate(zip(expected,actual)):
        for field in ('entry_time','exit_time','shares','entry_price','exit_price','pnl'):
            if abs(a[field]-b[field]) > (0.011 if field=='pnl' else 0.00011):
                differences.append({'trade':i+1,'field':field,'app':a[field],'backtrader':b[field]})
    report = {'run_id':run_id,'symbol':strategy['symbol'],'timeframe':strategy['timeframe'],
              'engine':'Backtrader '+bt.__version__,'app_trades':len(expected),'backtrader_trades':len(actual),
              'app_net_profit':round(sum(t['pnl'] for t in expected),2),
              'backtrader_net_profit':round(sum(t['pnl'] for t in actual),2),
              'missing_ai_judgments':sorted(result.missing),'differences':differences,
              'matched':not differences and not result.missing,'backtrader_trade_details':actual,
              'limitations':['Reuses saved AI decisions; validates execution, not AI trend accuracy.',
                             'Uses current cached candles with matching dates/count; original candle values were not saved with the run.',
                             'Custom broker models app adverse limit slippage and stop-first order priority.']}
    out=ROOT/'verification'/f'{run_id}.json';out.write_text(json.dumps(report,indent=2))
    print(json.dumps({k:v for k,v in report.items() if k!='backtrader_trade_details'},indent=2))
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('run_id', nargs='?')
    parser.add_argument('--job', help='Wait for an existing local job to finish; never starts a backtest.')
    args=parser.parse_args()
    if args.job:
        for _ in range(8640):  # At most 24 hours, one read-only check every ten seconds.
            with urllib.request.urlopen(f'http://127.0.0.1:8000/api/backtest/jobs/{args.job}',timeout=15) as response:
                job=json.load(response)
            if job['status']=='completed':
                compare(job['run_id'])
                break
            if job['status']=='failed':
                raise RuntimeError(job.get('message','Backtest failed'))
            time.sleep(10)
        else:
            raise TimeoutError('Job did not finish within 24 hours.')
    elif args.run_id:
        compare(args.run_id)
    else:
        parser.error('Provide a saved run ID or --job JOB_ID')
