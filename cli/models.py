"""Data models for the Wash Sale Tracker."""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional


@dataclass
class Transaction:
    """A parsed transaction from Robinhood CSV."""
    date: date
    ticker: str
    trans_type: str  # "Buy" or "Sell"
    quantity: float
    price: float
    amount: float  # Positive for sells, negative for buys
    description: str = ""

    def __str__(self) -> str:
        sign = "+" if self.trans_type == "Sell" else "-"
        return f"{self.date} {self.trans_type} {self.quantity:.4f} {self.ticker} @ ${self.price:.2f} ({sign}${abs(self.amount):.2f})"


@dataclass
class Lot:
    """A buy lot for FIFO tracking."""
    date: date
    ticker: str
    quantity: float
    price: float
    remaining_quantity: float

    @classmethod
    def from_transaction(cls, txn: Transaction) -> "Lot":
        """Create a lot from a buy transaction."""
        return cls(
            date=txn.date,
            ticker=txn.ticker,
            quantity=txn.quantity,
            price=txn.price,
            remaining_quantity=txn.quantity,
        )

    @property
    def cost_per_share(self) -> float:
        return self.price

    def __str__(self) -> str:
        return f"Lot({self.date}, {self.remaining_quantity:.4f}/{self.quantity:.4f} {self.ticker} @ ${self.price:.2f})"


@dataclass
class LossSale:
    """A realized loss sale with wash sale window."""
    ticker: str
    sale_date: date
    quantity: float
    sale_price: float
    proceeds: float
    cost_basis: float
    loss_amount: float  # Positive number representing the loss

    # The wash sale window is 30 days before and 30 days after the sale
    WASH_WINDOW_DAYS = 30

    @property
    def wash_window_start(self) -> date:
        """Start of the wash sale window (30 days before sale)."""
        return self.sale_date - timedelta(days=self.WASH_WINDOW_DAYS)

    @property
    def wash_window_end(self) -> date:
        """End of the wash sale window (30 days after sale)."""
        return self.sale_date + timedelta(days=self.WASH_WINDOW_DAYS)

    def is_in_wash_window(self, check_date: date) -> bool:
        """Check if a date falls within the wash sale window."""
        return self.wash_window_start <= check_date <= self.wash_window_end

    def safe_to_buy_date(self) -> date:
        """The first date it's safe to buy this ticker again."""
        return self.wash_window_end + timedelta(days=1)

    def days_until_safe(self, as_of_date: date) -> int:
        """Number of days until it's safe to buy."""
        safe_date = self.safe_to_buy_date()
        if as_of_date >= safe_date:
            return 0
        return (safe_date - as_of_date).days

    def __str__(self) -> str:
        return f"LossSale({self.ticker}, {self.sale_date}, loss=${self.loss_amount:.2f})"


@dataclass
class WashSaleViolation:
    """A historical wash sale that occurred."""
    ticker: str
    loss_sale: LossSale
    triggering_buy_date: date
    triggering_buy_quantity: float
    disallowed_loss: float

    def __str__(self) -> str:
        return (
            f"WashSale: Bought {self.triggering_buy_quantity:.4f} {self.ticker} on {self.triggering_buy_date}, "
            f"within 30 days of loss sale on {self.loss_sale.sale_date} (disallowed loss: ${self.disallowed_loss:.2f})"
        )


@dataclass
class WashSaleStatus:
    """Result of checking a ticker for wash sale restrictions."""
    ticker: str
    is_safe: bool
    active_windows: list[LossSale]
    check_date: date
    message: str = ""

    @property
    def safe_to_buy_date(self) -> Optional[date]:
        """The earliest date it's safe to buy, or None if already safe."""
        if self.is_safe:
            return None
        # Return the latest safe date among all active windows
        return max(ls.safe_to_buy_date() for ls in self.active_windows)

    @property
    def days_until_safe(self) -> int:
        """Days until safe to buy, or 0 if already safe."""
        if self.is_safe:
            return 0
        safe_date = self.safe_to_buy_date
        if safe_date and self.check_date < safe_date:
            return (safe_date - self.check_date).days
        return 0
