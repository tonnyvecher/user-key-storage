<template>
  <div>
    <div class="card">
      <h2 class="card__title">
        {{ isSelf ? "Ваш профиль" : "Профиль пользователя" }}
      </h2>
      <p class="hint">
        Это личный кабинет пользователя. Здесь показываются его профиль, роли и
        результат проверки доступа через
        <code>/secure-test</code>.
      </p>
      <div class="info-row">
        <span class="info-label">userId:</span>
        <span class="info-value mono">{{ userId }}</span>
      </div>
      <button class="btn" @click="loadAll" :disabled="loading">
        Обновить данные
      </button>
      <span v-if="loading" class="loading">Загрузка...</span>
      <div v-if="error" class="error">Ошибка: {{ error }}</div>
    </div>

    <section class="grid">
      <div class="card">
        <h3 class="card__title">Профиль</h3>
        <div v-if="profileData && profileData.profile">
          <div class="profile">
            <div>
              <strong>Имя:</strong> {{ profileData.profile.full_name || "—" }}
            </div>
            <div>
              <strong>Телефон:</strong> {{ profileData.profile.phone || "—" }}
            </div>
            <div>
              <strong>Дата рождения:</strong>
              {{ profileData.profile.birth_date || "—" }}
            </div>
            <div>
              <strong>Язык UI:</strong>
              {{ profileData.profile.settings?.lang || "—" }}
            </div>
            <div>
              <strong>Тема:</strong>
              {{ profileData.profile.settings?.theme || "—" }}
            </div>
          </div>
        </div>
        <div v-else class="empty">Профиль отсутствует.</div>
        <pre v-if="profileRaw">{{ profileRaw }}</pre>
      </div>

      <div class="card">
        <h3 class="card__title">Роли и целостность</h3>
        <div v-if="rolesData && rolesData.roles.length > 0">
          <div v-for="r in rolesData.roles" :key="r.id" class="role-row">
            <div class="role-row__header">
              <span class="role-row__name">{{ r.role_name }}</span>
              <span class="tag" :class="r.valid ? 'tag--ok' : 'tag--bad'">
                {{ r.valid ? "OK" : "Проблема" }}
              </span>
            </div>
            <div class="role-row__meta">
              <span>
                Подпись:
                <strong>{{ r.has_signature ? "есть" : "нет" }}</strong>
              </span>
              <span v-if="r.integrity"> Целостность: {{ r.integrity }} </span>
            </div>
            <div class="role-row__reason">
              {{ r.reason }}
            </div>
          </div>
        </div>
        <div v-else class="empty">Роли отсутствуют.</div>
        <pre v-if="rolesRaw">{{ rolesRaw }}</pre>
      </div>
    </section>

    <section class="card">
      <h3 class="card__title">Результат /secure-test</h3>
      <pre v-if="secureTestRaw">{{ secureTestRaw }}</pre>
      <div v-else class="empty">/secure-test ещё не вызывался.</div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { getProfile, getRolesVerify, secureTest } from "../api";
import { authState } from "../auth";

const route = useRoute();
const userId = computed(() => route.params.id as string);

const shortId = computed(() => userId.value?.slice(0, 8) + "..." || "");

const profileData = ref<any | null>(null);
const profileRaw = ref<string | null>(null);
const rolesData = ref<any | null>(null);
const rolesRaw = ref<string | null>(null);
const secureTestRaw = ref<string | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);

async function loadProfile() {
  if (!userId.value) return;
  const data = await getProfile(userId.value);
  profileData.value = data;
  profileRaw.value = JSON.stringify(data, null, 2);
}

async function loadRoles() {
  if (!userId.value) return;
  const data = await getRolesVerify(userId.value);
  rolesData.value = data;
  rolesRaw.value = JSON.stringify(data, null, 2);
}

async function runSecureTest() {
  if (!userId.value) return;
  const data = await secureTest(userId.value);
  secureTestRaw.value = JSON.stringify(data, null, 2);
}

async function loadAll() {
  if (!userId.value) return;
  loading.value = true;
  error.value = null;
  try {
    await loadProfile();
    await loadRoles();
    await runSecureTest();
  } catch (e: any) {
    error.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

const isSelf = computed(() => authState.internalUserId === route.params.id);

onMounted(loadAll);

// если перешли на другого пользователя по маршруту, перезагружаем данные
watch(userId, () => {
  profileData.value = null;
  rolesData.value = null;
  secureTestRaw.value = null;
  loadAll();
});
</script>

<style scoped>
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

.hint {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 8px;
}

.info-row {
  font-size: 13px;
  margin-bottom: 4px;
}

.info-label {
  color: #6b7280;
  margin-right: 4px;
}

.info-value.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
}

.btn {
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  background: #2563eb;
  color: #fff;
}

.loading {
  margin-left: 8px;
  font-size: 12px;
  color: #6b7280;
}

.error {
  font-size: 13px;
  color: #b91c1c;
  margin-top: 8px;
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

pre {
  background: #111827;
  color: #e5e7eb;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 11px;
  overflow-x: auto;
  margin-top: 8px;
}
</style>
