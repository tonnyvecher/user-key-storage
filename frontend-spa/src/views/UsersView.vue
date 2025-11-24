<template>
    <div class="card">
      <h2 class="card__title">Пользователи системы</h2>
      <p class="hint">
        Здесь отображаются пользователи из внутренней БД (<code>users</code>),
        а также агрегированный статус целостности их ролей
        (проверка через криптографические подписи и ключи из Vault).
      </p>
  
      <div class="filters">
        <button
          class="filter-btn"
          :class="{ 'filter-btn--active': filter === 'all' }"
          @click="filter = 'all'"
        >
          Все ({{ users.length }})
        </button>
        <button
          class="filter-btn"
          :class="{ 'filter-btn--active': filter === 'ok' }"
          @click="filter = 'ok'"
        >
          Без проблем ({{ okCount }})
        </button>
        <button
          class="filter-btn"
          :class="{ 'filter-btn--active': filter === 'issues' }"
          @click="filter = 'issues'"
        >
          С проблемами ({{ issuesCount }})
        </button>
        <button class="reload-btn" @click="loadUsers" :disabled="loading">
          Обновить
        </button>
      </div>
  
      <div v-if="loading" class="info">Загрузка...</div>
      <div v-if="error" class="error">Ошибка: {{ error }}</div>
  
      <table v-if="filteredUsers.length > 0" class="table">
        <thead>
          <tr>
            <th>email</th>
            <th>active</th>
            <th>ролей</th>
            <th>статус ролей</th>
            <th>создан</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in filteredUsers" :key="u.id">
            <td>{{ u.primary_email }}</td>
            <td>
              <span :class="['pill', u.is_active ? 'pill--ok' : 'pill--bad']">
                {{ u.is_active ? 'активен' : 'неактивен' }}
              </span>
            </td>
            <td>{{ u.roles_count }}</td>
            <td>
              <span
                :class="[
                  'pill',
                  u.has_issues ? 'pill--bad' : 'pill--ok'
                ]"
              >
                {{ u.has_issues ? 'есть проблемы' : 'OK' }}
              </span>
            </td>
            <td>{{ formatDate(u.created_at) }}</td>
            <td>
              <RouterLink :to="`/users/${u.id}`" class="link">
                Открыть
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
  
      <div v-else-if="!loading && !error" class="info">
        Пользователи не найдены под текущей выборкой.
      </div>
    </div>
</template>
  
<script setup lang="ts">
  import { onMounted, ref, computed } from 'vue';
  import { RouterLink } from 'vue-router';
  import { listUsersWithStatus } from '../api';
  
  interface UserStatusRow {
    id: string;
    primary_email: string;
    is_active: boolean;
    created_at: string;
    roles_count: number;
    has_issues: boolean;
  }
  
  const users = ref<UserStatusRow[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const filter = ref<'all' | 'ok' | 'issues'>('all');
  
  function formatDate(iso: string) {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  }
  
  const okCount = computed(() => users.value.filter(u => !u.has_issues).length);
  const issuesCount = computed(() => users.value.filter(u => u.has_issues).length);
  
  const filteredUsers = computed(() => {
    if (filter.value === 'ok') {
      return users.value.filter(u => !u.has_issues);
    }
    if (filter.value === 'issues') {
      return users.value.filter(u => u.has_issues);
    }
    return users.value;
  });
  
  async function loadUsers() {
    loading.value = true;
    error.value = null;
    try {
      const data = await listUsersWithStatus();
      users.value = data.users || [];
    } catch (e: any) {
      error.value = e.message || String(e);
    } finally {
      loading.value = false;
    }
  }
  
  onMounted(loadUsers);
</script>
  
<style scoped>
  .card {
    background: #ffffff;
    border-radius: 12px;
    padding: 16px 18px;
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
  }
  
  .card__title {
    margin: 0 0 8px;
    font-size: 16px;
  }
  
  .hint {
    font-size: 12px;
    color: #6b7280;
    margin-bottom: 8px;
  }
  
  .info {
    font-size: 13px;
    color: #6b7280;
    margin-top: 8px;
  }
  
  .error {
    font-size: 13px;
    color: #b91c1c;
    margin-bottom: 8px;
  }
  
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
    align-items: center;
  }
  
  .filter-btn {
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid #d1d5db;
    background: #f9fafb;
    font-size: 12px;
    cursor: pointer;
  }
  
  .filter-btn--active {
    background: #111827;
    color: #f9fafb;
    border-color: #111827;
  }
  
  .reload-btn {
    margin-left: auto;
    padding: 4px 10px;
    border-radius: 999px;
    border: none;
    font-size: 12px;
    cursor: pointer;
    background: #2563eb;
    color: #fff;
  }
  
  .table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
    font-size: 13px;
  }
  
  .table th,
  .table td {
    padding: 6px 8px;
    border-bottom: 1px solid #e5e7eb;
    text-align: left;
  }
  
  .pill {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 999px;
    font-size: 11px;
  }
  
  .pill--ok {
    background: #dcfce7;
    color: #166534;
  }
  
  .pill--bad {
    background: #fee2e2;
    color: #991b1b;
  }
  
  .link {
    font-size: 13px;
    color: #2563eb;
    text-decoration: none;
  }
  
  .link:hover {
    text-decoration: underline;
  }
</style>
  