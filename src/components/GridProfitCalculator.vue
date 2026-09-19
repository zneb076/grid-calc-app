<script setup>
import { ref, reactive, computed, watch, onMounted } from "vue";
import {
  computePlan,
  buildLevels,
  qtyPerOrder,
  profitPerGridRange,
  estimateTradesPerDay,
  expectedDaysInRange,
  roundStep,
} from "../lib/grid.js";
import { fetchMarketSnapshot, fetchKlines } from "../lib/binance.js";
import { backtestGrid } from "../lib/backtest.js";

// ---------------------------------
// 1. สถานะ (แยกตามคู่เหรียญ) + Local Storage
// ---------------------------------
const APP_VERSION = __APP_VERSION__;
const BUILD_DATE = __BUILD_DATE__;
const SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const DEFAULTS = {
  BTCUSDT: { priceLower: 72000, priceUpper: 89000, gridCount: 25, capital: 1000, currentPrice: 81000, atrValue: 2300 },
  ETHUSDT: { priceLower: 2300, priceUpper: 3000, gridCount: 25, capital: 500, currentPrice: 2600, atrValue: 100 },
};
const COMMON_DEFAULTS = {
  gridType: "Arithmetic",
  feeRate: 0.001,
  efficiency: 1.0,
  factorAggressive: 0.25,
  factorBalanced: 0.5,
  factorConservative: 1.0,
  dailyGoalPct: 0.1,
  goalPctUnit: "year",
  dailyGoalUSD: 1,
};

const readJSON = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
};

const symbol = ref(localStorage.getItem("symbol") || "BTCUSDT");
const common = reactive(readJSON("grid:common", COMMON_DEFAULTS));
const s = reactive(readJSON("grid:" + symbol.value, DEFAULTS[symbol.value] || DEFAULTS.BTCUSDT));

watch(common, () => localStorage.setItem("grid:common", JSON.stringify(common)), { deep: true });
watch(s, () => localStorage.setItem("grid:" + symbol.value, JSON.stringify(s)), { deep: true });

const switchSymbol = (sym) => {
  if (sym === symbol.value) return;
  localStorage.setItem("grid:" + symbol.value, JSON.stringify(s));
  symbol.value = sym;
  localStorage.setItem("symbol", sym);
  Object.assign(s, readJSON("grid:" + sym, DEFAULTS[sym] || DEFAULTS.BTCUSDT));
  market.value = null;
  candles.value = [];
  refreshMarket();
};

// ---------------------------------
// 2. ข้อมูลตลาดจาก Binance
// ---------------------------------
const market = ref(null);
const marketLoading = ref(false);
const marketError = ref("");
const filters = computed(
  () => market.value?.filters || { base: symbol.value.replace("USDT", ""), stepSize: 0.00001, tickSize: 0.01, minNotional: 5 }
);
const base = computed(() => filters.value.base);
const priceDecimals = computed(() => Math.max(0, Math.round(-Math.log10(filters.value.tickSize))));
const qtyDecimals = computed(() => Math.max(0, Math.round(-Math.log10(filters.value.stepSize))));

const refreshMarket = async () => {
  marketLoading.value = true;
  marketError.value = "";
  try {
    const snap = await fetchMarketSnapshot(symbol.value);
    market.value = snap;
    s.currentPrice = snap.price;
    s.atrValue = Number(snap.atr14.toFixed(2));
  } catch (e) {
    marketError.value = "ดึงข้อมูล Binance ไม่สำเร็จ: " + e.message;
  } finally {
    marketLoading.value = false;
  }
};
onMounted(refreshMarket);

const tick = (p) => roundStep(p, filters.value.tickSize);
const setRange = (lower, upper) => {
  s.priceLower = tick(lower);
  s.priceUpper = tick(upper);
};
const setRangeAtr = (k) => setRange(s.currentPrice - k * s.atrValue, s.currentPrice + k * s.atrValue);

// ---------------------------------
// 3. แผนที่จะวางใน Binance (สูตรตรงกับหน้า Details ของ Binance)
// ---------------------------------
const plan = computed(() =>
  computePlan({
    lower: s.priceLower,
    upper: s.priceUpper,
    grids: s.gridCount,
    mode: common.gridType,
    investment: s.capital,
    fee: common.feeRate,
    startPrice: s.currentPrice,
    stepSize: filters.value.stepSize,
    tickSize: filters.value.tickSize,
    minNotional: filters.value.minNotional,
  })
);

// ระยะห่างกริด ณ ราคาปัจจุบัน (Geometric ห่างไม่เท่ากัน)
const gapAtPrice = (levels, price) => {
  if (!levels || levels.length < 2) return 0;
  for (let i = 1; i < levels.length; i++) if (levels[i] >= price) return levels[i] - levels[i - 1];
  return levels[levels.length - 1] - levels[levels.length - 2];
};

// ประมาณการจากโมเดล: ไม้/วัน = (σ/gap)²/2 × efficiency, σ ≈ ATR/1.6
const estimate = (levels, qty, price) => {
  const g = gapAtPrice(levels, price);
  if (!(g > 0) || !(qty > 0)) return { gap: 0, trades: 0, perTrade: 0, perDay: 0, perDayPct: 0 };
  const trades = estimateTradesPerDay(s.atrValue, g) * common.efficiency;
  const perTrade = qty * g - 2 * common.feeRate * qty * price;
  const perDay = trades * perTrade;
  return { gap: g, trades, perTrade, perDay, perDayPct: (perDay / s.capital) * 100 };
};

const planEstimate = computed(() => {
  const p = plan.value;
  if (!p) return null;
  const price = Math.min(Math.max(s.currentPrice, s.priceLower), s.priceUpper);
  const est = estimate(p.levels, p.qty, price);
  const width = s.priceUpper - s.priceLower;
  const center = (s.priceUpper + s.priceLower) / 2;
  return {
    ...est,
    daysInRange: p.inRange ? expectedDaysInRange(s.atrValue, width, s.currentPrice - center) : 0,
    widthAtr: s.atrValue > 0 ? width / s.atrValue : 0,
    widthPct: (width / s.currentPrice) * 100,
    lowerDistPct: ((s.currentPrice - s.priceLower) / s.currentPrice) * 100,
    upperDistPct: ((s.priceUpper - s.currentPrice) / s.currentPrice) * 100,
  };
});

// คำเตือน (error/warn) และคำแนะนำ (tip) ตามสถานการณ์
const warnings = computed(() => {
  const p = plan.value;
  const est = planEstimate.value;
  const w = [];
  const add = (level, text) => w.push({ level, text });
  if (!p) return [{ level: "error", text: "กรอกราคาบนให้มากกว่าราคาล่าง และจำนวนกริด ≥ 1" }];

  if (!p.inRange)
    add("error", s.currentPrice > s.priceUpper
      ? "ราคาอยู่เหนือกรอบ บอทจะถือแต่ USDT และไม่เทรดจนกว่าราคาจะลงมาในกรอบ"
      : "ราคาอยู่ใต้กรอบ บอทจะถือเหรียญเต็มและไม่เทรดจนกว่าราคาจะขึ้นมาในกรอบ");
  if (!(p.qty > 0)) add("error", "ทุนน้อยเกินไปสำหรับจำนวนกริดนี้ (Qty/Order ปัดแล้วเป็น 0)");
  else if (!p.minNotionalOk)
    add("error", `มูลค่าต่อออเดอร์ ${p.minOrderNotional.toFixed(2)} USDT ต่ำกว่าขั้นต่ำ ${filters.value.minNotional} USDT ให้ลดจำนวนกริดหรือเพิ่มทุน`);
  if (p.profit.min <= 0) add("error", "Profit/Grid ติดลบหลังหักค่าธรรมเนียม ให้ลดจำนวนกริด");
  else if (p.profit.min < 0.3) add("warn", "Profit/Grid ต่ำกว่า 0.3% ค่าธรรมเนียมจะกินกำไรเกินครึ่ง ควรลดจำนวนกริด");
  else if (p.feeShare > 0.35) add("warn", `ค่าธรรมเนียมกินกำไรขั้นต้นไป ${(p.feeShare * 100).toFixed(0)}% ลองลดจำนวนกริดลงเล็กน้อย`);
  if (p.profit.min > 1.5 && est && est.trades < 0.5)
    add("warn", "Gap กว้างมาก คาดว่าจะได้ไม่ถึง 1 ไม้ใน 2 วัน ทุนส่วนใหญ่จะอยู่เฉยๆ ลองเพิ่มจำนวนกริด");

  if (est && p.inRange) {
    const width = s.priceUpper - s.priceLower;
    if (est.widthAtr > 0 && est.widthAtr < 3)
      add("warn", "กรอบแคบกว่า 3×ATR มีโอกาสหลุดกรอบภายในไม่กี่วัน");
    else if (est.widthAtr > 15)
      add("tip", `กรอบกว้าง ${est.widthAtr.toFixed(0)}×ATR ปลอดภัยแต่ทุนกระจายบางมาก กำไรต่อวันจะต่ำ ถ้าต้องการกำไรมากขึ้นให้ลองกรอบที่แคบลง (ดูข้อ 4)`);
    const pos = (s.currentPrice - s.priceLower) / width;
    if (pos > 0.8)
      add("tip", "ราคาอยู่ใกล้ขอบบน บอทจะถือ USDT เกือบทั้งหมด ถ้าราคาขึ้นต่อจะหลุดกรอบเร็ว (ถ้าคาดว่าขาขึ้น ให้เลื่อนกรอบขึ้นหรือเปิด Trailing Up)");
    else if (pos < 0.2)
      add("tip", "ราคาอยู่ใกล้ขอบล่าง บอทจะซื้อเหรียญเกือบเต็มทุนตั้งแต่เริ่ม ถ้าราคาลงต่อจะขาดทุนเหมือนถือเหรียญ ควรตั้ง Stop Loss ไว้ใต้กรอบ");
  }
  if (common.gridType === "Arithmetic" && p.profit.max > 0 && p.profit.min > 0 && p.profit.max / p.profit.min > 1.6)
    add("tip", "กรอบกว้างมาก กำไรต่อกริดช่วงบนกับช่วงล่างต่างกันมาก ควรใช้ Geometric เพื่อให้ได้ % เท่ากันทุกกริด");

  const m = market.value;
  if (m) {
    if (Math.abs(m.change30) >= 15)
      add("warn", `30 วันที่ผ่านมาราคา${m.change30 > 0 ? "ขึ้น" : "ลง"} ${Math.abs(m.change30).toFixed(1)}% ตลาดเป็นเทรนด์ บอทกริดจะทำได้ดีตอนราคาแกว่งตัวในกรอบ${
        m.change30 > 0 ? " ถ้าจะเปิดตอนนี้ให้เผื่อกรอบบนไว้มากๆ หรือเปิด Trailing Up" : " ถ้าจะเปิดตอนนี้ให้เผื่อกรอบล่างไว้ลึกๆ และตั้ง Stop Loss"}`);
    if (m.range30 && (s.priceUpper < m.range30.low || s.priceLower > m.range30.high))
      add("warn", "กรอบนี้ไม่ทับกับช่วงราคา 30 วันล่าสุดเลย");
  }
  if (common.feeRate >= 0.001)
    add("tip", "ถ้าจ่ายค่าธรรมเนียมด้วย BNB จะเหลือ 0.075% (กรอก 0.00075) ทำให้กำไรต่อกริดเพิ่มขึ้นราว 0.05%");
  return w;
});

// ---------------------------------
// 4. Backtest ด้วยข้อมูลจริงจาก Binance
// ---------------------------------
const btDays = ref(Number(localStorage.getItem("btDays")) || 30);
watch(btDays, (v) => localStorage.setItem("btDays", v));
const candles = ref([]);
const btLoading = ref(false);
const btError = ref("");
const btInterval = computed(() => (btDays.value <= 30 ? "5m" : "15m"));

const runBacktest = async () => {
  btLoading.value = true;
  btError.value = "";
  try {
    candles.value = await fetchKlines(symbol.value, btInterval.value, btDays.value);
  } catch (e) {
    btError.value = "โหลดแท่งเทียนไม่สำเร็จ: " + e.message;
  } finally {
    btLoading.value = false;
  }
};

const btConfig = (grids) => ({
  lower: s.priceLower,
  upper: s.priceUpper,
  grids,
  mode: common.gridType,
  investment: s.capital,
  fee: common.feeRate,
  stepSize: filters.value.stepSize,
  tickSize: filters.value.tickSize,
});

const btCurrent = computed(() =>
  candles.value.length ? backtestGrid(candles.value, btConfig(s.gridCount)) : null
);

const btScan = computed(() => {
  if (!candles.value.length || !(s.priceUpper > s.priceLower)) return [];
  const counts = new Set([5, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40, 50, 60, 80, 100, 150, Math.floor(s.gridCount)]);
  const rows = [];
  for (const n of [...counts].sort((a, b) => a - b)) {
    if (!(n >= 2)) continue;
    const levels = buildLevels(s.priceLower, s.priceUpper, n, common.gridType, filters.value.tickSize);
    const qty = qtyPerOrder(s.capital, levels, filters.value.stepSize);
    if (!(qty > 0) || qty * levels[0] < filters.value.minNotional) continue;
    const r = backtestGrid(candles.value, btConfig(n));
    if (!r) continue;
    const profit = computePlan({ ...btConfig(n), startPrice: s.currentPrice }).profit;
    rows.push({ ...r, profitMin: profit.min, profitMax: profit.max });
  }
  const best = rows.reduce((b, r) => (!b || r.gridProfitPerDay > b.gridProfitPerDay ? r : b), null);
  return rows.map((r) => ({ ...r, isBest: r === best }));
});

// ความแม่นของโมเดล ATR เทียบกับ backtest (ใช้ปรับ efficiency)
const calibration = computed(() => {
  const r = btCurrent.value;
  const p = plan.value;
  if (!r || !p || !(r.tradesPerDay > 0)) return null;
  const mid = (r.startPrice + r.endPrice) / 2;
  const model = estimateTradesPerDay(s.atrValue, gapAtPrice(p.levels, mid));
  return model > 0 ? r.tradesPerDay / model : null;
});

// ---------------------------------
// 5. ATR Grid Recommendations
// ---------------------------------
const typeLabels = {
  Aggressive: "1. เน้นซิ่ง (Aggressive)",
  Balanced: "2. บาลานซ์ (Balanced)",
  Conservative: "3. ปลอดภัย (Conservative)",
};
const factorKey = { Aggressive: "factorAggressive", Balanced: "factorBalanced", Conservative: "factorConservative" };
const updateFactor = (type, value) => {
  const v = Number(value);
  if (!isNaN(v) && v >= 0.01) common[factorKey[type]] = v;
};

const atrRecommendations = computed(() => {
  const range = s.priceUpper - s.priceLower;
  if (!(s.atrValue > 0) || !(range > 0)) return {};
  const results = {};
  for (const type of Object.keys(factorKey)) {
    const gapTarget = s.atrValue * Math.max(common[factorKey[type]], 0.01);
    const grids = Math.max(1, Math.round(range / gapTarget));
    const p = computePlan({ ...btConfig(grids), startPrice: s.currentPrice, minNotional: filters.value.minNotional });
    const est = estimate(p.levels, p.qty, Math.min(Math.max(s.currentPrice, s.priceLower), s.priceUpper));
    const bt = candles.value.length ? backtestGrid(candles.value, btConfig(grids)) : null;
    results[type] = { grids, plan: p, est, bt };
  }
  return results;
});

// ---------------------------------
// 6. Goal Seeker: หากรอบราคาที่ต้องใช้เพื่อให้ได้กำไร/วันตามเป้า
// ---------------------------------
// กำไร/วัน ≈ eff·σ²/(2g²) · C/((R/g+1)·P) · (g − 2fP)  → แก้หา R (ความกว้างกรอบ)
const goalProfiles = [
  { label: "เทรดถี่ (Profit/Grid 0.4%)", net: 0.4, color: "red" },
  { label: "มาตรฐาน (Profit/Grid 0.6%)", net: 0.6, color: "green" },
  { label: "เทรดน้อย (Profit/Grid 1.0%)", net: 1.0, color: "blue" },
];
const dailyGoalUSDT = computed(() => (s.capital * common.dailyGoalPct) / 100);
// ช่องกรอกเป้า % รองรับทั้ง %/วัน และ %/ปี (เก็บเป็น %/วัน เสมอ)
const APR_PRESETS = [15, 25, 35, 50, 75];
const goalPctInput = computed({
  get: () =>
    common.goalPctUnit === "year"
      ? Number((common.dailyGoalPct * 365).toFixed(2))
      : common.dailyGoalPct,
  set: (v) => {
    const n = Number(v);
    if (!(n > 0)) return;
    common.dailyGoalPct = common.goalPctUnit === "year" ? n / 365 : n;
  },
});

const goalSeekerResults = computed(() => {
  const P = s.currentPrice;
  const f = common.feeRate;
  const C = s.capital;
  const goal = dailyGoalUSDT.value;
  if (!(goal > 0) || !(C > 0) || !(s.atrValue > 0) || !(P > 0)) return [];
  const sigma2 = Math.pow(s.atrValue / 1.6, 2) * common.efficiency;
  return goalProfiles.map((prof) => {
    const g = P * (prof.net / 100 + 2 * f);
    const x = (sigma2 * C * (g - 2 * f * P)) / (2 * g * g * P * goal);
    const grids = Math.max(1, Math.round(x - 1));
    const width = grids * g;
    const lower = tick(P - width / 2);
    const upper = tick(P + width / 2);
    const p = computePlan({ ...btConfig(grids), lower, upper, startPrice: P, minNotional: filters.value.minNotional });
    const est = estimate(p.levels, p.qty, P);
    return {
      ...prof,
      feasible: x > 2 && p.qty > 0 && p.minNotionalOk,
      grids,
      gap: g,
      lower,
      upper,
      plan: p,
      est,
      daysInRange: expectedDaysInRange(s.atrValue, width),
      widthPct: (width / P) * 100,
    };
  });
});

// ---------------------------------
// 5.5 เป้ากำไร $/วัน → ต้องใช้ทุนเท่าไหร่
// ---------------------------------
// กำไร/วันแปรผันตรงกับทุน จึงคำนวณ "กำไร/วัน ต่อทุน 1 USDT" ของแต่ละแบบ แล้วหารย้อนกลับ
const GOAL_USD_PRESETS = [0.5, 1, 2, 5, 10];
const TARGET_PROFIT_PER_GRID = 0.6; // % สุทธิ ใช้ตั้ง Gap ของแต่ละแบบ

const capitalProfiles = computed(() => {
  const P = s.currentPrice;
  const f = common.feeRate;
  const atr = s.atrValue;
  if (!(P > 0) || !(atr > 0)) return [];
  const g = P * (TARGET_PROFIT_PER_GRID / 100 + 2 * f);
  const profiles = [
    { key: "narrow", label: "กรอบแคบ ±3 ATR", color: "red", k: 3 },
    { key: "mid", label: "กรอบกลาง ±5 ATR", color: "green", k: 5 },
    { key: "wide", label: "กรอบกว้าง ±8 ATR", color: "blue", k: 8 },
  ].map((pr) => {
    const grids = Math.max(2, Math.round((2 * pr.k * atr) / g));
    const lower = tick(P - pr.k * atr);
    const upper = tick(P + pr.k * atr);
    return { ...pr, lower, upper, grids, daysInRange: expectedDaysInRange(atr, upper - lower) };
  });
  if (s.priceUpper > s.priceLower && s.gridCount >= 1) {
    const center = (s.priceUpper + s.priceLower) / 2;
    profiles.push({
      key: "current",
      label: "กรอบที่ตั้งไว้ตอนนี้",
      color: "gray",
      lower: s.priceLower,
      upper: s.priceUpper,
      grids: Math.floor(s.gridCount),
      daysInRange: plan.value?.inRange ? expectedDaysInRange(atr, s.priceUpper - s.priceLower, P - center) : 0,
    });
  }
  return profiles.map((pr) => {
    const levels = buildLevels(pr.lower, pr.upper, pr.grids, common.gridType, filters.value.tickSize);
    const sum = levels.reduce((a, x) => a + x, 0);
    const price = Math.min(Math.max(P, pr.lower), pr.upper);
    const gap = gapAtPrice(levels, price);
    const trades = estimateTradesPerDay(atr, gap) * common.efficiency;
    // กำไร/วัน ต่อทุน 1 USDT (qty = 1/Σlevels)
    const ratePerUSDT = (trades * (gap - 2 * f * price)) / sum;
    const minCapital = (filters.value.minNotional * sum) / levels[0];
    const profitMin = profitPerGridRange(levels, f, common.gridType).min;
    let btRate = null;
    if (pr.key === "current" && btCurrent.value && s.capital > 0) btRate = btCurrent.value.gridProfitPerDay / s.capital;
    return { ...pr, levels, gap, trades, ratePerUSDT, btRate, minCapital, profitMin, apr: ratePerUSDT * 365 * 100 };
  });
});

const capitalFor = (pr, goal) => {
  if (!(pr.ratePerUSDT > 0) || !(goal > 0)) return null;
  return Math.max(goal / pr.ratePerUSDT, pr.minCapital);
};

const goalUsdResults = computed(() =>
  capitalProfiles.value.map((pr) => {
    const capital = capitalFor(pr, common.dailyGoalUSD);
    return {
      ...pr,
      capital,
      capitalBt: pr.btRate > 0 ? common.dailyGoalUSD / pr.btRate : null,
      perMonth: common.dailyGoalUSD * 30,
    };
  })
);

const applyCapital = (r) => {
  if (r.key !== "current") {
    s.priceLower = r.lower;
    s.priceUpper = r.upper;
    s.gridCount = r.grids;
  }
  s.capital = Math.ceil(r.capital / 10) * 10;
  window.scrollTo({ top: 0, behavior: "smooth" });
};

const applyConfig = ({ lower, upper, grids }) => {
  if (lower !== undefined) s.priceLower = lower;
  if (upper !== undefined) s.priceUpper = upper;
  s.gridCount = grids;
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// ---------------------------------
// Formatting helpers
// ---------------------------------
const fmt = (v, d = 2) =>
  Number.isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "-";
const fmtPrice = (v) => fmt(v, priceDecimals.value);
const fmtQty = (v) => fmt(v, qtyDecimals.value);
const fmtDays = (d) => (!(d > 0) ? "-" : d >= 365 ? "> 1 ปี" : d >= 1 ? `~${d.toFixed(0)} วัน` : `~${(d * 24).toFixed(0)} ชม.`);
const signClass = (v) => (v >= 0 ? "text-green-700" : "text-red-600");
</script>

<template>
  <div class="grid-calc-container max-w-lg lg:max-w-7xl mx-auto p-4 lg:px-8 bg-gray-50 min-h-screen">
    <!-- Header -->
    <header class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pt-4 mb-4">
      <div class="text-center lg:text-left">
        <h2 class="app-title text-xl lg:text-2xl font-semibold text-gray-800">🤖 Grid Bot Profit Calc</h2>
        <p class="text-xs text-gray-400">v{{ APP_VERSION }} · {{ BUILD_DATE }}</p>
      </div>
      <div class="flex justify-center space-x-2">
        <button
          v-for="sym in SYMBOLS"
          :key="sym"
          @click="switchSymbol(sym)"
          :class="[
            'px-4 py-2 text-sm font-semibold rounded-lg transition-colors',
            symbol === sym ? 'bg-yellow-400 text-gray-900' : 'bg-white text-gray-700 border border-gray-300',
          ]"
        >
          {{ sym.replace("USDT", "/USDT") }}
        </button>
      </div>
    </header>

    <p class="hidden lg:block text-sm text-gray-500 mb-3">
      ทำตามลำดับ ① → ② → ③ แล้วกรอกค่าในกล่อง ③ ลง Binance · ④ Backtest ใช้เช็คย้อนหลังด้วยราคาจริง
    </p>

    <!-- ขั้นตอนหลัก -->
    <section class="lg:grid lg:grid-cols-3 lg:gap-5 lg:items-start">
      <div>
        <!-- ข้อมูลตลาด -->
        <div class="bg-white p-3 rounded-xl shadow-lg border border-gray-200 mb-4">
          <div class="flex justify-between items-center mb-2">
            <p class="text-base font-semibold text-gray-800">① ข้อมูลตลาดจาก Binance</p>
            <button
              @click="refreshMarket"
              :disabled="marketLoading"
              class="px-3 py-1 text-xs font-semibold rounded-lg bg-gray-800 text-white disabled:opacity-50"
            >
              {{ marketLoading ? "กำลังโหลด..." : "🔄 รีเฟรช" }}
            </button>
          </div>
          <p v-if="marketError" class="text-xs text-red-600 mb-1">{{ marketError }}</p>
          <div v-if="market" class="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <span class="text-gray-500">ราคาล่าสุด</span>
            <span class="text-right font-bold">{{ fmtPrice(market.price) }}</span>
            <span class="text-gray-500">ATR(14) 1D</span>
            <span class="text-right font-bold text-purple-700">
              {{ fmtPrice(market.atr14) }}
              <span class="font-normal text-gray-500">({{ fmt((market.atr14 / market.price) * 100) }}%)</span>
            </span>
            <span class="text-gray-500">กรอบ 7 วัน</span>
            <span class="text-right">{{ fmtPrice(market.range7.low) }} – {{ fmtPrice(market.range7.high) }}</span>
            <span class="text-gray-500">กรอบ 30 วัน</span>
            <span class="text-right">{{ fmtPrice(market.range30.low) }} – {{ fmtPrice(market.range30.high) }}</span>
            <span class="text-gray-500">กรอบ 90 วัน</span>
            <span class="text-right">{{ fmtPrice(market.range90.low) }} – {{ fmtPrice(market.range90.high) }}</span>
            <span class="text-gray-500">เปลี่ยนแปลง 7 / 30 วัน</span>
            <span class="text-right">
              <span :class="signClass(market.change7)">{{ fmt(market.change7, 1) }}%</span> /
              <span :class="signClass(market.change30)">{{ fmt(market.change30, 1) }}%</span>
            </span>
          </div>
          <p v-else-if="!marketError" class="text-xs text-gray-400">กำลังโหลด...</p>
        </div>
        <!-- Input -->
        <div class="input-section bg-white p-3 rounded-xl shadow-lg mb-4">
          <h3 class="text-lg font-medium text-center text-gray-700 mb-3">
            ② ตั้งค่ากริด ({{ symbol }})
          </h3>
          <div class="flex justify-center space-x-2 mb-3">
            <button
              v-for="mode in ['Arithmetic', 'Geometric']"
              :key="mode"
              @click="common.gridType = mode"
              :class="[
                'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                common.gridType === mode ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 border border-blue-600',
              ]"
            >
              {{ mode }}
            </button>
          </div>

          <div class="flex space-x-2 mb-2">
            <div class="flex-1">
              <label for="priceLower" class="block text-xs font-medium text-gray-600 mb-1">ราคาล่าง:</label>
              <input id="priceLower" type="number" v-model.number="s.priceLower" min="0" step="any"
                class="w-full p-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div class="flex-1">
              <label for="priceUpper" class="block text-xs font-medium text-gray-600 mb-1">ราคาบน:</label>
              <input id="priceUpper" type="number" v-model.number="s.priceUpper" min="0" step="any"
                class="w-full p-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          <div class="flex flex-wrap gap-1 mb-3 text-xs">
            <span class="text-gray-500 self-center mr-1">ตั้งกรอบเร็ว:</span>
            <button v-for="k in [3, 4, 5]" :key="k" @click="setRangeAtr(k)"
              class="px-2 py-1 rounded border border-purple-400 text-purple-700 bg-purple-50">±{{ k }} ATR</button>
            <button v-if="market" @click="setRange(market.range30.low, market.range30.high)"
              class="px-2 py-1 rounded border border-gray-400 text-gray-700 bg-gray-50">กรอบ 30 วัน</button>
            <button v-if="market" @click="setRange(market.range90.low, market.range90.high)"
              class="px-2 py-1 rounded border border-gray-400 text-gray-700 bg-gray-50">กรอบ 90 วัน</button>
          </div>

          <div class="flex space-x-2 mb-2">
            <div class="flex-1">
              <label for="gridCount" class="block text-xs font-medium text-gray-600 mb-1">จำนวนกริด:</label>
              <input id="gridCount" type="number" v-model.number="s.gridCount" min="1" step="1"
                class="w-full p-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div class="flex-1">
              <label for="capital" class="block text-xs font-medium text-gray-600 mb-1">เงินทุน (USDT):</label>
              <input id="capital" type="number" v-model.number="s.capital" min="0" step="any"
                class="w-full p-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>

          <div class="flex space-x-2 mb-2">
            <div class="flex-1">
              <label for="currentPrice" class="block text-xs font-medium text-gray-600 mb-1">ราคาปัจจุบัน:</label>
              <input id="currentPrice" type="number" v-model.number="s.currentPrice" min="0" step="any"
                class="w-full p-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div class="flex-1">
              <label for="atrValue" class="block text-xs font-medium text-gray-600 mb-1">ATR (1D):</label>
              <input id="atrValue" type="number" v-model.number="s.atrValue" min="0" step="any"
                class="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold" />
            </div>
          </div>

          <div class="flex space-x-2">
            <div class="flex-1">
              <label for="feeRate" class="block text-xs font-medium text-gray-600 mb-1">Fee (0.001 = 0.1%):</label>
              <input id="feeRate" type="number" v-model.number="common.feeRate" min="0" step="0.00001"
                class="w-full p-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div class="flex-1">
              <label for="efficiency" class="block text-xs font-medium text-gray-600 mb-1">ตัวคูณจำนวนไม้ (โมเดล):</label>
              <input id="efficiency" type="number" v-model.number="common.efficiency" min="0.1" step="0.05"
                class="w-full p-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
        </div>
      </div>
      <div>
        <!-- ค่าที่จะกรอกใน Binance -->
        <div class="bg-white p-3 rounded-xl shadow-lg border-2 border-yellow-400 mb-4">
          <h3 class="text-lg font-medium text-center text-gray-800 mb-2">③ ค่าที่จะกรอกใน Binance</h3>
          <div v-if="plan" class="text-sm">
            <table class="w-full">
              <tbody>
                <tr><td class="py-1 text-gray-500">Price Range</td>
                  <td class="py-1 text-right font-bold">{{ fmtPrice(s.priceLower) }} – {{ fmtPrice(s.priceUpper) }}</td></tr>
                <tr><td class="py-1 text-gray-500">Number of Grids</td>
                  <td class="py-1 text-right font-bold">{{ plan.n }}</td></tr>
                <tr><td class="py-1 text-gray-500">Mode</td>
                  <td class="py-1 text-right font-bold">{{ common.gridType }}</td></tr>
                <tr><td class="py-1 text-gray-500">Investment</td>
                  <td class="py-1 text-right font-bold">{{ fmt(s.capital) }} USDT</td></tr>
              </tbody>
            </table>

            <p class="text-xs text-gray-500 mt-3 mb-1 border-t pt-2">ค่าที่ Binance ควรแสดงหลังตั้งค่า (ไว้เช็คว่าตรงกัน)</p>
            <table class="w-full">
              <tbody>
                <tr><td class="py-1 text-gray-500">Qty/Order</td>
                  <td class="py-1 text-right font-semibold">{{ fmtQty(plan.qty) }} {{ base }}</td></tr>
                <tr><td class="py-1 text-gray-500">Profit/Grid</td>
                  <td class="py-1 text-right font-semibold" :class="plan.profit.min > 0 ? 'text-green-700' : 'text-red-600'">
                    {{ plan.profit.min.toFixed(2) }}%<template v-if="common.gridType === 'Arithmetic'"> – {{ plan.profit.max.toFixed(2) }}%</template>
                  </td></tr>
                <tr><td class="py-1 text-gray-500">Initial Buy Qty (ประมาณ)</td>
                  <td class="py-1 text-right font-semibold">{{ fmtQty(plan.initialBuyQty) }} {{ base }}</td></tr>
                <tr><td class="py-1 text-gray-500">ออเดอร์ซื้อ / ขาย</td>
                  <td class="py-1 text-right">{{ plan.buyCount }} / {{ plan.sellCount }}</td></tr>
                <tr><td class="py-1 text-gray-500">Gap ต่อกริด</td>
                  <td class="py-1 text-right">
                    <template v-if="common.gridType === 'Arithmetic'">{{ fmtPrice(plan.gapLow) }} USDT</template>
                    <template v-else>{{ fmtPrice(plan.gapLow) }} – {{ fmtPrice(plan.gapHigh) }} USDT</template>
                  </td></tr>
                <tr><td class="py-1 text-gray-500">มูลค่า/ออเดอร์</td>
                  <td class="py-1 text-right">{{ fmt(plan.minOrderNotional) }} – {{ fmt(plan.qty * s.priceUpper) }} USDT</td></tr>
              </tbody>
            </table>

            <div v-if="planEstimate" class="mt-3 p-2 rounded-lg bg-gray-50 border text-sm">
              <p class="text-xs text-gray-500 mb-1">ประมาณการจาก ATR (ถ้าราคาอยู่ในกรอบ)</p>
              <div class="grid grid-cols-2 gap-y-1">
                <span class="text-gray-600">กำไร/ไม้ (สุทธิ)</span>
                <span class="text-right font-semibold">{{ fmt(planEstimate.perTrade, 4) }} USDT</span>
                <span class="text-gray-600">จำนวนไม้/วัน</span>
                <span class="text-right font-semibold">{{ fmt(planEstimate.trades, 1) }}</span>
                <span class="text-gray-600">กำไรกริด/วัน</span>
                <span class="text-right font-bold text-purple-700">
                  {{ fmt(planEstimate.perDay) }} USDT ({{ fmt(planEstimate.perDayPct, 3) }}%)
                </span>
                <span class="text-gray-600">คิดเป็นต่อปี (APR)</span>
                <span class="text-right font-semibold">{{ fmt(planEstimate.perDayPct * 365, 1) }}%</span>
                <span class="text-gray-600">กรอบกว้าง</span>
                <span class="text-right">{{ fmt(planEstimate.widthPct, 1) }}% ({{ fmt(planEstimate.widthAtr, 1) }}× ATR)</span>
                <span class="text-gray-600">ห่างจากขอบ ล่าง/บน</span>
                <span class="text-right">-{{ fmt(planEstimate.lowerDistPct, 1) }}% / +{{ fmt(planEstimate.upperDistPct, 1) }}%</span>
                <span class="text-gray-600">คาดว่าจะอยู่ในกรอบ</span>
                <span class="text-right">{{ fmtDays(planEstimate.daysInRange) }}</span>
              </div>
            </div>
          </div>

          <ul v-if="warnings.length" class="mt-3 space-y-1">
            <li v-for="(w, i) in warnings" :key="i" class="text-xs rounded p-2 border"
              :class="{
                'text-red-700 bg-red-50 border-red-200': w.level === 'error',
                'text-amber-800 bg-amber-50 border-amber-200': w.level === 'warn',
                'text-blue-800 bg-blue-50 border-blue-200': w.level === 'tip',
              }">
              {{ w.level === "error" ? "⛔" : w.level === "warn" ? "⚠️" : "💡" }} {{ w.text }}
            </li>
          </ul>
        </div>
      </div>
      <div>
        <!-- Backtest -->
        <div class="bg-white p-4 rounded-xl shadow-lg mb-4">
          <h3 class="text-lg font-medium text-gray-700 pb-2 border-b border-gray-200">
            ④ Backtest ด้วยข้อมูลจริง (ไม่บังคับ)
          </h3>
          <div class="flex items-center gap-2 pt-3 text-sm">
            <span class="text-gray-600">ย้อนหลัง</span>
            <select v-model.number="btDays" class="p-1 border rounded">
              <option v-for="d in [7, 14, 30, 60, 90]" :key="d" :value="d">{{ d }} วัน</option>
            </select>
            <button @click="runBacktest" :disabled="btLoading"
              class="ml-auto px-3 py-1 text-sm font-semibold rounded-lg bg-blue-600 text-white disabled:opacity-50">
              {{ btLoading ? "กำลังโหลด..." : candles.length ? "โหลดใหม่" : "▶ รัน Backtest" }}
            </button>
          </div>
          <p class="text-xs text-gray-400 mt-1">
            ใช้แท่ง {{ btInterval }} จาก Binance จำลองบอทแบบเดียวกับ Spot Grid (เริ่มที่ราคาเปิดวันแรก)
          </p>
          <p v-if="btError" class="text-xs text-red-600 mt-1">{{ btError }}</p>

          <div v-if="btCurrent" class="mt-3 p-2 rounded-lg bg-blue-50 border border-blue-200 text-sm">
            <p class="text-xs text-gray-500 mb-1">
              ตั้งค่าปัจจุบัน {{ btCurrent.grids }} กริด · {{ fmt(btCurrent.days, 1) }} วัน ·
              ราคา {{ fmtPrice(btCurrent.startPrice) }} → {{ fmtPrice(btCurrent.endPrice) }}
            </p>
            <div class="grid grid-cols-2 gap-y-1">
              <span class="text-gray-600">ขายทำกำไร (ไม้)</span>
              <span class="text-right font-semibold">{{ btCurrent.sells }} ({{ fmt(btCurrent.tradesPerDay, 1) }}/วัน)</span>
              <span class="text-gray-600">กำไรกริด</span>
              <span class="text-right font-bold text-purple-700">
                {{ fmt(btCurrent.gridProfit) }} USDT ({{ fmt(btCurrent.gridProfitPerDayPct, 3) }}%/วัน)
              </span>
              <span class="text-gray-600">APR จากกริด</span>
              <span class="text-right font-semibold">{{ fmt(btCurrent.gridApr, 1) }}%</span>
              <span class="text-gray-600">กำไร/ขาดทุนที่ยังไม่รับรู้</span>
              <span class="text-right" :class="signClass(btCurrent.unrealized)">{{ fmt(btCurrent.unrealized) }} USDT</span>
              <span class="text-gray-600">รวมทั้งหมด</span>
              <span class="text-right font-bold" :class="signClass(btCurrent.totalPnl)">
                {{ fmt(btCurrent.totalPnl) }} USDT ({{ fmt(btCurrent.totalPnlPct) }}%)
              </span>
              <span class="text-gray-600">ถ้าถือเหรียญเฉยๆ</span>
              <span class="text-right" :class="signClass(btCurrent.hodlPnlPct)">{{ fmt(btCurrent.hodlPnlPct) }}%</span>
              <span class="text-gray-600">เวลาที่อยู่ในกรอบ</span>
              <span class="text-right">{{ fmt(btCurrent.inRangePct, 0) }}%</span>
            </div>
            <div v-if="calibration" class="mt-2 pt-2 border-t border-blue-200 text-xs flex items-center justify-between">
              <span class="text-gray-600">จำนวนไม้จริง ÷ ที่โมเดลทาย = <b>{{ fmt(calibration) }}</b></span>
              <button @click="common.efficiency = Number(calibration.toFixed(2))"
                class="px-2 py-1 rounded bg-blue-600 text-white">ใช้เป็นตัวคูณ</button>
            </div>
          </div>

          <div v-if="btScan.length" class="mt-3">
            <p class="text-sm font-semibold text-gray-700 mb-1">เทียบจำนวนกริด (กรอบเดิม ทุนเดิม)</p>
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="text-gray-500 border-b">
                    <th class="py-1 text-left">กริด</th>
                    <th class="py-1 text-right">Profit/Grid</th>
                    <th class="py-1 text-right">ไม้/วัน</th>
                    <th class="py-1 text-right">กริด %/วัน</th>
                    <th class="py-1 text-right">รวม %</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in btScan" :key="r.grids" class="border-b"
                    :class="{ 'bg-green-50 font-semibold': r.isBest, 'bg-yellow-50': r.grids === Math.floor(s.gridCount) && !r.isBest }">
                    <td class="py-1">{{ r.grids }}<span v-if="r.isBest"> ★</span></td>
                    <td class="py-1 text-right">{{ r.profitMin.toFixed(2) }}%</td>
                    <td class="py-1 text-right">{{ fmt(r.tradesPerDay, 1) }}</td>
                    <td class="py-1 text-right text-purple-700">{{ fmt(r.gridProfitPerDayPct, 3) }}</td>
                    <td class="py-1 text-right" :class="signClass(r.totalPnlPct)">{{ fmt(r.totalPnlPct) }}</td>
                    <td class="py-1 text-right">
                      <button v-if="r.grids !== Math.floor(s.gridCount)" @click="applyConfig({ grids: r.grids })"
                        class="px-2 py-0.5 rounded border border-blue-500 text-blue-600">ใช้</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="text-xs text-gray-400 mt-1">
              ★ = กำไรกริดสูงสุดในช่วงที่ทดสอบ ถ้าหลายค่าได้ใกล้เคียงกัน ให้เลือกค่าที่มี Profit/Grid ≥ 0.5% จะเผื่อค่าธรรมเนียมได้ดีกว่า
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- ตัวช่วยหาค่า -->
    <div class="mt-4 lg:mt-6 mb-3 border-t border-gray-300 pt-4">
      <h2 class="text-lg lg:text-xl font-semibold text-gray-800">🧭 ตัวช่วยหาค่าที่เหมาะสม</h2>
      <p class="text-sm text-gray-500">เลือกเป้าหมายที่ต้องการ แล้วกด "ใช้ค่านี้" ค่าจะถูกใส่ในขั้นที่ ② ให้อัตโนมัติ</p>
    </div>
    <section class="lg:grid lg:grid-cols-3 lg:gap-5 lg:items-start">
      <div>
        <!-- Goal: $/day -> capital -->
        <div class="bg-white p-4 rounded-xl shadow-lg mb-4 border-2 border-purple-300">
          <h3 class="text-lg font-medium text-gray-700 pb-2 border-b border-gray-200">
            A. อยากได้กำไรวันละกี่ $ → ต้องใช้ทุนเท่าไหร่
          </h3>
          <div class="flex flex-col items-center pt-3">
            <label for="dailyGoalUSD" class="block text-sm font-medium text-gray-700 mb-1 text-center">
              เป้ากำไรกริด/วัน <span class="text-purple-700 font-semibold">(USDT)</span>:
            </label>
            <input id="dailyGoalUSD" type="number" v-model.number="common.dailyGoalUSD" min="0.01" step="0.1"
              class="w-full max-w-xs p-2 border border-purple-600 rounded-lg text-lg text-center font-bold" />
            <div class="flex flex-wrap justify-center gap-1 mt-2">
              <button v-for="g in GOAL_USD_PRESETS" :key="g" @click="common.dailyGoalUSD = g"
                class="px-3 py-1 text-xs rounded-full border"
                :class="common.dailyGoalUSD === g ? 'bg-purple-600 text-white border-purple-600' : 'border-purple-400 text-purple-700 bg-purple-50'">
                ${{ g }}/วัน
              </button>
            </div>
            <p class="text-sm text-gray-700 mt-2">
              ≈ {{ fmt(common.dailyGoalUSD * 30) }} USDT/เดือน · {{ fmt(common.dailyGoalUSD * 365, 0) }} USDT/ปี
            </p>
          </div>

          <div v-if="goalUsdResults.length" class="space-y-3 mt-4">
            <div v-for="r in goalUsdResults" :key="r.key" class="border rounded-lg p-3"
              :class="{
                'border-red-400 bg-red-50': r.color === 'red',
                'border-green-400 bg-green-50': r.color === 'green',
                'border-blue-400 bg-blue-50': r.color === 'blue',
                'border-gray-400 bg-gray-50': r.color === 'gray',
              }">
              <p class="font-bold text-sm mb-1"
                :class="{ 'text-red-700': r.color === 'red', 'text-green-700': r.color === 'green', 'text-blue-700': r.color === 'blue', 'text-gray-700': r.color === 'gray' }">
                {{ r.label }}
              </p>
              <p v-if="!r.capital" class="text-xs text-red-600">คำนวณไม่ได้ (Profit/Grid ติดลบหรือราคาอยู่นอกกรอบ)</p>
              <table v-else class="w-full text-sm border-t border-dotted">
                <tbody>
                  <tr><td class="py-1 text-gray-600">ต้องใช้ทุน:</td>
                    <td class="py-1 text-right font-bold text-lg text-purple-700">≈ {{ fmt(r.capital, 0) }} USDT</td></tr>
                  <tr v-if="r.capitalBt"><td class="py-1 text-gray-600">ทุนตาม Backtest:</td>
                    <td class="py-1 text-right font-semibold text-blue-700">≈ {{ fmt(r.capitalBt, 0) }} USDT</td></tr>
                  <tr><td class="py-1 text-gray-600">Price Range:</td>
                    <td class="py-1 text-right">{{ fmtPrice(r.lower) }} – {{ fmtPrice(r.upper) }}</td></tr>
                  <tr><td class="py-1 text-gray-600">Grids / Profit/Grid:</td>
                    <td class="py-1 text-right">{{ r.grids }} กริด · {{ r.profitMin.toFixed(2) }}%</td></tr>
                  <tr><td class="py-1 text-gray-600">ไม้/วัน (โมเดล):</td>
                    <td class="py-1 text-right">{{ fmt(r.trades, 1) }}</td></tr>
                  <tr><td class="py-1 text-gray-600">ผลตอบแทนจากกริด:</td>
                    <td class="py-1 text-right">{{ fmt(r.ratePerUSDT * 100, 3) }}%/วัน (~{{ fmt(r.apr, 0) }}%/ปี)</td></tr>
                  <tr class="border-t border-dotted"><td class="py-1 text-gray-600">คาดว่าจะอยู่ในกรอบ:</td>
                    <td class="py-1 text-right font-semibold" :class="r.daysInRange < 7 ? 'text-red-600' : 'text-gray-800'">
                      {{ fmtDays(r.daysInRange) }}</td></tr>
                </tbody>
              </table>
              <div v-if="r.capital" class="text-right mt-1">
                <button @click="applyCapital(r)"
                  class="px-2 py-1 text-xs rounded border border-gray-500 text-gray-700 bg-white">
                  {{ r.key === "current" ? "ใช้ทุนนี้" : "ใช้กรอบ + ทุนนี้" }}
                </button>
              </div>
            </div>

            <div class="mt-2">
              <p class="text-sm font-semibold text-gray-700 mb-1">ตารางเทียบ: เป้า $/วัน → ทุนที่ต้องใช้ (USDT)</p>
              <div class="overflow-x-auto">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="text-gray-500 border-b">
                      <th class="py-1 text-left">เป้า/วัน</th>
                      <th v-for="r in capitalProfiles" :key="r.key" class="py-1 text-right">{{ r.label.replace("กรอบ", "") }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="g in GOAL_USD_PRESETS" :key="g" class="border-b"
                      :class="{ 'bg-purple-50 font-semibold': common.dailyGoalUSD === g }">
                      <td class="py-1">${{ g }}</td>
                      <td v-for="r in capitalProfiles" :key="r.key" class="py-1 text-right">
                        {{ capitalFor(r, g) ? fmt(capitalFor(r, g), 0) : "-" }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class="text-xs text-gray-500 mt-2">
                ตัวเลขนี้คิดจากความผันผวนตอนนี้ (ATR) และสมมติว่าราคาแกว่งอยู่ในกรอบ ถ้าตลาดเงียบกำไรจะลดลง ถ้าเป็นเทรนด์แรงราคาจะหลุดกรอบ
                กรอบแคบใช้ทุนน้อยกว่าแต่หลุดกรอบเร็ว กดรัน Backtest (ข้อ 2) เพื่อดูทุนที่ต้องใช้จากราคาจริงของกรอบที่ตั้งไว้
              </p>
            </div>
          </div>
          <div v-else class="text-center text-gray-500 py-4 text-sm">โปรดกรอกราคาปัจจุบันและ ATR</div>
        </div>
      </div>
      <div>
        <!-- Goal Seeker -->
        <div class="bg-white p-4 rounded-xl shadow-lg mb-4">
          <h3 class="text-lg font-medium text-gray-700 pb-2 border-b border-gray-200">
            B. เป้า %/ปี หรือ %/วัน → หากรอบราคา
          </h3>
          <div class="flex flex-col items-center pt-3">
            <div class="flex space-x-2 mb-2">
              <button v-for="u in [{ v: 'year', l: '% ต่อปี' }, { v: 'day', l: '% ต่อวัน' }]" :key="u.v"
                @click="common.goalPctUnit = u.v"
                :class="[
                  'px-3 py-1 text-xs font-semibold rounded-lg',
                  common.goalPctUnit === u.v ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 border border-blue-600',
                ]">
                {{ u.l }}
              </button>
            </div>
            <label for="dailyGoalPct" class="block text-sm font-medium text-gray-700 mb-1 text-center">
              เป้าหมายกำไรกริด
              <span class="text-blue-600 font-semibold">({{ common.goalPctUnit === "year" ? "% ของทุน ต่อปี" : "% ของทุน ต่อวัน" }})</span>:
            </label>
            <input id="dailyGoalPct" type="number" v-model.number="goalPctInput" min="0.01"
              :step="common.goalPctUnit === 'year' ? 1 : 0.01"
              class="w-full max-w-xs p-2 border border-blue-600 rounded-lg text-lg text-center font-bold" />
            <div v-if="common.goalPctUnit === 'year'" class="flex flex-wrap justify-center gap-1 mt-2">
              <button v-for="a in APR_PRESETS" :key="a" @click="goalPctInput = a"
                class="px-3 py-1 text-xs rounded-full border"
                :class="goalPctInput === a ? 'bg-blue-600 text-white border-blue-600' : 'border-blue-400 text-blue-700 bg-blue-50'">
                {{ a }}%/ปี
              </button>
            </div>
            <p class="text-sm text-gray-700 font-medium mt-1">
              = {{ fmt(common.dailyGoalPct, 3) }}%/วัน · {{ fmt(common.dailyGoalPct * 365, 1) }}%/ปี
            </p>
            <p class="text-sm text-gray-700 mt-1">
              ทุน {{ fmt(s.capital, 0) }} USDT → {{ fmt(dailyGoalUSDT) }} USDT/วัน · {{ fmt(dailyGoalUSDT * 30) }} USDT/เดือน
            </p>
            <p class="text-xs text-gray-500 mt-1 text-center">
              ยิ่งอยากได้กำไรต่อวันมาก กรอบก็ต้องยิ่งแคบลง และหลุดกรอบเร็วขึ้น
            </p>
          </div>

          <div v-if="goalSeekerResults.length" class="space-y-3 mt-4">
            <div v-for="r in goalSeekerResults" :key="r.label" class="border rounded-lg p-3"
              :class="{
                'border-red-400 bg-red-50': r.color === 'red',
                'border-green-400 bg-green-50': r.color === 'green',
                'border-blue-400 bg-blue-50': r.color === 'blue',
              }">
              <p class="font-bold text-sm mb-1"
                :class="{ 'text-red-700': r.color === 'red', 'text-green-700': r.color === 'green', 'text-blue-700': r.color === 'blue' }">
                {{ r.label }}
              </p>
              <p v-if="!r.feasible" class="text-xs text-red-600">
                เป้านี้สูงเกินไปสำหรับ Profit/Grid นี้ (กรอบจะแคบจนเหลือไม่กี่กริด หรือทุน/ออเดอร์ต่ำกว่าขั้นต่ำ)
              </p>
              <table v-else class="w-full text-sm border-t border-dotted">
                <tbody>
                  <tr><td class="py-1 text-gray-600">Price Range:</td>
                    <td class="py-1 text-right font-bold">{{ fmtPrice(r.lower) }} – {{ fmtPrice(r.upper) }}</td></tr>
                  <tr><td class="py-1 text-gray-600">จำนวน Grids:</td>
                    <td class="py-1 text-right font-bold text-lg text-blue-700">{{ r.grids }}</td></tr>
                  <tr><td class="py-1 text-gray-600">กรอบกว้าง:</td>
                    <td class="py-1 text-right">±{{ fmt(r.widthPct / 2, 1) }}% · Gap {{ fmtPrice(r.gap) }}</td></tr>
                  <tr><td class="py-1 text-gray-600">ไม้/วัน (โมเดล):</td>
                    <td class="py-1 text-right">{{ fmt(r.est.trades, 1) }}</td></tr>
                  <tr><td class="py-1 text-gray-600">กำไร/วัน (โมเดล):</td>
                    <td class="py-1 text-right font-bold text-purple-700">
                      {{ fmt(r.est.perDay) }} USDT ({{ fmt(r.est.perDayPct, 3) }}%)</td></tr>
                  <tr class="border-t border-dotted"><td class="py-1 text-gray-600">คาดว่าจะอยู่ในกรอบ:</td>
                    <td class="py-1 text-right font-semibold" :class="r.daysInRange < 7 ? 'text-red-600' : 'text-gray-800'">
                      {{ fmtDays(r.daysInRange) }}</td></tr>
                </tbody>
              </table>
              <div v-if="r.feasible" class="text-right mt-1">
                <button @click="applyConfig(r)"
                  class="px-2 py-1 text-xs rounded border border-gray-500 text-gray-700 bg-white">ใช้ค่านี้</button>
              </div>
            </div>
          </div>
          <div v-else class="text-center text-gray-500 py-4 text-sm">โปรดตรวจสอบ ATR, เงินทุน, และเป้าหมายกำไร</div>
        </div>
      </div>
      <div>
        <!-- ATR Recommendations -->
        <div class="bg-white p-4 rounded-xl shadow-lg mb-4">
          <h3 class="text-lg font-medium text-gray-700 pb-2 border-b border-gray-200">
            C. จำนวนกริดจาก ATR ({{ fmt(s.priceUpper - s.priceLower, 0) }} USDT Range)
          </h3>
          <div v-if="Object.keys(atrRecommendations).length" class="space-y-3 pt-3">
            <div v-for="(r, type) in atrRecommendations" :key="type" class="border rounded-lg p-3"
              :class="{
                'border-red-400 bg-red-50': type === 'Aggressive',
                'border-green-400 bg-green-50': type === 'Balanced',
                'border-blue-400 bg-blue-50': type === 'Conservative',
              }">
              <p class="font-bold text-sm mb-1 flex justify-between items-center"
                :class="{ 'text-red-700': type === 'Aggressive', 'text-green-700': type === 'Balanced', 'text-blue-700': type === 'Conservative' }">
                {{ typeLabels[type] }}
                <span class="text-xs font-normal flex items-center">
                  Gap =
                  <input type="number" :value="common[factorKey[type]]" @input="updateFactor(type, $event.target.value)"
                    min="0.01" step="0.05" class="w-16 mx-1 p-1 border rounded-lg text-sm text-center font-bold" />
                  × ATR
                </span>
              </p>
              <table class="w-full text-sm mt-2 border-t border-dotted">
                <tbody>
                  <tr><td class="py-1 text-gray-600">จำนวน Grids:</td>
                    <td class="py-1 text-right font-bold text-lg text-blue-700">{{ r.grids }}</td></tr>
                  <tr><td class="py-1 text-gray-600">ระยะ Gap:</td>
                    <td class="py-1 text-right font-bold text-green-700">{{ fmtPrice(r.est.gap) }} USDT</td></tr>
                  <tr><td class="py-1 text-gray-600">Qty/Order:</td>
                    <td class="py-1 text-right">{{ fmtQty(r.plan.qty) }} {{ base }}</td></tr>
                  <tr><td class="py-1 text-gray-600">Profit/Grid:</td>
                    <td class="py-1 text-right" :class="r.plan.profit.min > 0 ? '' : 'text-red-600'">
                      {{ r.plan.profit.min.toFixed(2) }}% – {{ r.plan.profit.max.toFixed(2) }}%</td></tr>
                  <tr><td class="py-1 text-gray-600">ไม้/วัน (โมเดล):</td>
                    <td class="py-1 text-right font-semibold">{{ fmt(r.est.trades, 1) }}</td></tr>
                  <tr class="border-t border-dotted"><td class="py-1 text-gray-600">กำไร/วัน (โมเดล):</td>
                    <td class="py-1 text-right font-bold text-purple-700">
                      {{ fmt(r.est.perDay) }} USDT <span class="text-gray-600 font-normal">({{ fmt(r.est.perDayPct, 3) }}%)</span>
                    </td></tr>
                  <tr v-if="r.bt"><td class="py-1 text-gray-600">Backtest:</td>
                    <td class="py-1 text-right font-semibold text-blue-700">
                      {{ fmt(r.bt.tradesPerDay, 1) }} ไม้/วัน · {{ fmt(r.bt.gridProfitPerDayPct, 3) }}%/วัน
                    </td></tr>
                </tbody>
              </table>
              <div class="text-right mt-1">
                <button @click="applyConfig({ grids: r.grids })"
                  class="px-2 py-1 text-xs rounded border border-gray-500 text-gray-700 bg-white">ใช้ค่านี้</button>
              </div>
            </div>
          </div>
          <div v-else class="text-center text-gray-500 py-4 text-sm">โปรดกรอก ATR และกำหนดช่วงราคาเพื่อดูคำแนะนำ</div>
        </div>
      </div>
    </section>

    <p class="text-xs text-gray-400 text-center pb-6">
      โมเดล: ไม้/วัน ≈ ½·(σ/Gap)² × ตัวคูณ, σ ≈ ATR/1.6 · กำไรกริดไม่รวมกำไร/ขาดทุนจากราคาเหรียญที่ถืออยู่
    </p>
  </div>
</template>
