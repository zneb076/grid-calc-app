// Technical indicators on candles [{o,h,l,c}] oldest -> newest. Each returns the latest value.

export const emaSeries = (values, period) => {
  const k = 2 / (period + 1);
  const out = [];
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) out.push(NaN);
    else if (i === period - 1) out.push(e);
    else out.push((e = values[i] * k + e * (1 - k)));
  }
  return out;
};

export const ema = (values, period) =>
  values.length >= period ? emaSeries(values, period).at(-1) : NaN;

// Wilder RSI
export const rsi = (closes, period = 14) => {
  if (closes.length <= period) return NaN;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
};

// Wilder ADX with +DI / -DI
export const adx = (candles, period = 14) => {
  if (candles.length < period * 2 + 1) return { adx: NaN, plusDI: NaN, minusDI: NaN };
  const tr = [];
  const pdm = [];
  const mdm = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const up = c.h - p.h;
    const down = p.l - c.l;
    pdm.push(up > down && up > 0 ? up : 0);
    mdm.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  let atr = sum(tr.slice(0, period));
  let sp = sum(pdm.slice(0, period));
  let sm = sum(mdm.slice(0, period));
  const dx = [];
  let plusDI = 0;
  let minusDI = 0;
  for (let i = period; i <= tr.length; i++) {
    if (i > period) {
      atr = atr - atr / period + tr[i - 1];
      sp = sp - sp / period + pdm[i - 1];
      sm = sm - sm / period + mdm[i - 1];
    }
    plusDI = (100 * sp) / atr;
    minusDI = (100 * sm) / atr;
    const s = plusDI + minusDI;
    dx.push(s === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / s);
  }
  let a = sum(dx.slice(0, period)) / period;
  for (let i = period; i < dx.length; i++) a = (a * (period - 1) + dx[i]) / period;
  return { adx: a, plusDI, minusDI };
};

// Bollinger Bands (period, k·stdev)
export const bollinger = (closes, period = 20, k = 2) => {
  if (closes.length < period) return null;
  const s = closes.slice(-period);
  const mid = s.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
  return { mid, upper: mid + k * sd, lower: mid - k * sd, widthPct: ((2 * k * sd) / mid) * 100 };
};
