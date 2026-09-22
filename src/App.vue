<script setup>
// Grid Bot Profit Calc ย้ายไปอยู่ใน TrendBot แล้ว (เมนู Grid)
// หน้านี้แค่พาไปที่ใหม่ — โค้ดคำนวณเดิมยังเก็บไว้ใน components/GridProfitCalculator.vue
// (TrendBot ใช้เทียบว่าตัวเลขของหน้าใหม่ตรงกับหน้าเดิม)
const NEW_URL = "https://trendbot.zneb076.com/grid";
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-gray-50 p-6 text-center">
    <div class="max-w-sm">
      <div class="mb-3 text-4xl">🤖</div>
      <h1 class="mb-2 text-xl font-semibold text-gray-800">Grid Bot Profit Calc ย้ายที่อยู่แล้ว</h1>
      <p class="mb-5 text-sm text-gray-500">ตอนนี้อยู่ใน TrendBot เมนู Grid · กำลังพาไป...</p>
      <a :href="NEW_URL" class="inline-block rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white">ไปหน้าใหม่</a>
      <p class="mt-4 text-xs text-gray-400">{{ NEW_URL }}</p>
    </div>
  </main>
</template>
