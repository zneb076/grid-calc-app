<script setup>
import { ref, computed, watchEffect } from "vue";

// ---------------------------------
// 1. สถานะเริ่มต้นและการดึงจาก Local Storage
// ---------------------------------
const getInitialValue = (key, defaultValue) => {
  const saved = localStorage.getItem(key);
  return saved !== null ? Number(saved) : defaultValue;
};
const getInitialString = (key, defaultValue) => {
  const saved = localStorage.getItem(key);
  return saved !== null ? saved : defaultValue;
};

// ค่าเริ่มต้น (อิงจาก Input ล่าสุด)
const gridType = ref(getInitialString("gridType", "Arithmetic"));
const priceUpper = ref(getInitialValue("priceUpper", 5500));
const priceLower = ref(getInitialValue("priceLower", 2500));
const gridCount = ref(getInitialValue("gridCount", 50));
const capital = ref(getInitialValue("capital", 500));
const feeRate = ref(getInitialValue("feeRate", 0.001));
const currentPrice = ref(getInitialValue("currentPrice", 3800));
const atrValue = ref(getInitialValue("atrValue", 200));
const isIdealMode = ref(getInitialValue("isIdealMode", 0));

// ATR Custom Factors
const factorAggressive = ref(getInitialValue("factorAggressive", 0.1));
const factorBalanced = ref(getInitialValue("factorBalanced", 0.22));
const factorConservative = ref(getInitialValue("factorConservative", 0.5));

// Goal Seeker Input (Percent Focus)
const dailyGoalPct = ref(getInitialValue("dailyGoalPct", 0.2));

// สถานะ Collapsible
const isATRRecsOpen = ref(true);
const isGoalSeekerOpen = ref(true);

// ---------------------------------
// 2. Watcher สำหรับบันทึกค่าลง Local Storage
// ---------------------------------
watchEffect(() => {
  localStorage.setItem("gridType", gridType.value);
  localStorage.setItem("priceUpper", priceUpper.value);
  localStorage.setItem("priceLower", priceLower.value);
  localStorage.setItem("gridCount", gridCount.value);
  localStorage.setItem("capital", capital.value);
  localStorage.setItem("feeRate", feeRate.value);
  localStorage.setItem("currentPrice", currentPrice.value);
  localStorage.setItem("atrValue", atrValue.value);
  localStorage.setItem("isIdealMode", isIdealMode.value);
  localStorage.setItem("factorAggressive", factorAggressive.value);
  localStorage.setItem("factorBalanced", factorBalanced.value);
  localStorage.setItem("factorConservative", factorConservative.value);
  localStorage.setItem("dailyGoalPct", dailyGoalPct.value);
});

// ---------------------------------
// 2.5 Helper Functions และ Computed Goal USDT
// ---------------------------------

const getFactorRef = (type) => {
  if (type === "Aggressive") return factorAggressive;
  if (type === "Balanced") return factorBalanced;
  if (type === "Conservative") return factorConservative;
  return ref(0);
};

const updateFactor = (type, value) => {
  const factorRef = getFactorRef(type);
  const numValue = Number(value);
  if (!isNaN(numValue) && numValue >= 0.01) {
    factorRef.value = numValue;
  }
};

const dailyGoalUSDT = computed(() => {
  const capitalValue = capital.value;
  const goalPct = dailyGoalPct.value;
  return (capitalValue * goalPct) / 100;
});

// ---------------------------------
// 3. Computed Properties หลัก (Logic การคำนวณ)
// ---------------------------------

const gridMetrics = computed(() => {
  if (priceUpper.value <= priceLower.value || gridCount.value <= 0) {
    return { ratio: 1, gap: 0 };
  }
  const priceRange = priceUpper.value - priceLower.value;
  const numGrids = gridCount.value;

  if (gridType.value === "Geometric") {
    const R = priceUpper.value / priceLower.value;
    const ratio = Math.pow(R, 1 / numGrids);
    return { ratio: ratio, gap: 0 };
  } else {
    const gap = priceRange / numGrids;
    return { ratio: 1, gap: gap };
  }
});

const investmentPerGrid = computed(() => {
  if (gridCount.value <= 0) return 0;
  return capital.value / gridCount.value;
});

const priceAverage = computed(() => (priceUpper.value + priceLower.value) / 2);

const quantityPerGrid = computed(() => {
  const inv = investmentPerGrid.value;
  let priceRef = 0;

  if (gridType.value === "Arithmetic") {
    priceRef = priceAverage.value;
  } else {
    priceRef = currentPrice.value > 0 ? currentPrice.value : priceLower.value;
  }

  if (priceRef <= 0 || inv <= 0) return 0;
  return inv / priceRef;
});

const grossProfitPerGrid = computed(() => {
  const inv = investmentPerGrid.value;

  if (gridType.value === "Geometric") {
    const r = gridMetrics.value.ratio;
    if (r <= 1) return 0;
    return inv * (r - 1);
  } else {
    const gap = gridMetrics.value.gap;
    const qty = quantityPerGrid.value;
    return qty * gap;
  }
});

const totalFeePerGrid = computed(() => {
  const fee = feeRate.value;
  const inv = investmentPerGrid.value;

  if (gridType.value === "Geometric") {
    const r = gridMetrics.value.ratio;
    return inv * fee * (1 + r);
  } else {
    const qty = quantityPerGrid.value;
    const avgPrice = priceAverage.value;
    const avgTradeVolume = qty * avgPrice;
    return 2 * avgTradeVolume * fee;
  }
});

const netProfitPerGrid = computed(
  () => grossProfitPerGrid.value - totalFeePerGrid.value
);
const totalNetProfit = computed(
  () => netProfitPerGrid.value * (gridCount.value - 1)
);
const netProfitPercentage = computed(() => {
  const netProfit = netProfitPerGrid.value;
  const inv = investmentPerGrid.value;
  if (inv === 0) return 0;
  return (netProfit / inv) * 100;
});

const priceGapLower = computed(() => {
  if (gridType.value === "Geometric") {
    return priceLower.value * (gridMetrics.value.ratio - 1);
  } else {
    return gridMetrics.value.gap;
  }
});

const priceGapUpper = computed(() => {
  if (gridType.value === "Geometric") {
    const r = gridMetrics.value.ratio;
    return priceUpper.value - priceUpper.value / r;
  } else {
    return gridMetrics.value.gap;
  }
});

// ---------------------------------
// 4. Logic คำนวณ ATR Recommendations และ Risk Adjustment
// ---------------------------------
const typeLabels = {
  Aggressive: "1. เน้นซิ่ง (Aggressive)",
  Balanced: "2. บาลานซ์ (Balanced)",
  Conservative: "3. ปลอดภัย (Conservative)",
};
const RISK_ADJUSTMENT_FACTOR = 0.6;

const calculateAtrGrid = (recommendedGap) => {
  const range = priceUpper.value - priceLower.value;

  if (recommendedGap <= 0 || range <= 0 || capital.value <= 0) {
    return {
      grids: 0,
      netProfit: 0,
      netProfitPct: 0,
      profitPerDay: 0,
      expectedTrades: 0,
      recommendedGap: 0,
      investmentPerGrid: 0,
    };
  }

  const recommendedGrids = Math.floor(range / recommendedGap);

  if (recommendedGrids <= 0) {
    return {
      grids: 0,
      netProfit: 0,
      netProfitPct: 0,
      profitPerDay: 0,
      expectedTrades: 0,
      recommendedGap: recommendedGap,
      investmentPerGrid: 0,
    };
  }

  // --- คำนวณ Ideal Values ---
  const inv = capital.value / recommendedGrids;
  const fee = feeRate.value;
  const priceAvgValue = priceAverage.value;

  const qty = inv / priceAvgValue;
  const grossProfit = qty * recommendedGap;
  const totalFee = 2 * (qty * priceAvgValue) * fee;
  const netProfit = grossProfit - totalFee;
  const netProfitPct = inv > 0 ? (netProfit / inv) * 100 : 0;

  const atr = atrValue.value;

  const profitPerDayIdeal = netProfit * (atr / recommendedGap);
  const expectedTradesIdeal = atr / recommendedGap;

  const adjustmentFactor = isIdealMode.value ? 1.0 : RISK_ADJUSTMENT_FACTOR;

  // --- ผลลัพธ์สุดท้ายที่ปรับปรุงแล้ว ---
  return {
    grids: recommendedGrids,
    netProfit: netProfit,
    netProfitPct: netProfitPct,

    profitPerDay: profitPerDayIdeal * adjustmentFactor,
    expectedTrades: expectedTradesIdeal * adjustmentFactor,

    recommendedGap: recommendedGap,
    investmentPerGrid: inv,
  };
};

const atrRecommendations = computed(() => {
  if (atrValue.value <= 0 || priceUpper.value <= priceLower.value) return {};

  const factors = {
    Aggressive: factorAggressive.value,
    Balanced: factorBalanced.value,
    Conservative: factorConservative.value,
  };

  const results = {};
  for (const [key, factor] of Object.entries(factors)) {
    const validFactor = factor > 0 ? factor : 0.01;
    const recommendedGap = atrValue.value * validFactor;
    const result = calculateAtrGrid(recommendedGap);
    results[key] = result;
  }

  return results;
});

// ---------------------------------
// 5. Logic ATR Goal Seeker (แก้ไขสมการ)
// ---------------------------------

const goalSeekerResults = computed(() => {
  const goalUSDT = dailyGoalUSDT.value;
  const capitalValue = capital.value;
  const atr = atrValue.value;
  const fee = feeRate.value;
  const range = priceUpper.value - priceLower.value;
  const priceAvgValue = priceAverage.value;

  if (goalUSDT <= 0 || capitalValue <= 0 || atr <= 0 || range <= 0) {
    return [];
  }

  const gapFactors = [0.1, 0.22, 0.5];
  const results = [];
  const adjustmentFactor = isIdealMode.value ? 1.0 : RISK_ADJUSTMENT_FACTOR;

  for (const factor of gapFactors) {
    const tradesPerDayIdeal = (1 / factor) * (atr / 100);
    const tradesPerDayAdjusted = tradesPerDayIdeal * adjustmentFactor;
    if (tradesPerDayAdjusted <= 0) continue;

    const netProfitReq = goalUSDT / tradesPerDayAdjusted;
    const grossProfitReq = netProfitReq / (1 - fee * 2);
    if (grossProfitReq <= 0) continue;

    const requiredGapSquared =
      (grossProfitReq * priceAvgValue * range) / capitalValue;
    if (requiredGapSquared <= 0) continue;
    const requiredGap = Math.sqrt(requiredGapSquared);

    if (requiredGap <= 0) continue;

    const requiredGrids = Math.ceil(range / requiredGap);
    if (requiredGrids < 1) continue;

    const finalInvPerGrid = capitalValue / requiredGrids;
    const finalQty = finalInvPerGrid / priceAvgValue;
    const finalGrossProfit = finalQty * requiredGap;
    const finalFee = 2 * (finalQty * priceAvgValue) * fee;
    const finalNetProfit = finalGrossProfit - finalFee;
    const finalNetProfitPct =
      finalInvPerGrid > 0 ? (finalNetProfit / finalInvPerGrid) * 100 : 0;

    // ========================================================
    // START: โค้ดส่วนที่เพิ่มเข้ามา
    // ========================================================
    const calculatedDailyProfitUSDT = finalNetProfit * tradesPerDayAdjusted;
    const calculatedDailyProfitPct =
      (calculatedDailyProfitUSDT / capitalValue) * 100;
    // ========================================================
    // END: โค้ดส่วนที่เพิ่มเข้ามา
    // ========================================================

    results.push({
      label:
        factor === 0.5
          ? "เทรดน้อย (Low)"
          : factor === 0.22
          ? "มาตรฐาน (Normal)"
          : "เทรดถี่ (High)",
      tradesPerDay: tradesPerDayAdjusted,
      requiredGap: requiredGap,
      requiredGrids: requiredGrids,
      finalInvPerGrid: finalInvPerGrid,
      finalNetProfit: finalNetProfit,
      finalNetProfitPct: finalNetProfitPct,
      tradesPerDayIdeal: tradesPerDayIdeal,
      // เพิ่มค่าที่คำนวณใหม่เข้าไปใน object
      calculatedDailyProfitUSDT: calculatedDailyProfitUSDT,
      calculatedDailyProfitPct: calculatedDailyProfitPct,
      debug_NP_Req: netProfitReq,
      debug_GP_Req: grossProfitReq,
    });
  }

  return results;
});
</script>

<template>
  <div class="grid-calc-container max-w-lg mx-auto p-4 bg-gray-50 min-h-screen">
    <h2
      class="app-title text-center text-xl font-semibold text-gray-800 mb-4 pt-4"
    >
      🤖 Grid Bot Profit Calc
    </h2>

    <div class="flex justify-center space-x-2 mb-4">
      <button
        @click="gridType = 'Arithmetic'"
        :class="[
          'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
          gridType === 'Arithmetic'
            ? 'bg-blue-600 text-white'
            : 'bg-white text-blue-600 border border-blue-600',
        ]"
      >
        Arithmetic
      </button>
      <button
        @click="gridType = 'Geometric'"
        :class="[
          'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
          gridType === 'Geometric'
            ? 'bg-blue-600 text-white'
            : 'bg-white text-blue-600 border border-blue-600',
        ]"
      >
        Geometric
      </button>
    </div>

    <div
      class="result-box bg-white p-3 rounded-xl shadow-lg border border-gray-200 mb-4"
    >
      <p class="text-sm text-center text-gray-500 mb-2">
        กำไรสุทธิ/ไม้ (Net Profit/Grid)
      </p>
      <div
        class="metric-display p-3 rounded-lg text-white text-center"
        :class="{
          'bg-green-600': netProfitPerGrid > 0,
          'bg-red-600': netProfitPerGrid <= 0,
        }"
      >
        <p class="text-sm font-semibold mb-1">
          ทุนต่อไม้: {{ investmentPerGrid.toFixed(2) }} USDT
        </p>

        <p class="text-4xl font-bold leading-none">
          {{ netProfitPerGrid.toFixed(4) }}
          <span class="text-base font-normal align-top ml-1">USDT</span>
        </p>
        <p class="text-lg font-medium mt-1">
          {{ netProfitPercentage.toFixed(4) }} %
        </p>

        <p class="text-sm font-semibold mt-1" v-if="gridType === 'Arithmetic'">
          (Gap: {{ priceGapLower.toFixed(2) }} USDT)
        </p>
      </div>
    </div>

    <hr class="border-gray-300 my-4" />

    <div class="input-section bg-white p-3 rounded-xl shadow-lg">
      <h3 class="font-medium text-center text-gray-700 mb-3">
        1. Input Parameters ({{ gridType }} Grid)
      </h3>

      <div class="flex space-x-2 mb-2">
        <div class="input-group flex-1">
          <label
            for="priceLower"
            class="block text-xs font-medium text-gray-600 mb-1"
            >ราคาล่าง:</label
          >
          <input
            id="priceLower"
            type="number"
            v-model.number="priceLower"
            min="0.01"
            step="any"
            class="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div class="input-group flex-1">
          <label
            for="priceUpper"
            class="block text-xs font-medium text-gray-600 mb-1"
            >ราคาบน:</label
          >
          <input
            id="priceUpper"
            type="number"
            v-model.number="priceUpper"
            min="0.01"
            step="any"
            class="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      <div class="flex space-x-2 mb-2">
        <div class="input-group flex-1">
          <label
            for="gridCount"
            class="block text-xs font-medium text-gray-600 mb-1"
            >จำนวนกริด:</label
          >
          <input
            id="gridCount"
            type="number"
            v-model.number="gridCount"
            min="1"
            step="1"
            class="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div class="input-group flex-1">
          <label
            for="capital"
            class="block text-xs font-medium text-gray-600 mb-1"
            >เงินทุน (USDT):</label
          >
          <input
            id="capital"
            type="number"
            v-model.number="capital"
            min="0.01"
            step="any"
            class="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      <div class="flex space-x-2 mb-2">
        <div class="input-group flex-1">
          <label
            for="feeRate"
            class="block text-xs font-medium text-gray-600 mb-1"
            >Fee Rate (0.001 = 0.1%):</label
          >
          <input
            id="feeRate"
            type="number"
            v-model.number="feeRate"
            min="0"
            step="0.00001"
            class="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div class="input-group flex-1">
          <label
            for="currentPrice"
            class="block text-xs font-medium text-gray-600 mb-1"
            >ราคาอ้างอิง (สำหรับ Quantity):</label
          >
          <input
            id="currentPrice"
            type="number"
            v-model.number="currentPrice"
            min="1"
            step="any"
            class="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      <div class="input-group fee-rate-group">
        <label
          for="atrValue"
          class="block text-xs font-medium text-gray-600 mb-1"
          >ATR (Average True Range, เช่น TF 1D):</label
        >
        <input
          id="atrValue"
          type="number"
          v-model.number="atrValue"
          min="0"
          step="any"
          class="w-full p-2 border border-gray-300 rounded-lg text-sm font-bold focus:ring-purple-500 focus:border-purple-500"
        />
      </div>

      <div
        class="flex items-center mt-2 px-2 py-1 bg-gray-100 rounded-lg border border-gray-200"
      >
        <input
          id="idealMode"
          type="checkbox"
          v-model.number="isIdealMode"
          class="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
        />
        <label
          for="idealMode"
          class="ml-2 block text-sm font-medium text-gray-700"
        >
          แสดงผลในอุดมคติ (Ideal Mode)
          <span
            v-if="!isIdealMode"
            class="text-xs text-red-500 ml-1 font-semibold"
            >(ผลลัพธ์ลดลง 40%)</span
          >
        </label>
      </div>
    </div>

    <hr class="border-gray-300 my-4" />

    <div
      class="result-box detail-result bg-white p-4 rounded-xl shadow-lg mb-4"
    >
      <div
        @click="isATRRecsOpen = !isATRRecsOpen"
        class="flex justify-between items-center cursor-pointer pb-2 border-b border-gray-200"
      >
        <h3 class="font-medium text-gray-700">
          2. ATR Grid Recommendations <br />({{
            (priceUpper - priceLower).toFixed(0)
          }}
          USDT Range)
        </h3>
        <svg
          class="w-5 h-5 transition-transform duration-300"
          :class="{ 'rotate-180': isATRRecsOpen }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 9l-7 7-7-7"
          ></path>
        </svg>
      </div>

      <div v-show="isATRRecsOpen">
        <div
          v-if="atrValue > 0 && priceUpper > priceLower"
          class="space-y-3 pt-3"
        >
          <div
            v-for="(result, type) in atrRecommendations"
            :key="type"
            class="border rounded-lg p-3"
            :class="{
              'border-red-400 bg-red-50': type === 'Aggressive',
              'border-green-400 bg-green-50': type === 'Balanced',
              'border-blue-400 bg-blue-50': type === 'Conservative',
            }"
          >
            <p
              class="font-bold text-sm mb-1 flex justify-between items-center"
              :class="{
                'text-red-700': type === 'Aggressive',
                'text-green-700': type === 'Balanced',
                'text-blue-700': type === 'Conservative',
              }"
            >
              {{ typeLabels[type] }}
              <span class="float-right text-xs font-normal flex items-center">
                <input
                  :id="'factor' + type"
                  type="number"
                  :value="getFactorRef(type).value"
                  @input="updateFactor(type, $event.target.value)"
                  min="0.01"
                  step="0.01"
                  class="w-16 p-1 border rounded-lg text-sm text-center font-bold"
                  :class="{
                    'border-red-400 focus:ring-red-500': type === 'Aggressive',
                    'border-green-400 focus:ring-green-500':
                      type === 'Balanced',
                    'border-blue-400 focus:ring-blue-500':
                      type === 'Conservative',
                  }"
                />
                <span class="ml-1">x ATR</span>
              </span>
            </p>

            <div class="text-xs text-gray-500 mb-2 mt-1">
              <span class="font-medium">Gap ที่แนะนำ:</span>
              <span class="font-semibold"
                >{{ result.recommendedGap.toFixed(2) }} USDT</span
              >
            </div>

            <table class="w-full text-sm mt-2 border-t border-dotted">
              <tbody>
                <tr>
                  <td class="pt-2 pb-1 text-gray-600">ทุน/ไม้:</td>
                  <td
                    class="pt-2 pb-1 text-right font-bold text-base text-gray-800"
                  >
                    {{ result.investmentPerGrid.toFixed(2) }} USDT
                  </td>
                </tr>
                <tr>
                  <td class="py-1 text-gray-600">Grids:</td>
                  <td class="py-1 text-right font-bold text-base">
                    {{ result.grids }}
                  </td>
                </tr>
                <tr>
                  <td class="py-1 text-gray-600">Trades/Day (Expected):</td>
                  <td
                    class="py-1 text-right font-bold text-base"
                    :class="{
                      'text-red-500': !isIdealMode,
                      'text-green-600': isIdealMode,
                    }"
                  >
                    {{ result.expectedTrades.toFixed(1) }}
                  </td>
                </tr>
                <tr>
                  <td class="pt-2 text-gray-600">Net Profit/Grid:</td>
                  <td class="pt-2 text-right font-bold">
                    {{ result.netProfit.toFixed(4) }} USDT
                    <span class="text-gray-600 font-normal"
                      >({{ result.netProfitPct.toFixed(2) }}%)</span
                    >
                  </td>
                </tr>
                <tr class="border-t border-dotted">
                  <td class="py-1 text-gray-600">Profit/Day:</td>
                  <td
                    class="py-1 text-right font-bold text-base text-purple-700"
                  >
                    {{ result.profitPerDay.toFixed(2) }} USDT
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-else class="text-center text-gray-500 py-4 text-sm">
          โปรดกรอก ATR และกำหนดช่วงราคาเพื่อดูคำแนะนำ
        </div>
      </div>
    </div>

    <hr class="border-gray-300 my-4" />

    <div
      class="result-box detail-result bg-white p-4 rounded-xl shadow-lg mb-4"
    >
      <div
        @click="isGoalSeekerOpen = !isGoalSeekerOpen"
        class="flex justify-between items-center cursor-pointer pb-2 border-b border-gray-200"
      >
        <h3 class="font-medium text-gray-700">
          3. ATR Goal Seeker (ค้นหากริดตามเป้าหมาย)
        </h3>
        <svg
          class="w-5 h-5 transition-transform duration-300"
          :class="{ 'rotate-180': isGoalSeekerOpen }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 9l-7 7-7-7"
          ></path>
        </svg>
      </div>

      <div v-show="isGoalSeekerOpen">
        <div class="space-y-3 pt-3">
          <div class="flex flex-col items-center">
            <div class="input-group w-full max-w-xs mb-2">
              <label
                for="dailyGoalPct"
                class="block text-sm font-medium text-gray-700 mb-1 text-center"
              >
                เป้าหมายกำไร/วัน
                <span class="text-blue-600 font-semibold">(% ทุน)</span>:
              </label>
              <input
                id="dailyGoalPct"
                type="number"
                v-model.number="dailyGoalPct"
                min="0.01"
                step="0.01"
                class="w-full p-2 border border-blue-600 rounded-lg text-lg text-center focus:ring-blue-500 focus:border-blue-500 font-bold"
              />
            </div>
            <p class="text-sm text-gray-700 font-medium">
              = {{ dailyGoalUSDT.toFixed(2) }} USDT
            </p>
          </div>
        </div>

        <div v-if="goalSeekerResults.length > 0" class="space-y-3 mt-4">
          <p
            class="text-sm text-center text-gray-700 font-semibold border-b pb-2"
          >
            ต้องการ {{ dailyGoalUSDT.toFixed(2) }} USDT ({{
              dailyGoalPct.toFixed(2)
            }}%)
          </p>

          <div
            v-for="(result, index) in goalSeekerResults"
            :key="index"
            class="border rounded-lg p-3 bg-indigo-50 border-indigo-400"
          >
            <p class="font-bold text-sm text-indigo-700 mb-2">
              {{ result.label }}
            </p>

            <table class="w-full text-sm mt-2 border-t border-dotted">
              <tbody>
                <tr>
                  <td class="pt-2 pb-1 text-gray-600">Trades/Day (Target):</td>
                  <td class="pt-2 pb-1 text-right font-bold text-base">
                    {{ result.tradesPerDay.toFixed(1) }}
                  </td>
                </tr>
                <tr>
                  <td class="py-1 text-gray-600">Grids ที่ต้องใช้:</td>
                  <td class="py-1 text-right font-bold text-lg text-blue-700">
                    {{ result.requiredGrids }}
                  </td>
                </tr>
                <tr>
                  <td class="py-1 text-gray-600">ทุน/ไม้ ที่ใช้:</td>
                  <td class="py-1 text-right font-bold text-gray-800">
                    {{ result.finalInvPerGrid.toFixed(2) }} USDT
                  </td>
                </tr>
                <tr>
                  <td class="py-1 text-gray-600">Gap:</td>
                  <td class="py-1 text-right font-bold text-green-700">
                    {{ result.requiredGap.toFixed(2) }} USDT
                  </td>
                </tr>
                <tr>
                  <td class="py-1 text-gray-600">กำไร/Grid:</td>
                  <td class="py-1 text-right font-bold text-red-500">
                    {{ result.finalNetProfit.toFixed(4) }} USDT
                    <span class="text-gray-600 font-normal"
                      >({{ result.finalNetProfitPct.toFixed(2) }}%)</span
                    >
                  </td>
                </tr>
                <tr class="border-t border-dotted">
                  <td class="pt-2 text-gray-600">กำไร/วันที่คำนวณได้:</td>
                  <td class="pt-2 text-right font-bold text-purple-700">
                    {{ result.calculatedDailyProfitUSDT.toFixed(2) }} USDT
                    <span class="text-gray-600 font-normal"
                      >({{ result.calculatedDailyProfitPct.toFixed(2) }}%)</span
                    >
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-else class="text-center text-gray-500 py-4 text-sm">
          โปรดตรวจสอบ ATR, เงินทุน, และเป้าหมายกำไรรายวัน
        </div>
      </div>
    </div>

    <hr class="border-gray-300 my-4" />

    <div class="result-box detail-result bg-white p-4 rounded-xl shadow-lg">
      <h3 class="text-lg font-medium text-center text-gray-700 mb-3">
        4. รายละเอียดการคำนวณ
      </h3>

      <div class="space-y-2 text-sm text-gray-700">
        <div class="flex justify-between border-b pb-1">
          <span class="font-medium">ปริมาณเหรียญต่อกริด (Quantity):</span>
          <span class="font-semibold">{{ quantityPerGrid.toFixed(8) }}</span>
        </div>

        <div class="flex justify-between border-b pb-1">
          <span class="font-medium">ช่วงห่าง/กริด (ณ ราคาล่าง):</span>
          <span class="font-semibold">{{ priceGapLower.toFixed(2) }} USDT</span>
        </div>
        <div
          class="flex justify-between border-b pb-1"
          v-if="gridType === 'Geometric'"
        >
          <span class="font-medium">ช่วงห่าง/กริด (ณ ราคาบน):</span>
          <span class="font-semibold">{{ priceGapUpper.toFixed(2) }} USDT</span>
        </div>

        <div class="flex justify-between border-b pb-1">
          <span class="font-medium">กำไรสุทธิรวม (Potential):</span>
          <span class="font-semibold"
            >{{ totalNetProfit.toFixed(4) }} USDT</span
          >
        </div>
        <div class="flex justify-between border-b pb-1">
          <span class="font-medium">เงินลงทุนต่อไม้:</span>
          <span>{{ investmentPerGrid.toFixed(2) }} USDT</span>
        </div>
        <div class="flex justify-between border-b pb-1">
          <span class="font-medium">กำไรขั้นต้น/ไม้:</span>
          <span>{{ grossProfitPerGrid.toFixed(4) }} USDT</span>
        </div>
        <div class="flex justify-between border-b pb-1">
          <span class="font-medium">ค่าธรรมเนียมรวม/ไม้:</span>
          <span class="text-orange-500 font-semibold"
            >{{ totalFeePerGrid.toFixed(4) }} USDT</span
          >
        </div>
        <div class="flex justify-between">
          <span class="font-medium"
            >{{
              gridType === "Geometric"
                ? "อัตราส่วนต่อกริด (r)"
                : "ระยะห่างคงที่ (Gap)"
            }}:</span
          >
          <span>{{
            gridType === "Geometric"
              ? gridMetrics.ratio.toFixed(6)
              : gridMetrics.gap.toFixed(2)
          }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ไม่มีสไตล์ scoped อีกต่อไป Tailwind จัดการทุกอย่างแล้ว */
</style>
