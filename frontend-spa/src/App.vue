<template>
  <div class="layout">
    <header class="layout__header">
      <div class="layout__brand">
        <div class="layout__title">User Key Storage</div>
        <div class="layout__subtitle">
          Дипломная система хранения ключевой информации
        </div>
      </div>
      <nav class="layout__nav">
        <RouterLink to="/" class="nav-link" active-class="nav-link--active" exact>Диагностика</RouterLink>
        <RouterLink to="/users" class="nav-link" active-class="nav-link--active">Пользователи</RouterLink>
      </nav>
    </header>

    <main class="layout__main">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<style scoped>
.layout {
  min-height: 100vh;
  background: #f3f4f6;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.layout__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  background: #111827;
  color: #e5e7eb;
}

.layout__brand {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.layout__title {
  font-size: 18px;
  font-weight: 600;
}

.layout__subtitle {
  font-size: 12px;
  color: #9ca3af;
}

.layout__nav {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.nav-link {
  color: #e5e7eb;
  font-size: 13px;
  text-decoration: none;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
}

.nav-link--active {
  background: #f97316;
  color: #111827;
  border-color: #f97316;
}

.layout__main {
  max-width: 1100px;
  margin: 16px auto 32px;
  padding: 0 16px;
}
</style>
