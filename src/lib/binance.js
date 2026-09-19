// Public Binance market-data endpoints (CORS enabled, no API key).
const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];

const getJSON = async (path) => {
  let lastErr;
  for (const host of HOSTS) {
    try {
      const res = await fetch(host + path);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
};

export const fetchPrice = async (symbol) =>
  Number((await getJSON(`/api/v3/ticker/price?symbol=${symbol}`)).price);

export const fetchSymbolFilters = async (symbol) => {
  const info = await getJSON(`/api/v3/exchangeInfo?symbol=${symbol}`);
  const s = info.symbols?.[0];
  if (!s) throw new Error("ไม่พบคู่เหรียญ " + symbol);
  const f = Object.fromEntries(s.filters.map((x) => [x.filterType, x]));
  return {
    base: s.baseAsset,
    quote: s.quoteAsset,
    tickSize: Number(f.PRICE_FILTER?.tickSize ?? 0.01),
    stepSize: Number(f.LOT_SIZE?.stepSize ?? 0.00001),
    minNotional: Number(f.NOTIONAL?.minNotional ?? f.MIN_NOTIONAL?.minNotional ?? 5),
  };
};

const INTERVAL_MS = { "1m": 6e4, "5m": 3e5, "15m": 9e5, "1h": 36e5, "4h": 144e5, "1d": 864e5 };

// Returns [{t, o, h, l, c}] oldest -> newest, paging 1000 candles per request.
export const fetchKlines = async (symbol, interval, days) => {
  const step = INTERVAL_MS[interval];
  const end = Date.now();
  let start = end - days * 864e5;
  const out = [];
  while (start < end) {
    const rows = await getJSON(
      `/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${start}&limit=1000`
    );
    if (!rows.length) break;
    for (const r of rows) out.push({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] });
    start = rows[rows.length - 1][0] + step;
    if (rows.length < 1000) break;
  }
  return out;
};

// Wilder ATR on daily candles.
export const computeATR = (candles, period = 14) => {
  if (candles.length < period + 1) return 0;
  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    const { h, l } = candles[i];
    const pc = candles[i - 1].c;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) atr = (atr * (period - 1) + tr[i]) / period;
  return atr;
};

export const fetchMarketSnapshot = async (symbol) => {
  const [price, filters, daily] = await Promise.all([
    fetchPrice(symbol),
    fetchSymbolFilters(symbol),
    fetchKlines(symbol, "1d", 1100),
  ]);
  // Exclude today's unfinished candle from ATR.
  const closed = daily.slice(0, -1);
  const hiLo = (n) => {
    const s = daily.slice(-n);
    return { high: Math.max(...s.map((c) => c.h)), low: Math.min(...s.map((c) => c.l)) };
  };
  return {
    price,
    filters,
    atr14: computeATR(closed, 14),
    range7: hiLo(7),
    range30: hiLo(30),
    range90: hiLo(90),
    change7: (daily.at(-1).c / daily.at(-8).c - 1) * 100,
    change30: (daily.at(-1).c / daily.at(-31).c - 1) * 100,
    daily,
  };
};
