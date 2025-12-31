import React, { useState, useCallback, useMemo } from 'react';
import { Upload, Search, AlertTriangle, CheckCircle, Calendar, DollarSign, TrendingDown, Clock, FileText, X, ChevronRight, Shield, AlertCircle } from 'lucide-react';

// ============================================================================
// WASH SALE TRACKER - Production Web UI
// A refined financial dashboard with dark theme and sharp accents
// ============================================================================

// ----------------------------------------------------------------------------
// Core Logic (ported from Python)
// ----------------------------------------------------------------------------

function parseDate(dateStr) {
  if (!dateStr) return null;
  const [month, day, year] = dateStr.trim().split('/');
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
}

function parseAmount(amountStr) {
  if (!amountStr || !amountStr.trim()) return 0;
  let str = amountStr.trim();
  const isNegative = str.startsWith('(') && str.endsWith(')');
  const cleaned = str.replace(/[()$,]/g, '');
  const value = parseFloat(cleaned) || 0;
  return isNegative ? -value : value;
}

function parsePrice(priceStr) {
  if (!priceStr || !priceStr.trim()) return 0;
  return parseFloat(priceStr.trim().replace(/[$,]/g, '')) || 0;
}

function parseQuantity(qtyStr) {
  if (!qtyStr || !qtyStr.trim()) return 0;
  return parseFloat(qtyStr.trim()) || 0;
}

function parseCSV(text) {
  const lines = text.split('\n');
  if (lines.length < 2) return [];
  
  // Parse header
  const headerLine = lines[0];
  const headers = [];
  let current = '';
  let inQuotes = false;
  
  for (let char of headerLine) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      headers.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  headers.push(current.trim().replace(/^"|"$/g, ''));
  
  // Parse rows
  const rows = [];
  let i = 1;
  
  while (i < lines.length) {
    let line = lines[i];
    
    // Handle multi-line fields (description with newlines)
    while ((line.match(/"/g) || []).length % 2 !== 0 && i + 1 < lines.length) {
      i++;
      line += '\n' + lines[i];
    }
    
    if (!line.trim()) {
      i++;
      continue;
    }
    
    const values = [];
    current = '';
    inQuotes = false;
    
    for (let char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim().replace(/^"|"$/g, ''));
    
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
    i++;
  }
  
  return rows;
}

function processTransactions(csvText, asOfDate) {
  const rows = parseCSV(csvText);
  const transactions = [];
  
  for (const row of rows) {
    const transCode = row['Trans Code']?.trim();
    if (transCode !== 'Buy' && transCode !== 'Sell') continue;
    
    const date = parseDate(row['Activity Date']);
    if (!date) continue;
    
    const ticker = row['Instrument']?.trim();
    if (!ticker) continue;
    
    const quantity = parseQuantity(row['Quantity']);
    if (quantity <= 0) continue;
    
    transactions.push({
      date,
      ticker,
      transType: transCode,
      quantity,
      price: parsePrice(row['Price']),
      amount: parseAmount(row['Amount']),
    });
  }
  
  // Sort by date, then Buys before Sells on same day (matches CLI FIFO behavior)
  transactions.sort((a, b) => {
    const dateDiff = a.date - b.date;
    if (dateDiff !== 0) return dateDiff;
    // On same day: Buys (0) before Sells (1)
    const aIsSell = a.transType === 'Sell' ? 1 : 0;
    const bIsSell = b.transType === 'Sell' ? 1 : 0;
    return aIsSell - bIsSell;
  });
  
  // FIFO processing
  const lots = {}; // ticker -> [{date, quantity, price, remaining}]
  const lossSales = [];
  const violations = [];
  const warnings = [];
  
  for (const txn of transactions) {
    if (txn.transType === 'Buy') {
      if (!lots[txn.ticker]) lots[txn.ticker] = [];
      lots[txn.ticker].push({
        date: txn.date,
        quantity: txn.quantity,
        price: txn.price,
        remaining: txn.quantity,
      });
      
      // Check if this buy is within wash window of a prior loss sale
      for (const ls of lossSales) {
        if (ls.ticker === txn.ticker && isInWashWindow(ls.saleDate, txn.date)) {
          const disallowed = Math.min(txn.quantity, ls.quantity) / ls.quantity * ls.lossAmount;
          violations.push({
            ticker: txn.ticker,
            lossSale: ls,
            buyDate: txn.date,
            buyQuantity: txn.quantity,
            disallowedLoss: disallowed,
          });
        }
      }
    } else {
      // Sell - FIFO matching
      const tickerLots = lots[txn.ticker] || [];
      
      if (tickerLots.length === 0) {
        warnings.push(`No buy lots found for ${txn.ticker} sell on ${formatDate(txn.date)}`);
        continue;
      }
      
      let remainingToSell = txn.quantity;
      let totalCostBasis = 0;
      let quantitySold = 0;
      
      for (const lot of tickerLots) {
        if (remainingToSell <= 0) break;
        if (lot.remaining <= 0) continue;
        
        const take = Math.min(lot.remaining, remainingToSell);
        lot.remaining -= take;
        totalCostBasis += take * lot.price;
        quantitySold += take;
        remainingToSell -= take;
      }
      
      if (quantitySold === 0) continue;
      
      const proceeds = txn.amount * (quantitySold / txn.quantity);
      const gainLoss = proceeds - totalCostBasis;
      
      if (gainLoss < 0) {
        const lossSale = {
          ticker: txn.ticker,
          saleDate: txn.date,
          quantity: quantitySold,
          salePrice: txn.price,
          proceeds,
          costBasis: totalCostBasis,
          lossAmount: Math.abs(gainLoss),
        };
        lossSales.push(lossSale);
        
        // Check for wash sale from buys before this sale
        for (const priorTxn of transactions) {
          if (priorTxn.transType === 'Buy' && 
              priorTxn.ticker === txn.ticker &&
              priorTxn.date < txn.date &&
              isInWashWindow(txn.date, priorTxn.date)) {
            const alreadyRecorded = violations.some(v => 
              v.lossSale.saleDate.getTime() === txn.date.getTime() &&
              v.buyDate.getTime() === priorTxn.date.getTime() &&
              v.ticker === txn.ticker
            );
            if (!alreadyRecorded) {
              const disallowed = Math.min(priorTxn.quantity, quantitySold) / quantitySold * Math.abs(gainLoss);
              violations.push({
                ticker: txn.ticker,
                lossSale,
                buyDate: priorTxn.date,
                buyQuantity: priorTxn.quantity,
                disallowedLoss: disallowed,
              });
            }
          }
        }
      }
      
      // Clean up empty lots
      lots[txn.ticker] = tickerLots.filter(l => l.remaining > 0.0001);
    }
  }
  
  // Get active windows
  const activeWindows = lossSales.filter(ls => {
    const safeDate = new Date(ls.saleDate);
    safeDate.setDate(safeDate.getDate() + 31);
    return safeDate > asOfDate;
  });
  
  // Summary stats
  const buys = transactions.filter(t => t.transType === 'Buy');
  const sells = transactions.filter(t => t.transType === 'Sell');
  const tickers = new Set(transactions.map(t => t.ticker));
  
  return {
    transactions,
    summary: {
      total: transactions.length,
      buys: buys.length,
      sells: sells.length,
      tickerCount: tickers.size,
      dateRange: transactions.length > 0 ? {
        start: transactions[0].date,
        end: transactions[transactions.length - 1].date,
      } : null,
    },
    lossSales,
    violations,
    activeWindows,
    warnings,
  };
}

function isInWashWindow(saleDate, checkDate) {
  const windowStart = new Date(saleDate);
  windowStart.setDate(windowStart.getDate() - 30);
  const windowEnd = new Date(saleDate);
  windowEnd.setDate(windowEnd.getDate() + 30);
  return checkDate >= windowStart && checkDate <= windowEnd;
}

function getSafeDate(saleDate) {
  const safe = new Date(saleDate);
  safe.setDate(safe.getDate() + 31);
  return safe;
}

function formatDate(date) {
  if (!date) return '-';
  return date.toISOString().split('T')[0];
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

function daysUntil(targetDate, fromDate) {
  const diff = targetDate - fromDate;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ----------------------------------------------------------------------------
// UI Components
// ----------------------------------------------------------------------------

const StatusBadge = ({ type, children }) => {
  const styles = {
    warning: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    danger: 'bg-red-500/20 text-red-400 border-red-500/30',
    success: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    info: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  };
  
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${styles[type]}`}>
      {children}
    </span>
  );
};

const StatCard = ({ icon: Icon, label, value, subtext, accent }) => {
  const accentColors = {
    amber: 'from-amber-500/20 to-transparent border-amber-500/20 text-amber-400',
    red: 'from-red-500/20 to-transparent border-red-500/20 text-red-400',
    emerald: 'from-emerald-500/20 to-transparent border-emerald-500/20 text-emerald-400',
    sky: 'from-sky-500/20 to-transparent border-sky-500/20 text-sky-400',
  };
  
  return (
    <div className={`relative overflow-hidden rounded-xl border bg-gradient-to-br ${accentColors[accent]} p-5`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400 font-medium">{label}</p>
          <p className="text-2xl font-bold text-white mt-1 tracking-tight">{value}</p>
          {subtext && <p className="text-xs text-slate-500 mt-1">{subtext}</p>}
        </div>
        <div className={`p-2.5 rounded-lg bg-slate-800/50`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
};

const FileUploader = ({ onFileLoad }) => {
  const [isDragging, setIsDragging] = useState(false);
  
  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragging(true);
    } else if (e.type === 'dragleave') {
      setIsDragging(false);
    }
  }, []);
  
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const file = e.dataTransfer?.files?.[0];
    if (file && file.name.endsWith('.csv')) {
      const reader = new FileReader();
      reader.onload = (e) => onFileLoad(e.target.result, file.name);
      reader.readAsText(file);
    }
  }, [onFileLoad]);
  
  const handleFileInput = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => onFileLoad(e.target.result, file.name);
      reader.readAsText(file);
    }
  }, [onFileLoad]);
  
  return (
    <div
      className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 ${
        isDragging 
          ? 'border-sky-500 bg-sky-500/10' 
          : 'border-slate-700 hover:border-slate-600 bg-slate-900/50'
      }`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept=".csv"
        onChange={handleFileInput}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
      <div className="flex flex-col items-center">
        <div className={`p-4 rounded-2xl mb-4 transition-colors ${isDragging ? 'bg-sky-500/20' : 'bg-slate-800'}`}>
          <Upload className={`w-8 h-8 ${isDragging ? 'text-sky-400' : 'text-slate-400'}`} />
        </div>
        <p className="text-lg font-semibold text-white mb-1">
          Drop your Robinhood CSV here
        </p>
        <p className="text-sm text-slate-500">
          or click to browse files
        </p>
      </div>
    </div>
  );
};

const TickerChecker = ({ data, asOfDate }) => {
  const [ticker, setTicker] = useState('');
  const [result, setResult] = useState(null);
  
  const checkTicker = useCallback(() => {
    if (!ticker.trim() || !data) return;
    
    const upperTicker = ticker.trim().toUpperCase();
    const matchingWindows = data.activeWindows.filter(w => w.ticker === upperTicker);
    
    if (matchingWindows.length === 0) {
      setResult({ safe: true, ticker: upperTicker });
    } else {
      const latestSafe = matchingWindows.reduce((latest, w) => {
        const safe = getSafeDate(w.saleDate);
        return safe > latest ? safe : latest;
      }, new Date(0));
      
      setResult({
        safe: false,
        ticker: upperTicker,
        windows: matchingWindows,
        safeDate: latestSafe,
        daysUntilSafe: daysUntil(latestSafe, asOfDate),
      });
    }
  }, [ticker, data, asOfDate]);
  
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') checkTicker();
  };
  
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            onKeyPress={handleKeyPress}
            placeholder="Enter ticker symbol (e.g., AAPL)"
            className="w-full pl-12 pr-4 py-3.5 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 transition-colors font-mono text-lg"
          />
        </div>
        <button
          onClick={checkTicker}
          disabled={!ticker.trim()}
          className="px-6 py-3.5 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-xl transition-colors flex items-center gap-2"
        >
          Check
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
      
      {result && (
        <div className={`rounded-xl p-5 border ${
          result.safe 
            ? 'bg-emerald-500/10 border-emerald-500/30' 
            : 'bg-red-500/10 border-red-500/30'
        }`}>
          {result.safe ? (
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/20">
                <CheckCircle className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-emerald-400">
                  {result.ticker} is safe to buy
                </p>
                <p className="text-sm text-slate-400">No active wash sale restrictions</p>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-red-500/20">
                  <AlertTriangle className="w-6 h-6 text-red-400" />
                </div>
                <div>
                  <p className="text-lg font-semibold text-red-400">
                    Wash Sale Warning: {result.ticker}
                  </p>
                  <p className="text-sm text-slate-400">
                    Safe to buy after {formatDate(result.safeDate)} ({result.daysUntilSafe} days)
                  </p>
                </div>
              </div>
              
              <div className="space-y-3 mt-4">
                {result.windows.map((w, i) => (
                  <div key={i} className="bg-slate-900/50 rounded-lg p-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-slate-500">Sale Date</p>
                        <p className="text-white font-mono">{formatDate(w.saleDate)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Quantity</p>
                        <p className="text-white font-mono">{w.quantity.toFixed(4)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Proceeds</p>
                        <p className="text-white font-mono">{formatCurrency(w.proceeds)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Loss Amount</p>
                        <p className="text-red-400 font-mono">{formatCurrency(w.lossAmount)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ActiveWindowsTable = ({ windows, asOfDate }) => {
  if (windows.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex p-4 rounded-2xl bg-emerald-500/10 mb-4">
          <Shield className="w-8 h-8 text-emerald-400" />
        </div>
        <p className="text-lg font-semibold text-white">No Active Restrictions</p>
        <p className="text-sm text-slate-500 mt-1">All tickers are safe to trade</p>
      </div>
    );
  }
  
  // Group by ticker
  const grouped = {};
  windows.forEach(w => {
    if (!grouped[w.ticker]) {
      grouped[w.ticker] = { losses: [], total: 0, safeDate: null };
    }
    grouped[w.ticker].losses.push(w);
    grouped[w.ticker].total += w.lossAmount;
    const safe = getSafeDate(w.saleDate);
    if (!grouped[w.ticker].safeDate || safe > grouped[w.ticker].safeDate) {
      grouped[w.ticker].safeDate = safe;
    }
  });
  
  // Sort by total loss (highest first)
  const sortedTickers = Object.entries(grouped)
    .sort((a, b) => b[1].total - a[1].total);
  
  const grandTotal = sortedTickers.reduce((sum, [, data]) => sum + data.total, 0);
  
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-800/50">
              <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Ticker</th>
              <th className="px-5 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Loss</th>
              <th className="px-5 py-4 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Safe After</th>
              <th className="px-5 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Days Left</th>
              <th className="px-5 py-4 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider"># Sales</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {sortedTickers.map(([ticker, data]) => {
              const days = daysUntil(data.safeDate, asOfDate);
              return (
                <tr key={ticker} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-5 py-4">
                    <span className="font-mono font-semibold text-white">{ticker}</span>
                  </td>
                  <td className="px-5 py-4 text-right text-red-400 font-mono text-sm">{formatCurrency(data.total)}</td>
                  <td className="px-5 py-4 text-slate-300 font-mono text-sm">{formatDate(data.safeDate)}</td>
                  <td className="px-5 py-4 text-right">
                    <StatusBadge type={days <= 7 ? 'warning' : 'danger'}>
                      {days} days
                    </StatusBadge>
                  </td>
                  <td className="px-5 py-4 text-right text-slate-400 font-mono text-sm">{data.losses.length}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-800/30 border-t border-slate-700">
              <td className="px-5 py-4 font-semibold text-white">TOTAL</td>
              <td className="px-5 py-4 text-right text-red-400 font-mono font-semibold">{formatCurrency(grandTotal)}</td>
              <td colSpan="3"></td>
            </tr>
          </tfoot>
        </table>
      </div>
      
      <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-200">
            Buying any of these tickers before the safe date will trigger a wash sale and disallow the loss deduction!
          </p>
        </div>
      </div>
    </div>
  );
};

const ViolationsHistory = ({ violations }) => {
  if (violations.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex p-4 rounded-2xl bg-emerald-500/10 mb-4">
          <CheckCircle className="w-8 h-8 text-emerald-400" />
        </div>
        <p className="text-lg font-semibold text-white">No Wash Sales Detected</p>
        <p className="text-sm text-slate-500 mt-1">Your transaction history is clean</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      {violations.map((v, i) => (
        <div key={i} className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-amber-500/20 shrink-0">
              <AlertCircle className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <span className="font-mono font-bold text-white text-lg">{v.ticker}</span>
                <StatusBadge type="warning">Wash Sale</StatusBadge>
              </div>
              <p className="text-sm text-slate-400 mb-3">
                Bought <span className="text-white font-mono">{v.buyQuantity.toFixed(4)}</span> shares on{' '}
                <span className="text-white font-mono">{formatDate(v.buyDate)}</span>, within 30 days of loss sale on{' '}
                <span className="text-white font-mono">{formatDate(v.lossSale.saleDate)}</span>
              </p>
              <div className="flex gap-6 text-sm">
                <div>
                  <p className="text-slate-500">Original Loss</p>
                  <p className="text-red-400 font-mono">{formatCurrency(v.lossSale.lossAmount)}</p>
                </div>
                <div>
                  <p className="text-slate-500">Disallowed</p>
                  <p className="text-amber-400 font-mono">{formatCurrency(v.disallowedLoss)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// ----------------------------------------------------------------------------
// Main App
// ----------------------------------------------------------------------------

export default function WashSaleTracker() {
  const [data, setData] = useState(null);
  const [fileName, setFileName] = useState('');
  const [asOfDate, setAsOfDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState('check');
  
  const handleFileLoad = useCallback((content, name) => {
    const result = processTransactions(content, asOfDate);
    setData(result);
    setFileName(name);
  }, [asOfDate]);
  
  const handleDateChange = useCallback((e) => {
    const newDate = new Date(e.target.value + 'T00:00:00');
    setAsOfDate(newDate);
    if (data) {
      // Reprocess with new date to update active windows
      // For now we just update the date, windows are calculated on display
    }
  }, [data]);
  
  const handleReset = useCallback(() => {
    setData(null);
    setFileName('');
  }, []);
  
  // Recalculate active windows when date changes
  const activeWindows = useMemo(() => {
    if (!data) return [];
    return data.lossSales.filter(ls => {
      const safeDate = getSafeDate(ls.saleDate);
      return safeDate > asOfDate;
    });
  }, [data, asOfDate]);
  
  const tabs = [
    { id: 'check', label: 'Check Ticker', icon: Search },
    { id: 'windows', label: 'Active Windows', icon: Clock },
    { id: 'history', label: 'Violations', icon: AlertTriangle },
  ];
  
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Background gradient */}
      <div className="fixed inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pointer-events-none" />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-sky-900/20 via-transparent to-transparent pointer-events-none" />
      
      <div className="relative max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="text-center mb-12">
          <div className="inline-flex items-center gap-3 px-4 py-2 bg-slate-800/50 rounded-full border border-slate-700 mb-6">
            <Shield className="w-4 h-4 text-sky-400" />
            <span className="text-sm text-slate-300">IRS Wash Sale Rule Tracker</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            <span className="bg-gradient-to-r from-white via-white to-slate-400 bg-clip-text text-transparent">
              Wash Sale Tracker
            </span>
          </h1>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto">
            Analyze your Robinhood transactions to detect wash sales and prevent future violations
          </p>
        </header>
        
        {/* Date Override */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex items-center gap-3 px-4 py-2 bg-slate-900/50 rounded-xl border border-slate-800">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-400">As of:</span>
            <input
              type="date"
              value={asOfDate.toISOString().split('T')[0]}
              onChange={handleDateChange}
              className="bg-transparent border-none text-white font-mono text-sm focus:outline-none cursor-pointer"
            />
          </div>
        </div>
        
        {!data ? (
          /* Upload State */
          <FileUploader onFileLoad={handleFileLoad} />
        ) : (
          /* Dashboard State */
          <div className="space-y-8">
            {/* File Info Bar */}
            <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-slate-800">
                  <FileText className="w-5 h-5 text-sky-400" />
                </div>
                <div>
                  <p className="font-medium text-white">{fileName}</p>
                  <p className="text-sm text-slate-500">
                    {data.summary.total} transactions • {data.summary.tickerCount} tickers
                  </p>
                </div>
              </div>
              <button
                onClick={handleReset}
                className="p-2 hover:bg-slate-800 rounded-lg transition-colors group"
              >
                <X className="w-5 h-5 text-slate-500 group-hover:text-white" />
              </button>
            </div>
            
            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                icon={TrendingDown}
                label="Loss Sales"
                value={data.lossSales.length}
                subtext="Total realized losses"
                accent="red"
              />
              <StatCard
                icon={AlertTriangle}
                label="Active Windows"
                value={activeWindows.length}
                subtext="Current restrictions"
                accent="amber"
              />
              <StatCard
                icon={AlertCircle}
                label="Violations"
                value={data.violations.length}
                subtext="Historical wash sales"
                accent="amber"
              />
              <StatCard
                icon={DollarSign}
                label="Total Disallowed"
                value={formatCurrency(data.violations.reduce((sum, v) => sum + v.disallowedLoss, 0))}
                subtext="Non-deductible losses"
                accent="red"
              />
            </div>
            
            {/* Warnings */}
            {data.warnings.length > 0 && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                <div className="flex items-center gap-2 text-amber-400 mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="font-semibold">Warnings</span>
                </div>
                <ul className="text-sm text-slate-300 space-y-1">
                  {data.warnings.slice(0, 5).map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                  {data.warnings.length > 5 && (
                    <li className="text-slate-500">...and {data.warnings.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
            
            {/* Tabs */}
            <div className="border-b border-slate-800">
              <nav className="flex gap-1">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === tab.id
                        ? 'border-sky-500 text-sky-400'
                        : 'border-transparent text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                    {tab.id === 'windows' && activeWindows.length > 0 && (
                      <span className="ml-1 px-2 py-0.5 text-xs bg-amber-500/20 text-amber-400 rounded-full">
                        {activeWindows.length}
                      </span>
                    )}
                    {tab.id === 'history' && data.violations.length > 0 && (
                      <span className="ml-1 px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded-full">
                        {data.violations.length}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
            </div>
            
            {/* Tab Content */}
            <div className="min-h-[400px]">
              {activeTab === 'check' && (
                <div>
                  <h2 className="text-xl font-semibold text-white mb-4">Check Before You Buy</h2>
                  <p className="text-slate-400 mb-6">
                    Enter a ticker symbol to check if it's safe to purchase without triggering a wash sale.
                  </p>
                  <TickerChecker data={{ ...data, activeWindows }} asOfDate={asOfDate} />
                </div>
              )}
              
              {activeTab === 'windows' && (
                <div>
                  <h2 className="text-xl font-semibold text-white mb-4">Active Wash Sale Windows</h2>
                  <p className="text-slate-400 mb-6">
                    Securities you sold at a loss that are still within the 30-day restriction period.
                  </p>
                  <ActiveWindowsTable windows={activeWindows} asOfDate={asOfDate} />
                </div>
              )}
              
              {activeTab === 'history' && (
                <div>
                  <h2 className="text-xl font-semibold text-white mb-4">Historical Wash Sale Violations</h2>
                  <p className="text-slate-400 mb-6">
                    Past wash sales detected in your transaction history. These losses cannot be deducted.
                  </p>
                  <ViolationsHistory violations={data.violations} />
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-slate-800 text-center">
          <p className="text-sm text-slate-600">
            For informational purposes only. Not tax advice. Consult a tax professional.
          </p>
        </footer>
      </div>
    </div>
  );
}
