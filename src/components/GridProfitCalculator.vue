<script setup>
import { ref, computed, watchEffect } from "vue";

// ---------------------------------
// 1. สถานะเริ่มต้นและการดึงจาก Local Storage
// ---------------------------------
const getInitialValue = (key, defaultValue) => {
  // ดึงค่าจาก Local Storage, แปลงเป็นตัวเลข ถ้าไม่มีให้ใช้ค่าเริ่มต้น
  const saved = localStorage.getItem(key);
  // ตรวจสอบว่าเป็น string '0' หรือไม่ ก่อนแปลงเป็น Number
  return saved !== null ? Number(saved) : defaultValue;
};
const getInitialString = (key, defaultValue) => {
  const saved = localStorage.getItem(key);
  return saved !== null ? saved : defaultValue;
};

// ใช้ Local Storage สำหรับค่าเริ่มต้น
const gridType = ref(getInitialString("gridType", "Arithmetic"));
const priceUpper = ref(getInitialValue("priceUpper", 130000));
const priceLower = ref(getInitialValue("priceLower", 90000));
const gridCount = ref(getInitialValue("gridCount", 40));
const capital = ref(getInitialValue("capital", 500));
const feeRate = ref(getInitialValue("feeRate", 0.0005));
// ใช้ PriceLower เป็นค่าเริ่มต้นสำหรับราคาอ้างอิง
const currentPrice = ref(getInitialValue("currentPrice", 90000));

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
});

// ---------------------------------
// 3. Computed Properties หลัก (รองรับ 2 Grid Type)
// ---------------------------------

// อัตราส่วนการเติบโต (r) หรือ ระยะห่างที่เป็นเงิน (gap)
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
    // Arithmetic Grid: ระยะห่างที่เป็นหน่วยเงิน
    const gap = priceRange / numGrids;
    return { ratio: 1, gap: gap };
  }
});

// เงินลงทุนต่อกริด (Investment per Grid)
const investmentPerGrid = computed(() => {
  if (gridCount.value <= 0) return 0;
  return capital.value / gridCount.value;
});

// ราคาเฉลี่ยของช่วง (ใช้สำหรับ Quantity และ Fee ใน Arithmetic)
const priceAverage = computed(() => (priceUpper.value + priceLower.value) / 2);

// 4. ปริมาณเหรียญที่ซื้อต่อกริด (Quantity per Grid)
const quantityPerGrid = computed(() => {
  const inv = investmentPerGrid.value;
  let priceRef = 0;

  if (gridType.value === "Arithmetic") {
    // Arithmetic: ใช้ราคาเฉลี่ยเป็นราคาอ้างอิงเพื่อให้ Quantity มีค่าคงที่ที่แม่นยำขึ้น
    priceRef = priceAverage.value;
  } else {
    // Geometric: ใช้ราคาอ้างอิงที่กรอก หรือ Price Lower เป็นค่าเริ่มต้น
    priceRef = currentPrice.value > 0 ? currentPrice.value : priceLower.value;
  }

  if (priceRef <= 0 || inv <= 0) return 0;
  return inv / priceRef;
});

// 5. กำไรขั้นต้นต่อไม้ (Gross Profit per Grid)
const grossProfitPerGrid = computed(() => {
  const inv = investmentPerGrid.value;

  if (gridType.value === "Geometric") {
    const r = gridMetrics.value.ratio;
    if (r <= 1) return 0;
    // Geometric: Inv * (r - 1)
    return inv * (r - 1);
  } else {
    // Arithmetic: Gross Profit = Quantity * Price Gap
    const gap = gridMetrics.value.gap;
    const qty = quantityPerGrid.value;
    return qty * gap;
  }
});

// 6. ค่าธรรมเนียมรวมต่อไม้ (Total Fee per Grid)
const totalFeePerGrid = computed(() => {
  const inv = investmentPerGrid.value;
  const fee = feeRate.value;

  if (gridType.value === "Geometric") {
    const r = gridMetrics.value.ratio;
    // Geometric: Inv * Fee * (1 + r)
    return inv * fee * (1 + r);
  } else {
    // Arithmetic: Total Fee ≈ 2 * (Quantity * Price_Avg) * Fee_Rate
    const qty = quantityPerGrid.value;
    const avgPrice = priceAverage.value;
    const avgTradeVolume = qty * avgPrice;

    // 2 * (มูลค่าเทรดเฉลี่ย) * Fee Rate (สำหรับการซื้อ 1 ขาย 1)
    return 2 * avgTradeVolume * fee;
  }
});

// 7. กำไรสุทธิต่อไม้ และอื่นๆ
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

// ช่วงห่างของราคา ณ กริดล่างสุด
const priceGapLower = computed(() => {
  if (gridType.value === "Geometric") {
    return priceLower.value * (gridMetrics.value.ratio - 1);
  } else {
    return gridMetrics.value.gap;
  }
});

// ช่วงห่างของราคา ณ กริดบนสุด
const priceGapUpper = computed(() => {
  if (gridType.value === "Geometric") {
    const r = gridMetrics.value.ratio;
    return priceUpper.value - priceUpper.value / r;
  } else {
    return gridMetrics.value.gap;
  }
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
        class="metric-display p-4 rounded-lg text-white text-center"
        :class="{
          'bg-green-600': netProfitPerGrid > 0,
          'bg-red-600': netProfitPerGrid <= 0,
        }"
      >
        <p class="text-4xl font-bold leading-none">
          {{ netProfitPerGrid.toFixed(4) }}
          <span class="text-base font-normal align-top ml-1">USDT</span>
        </p>
        <p class="text-lg font-medium mt-1">
          {{ netProfitPercentage.toFixed(4) }} %
        </p>
        <p class="text-sm mt-1" v-if="gridType === 'Arithmetic'">
          (ระยะแต่ละ grid: {{ priceGapLower.toFixed(2) }})
        </p>
      </div>
    </div>

    <hr class="border-gray-300 my-4" />

    <div class="input-section bg-white p-3 rounded-xl shadow-lg">
      <h3 class="text-lg font-medium text-center text-gray-700 mb-3">
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
    </div>

    <hr class="border-gray-300 my-4" />

    <div class="result-box detail-result bg-white p-4 rounded-xl shadow-lg">
      <h3 class="text-lg font-medium text-gray-700 mb-3 text-center">
        2. รายละเอียดการคำนวณ
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
/* แต่เรายังต้องคงโค้ดส่วนนี้ไว้เพื่อไม่ให้เกิด error */
</style>
