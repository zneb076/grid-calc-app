<script setup>
import { ref, computed } from "vue";

// ---------------------------------
// 1. ตัวแปรสำหรับรับค่า Input (Reactive)
// ---------------------------------
const priceUpper = ref(130000);
const priceLower = ref(90000);
const gridCount = ref(40);
const capital = ref(500);
const feeRate = ref(0.0005);

// ---------------------------------
// 2. Computed Properties สำหรับการคำนวณ
// ---------------------------------

// อัตราส่วนการเติบโตต่อกริด (r)
const ratioPerGrid = computed(() => {
  if (priceUpper.value <= priceLower.value || gridCount.value <= 0) {
    return 1;
  }
  const R = priceUpper.value / priceLower.value;
  const numGrids = gridCount.value;
  return Math.pow(R, 1 / numGrids);
});

// เงินลงทุนต่อกริด (Investment per Grid)
const investmentPerGrid = computed(() => {
  if (gridCount.value <= 0) return 0;
  return capital.value / gridCount.value;
});

// กำไรขั้นต้นต่อไม้ (Gross Profit per Grid)
const grossProfitPerGrid = computed(() => {
  const r = ratioPerGrid.value;
  const inv = investmentPerGrid.value;
  if (r <= 1) return 0;
  // สูตรประมาณการ: Inv * (r - 1)
  return inv * (r - 1);
});

// ค่าธรรมเนียมรวมต่อไม้ (Total Fee per Grid)
const totalFeePerGrid = computed(() => {
  const r = ratioPerGrid.value;
  const inv = investmentPerGrid.value;
  // สูตรประมาณการ: Inv * Fee Rate * (1 + r)
  return inv * feeRate.value * (1 + r);
});

// กำไรสุทธิต่อไม้ (Net Profit per Grid)
const netProfitPerGrid = computed(() => {
  const grossProfit = grossProfitPerGrid.value;
  const totalFee = totalFeePerGrid.value;
  return grossProfit - totalFee;
});

// กำไรสุทธิรวม (Total Net Profit Potential)
const totalNetProfit = computed(() => {
  if (gridCount.value <= 1) return 0;
  // กำไรสุทธิ/ไม้ * (จำนวนกริด - 1)
  return netProfitPerGrid.value * (gridCount.value - 1);
});

// % กำไรสุทธิ/ไม้ (เทียบกับเงินลงทุนต่อไม้)
const netProfitPercentage = computed(() => {
  const netProfit = netProfitPerGrid.value;
  const inv = investmentPerGrid.value;
  if (inv === 0) return 0;
  return (netProfit / inv) * 100;
});
</script>

<template>
  <div class="grid-calc-container max-w-lg mx-auto p-4 bg-gray-50 min-h-screen">
    <h2
      class="app-title text-center text-xl font-semibold text-gray-800 mb-4 pt-4"
    >
      🤖 Grid Bot Profit Calc
    </h2>

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
        <p class="text-4xl font-bold leading-none">
          {{ netProfitPerGrid.toFixed(4) }}
          <span class="text-base font-normal align-top ml-1">USDT</span>
        </p>
        <p class="text-lg font-medium mt-1">
          {{ netProfitPercentage.toFixed(4) }} %
        </p>
      </div>
    </div>

    <hr class="border-gray-300 my-4" />

    <div class="input-section bg-white p-3 rounded-xl shadow-lg">
      <h3 class="text-lg font-medium text-center text-gray-700 mb-3">
        1. Input Parameters
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

      <div class="input-group">
        <label
          for="feeRate"
          class="block text-xs font-medium text-gray-600 mb-1"
          >Fee Rate (0.0005):</label
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
    </div>

    <hr class="border-gray-300 my-4" />

    <div class="result-box detail-result bg-white p-4 rounded-xl shadow-lg">
      <h3 class="text-lg font-medium text-gray-700 mb-3 text-center">
        2. รายละเอียดการคำนวณ
      </h3>

      <div class="space-y-2 text-sm text-gray-700">
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
          <span class="font-medium">อัตราส่วนต่อกริด (r):</span>
          <span>{{ ratioPerGrid.toFixed(6) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
