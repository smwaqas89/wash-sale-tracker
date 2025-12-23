# Wash Sale Tracker - CLI

A command-line tool for detecting and preventing wash sales.

## Requirements

- Python 3.10+
- No external dependencies

## Usage

```bash
# Basic usage
python main.py /path/to/transactions.csv

# With date override
python main.py /path/to/transactions.csv --date 2025-12-23
```

## Interactive Commands

| Command | Description |
|---------|-------------|
| `<TICKER>` | Check if ticker is safe to buy |
| `list` | Show active wash sale windows |
| `history` | Show historical violations |
| `help` | Show available commands |
| `q` / `quit` | Exit |

## Example Session

```
$ python main.py transactions.csv --date 2025-12-23

Parsing transactions.csv... Done.
Loaded 247 transactions (2025-01-01 to 2025-12-19)
  → 89 buys, 34 sells across 15 tickers

==================================================
 Historical Wash Sales Detected
==================================================

1. METU: Bought 500.0000 shares on 2025-09-01
   ↳ Within 30 days of loss sale on 2025-10-01
   ↳ Original loss: $1500.00
   ↳ Disallowed loss: $1500.00

==================================================
 Active Wash Sale Windows (as of 2025-12-23)
==================================================

TICKER   LOSS DATE     LOSS AMOUNT SAFE AFTER     DAYS
------------------------------------------------------
NFXL     2025-12-19   $  1,129.09 2026-01-19       27
AMZU     2025-12-19   $    889.95 2026-01-19       27

--------------------------------------------------
Commands: <TICKER> to check, 'list', 'history', 'q' to quit
--------------------------------------------------

Enter command: NFXL

⚠️  WASH SALE WARNING: Do not buy NFXL!

   Loss sale on 2025-12-19:
     Sold 323.5072 shares @ $31.51
     Proceeds: $10,193.66
     Cost basis: $11,322.75
     Loss: $1,129.09

   Safe to buy after: 2026-01-19 (27 days from now)

Enter command: AAPL

✓ AAPL is clear - no wash sale restrictions.

Enter command: q
Goodbye!
```

## Module Structure

| File | Purpose |
|------|---------|
| `main.py` | CLI entry point & interactive loop |
| `parser.py` | Robinhood CSV parsing |
| `portfolio.py` | FIFO lot tracking & cost basis |
| `wash_sale_engine.py` | Wash sale detection logic |
| `models.py` | Data classes |
