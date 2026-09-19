// Pure grid math, matched against Binance Spot Grid "Details" screen.

export const floorStep = (value, step) => {
  if (!(step > 0)) return value;
  const decimals = Math.max(0, Math.round(-Math.log10(step)));
  const n = Math.floor(value / step + 1e-9) * step;
  return Number(n.toFixed(decimals));
};

export const roundStep = (value, step) => {
  if (!(step > 0)) return value;
  const decimals = Math.max(0, Math.round(-Math.log10(step)));
  return Number((Math.round(value / step) * step).toFixed(decimals));
};

export const MAX_GRIDS = 1000;

// N grids => N+1 price levels.
export const buildLevels = (lower, upper, grids, mode, tickSize = 0) => {
  const levels = [];
  // จำกัดจำนวนกริด กันหน้าเว็บค้างเมื่อกรอกค่าผิด
  if (!(upper > lower) || !(lower > 0) || !(grids >= 1) || grids > MAX_GRIDS) return levels;
  const n = Math.floor(grids);
  if (mode === "Geometric") {
    const r = Math.pow(upper / lower, 1 / n);
    for (let i = 0; i <= n; i++) levels.push(lower * Math.pow(r, i));
  } else {
    const gap = (upper - lower) / n;
    for (let i = 0; i <= n; i++) levels.push(lower + gap * i);
  }
  return tickSize > 0 ? levels.map((p) => roundStep(p, tickSize)) : levels;
};

// Binance leaves the level closest to the start price empty.
export const nearestLevelIndex = (levels, price) => {
  let best = 0;
  for (let i = 1; i < levels.length; i++) {
    if (Math.abs(levels[i] - price) < Math.abs(levels[best] - price)) best = i;
  }
  return best;
};

// Binance: Qty/Order ≈ investment / Σ(all N+1 level prices), rounded to lot step.
// Verified: 600 USDT, 63k–75k, 25 grids -> 0.00033 ; 1000 USDT, 72k–89k, 25 grids -> 0.00048
export const qtyPerOrder = (investment, levels, stepSize = 0) => {
  const sum = levels.reduce((a, p) => a + p, 0);
  if (!(sum > 0) || !(investment > 0)) return 0;
  return roundStep(investment / sum, stepSize);
};

// Binance "Profit/Grid" range (after fees on both sides).
export const profitPerGridRange = (levels, fee, mode) => {
  const n = levels.length - 1;
  if (n < 1) return { min: 0, max: 0 };
  if (mode === "Geometric") {
    const r = levels[1] / levels[0];
    const pct = (r - 1 - 2 * fee) * 100;
    return { min: pct, max: pct };
  }
  const gap = levels[1] - levels[0];
  return {
    min: (gap / levels[n] - 2 * fee) * 100,
    max: (gap / levels[0] - 2 * fee) * 100,
  };
};

export const computePlan = ({
  lower,
  upper,
  grids,
  mode,
  investment,
  fee,
  startPrice,
  stepSize = 0.00001,
  tickSize = 0.01,
  minNotional = 5,
}) => {
  const levels = buildLevels(lower, upper, grids, mode, tickSize);
  if (levels.length < 2) return null;
  const n = levels.length - 1;
  const qty = qtyPerOrder(investment, levels, stepSize);
  const profit = profitPerGridRange(levels, fee, mode);
  const inRange = startPrice >= lower && startPrice <= upper;
  const empty = inRange
    ? nearestLevelIndex(levels, startPrice)
    : startPrice > upper
    ? n
    : 0;
  const buyLevels = levels.slice(0, empty);
  const sellLevels = levels.slice(empty + 1);
  const initialBuyQty = qty * sellLevels.length;
  const initialBuyUSDT = initialBuyQty * startPrice;
  const buyOrdersUSDT = buyLevels.reduce((a, p) => a + p * qty, 0);
  const gapLow = levels[1] - levels[0];
  const gapHigh = levels[n] - levels[n - 1];
  const avgPrice = levels.reduce((a, p) => a + p, 0) / levels.length;
  const netPerTradeUSDT = qty * ((gapLow + gapHigh) / 2) - 2 * fee * qty * avgPrice;
  const feeShare = (2 * fee * avgPrice) / ((gapLow + gapHigh) / 2);
  return {
    levels,
    n,
    qty,
    profit,
    inRange,
    emptyIndex: empty,
    buyCount: buyLevels.length,
    sellCount: sellLevels.length,
    initialBuyQty,
    initialBuyUSDT,
    buyOrdersUSDT,
    usedUSDT: initialBuyUSDT + buyOrdersUSDT,
    gapLow,
    gapHigh,
    avgPrice,
    netPerTradeUSDT,
    feeShare,
    minOrderNotional: qty * levels[0],
    minNotionalOk: qty * levels[0] >= minNotional,
  };
};

// Brownian-motion estimate: price with daily σ (in price units) crosses a grid of
// spacing g about σ²/g² times a day; roughly half of those are profit-taking sells.
// σ_daily ≈ ATR(1D) / 1.6  (expected high-low range of a random walk ≈ 1.6σ)
export const ATR_TO_SIGMA = 1.6;

export const estimateTradesPerDay = (atr, gap) => {
  if (!(atr > 0) || !(gap > 0)) return 0;
  const sigma = atr / ATR_TO_SIGMA;
  return (sigma * sigma) / (2 * gap * gap);
};

// Expected days until a random walk starting at the middle leaves a range of width R.
export const expectedDaysInRange = (atr, rangeWidth, startOffsetFromCenter = 0) => {
  if (!(atr > 0) || !(rangeWidth > 0)) return 0;
  const sigma = atr / ATR_TO_SIGMA;
  const a = rangeWidth / 2 + startOffsetFromCenter;
  const b = rangeWidth / 2 - startOffsetFromCenter;
  if (a <= 0 || b <= 0) return 0;
  return (a * b) / (sigma * sigma);
};
