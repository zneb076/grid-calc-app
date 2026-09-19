import { ema, emaSeries, rsi, adx, bollinger } from "./indicators.js";
import { ATR_TO_SIGMA } from "./grid.js";

// ---------------------------------------------------------------
// วิเคราะห์ภาพรวมตลาดจากแท่งรายวัน
// ---------------------------------------------------------------
export const analyzeMarket = (daily, price, atr) => {
  const closes = daily.map((c) => c.c);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const e50s = emaSeries(closes, 50);
  const e50Slope = ((e50s.at(-1) - e50s.at(-11)) / e50s.at(-11)) * 100; // % ใน 10 วัน
  const r = rsi(closes, 14);
  const a = adx(daily, 14);
  const bb = bollinger(closes, 20, 2);

  const checks = [
    { ok: price > e20, text: "ราคาอยู่เหนือ EMA20" , textNeg: "ราคาอยู่ใต้ EMA20" },
    { ok: e20 > e50, text: "EMA20 อยู่เหนือ EMA50", textNeg: "EMA20 อยู่ใต้ EMA50" },
    { ok: e50 > e200, text: "EMA50 อยู่เหนือ EMA200", textNeg: "EMA50 อยู่ใต้ EMA200" },
    { ok: e50Slope > 0, text: "EMA50 กำลังชันขึ้น", textNeg: "EMA50 กำลังลาดลง" },
  ].filter((c) => Number.isFinite(e200) || !c.text.includes("EMA200"));
  const score = checks.reduce((s, c) => s + (c.ok ? 1 : -1), 0);

  let trend = "sideway";
  if (score >= 2) trend = "up";
  else if (score <= -2) trend = "down";
  const strong = a.adx >= 25;
  const ranging = a.adx < 20;

  // เอียงกรอบตามเทรนด์ (+ = เผื่อด้านบนมากกว่า)
  let skew = 0;
  if (!ranging) {
    if (trend === "up") skew = strong ? 0.4 : 0.25;
    if (trend === "down") skew = strong ? -0.4 : -0.25;
  }
  if (r > 70) skew -= 0.15; // overbought → เสี่ยงย่อ เผื่อด้านล่างเพิ่ม
  if (r < 30) skew += 0.15; // oversold → เสี่ยงเด้ง เผื่อด้านบนเพิ่ม
  skew = Math.max(-0.5, Math.min(0.5, skew));

  let suitability;
  if (ranging) suitability = { level: "good", text: "ตลาดแกว่งออกข้าง (ADX ต่ำ) เหมาะกับบอทกริดมาก" };
  else if (!strong) suitability = { level: "ok", text: "มีเทรนด์อ่อนๆ วางกริดได้ เอียงกรอบไปตามเทรนด์" };
  else if (trend === "down")
    suitability = { level: "caution", text: "ขาลงแรง (ADX สูง) บอทจะรับของระหว่างทาง ควรลดทุน ใช้โซนยาว และตั้ง Stop Loss" };
  else suitability = { level: "caution", text: "เทรนด์แรง (ADX สูง) ราคามักวิ่งหลุดกรอบ ควรใช้โซนกลาง/ยาว และเผื่อกรอบไปทางเทรนด์" };

  const trendLabel = { up: "ขาขึ้น", down: "ขาลง", sideway: "ออกข้าง" }[trend] + (strong && trend !== "sideway" ? " (แรง)" : "");
  const rsiLabel = r > 70 ? "ซื้อมากเกิน (Overbought)" : r < 30 ? "ขายมากเกิน (Oversold)" : r >= 55 ? "ค่อนข้างแข็ง" : r <= 45 ? "ค่อนข้างอ่อน" : "กลางๆ";

  return {
    price,
    atr,
    atrPct: (atr / price) * 100,
    ema20: e20,
    ema50: e50,
    ema200: e200,
    ema50Slope: e50Slope,
    rsi: r,
    rsiLabel,
    adx: a.adx,
    plusDI: a.plusDI,
    minusDI: a.minusDI,
    bb,
    checks,
    score,
    trend,
    trendLabel,
    strong,
    ranging,
    skew,
    suitability,
  };
};

// ---------------------------------------------------------------
// แนะนำ 3 โซน: ซิ่ง (สั้น) / กลาง / ยาว
// ความกว้างครึ่งกรอบ = z·σ·√T (σ ≈ ATR/1.6); z มาก = ทนกว่า (ซิ่งใช้ z ต่ำ ยอมหลุดกรอบง่ายกว่าเพื่อกำไรต่อวันที่สูงกว่า)
// ---------------------------------------------------------------
export const ZONE_DEFS = [
  { key: "short", label: "⚡ ซิ่ง · สั้น", horizon: 7, z: 1.0, net: 0.45, srDays: 7, slAtr: 0.5,
    desc: "กรอบแคบ รีดกำไรถี่ๆ ช่วง ~1 สัปดาห์ ต้องคอยดู ถ้าหลุดกรอบให้ปิดแล้ววางใหม่" },
  { key: "mid", label: "⚖️ กลาง", horizon: 30, z: 1.3, net: 0.6, srDays: 30, slAtr: 1,
    desc: "สมดุลระหว่างกำไรกับความทน วางทิ้งไว้ได้ราว 1 เดือน" },
  { key: "long", label: "🛡️ ยาว · เก็บกิน", horizon: 90, z: 1.5, net: 0.9, srDays: 90, slAtr: 1.5,
    desc: "กรอบกว้าง ทนความผันผวน วางยาวหลายเดือน กำไรต่อวันน้อยแต่แทบไม่ต้องดูแล" },
];

const hiLo = (daily, n) => {
  const s = daily.slice(-n);
  return { high: Math.max(...s.map((c) => c.h)), low: Math.min(...s.map((c) => c.l)) };
};

export const recommendZones = (daily, m, { fee = 0.001, tick = (x) => x } = {}) => {
  const P = m.price;
  const sigma = m.atr / ATR_TO_SIGMA;
  return ZONE_DEFS.map((z) => {
    const hw = z.z * sigma * Math.sqrt(z.horizon);
    let lower = P - hw * (1 - m.skew);
    let upper = P + hw * (1 + m.skew);
    const notes = [];

    // ปรับขอบกรอบให้ครอบแนวรับ/แนวต้านของช่วงเวลาเดียวกัน
    const sr = hiLo(daily, z.srDays);
    if (sr.low < P && sr.low > lower - m.atr && sr.low < lower + 0.5 * m.atr) {
      lower = Math.min(lower, sr.low - 0.3 * m.atr);
      notes.push(`ขยายขอบล่างให้ต่ำกว่าแนวรับ ${z.srDays} วัน`);
    }
    if (sr.high > P && sr.high < upper + m.atr && sr.high > upper - 0.5 * m.atr) {
      upper = Math.max(upper, sr.high + 0.3 * m.atr);
      notes.push(`ขยายขอบบนให้สูงกว่าแนวต้าน ${z.srDays} วัน`);
    }
    lower = Math.max(lower, P * 0.3);
    lower = tick(lower);
    upper = tick(upper);

    const width = upper - lower;
    const mode = width / P > 0.3 ? "Geometric" : "Arithmetic";
    const gapTarget = P * (z.net / 100 + 2 * fee);
    const grids = Math.max(3, Math.min(300, Math.round(width / gapTarget)));

    // ย้อนหลังราคาปิดรายวันอยู่ในกรอบกี่ %
    const past = daily.slice(-z.srDays);
    const inRangePast = (past.filter((c) => c.c >= lower && c.c <= upper).length / past.length) * 100;

    const stopLoss = tick(lower - z.slAtr * m.atr);
    const trailingUp = m.trend === "up" && z.key !== "short";
    if (m.skew > 0.05) notes.push("เผื่อด้านบนมากกว่าตามแนวโน้มขาขึ้น");
    if (m.skew < -0.05) notes.push("เผื่อด้านล่างมากกว่าตามแนวโน้มขาลง/ความเสี่ยงย่อ");
    return { ...z, lower, upper, grids, mode, stopLoss, trailingUp, inRangePast, notes, sr };
  });
};
