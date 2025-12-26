# 🛡️ Wash Sale Tracker

A production-grade tool to track and prevent IRS wash sale violations from your Robinhood transaction history.


## What is a Wash Sale?

A **wash sale** occurs when you:
1. Sell a security at a loss
2. Buy a "substantially identical" security within **30 days before or after** the sale

The IRS disallows the loss deduction, which can significantly impact your taxes. This tool helps you:

- ✅ **Detect** historical wash sales in your transaction history
- ✅ **Track** active wash sale windows
- ✅ **Prevent** future violations by checking tickers before buying

## Features

### Web UI
- 📁 Drag & drop CSV file upload
- 📊 Dashboard with summary statistics
- 🔍 Ticker checker - verify before you buy
- 📅 Date override for testing
- 📋 Active windows table
- ⚠️ Historical violations list

### CLI Tool
- Fast command-line interface
- Interactive ticker checking
- Same powerful detection engine

## Quick Start

### Web UI (Recommended)

```bash
# Clone the repository
git clone https://github.com/smwaqas89/wash-sale-tracker.git
cd wash-sale-tracker

# Install dependencies
npm install

# Start development server
npm run dev
```

Open http://localhost:5173 in your browser.

### CLI Tool

```bash
# Navigate to CLI directory
cd cli

# Run with your Robinhood CSV
python main.py /path/to/transactions.csv

# Override the date for testing
python main.py /path/to/transactions.csv --date 2025-12-23
```

## Robinhood CSV Export

To export your transaction history from Robinhood:

1. Open Robinhood app or website
2. Go to **Account** → **Statements & History**
3. Select **Account Statements**
4. Download your transaction history as CSV

The expected CSV format:

| Column | Description |
|--------|-------------|
| Activity Date | Transaction date (MM/DD/YYYY) |
| Process Date | Processing date |
| Settle Date | Settlement date |
| Instrument | Ticker symbol |
| Description | Security description |
| Trans Code | Buy, Sell, etc. |
| Quantity | Number of shares |
| Price | Price per share |
| Amount | Total amount |

## How It Works

### FIFO Cost Basis
The tool uses First-In-First-Out (FIFO) method to match sells with buy lots, calculating accurate cost basis and gain/loss for each sale.

### Wash Sale Detection
For each loss sale, the tool:
1. Creates a 61-day wash window (30 days before + sale day + 30 days after)
2. Checks for any buys of the same ticker within that window
3. Flags violations and calculates disallowed losses

### Active Window Tracking
Windows remain "active" until 31 days after the loss sale. The tool warns you when checking any ticker with an active window.

## Project Structure

```
wash-sale-tracker/
├── src/                    # React web application
│   ├── App.jsx            # Main application component
│   ├── main.jsx           # Entry point
│   └── index.css          # Tailwind styles
├── cli/                    # Python CLI tool
│   ├── main.py            # CLI entry point
│   ├── parser.py          # CSV parsing
│   ├── portfolio.py       # FIFO lot tracking
│   ├── wash_sale_engine.py # Detection logic
│   └── models.py          # Data classes
├── public/                 # Static assets
├── sample_transactions.csv # Example data
└── package.json
```

## Tech Stack

### Web UI
- **React 18** - UI framework
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Lucide React** - Icons

### CLI
- **Python 3.10+** - No external dependencies

## Development

### Web UI

```bash
# Install dependencies
npm install

# Start dev server with hot reload
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### CLI

```bash
cd cli

# Run directly
python main.py sample_transactions.csv

# Test with date override
python main.py sample_transactions.csv --date 2025-12-23
```

## Limitations

- Currently only matches **exact ticker symbols**
- ETF equivalents (e.g., SPY/VOO) not yet tracked as substantially identical
- Transfers in (sells without matching buys) are skipped with a warning
- Does not account for short sales

## Roadmap

- [ ] ETF equivalence mapping (SPY ↔ VOO, QQQ ↔ QQQM, etc.)
- [ ] Support for other brokers (Fidelity, Schwab, TD Ameritrade)
- [ ] Export reports as PDF
- [ ] Dark/light theme toggle
- [ ] PWA support for offline use

## Disclaimer

⚠️ **This tool is for informational purposes only.** It is not tax advice. The calculations may not account for all IRS rules and edge cases. Always consult a qualified tax professional for tax-related decisions.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
