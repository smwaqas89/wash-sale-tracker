"""Parser for Robinhood transaction history CSV files."""

import csv
import re
from datetime import datetime, date
from pathlib import Path
from typing import Iterator

from models import Transaction


def parse_date(date_str: str) -> date:
    """Parse date from MM/DD/YYYY format."""
    return datetime.strptime(date_str.strip(), "%m/%d/%Y").date()


def parse_amount(amount_str: str) -> float:
    """
    Parse dollar amount from Robinhood format.
    
    Examples:
        "$10,193.66" -> 10193.66
        "($9,994.21)" -> -9994.21
        "" -> 0.0
    """
    if not amount_str or not amount_str.strip():
        return 0.0
    
    amount_str = amount_str.strip()
    
    # Check for negative (parentheses)
    is_negative = amount_str.startswith("(") and amount_str.endswith(")")
    
    # Remove parentheses, dollar sign, and commas
    cleaned = re.sub(r"[()$,]", "", amount_str)
    
    try:
        value = float(cleaned)
        return -value if is_negative else value
    except ValueError:
        return 0.0


def parse_price(price_str: str) -> float:
    """Parse price from format like '$31.51'."""
    if not price_str or not price_str.strip():
        return 0.0
    
    cleaned = price_str.strip().replace("$", "").replace(",", "")
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def parse_quantity(qty_str: str) -> float:
    """Parse quantity, handling empty strings."""
    if not qty_str or not qty_str.strip():
        return 0.0
    
    try:
        return float(qty_str.strip())
    except ValueError:
        return 0.0


def parse_robinhood_csv(filepath: str | Path) -> list[Transaction]:
    """
    Parse a Robinhood transaction history CSV file.
    
    Args:
        filepath: Path to the CSV file
        
    Returns:
        List of Transaction objects, sorted by date (oldest first)
        
    Raises:
        FileNotFoundError: If the file doesn't exist
        ValueError: If the CSV format is invalid
    """
    filepath = Path(filepath)
    
    if not filepath.exists():
        raise FileNotFoundError(f"File not found: {filepath}")
    
    transactions: list[Transaction] = []
    
    with open(filepath, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        
        # Validate expected columns
        expected_columns = {
            "Activity Date", "Instrument", "Description", 
            "Trans Code", "Quantity", "Price", "Amount"
        }
        
        if reader.fieldnames is None:
            raise ValueError("CSV file appears to be empty")
        
        actual_columns = set(reader.fieldnames)
        missing = expected_columns - actual_columns
        
        if missing:
            raise ValueError(f"CSV missing required columns: {missing}")
        
        for row_num, row in enumerate(reader, start=2):  # Start at 2 since row 1 is header
            # Safely get trans_code, handling None values
            trans_code_raw = row.get("Trans Code")
            trans_code = trans_code_raw.strip() if trans_code_raw else ""
            
            # Only process Buy and Sell transactions
            if trans_code not in ("Buy", "Sell"):
                continue
            
            try:
                # Safely get all fields, handling None values
                activity_date = row.get("Activity Date")
                instrument = row.get("Instrument")
                quantity = row.get("Quantity")
                price = row.get("Price")
                amount = row.get("Amount")
                description = row.get("Description")
                
                # Skip rows with missing critical fields
                if not activity_date or not instrument:
                    print(f"Warning: Skipping row {row_num} - missing date or instrument")
                    continue
                
                txn = Transaction(
                    date=parse_date(activity_date),
                    ticker=instrument.strip(),
                    trans_type=trans_code,
                    quantity=parse_quantity(quantity or ""),
                    price=parse_price(price or ""),
                    amount=parse_amount(amount or ""),
                    description=description.strip() if description else "",
                )
                
                # Skip transactions with zero quantity
                if txn.quantity <= 0:
                    continue
                    
                transactions.append(txn)
                
            except Exception as e:
                print(f"Warning: Skipping row {row_num} due to parse error: {e}")
                continue
    
    # Sort by date (oldest first) for chronological processing
    transactions.sort(key=lambda t: (t.date, t.trans_type == "Sell"))
    
    return transactions


def get_transaction_summary(transactions: list[Transaction]) -> dict:
    """
    Get summary statistics for a list of transactions.
    
    Returns:
        Dictionary with summary stats
    """
    if not transactions:
        return {
            "total": 0,
            "buys": 0,
            "sells": 0,
            "tickers": set(),
            "date_range": (None, None),
        }
    
    buys = [t for t in transactions if t.trans_type == "Buy"]
    sells = [t for t in transactions if t.trans_type == "Sell"]
    tickers = set(t.ticker for t in transactions)
    dates = [t.date for t in transactions]
    
    return {
        "total": len(transactions),
        "buys": len(buys),
        "sells": len(sells),
        "tickers": tickers,
        "ticker_count": len(tickers),
        "date_range": (min(dates), max(dates)),
    }
