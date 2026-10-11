Independent Backtrader verification
==================================

This tool does not import the app engine, call AI/data providers, or change live jobs.
It independently implements stock reference-volume breakout signals, next-open
entries, whole-share account-risk sizing, stops, account-profit targets, per-order
fees, adverse slippage, and final-close liquidation in Backtrader.

From the repository root in PowerShell:

```powershell
backend/.venv/Scripts/python.exe -m venv verification/.venv
verification/.venv/Scripts/python.exe -m pip install -r verification/requirements.txt
verification/.venv/Scripts/python.exe verification/compare.py RUN_ID
```

To wait for a job already running on localhost:8000:

```powershell
verification/.venv/Scripts/python.exe verification/compare.py --job JOB_ID
```

Reports are written to `verification/RUN_ID.json`. Comparison tolerances are
$0.00011 for execution prices and $0.011 for each rounded trade's profit;
timestamps and quantities must match exactly within that numerical tolerance.
Unsupported strategy types, gold, and partial exits are rejected explicitly.
Missing saved AI judgments prevent a successful verification.

Saved AI judgments are reused, so this checks execution and signal-rule consistency,
not whether AI trend classifications are correct. The custom broker applies adverse
slippage on profit-limit exits and prioritizes stops, matching the app's stated
execution assumptions rather than Backtrader's default limit-fill policy.

Current cached candles must match the saved run's dates and count. Old runs do not
store every original candle value, so matching coverage cannot prove data identity.
Provider revisions can therefore produce legitimate differences.

Validated against saved TSLA hourly run `28dd6e7746c2`: 18 trades matched,
net profit $516.82 in both engines, no missing AI judgments or trade differences.
