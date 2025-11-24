<template>
    <div class="card">
      <h2 class="card__title">Пользователи системы</h2>
      <p class="hint">
        Здесь отображаются пользователи из нашей внутренней БД (<code>users</code>).
        Позже сюда добавим индикатор проблем с ролями.
      </p>
  
      <div v-if="loading" class="info">Загрузка...</div>
      <div v-if="error" class="error">Ошибка: {{ error }}</div>
  
      <table v-if="users.length > 0" class="table">
        <thead>
          <tr>
            <th>email</th>
            <th>active</th>
            <th>created_at</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.primary_email }}</td>
            <td>
              <span :class="['pill', u.is_active ? 'pill--ok' : 'pill--bad']">
                {{ u.is_active ? 'активен' : 'неактивен' }}
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
        Пользователи не найдены.
      </div>
    </div>
  </template>
  
  <script setup lang="ts">
  import { onMounted, ref } from 'vue';
  import { RouterLink } from 'vue-router';
  import { listUsers } from '../api';
  
  interface UserRow {
    id: string;
    primary_email: string;
    is_active: boolean;
    created_at: string;
  }
  
  const users = ref<UserRow[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  
  function formatDate(iso: string) {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  }
  
  async function loadUsers() {
    loading.value = true;
    error.value = null;
    try {
      const data = await listUsers();
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
  }
  
  .error {
    font-size: 13px;
    color: #b91c1c;
    margin-bottom: 8px;
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
  