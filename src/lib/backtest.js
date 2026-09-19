import { buildLevels, qtyPerOrder, nearestLevelIndex } from "./grid.js";

// Intra-candle path approximation: bullish O→L→H→C, bearish O→H→L→C.
const candlePath = (k) => (k.c >= k.o ? [k.o, k.l, k.h, k.c] : [k.o, k.h, k.l, k.c]);

// Simulates a Binance-style spot grid: one empty level; buys below it, sells above it.
// Each sell fill at level j realises qty*(L[j]-L[j-1]) minus fees on both legs.
export const backtestGrid = (candles, cfg) => {
  const { lower, upper, grids, mode, investment, fee, stepSize = 0, tickSize = 0 } = cfg;
  const levels = buildLevels(lower, upper, grids, mode, tickSize);
  if (levels.length < 2 || candles.length < 2) return null;
  const n = levels.length - 1;
  const qty = qtyPerOrder(investment, levels, stepSize);
  if (!(qty > 0)) return null;

  const p0 = candles[0].o;
  let e = p0 >= upper ? n : p0 <= lower ? 0 : nearestLevelIndex(levels, p0);
  const initBtc = qty * (n - e);
  let usdt = investment - initBtc * p0 * (1 + fee);
  let btc = initBtc;
  let sells = 0;
  let buys = 0;
  let gridProfit = 0;
  let inRangeCandles = 0;

  for (const k of candles) {
    if (k.c >= lower && k.c <= upper) inRangeCandles++;
    for (const p of candlePath(k)) {
      while (e > 0 && p <= levels[e - 1]) {
        const px = levels[e - 1];
        usdt -= qty * px * (1 + fee);
        btc += qty;
        buys++;
        e--;
      }
      while (e < n && p >= levels[e + 1]) {
        const px = levels[e + 1];
        usdt += qty * px * (1 - fee);
        btc -= qty;
        gridProfit += qty * (px - levels[e]) - fee * qty * (px + levels[e]);
        sells++;
        e++;
      }
    }
  }

  const last = candles[candles.length - 1].c;
  const days = (candles[candles.length - 1].t - candles[0].t) / 864e5 || 1;
  const equity = usdt + btc * last;
  const totalPnl = equity - investment;
  const hodlPnl = investment * (last / p0 - 1);
  return {
    grids: n,
    qty,
    days,
    sells,
    buys,
    tradesPerDay: sells / days,
    gridProfit,
    gridProfitPerDay: gridProfit / days,
    gridProfitPerDayPct: (gridProfit / days / investment) * 100,
    gridApr: (gridProfit / days / investment) * 365 * 100,
    totalPnl,
    totalPnlPct: (totalPnl / investment) * 100,
    unrealized: totalPnl - gridProfit,
    hodlPnlPct: (hodlPnl / investment) * 100,
    inRangePct: (inRangeCandles / candles.length) * 100,
    startPrice: p0,
    endPrice: last,
  };
};
