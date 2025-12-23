"""Wash sale detection engine."""

from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from models import Transaction, LossSale, WashSaleViolation, WashSaleStatus
from portfolio import Portfolio, SellResult


class WashSaleEngine:
    """
    Engine for detecting wash sales - both historical and forward-looking.
    
    Processes transactions chronologically and tracks:
    1. Loss sales and their 61-day wash windows
    2. Historical wash sale violations (buys within window of prior loss sales)
    3. Active windows for future purchase checks
    """
    
    def __init__(self):
        self._portfolio = Portfolio()
        self._loss_sales: list[LossSale] = []
        self._violations: list[WashSaleViolation] = []
        self._all_transactions: list[Transaction] = []
        self._skipped_sells: int = 0
    
    def process_transactions(self, transactions: list[Transaction]) -> None:
        """
        Process a list of transactions chronologically.
        
        Args:
            transactions: List of transactions (should be sorted by date)
        """
        # Sort by date to ensure chronological processing
        sorted_txns = sorted(transactions, key=lambda t: (t.date, t.trans_type == "Sell"))
        
        for txn in sorted_txns:
            self._all_transactions.append(txn)
            
            if txn.trans_type == "Buy":
                self._process_buy(txn)
            elif txn.trans_type == "Sell":
                self._process_sell(txn)
    
    def _process_buy(self, txn: Transaction) -> None:
        """Process a buy transaction."""
        # Check if this buy triggers a wash sale (bought within 30 days AFTER a loss sale)
        for loss_sale in self._loss_sales:
            if loss_sale.ticker == txn.ticker and loss_sale.is_in_wash_window(txn.date):
                # This is a wash sale violation!
                # Calculate the disallowed loss (proportional if partial)
                disallowed = min(txn.quantity, loss_sale.quantity) / loss_sale.quantity * loss_sale.loss_amount
                
                violation = WashSaleViolation(
                    ticker=txn.ticker,
                    loss_sale=loss_sale,
                    triggering_buy_date=txn.date,
                    triggering_buy_quantity=txn.quantity,
                    disallowed_loss=disallowed,
                )
                self._violations.append(violation)
        
        # Add the lot to portfolio
        self._portfolio.add_lot(txn)
    
    def _process_sell(self, txn: Transaction) -> None:
        """Process a sell transaction."""
        result = self._portfolio.sell_shares(txn)
        
        if result.quantity_sold == 0:
            self._skipped_sells += 1
            return
        
        if result.is_loss:
            loss_sale = LossSale(
                ticker=txn.ticker,
                sale_date=txn.date,
                quantity=result.quantity_sold,
                sale_price=txn.price,
                proceeds=result.proceeds,
                cost_basis=result.cost_basis,
                loss_amount=result.loss_amount,
            )
            self._loss_sales.append(loss_sale)
            
            # Check for wash sale: did we buy this ticker within 30 days BEFORE this sale?
            self._check_prior_buys_for_wash_sale(loss_sale)
    
    def _check_prior_buys_for_wash_sale(self, loss_sale: LossSale) -> None:
        """Check if any prior buys within the wash window trigger a wash sale."""
        for txn in self._all_transactions:
            if (txn.trans_type == "Buy" and 
                txn.ticker == loss_sale.ticker and
                loss_sale.is_in_wash_window(txn.date) and
                txn.date < loss_sale.sale_date):  # Only look at buys BEFORE the sale
                
                # Check if we already recorded this violation
                already_recorded = any(
                    v.loss_sale == loss_sale and v.triggering_buy_date == txn.date
                    for v in self._violations
                )
                
                if not already_recorded:
                    disallowed = min(txn.quantity, loss_sale.quantity) / loss_sale.quantity * loss_sale.loss_amount
                    
                    violation = WashSaleViolation(
                        ticker=loss_sale.ticker,
                        loss_sale=loss_sale,
                        triggering_buy_date=txn.date,
                        triggering_buy_quantity=txn.quantity,
                        disallowed_loss=disallowed,
                    )
                    self._violations.append(violation)
    
    def get_historical_violations(self) -> list[WashSaleViolation]:
        """Get all historical wash sale violations detected."""
        return sorted(self._violations, key=lambda v: v.triggering_buy_date)
    
    def get_all_loss_sales(self) -> list[LossSale]:
        """Get all loss sales."""
        return sorted(self._loss_sales, key=lambda ls: ls.sale_date)
    
    def get_active_windows(self, as_of_date: date) -> list[LossSale]:
        """
        Get loss sales with active wash windows as of a given date.
        
        Args:
            as_of_date: The date to check against
            
        Returns:
            List of LossSale objects with active windows
        """
        active = []
        for loss_sale in self._loss_sales:
            # Window is active if as_of_date is within the wash window
            # AND the safe-to-buy date is still in the future
            if loss_sale.safe_to_buy_date() > as_of_date:
                active.append(loss_sale)
        
        return sorted(active, key=lambda ls: ls.sale_date)
    
    def check_ticker(self, ticker: str, as_of_date: date) -> WashSaleStatus:
        """
        Check if a ticker is safe to buy on a given date.
        
        Args:
            ticker: The stock/ETF ticker to check
            as_of_date: The date of the potential purchase
            
        Returns:
            WashSaleStatus indicating if it's safe to buy
        """
        active_windows = [
            ls for ls in self.get_active_windows(as_of_date)
            if ls.ticker == ticker
        ]
        
        is_safe = len(active_windows) == 0
        
        if is_safe:
            message = f"✓ {ticker} is clear - no wash sale restrictions."
        else:
            safe_date = max(ls.safe_to_buy_date() for ls in active_windows)
            days_until = (safe_date - as_of_date).days
            message = f"⚠️  WASH SALE WARNING: Do not buy {ticker}! Safe after {safe_date} ({days_until} days)"
        
        return WashSaleStatus(
            ticker=ticker,
            is_safe=is_safe,
            active_windows=active_windows,
            check_date=as_of_date,
            message=message,
        )
    
    @property
    def skipped_sells(self) -> int:
        """Number of sell transactions skipped due to missing buy lots."""
        return self._skipped_sells
    
    @property
    def portfolio_warnings(self) -> list[str]:
        """Get warnings from portfolio processing."""
        return self._portfolio.warnings
