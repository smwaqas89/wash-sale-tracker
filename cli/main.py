#!/usr/bin/env python3
"""
Wash Sale Tracker - CLI Tool

Analyzes Robinhood transaction history to detect wash sales
and prevent future wash sale violations.

Usage:
    python main.py <transactions.csv> [--date YYYY-MM-DD]
"""

import argparse
import sys
from datetime import datetime, date
from pathlib import Path

from parser import parse_robinhood_csv, get_transaction_summary
from wash_sale_engine import WashSaleEngine
from models import LossSale, WashSaleViolation


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Analyze Robinhood transactions for wash sales",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python main.py transactions.csv
    python main.py transactions.csv --date 2025-12-23
        """,
    )
    
    parser.add_argument(
        "file",
        type=Path,
        help="Path to Robinhood transaction history CSV file",
    )
    
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Override today's date (YYYY-MM-DD format). Default: system date",
    )
    
    return parser.parse_args()


def parse_override_date(date_str: str | None) -> date:
    """Parse the override date or return today."""
    if date_str is None:
        return date.today()
    
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        print(f"Error: Invalid date format '{date_str}'. Use YYYY-MM-DD.")
        sys.exit(1)


def print_header(title: str) -> None:
    """Print a section header."""
    print(f"\n{'=' * 50}")
    print(f" {title}")
    print('=' * 50)


def print_violations(violations: list[WashSaleViolation]) -> None:
    """Print historical wash sale violations."""
    if not violations:
        print("\n✓ No historical wash sales detected.")
        return
    
    print_header("Historical Wash Sales Detected")
    
    for i, v in enumerate(violations, 1):
        print(f"\n{i}. {v.ticker}: Bought {v.triggering_buy_quantity:.4f} shares on {v.triggering_buy_date}")
        print(f"   ↳ Within 30 days of loss sale on {v.loss_sale.sale_date}")
        print(f"   ↳ Original loss: ${v.loss_sale.loss_amount:.2f}")
        print(f"   ↳ Disallowed loss: ${v.disallowed_loss:.2f}")


def print_active_windows(active: list[LossSale], as_of_date: date) -> None:
    """Print active wash sale windows grouped by ticker."""
    if not active:
        print("\n✓ No active wash sale windows.")
        return
    
    print_header(f"Active Wash Sale Windows (as of {as_of_date})")
    
    # Group by ticker
    from collections import defaultdict
    ticker_groups = defaultdict(lambda: {'losses': [], 'total': 0.0, 'safe_date': None})
    
    for ls in active:
        ticker_groups[ls.ticker]['losses'].append(ls)
        ticker_groups[ls.ticker]['total'] += ls.loss_amount
        safe = ls.safe_to_buy_date()
        if ticker_groups[ls.ticker]['safe_date'] is None or safe > ticker_groups[ls.ticker]['safe_date']:
            ticker_groups[ls.ticker]['safe_date'] = safe
    
    # Sort by total loss amount (highest first)
    sorted_tickers = sorted(ticker_groups.items(), key=lambda x: -x[1]['total'])
    
    # Table header
    print(f"\n{'TICKER':<8} {'TOTAL LOSS':>14} {'SAFE AFTER':<12} {'DAYS':>8} {'# SALES':>8}")
    print("-" * 54)
    
    grand_total = 0.0
    for ticker, data in sorted_tickers:
        days = (data['safe_date'] - as_of_date).days
        num_sales = len(data['losses'])
        grand_total += data['total']
        print(
            f"{ticker:<8} "
            f"${data['total']:>12,.2f} "
            f"{data['safe_date'].isoformat():<12} "
            f"{days:>8} "
            f"{num_sales:>8}"
        )
    
    print("-" * 54)
    print(f"{'TOTAL':<8} ${grand_total:>12,.2f}")
    print()
    print("⚠️  Buying any of these tickers before the safe date")
    print("   will trigger a wash sale and disallow the loss deduction!")


def print_ticker_check(ticker: str, engine: WashSaleEngine, as_of_date: date) -> None:
    """Check and print status for a single ticker."""
    status = engine.check_ticker(ticker.upper(), as_of_date)
    
    if status.is_safe:
        print(f"\n✓ {ticker.upper()} is clear - no wash sale restrictions.")
    else:
        print(f"\n⚠️  WASH SALE WARNING: Do not buy {ticker.upper()}!")
        
        for ls in status.active_windows:
            print(f"\n   Loss sale on {ls.sale_date}:")
            print(f"     Sold {ls.quantity:.4f} shares @ ${ls.sale_price:.2f}")
            print(f"     Proceeds: ${ls.proceeds:,.2f}")
            print(f"     Cost basis: ${ls.cost_basis:,.2f}")
            print(f"     Loss: ${ls.loss_amount:,.2f}")
        
        safe_date = status.safe_to_buy_date
        days = status.days_until_safe
        print(f"\n   Safe to buy after: {safe_date} ({days} days from now)")


def interactive_loop(engine: WashSaleEngine, as_of_date: date) -> None:
    """Run the interactive ticker checking loop."""
    print("\n" + "-" * 50)
    print("Commands: <TICKER> to check, 'list', 'history', 'q' to quit")
    print("-" * 50)
    
    while True:
        try:
            user_input = input("\nEnter command: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break
        
        if not user_input:
            continue
        
        cmd = user_input.lower()
        
        if cmd in ("q", "quit", "exit"):
            print("Goodbye!")
            break
        elif cmd == "list":
            active = engine.get_active_windows(as_of_date)
            print_active_windows(active, as_of_date)
        elif cmd == "history":
            violations = engine.get_historical_violations()
            print_violations(violations)
        elif cmd == "help":
            print("\nCommands:")
            print("  <TICKER>  - Check if a ticker is safe to buy")
            print("  list      - Show all active wash sale windows")
            print("  history   - Show historical wash sales detected")
            print("  q/quit    - Exit the program")
        else:
            # Treat as a ticker symbol
            print_ticker_check(user_input, engine, as_of_date)


def main() -> None:
    """Main entry point."""
    args = parse_args()
    as_of_date = parse_override_date(args.date)
    
    # Parse transactions
    print(f"Parsing {args.file}... ", end="", flush=True)
    
    try:
        transactions = parse_robinhood_csv(args.file)
    except FileNotFoundError:
        print(f"\nError: File not found: {args.file}")
        sys.exit(1)
    except ValueError as e:
        print(f"\nError: {e}")
        sys.exit(1)
    
    print("Done.")
    
    # Get summary
    summary = get_transaction_summary(transactions)
    
    if summary["total"] == 0:
        print("No Buy/Sell transactions found in file.")
        sys.exit(0)
    
    date_start, date_end = summary["date_range"]
    print(f"Loaded {summary['total']} transactions ({date_start} to {date_end})")
    print(f"  → {summary['buys']} buys, {summary['sells']} sells across {summary['ticker_count']} tickers")
    
    # Process through wash sale engine
    engine = WashSaleEngine()
    engine.process_transactions(transactions)
    
    # Report skipped sells
    if engine.skipped_sells > 0:
        print(f"  → {engine.skipped_sells} sells skipped (no matching buy lots)")
    
    # Show historical violations
    violations = engine.get_historical_violations()
    print_violations(violations)
    
    # Show active windows
    active_windows = engine.get_active_windows(as_of_date)
    print_active_windows(active_windows, as_of_date)
    
    # Enter interactive mode
    interactive_loop(engine, as_of_date)


if __name__ == "__main__":
    main()
