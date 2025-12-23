"""Portfolio management with FIFO lot tracking."""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from models import Transaction, Lot, LossSale


@dataclass
class SellResult:
    """Result of selling shares using FIFO."""
    ticker: str
    quantity_sold: float
    proceeds: float
    cost_basis: float
    gain_loss: float  # Positive = gain, negative = loss
    is_loss: bool
    matched_lots: list[tuple[Lot, float]]  # (lot, quantity used from lot)
    warnings: list[str] = field(default_factory=list)
    
    @property
    def loss_amount(self) -> float:
        """Return the loss as a positive number, or 0 if it was a gain."""
        return abs(self.gain_loss) if self.is_loss else 0.0


class Portfolio:
    """
    Tracks buy lots and handles FIFO cost basis calculation.
    """
    
    def __init__(self):
        # ticker -> list of Lots (ordered by date, oldest first)
        self._lots: dict[str, list[Lot]] = defaultdict(list)
        self._warnings: list[str] = []
    
    @property
    def warnings(self) -> list[str]:
        """Get all warnings generated during processing."""
        return self._warnings.copy()
    
    def add_lot(self, transaction: Transaction) -> None:
        """
        Add a buy transaction as a new lot.
        
        Args:
            transaction: A Buy transaction
        """
        if transaction.trans_type != "Buy":
            raise ValueError(f"Expected Buy transaction, got {transaction.trans_type}")
        
        lot = Lot.from_transaction(transaction)
        self._lots[transaction.ticker].append(lot)
        
        # Keep lots sorted by date (oldest first)
        self._lots[transaction.ticker].sort(key=lambda l: l.date)
    
    def sell_shares(self, transaction: Transaction) -> SellResult:
        """
        Sell shares using FIFO method.
        
        Args:
            transaction: A Sell transaction
            
        Returns:
            SellResult with cost basis and gain/loss information
        """
        if transaction.trans_type != "Sell":
            raise ValueError(f"Expected Sell transaction, got {transaction.trans_type}")
        
        ticker = transaction.ticker
        quantity_to_sell = transaction.quantity
        proceeds = transaction.amount  # Positive for sells
        
        warnings = []
        matched_lots = []
        total_cost_basis = 0.0
        quantity_sold = 0.0
        
        lots = self._lots.get(ticker, [])
        
        if not lots:
            warning = f"No buy lots found for {ticker} - skipping sell on {transaction.date}"
            warnings.append(warning)
            self._warnings.append(warning)
            return SellResult(
                ticker=ticker,
                quantity_sold=0,
                proceeds=proceeds,
                cost_basis=0,
                gain_loss=0,
                is_loss=False,
                matched_lots=[],
                warnings=warnings,
            )
        
        remaining_to_sell = quantity_to_sell
        
        for lot in lots:
            if remaining_to_sell <= 0:
                break
            
            if lot.remaining_quantity <= 0:
                continue
            
            # Determine how much to take from this lot
            take_quantity = min(lot.remaining_quantity, remaining_to_sell)
            lot_cost = take_quantity * lot.cost_per_share
            
            # Update lot
            lot.remaining_quantity -= take_quantity
            
            # Track what we matched
            matched_lots.append((lot, take_quantity))
            total_cost_basis += lot_cost
            quantity_sold += take_quantity
            remaining_to_sell -= take_quantity
        
        # Check if we couldn't match all shares
        if remaining_to_sell > 0.0001:  # Small tolerance for float precision
            warning = (
                f"Could only match {quantity_sold:.4f} of {quantity_to_sell:.4f} shares "
                f"for {ticker} sell on {transaction.date} - missing {remaining_to_sell:.4f} shares"
            )
            warnings.append(warning)
            self._warnings.append(warning)
        
        # Calculate gain/loss
        # Adjust proceeds proportionally if we couldn't match all shares
        if quantity_sold < quantity_to_sell and quantity_to_sell > 0:
            adjusted_proceeds = proceeds * (quantity_sold / quantity_to_sell)
        else:
            adjusted_proceeds = proceeds
        
        gain_loss = adjusted_proceeds - total_cost_basis
        is_loss = gain_loss < 0
        
        # Clean up empty lots
        self._lots[ticker] = [l for l in lots if l.remaining_quantity > 0.0001]
        
        return SellResult(
            ticker=ticker,
            quantity_sold=quantity_sold,
            proceeds=adjusted_proceeds,
            cost_basis=total_cost_basis,
            gain_loss=gain_loss,
            is_loss=is_loss,
            matched_lots=matched_lots,
            warnings=warnings,
        )
    
    def get_lots(self, ticker: str) -> list[Lot]:
        """Get remaining lots for a ticker."""
        return [l for l in self._lots.get(ticker, []) if l.remaining_quantity > 0.0001]
    
    def get_all_tickers(self) -> set[str]:
        """Get all tickers with remaining lots."""
        return {ticker for ticker, lots in self._lots.items() 
                if any(l.remaining_quantity > 0.0001 for l in lots)}
    
    def get_position(self, ticker: str) -> float:
        """Get total remaining shares for a ticker."""
        return sum(l.remaining_quantity for l in self.get_lots(ticker))
    
    def get_cost_basis(self, ticker: str) -> float:
        """Get total cost basis for remaining shares of a ticker."""
        return sum(l.remaining_quantity * l.cost_per_share for l in self.get_lots(ticker))
