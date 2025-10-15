<script setup>
import GridProfitCalculator from "./components/GridProfitCalculator.vue";
</script>

<template>
  <main>
    <GridProfitCalculator />
  </main>
</template>

<style scoped>
/* ลบ style ที่ไม่จำเป็นออก */
main {
  padding: 0;
  margin: 0;
  /* ทำให้แอปเต็มหน้าจอบนมือถือ */
  min-height: 100vh;
  background-color: #f0f2f5;
}
</style>
