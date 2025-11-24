<template>
  <div class="app">
    <header class="app__header">
      <h1>Система хранения ключевой информации</h1>
      <p class="app__subtitle">
        SPA на Vue 3 + Vite. Здесь можно посмотреть профиль пользователя, его роли и результат проверки доступа
        через <code>/secure-test</code>.
      </p>
    </header>

    <section class="card">
      <h2 class="card__title">Выбор пользователя</h2>
      <div class="field">
        <label for="userId">userId (UUID):</label>
        <input
          id="userId"
          v-model="userId"
          placeholder="вставь сюда UUID, например, пользователя D"
        />
      </div>

      <div class="buttons">
        <button @click="loadAll" :disabled="!userId || loading">
          Загрузить всё (профиль + роли + secure-test)
        </button>
        <button @click="loadProfile" :disabled="!userId || loading" class="secondary">
          Только профиль
        </button>
        <button @click="loadRoles" :disabled="!userId || loading" class="secondary">
          Только роли
        </button>
        <button @click="runSecureTest" :disabled="!userId || loading" class="secondary">
          Только /secure-test
        </button>
      </div>

      <div v-if="error" class="error">
        Ошибка: {{ error }}
      </div>
    </section>

    <section class="grid">
      <div class="card">
        <h2 class="card__title">Профиль</h2>
        <p class="hint">
          Чувствительные поля (телефон / дата рождения) хранятся в БД в зашифрованном виде,
          а здесь уже отображаются расшифрованные значения.
        </p>
        <div v-if="profileData">
          <div class="profile">
            <div><strong>Имя:</strong> {{ profileData.profile?.full_name || '—' }}</div>
            <div><strong>Телефон:</strong> {{ profileData.profile?.phone || '—' }}</div>
            <div><strong>Дата рождения:</strong> {{ profileData.profile?.birth_date || '—' }}</div>
            <div><strong>Язык UI:</strong> {{ profileData.profile?.settings?.lang || '—' }}</div>
            <div><strong>Тема:</strong> {{ profileData.profile?.settings?.theme || '—' }}</div>
          </div>
        </div>
        <pre v-if="profileRaw">{{ profileRaw }}</pre>
        <div v-else class="empty">Профиль не загружен или отсутствует.</div>
      </div>

      <div class="card">
        <h2 class="card__title">Роли и целостность</h2>
        <p class="hint">
          Для каждой роли проверяется криптографическая подпись (HMAC), рассчитанная через обёртку и ключ из Vault.
          Несоответствие подписи или её отсутствие помечаются как проблема.
        </p>

        <div v-if="rolesData && rolesData.roles.length > 0">
          <div
            v-for="r in rolesData.roles"
            :key="r.id"
            class="role-row"
          >
            <div class="role-row__header">
              <span class="role-row__name">{{ r.role_name }}</span>
              <span
                class="tag"
                :class="r.valid ? 'tag--ok' : 'tag--bad'"
              >
                {{ r.valid ? 'OK' : 'Проблема' }}
              </span>
            </div>
            <div class="role-row__meta">
              <span>
                Подпись:
                <strong>{{ r.has_signature ? 'есть' : 'нет' }}</strong>
              </span>
              <span v-if="r.integrity">Целостность: {{ r.integrity }}</span>
            </div>
            <div class="role-row__reason">
              {{ r.reason }}
            </div>
          </div>
        </div>
        <div v-else class="empty">Роли не загружены или отсутствуют.</div>

        <pre v-if="rolesRaw">{{ rolesRaw }}</pre>
      </div>
    </section>

    <section class="card">
      <h2 class="card__title">Результат /secure-test</h2>
      <p class="hint">
        /secure-test проверяет, есть ли у пользователя валидная роль <code>ADMIN</code> с корректной подписью.
        Если роль подменена в БД или добавлена без подписи, доступ будет запрещён.
      </p>
      <pre v-if="secureTestRaw">{{ secureTestRaw }}</pre>
      <div v-else class="empty">/secure-test ещё не вызывался.</div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { getProfile, getRolesVerify, secureTest } from './api';

const userId = ref('');
const profileData = ref<any | null>(null);
const profileRaw = ref<string | null>(null);
const rolesData = ref<any | null>(null);
const rolesRaw = ref<string | null>(null);
const secureTestRaw = ref<string | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);

async function loadProfile() {
  if (!userId.value) return;
  loading.value = true;
  error.value = null;
  try {
    const data = await getProfile(userId.value);
    profileData.value = data;
    profileRaw.value = JSON.stringify(data, null, 2);
  } catch (e: any) {
    profileData.value = null;
    profileRaw.value = null;
    error.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

async function loadRoles() {
  if (!userId.value) return;
  loading.value = true;
  error.value = null;
  try {
    const data = await getRolesVerify(userId.value);
    rolesData.value = data;
    rolesRaw.value = JSON.stringify(data, null, 2);
  } catch (e: any) {
    rolesData.value = null;
    rolesRaw.value = null;
    error.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

async function runSecureTest() {
  if (!userId.value) return;
  loading.value = true;
  // error здесь не трогаем, чтобы не сбивать сообщения выше
  try {
    const data = await secureTest(userId.value);
    secureTestRaw.value = JSON.stringify(data, null, 2);
  } catch (e: any) {
    // 403 тоже полезен — показываем текст ошибки
    secureTestRaw.value = `Ошибка /secure-test: ${e.message || String(e)}`;
  } finally {
    loading.value = false;
  }
}

async function loadAll() {
  await loadProfile();
  await loadRoles();
  await runSecureTest();
}
</script>

<style scoped>
.app {
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px 24px 40px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f3f4f6;
}

.app__header {
  margin-bottom: 16px;
}

.app__header h1 {
  margin: 0 0 6px;
  font-size: 22px;
}

.app__subtitle {
  margin: 0;
  font-size: 13px;
  color: #4b5563;
}

.card {
  background: #ffffff;
  border-radius: 12px;
  padding: 16px 18px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
  margin-bottom: 16px;
}

.card__title {
  margin: 0 0 8px;
  font-size: 16px;
}

.field {
  margin-bottom: 12px;
}

.field label {
  display: block;
  font-size: 13px;
  margin-bottom: 4px;
}

.field input {
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  font-size: 14px;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

button {
  padding: 6px 10px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  background: #2563eb;
  color: #fff;
}

button.secondary {
  background: #4b5563;
}

button:disabled {
  opacity: 0.6;
  cursor: default;
}

.error {
  font-size: 13px;
  color: #b91c1c;
}

.hint {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 8px;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

pre {
  background: #111827;
  color: #e5e7eb;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 11px;
  overflow-x: auto;
  margin-top: 8px;
}

.empty {
  font-size: 13px;
  color: #9ca3af;
}

.profile {
  font-size: 13px;
  margin-bottom: 6px;
}

.role-row {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
  font-size: 13px;
}

.role-row__header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.role-row__name {
  font-weight: 600;
}

.role-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: #6b7280;
  font-size: 12px;
  margin-bottom: 2px;
}

.role-row__reason {
  font-size: 12px;
  color: #4b5563;
}

.tag {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
}

.tag--ok {
  background: #dcfce7;
  color: #166534;
}

.tag--bad {
  background: #fee2e2;
  color: #991b1b;
}
</style>
