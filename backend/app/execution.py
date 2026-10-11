"""Direction-aware hypothetical execution math shared by backtests and paper signals."""
import math


def sign(strategy):
    return -1 if strategy.direction == 'short' else 1


def unit_for(symbol):
    return .00000001 if symbol == 'BTCUSD' else .01 if symbol == 'XAUUSD' else 1


def account_target(entry, gain, fees, quantity, direction, slip):
    return (entry + direction * (gain + fees) / quantity) / (1 - direction * slip)


def entry_terms(strategy, execution, raw_open, equity, reference=None):
    d = sign(strategy)
    slip = execution.slippage_bps / 10000
    fee = execution.commission_per_order_usd
    fill = raw_open * (1 + d * slip)
    unit = unit_for(strategy.symbol)
    quantity = round(math.floor(strategy.position_size_usd / fill / unit) * unit, 8)
    stop = fill * (1 - d * strategy.stop_loss_pct / 100)
    target = fill * (1 + d * strategy.take_profit_pct / 100)
    risk = planned = profit = None
    fees = (3 if strategy.partial_exit else 2) * fee
    if strategy.entry.reference_breakout:
        stop = reference['low' if d == 1 else 'high']
        if d * (raw_open - stop) <= 0 or d * (fill - stop) <= 0:
            return None, 'Next open is beyond the marked stop; entry skipped.'
        rules = strategy.entry.reference_breakout
        risk = equity * rules.risk_account_pct / 100
        profit = equity * rules.target_account_pct / 100
        loss_per_unit = d * (fill - stop * (1 - d * slip))
        affordable = max(0, math.floor((equity - fee) / fill / unit))
        risk_units = max(0, math.floor((risk - fees) / loss_per_unit / unit))
        quantity = round(min(affordable, risk_units) * unit, 8)
        planned = quantity * loss_per_unit + fees
        if quantity:
            target = account_target(fill, profit, fees, quantity, d, slip)
    if quantity < unit:
        return None, 'Position size is smaller than the minimum quantity unit.'
    if quantity * fill + fee > equity:
        return None, 'Not enough cash/collateral for the position and commission.'
    if target <= 0:
        return None, 'Requested account target implies a nonpositive price; entry skipped.'
    result = dict(entry_price=fill, stop=stop, target=target, quantity=quantity, risk_budget=risk,
                  planned_stop_loss=planned, target_profit=profit)
    if strategy.partial_exit:
        partial = strategy.partial_exit
        size = round(math.floor(quantity * partial.fraction / unit + 1e-9) * unit, 8)
        price = (fill * (1 + d * partial.profit_pct / 100) if partial.basis == 'price'
                 else account_target(fill, equity * partial.profit_pct / 100, 3 * fee, quantity, d, slip))
        if size >= unit and quantity - size >= unit - 1e-9 and price > 0 and d * (target - price) > 0:
            result.update(partial_quantity=size, partial_price=price)
        else:
            result['partial_exit_skipped'] = 'Partial quantity is too small or its trigger is beyond the final target.'
            if profit is not None:
                result['target'] = account_target(fill, profit, 2 * fee, quantity, d, slip)
                result['planned_stop_loss'] = quantity * loss_per_unit + 2 * fee
    return result, None


def close_value(quantity, entry, exit_fill, direction):
    # Release collateral plus P/L on shorts; release sale value on longs.
    return quantity * (entry + direction * (exit_fill - entry))
