<template>
  <div class="app">
    <header class="app__header">
      <h1>Диагностика пользователя</h1>
      <p class="app__subtitle">
        Введите <code>userId</code> (UUID) и получите профиль, роли с проверкой
        подписи и результат доступа через <code>/secure-test</code>.
      </p>
    </header>

    <section class="card">
      <h2 class="card__title">Выбор пользователя</h2>
      <div class="field">
        <label for="userId">userId (UUID):</label>
        <div class="field__row">
          <input id="userId" v-model="userId" placeholder="вставь сюда UUID" />
          <button
            class="mini-btn"
            type="button"
            @click="if (myUserId) userId = myUserId;"
            :disabled="!myUserId"
          >
            Мой id
          </button>
        </div>
      </div>

      <div class="buttons">
        <button @click="loadAll" :disabled="!userId || loading">
          Загрузить всё (профиль + роли + secure-test)
        </button>
        <button
          @click="loadProfile"
          :disabled="!userId || loading"
          class="secondary"
        >
          Только профиль
        </button>
        <button
          @click="loadRoles"
          :disabled="!userId || loading"
          class="secondary"
        >
          Только роли
        </button>
        <button
          @click="runSecureTest"
          :disabled="!userId || loading"
          class="secondary"
        >
          Только /secure-test
        </button>
      </div>

      <div v-if="error" class="error">Ошибка: {{ error }}</div>
    </section>

    <section class="grid">
      <div class="card">
        <div class="card__header-row">
          <h2 class="card__title">Профиль</h2>
          <!-- Кнопка редактирования только для текущего залогиненного пользователя -->
          <button
            v-if="
              myUserId &&
              userId === myUserId &&
              profileData &&
              profileData.profile
            "
            type="button"
            class="mini-btn mini-btn--primary"
            @click="openEditMyProfile"
          >
            Редактировать мой профиль
          </button>
        </div>
        <p class="hint">
          Чувствительные поля (телефон / дата рождения) хранятся в БД в
          зашифрованном виде, а здесь уже отображаются расшифрованные значения.
        </p>
        <div v-if="profileData && profileData.profile">
          <div class="profile">
            <div>
              <strong>Имя:</strong> {{ profileData.profile?.full_name || "—" }}
            </div>
            <div>
              <strong>Телефон:</strong> {{ profileData.profile?.phone || "—" }}
            </div>
            <div>
              <strong>Дата рождения:</strong>
              {{ profileData.profile?.birth_date || "—" }}
            </div>
            <div>
              <strong>Язык UI:</strong>
              {{ profileData.profile?.settings?.lang || "—" }}
            </div>
            <div>
              <strong>Тема:</strong>
              {{ profileData.profile?.settings?.theme || "—" }}
            </div>
          </div>
        </div>
        <pre v-if="profileRaw">{{ profileRaw }}</pre>
        <div v-else class="empty">Профиль не загружен или отсутствует.</div>
      </div>

      <div class="card">
        <h2 class="card__title">Роли и целостность</h2>
        <p class="hint">
          Для каждой роли проверяется криптографическая подпись (HMAC) через
          ключ из Vault. Несоответствие подписи или её отсутствие помечаются как
          проблема.
        </p>

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
        /secure-test проверяет, есть ли у пользователя валидная роль
        <code>ADMIN</code> с корректной подписью.
      </p>
      <pre v-if="secureTestRaw">{{ secureTestRaw }}</pre>
      <div v-else class="empty">/secure-test ещё не вызывался.</div>
    </section>

    <!-- Модалка редактирования моего профиля -->
    <div v-if="editMyProfileOpen" class="modal">
      <div class="modal__backdrop" @click="closeEditMyProfile"></div>
      <div class="modal__content">
        <h3 class="modal__title">Редактирование профиля</h3>
        <p class="hint">
          Здесь можно обновить только телефон и дату рождения. Имя берётся из
          Keycloak и изменяется через учётную запись в Keycloak.
        </p>

        <div class="field">
          <label for="editPhone">Телефон:</label>
          <input id="editPhone" v-model="editPhone" placeholder="+7999..." />
        </div>

        <div class="field">
          <label for="editBirth">Дата рождения (YYYY-MM-DD):</label>
          <input
            id="editBirth"
            v-model="editBirthDate"
            placeholder="1990-01-01"
          />
        </div>

        <div class="modal__buttons">
          <button
            type="button"
            @click="saveEditMyProfile"
            :disabled="profileEditLoading"
          >
            Сохранить
          </button>
          <button
            type="button"
            class="secondary"
            @click="closeEditMyProfile"
            :disabled="profileEditLoading"
          >
            Отмена
          </button>
        </div>

        <div v-if="profileEditError" class="error">
          {{ profileEditError }}
        </div>
        <div v-if="profileEditSuccess" class="success">
          {{ profileEditSuccess }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { getProfile, getRolesVerify, secureTest, upsertProfile } from "../api";
import { authState } from "../auth";

const userId = ref("");
const profileData = ref<any | null>(null);
const profileRaw = ref<string | null>(null);
const rolesData = ref<any | null>(null);
const rolesRaw = ref<string | null>(null);
const secureTestRaw = ref<string | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);

const myUserId = computed(() => authState.internalUserId);

// --- состояние модалки редактирования профиля текущего пользователя ---
const editMyProfileOpen = ref(false);
const editPhone = ref("");
const editBirthDate = ref("");
const profileEditLoading = ref(false);
const profileEditError = ref<string | null>(null);
const profileEditSuccess = ref<string | null>(null);

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
  try {
    const data = await secureTest(userId.value);
    secureTestRaw.value = JSON.stringify(data, null, 2);
  } catch (e: any) {
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

// --- модалка редактирования профиля ---
function openEditMyProfile() {
  if (!myUserId.value) return;

  const currentProfile = profileData.value?.profile || null;
  editPhone.value = currentProfile?.phone || "";
  editBirthDate.value = currentProfile?.birth_date || "";

  profileEditError.value = null;
  profileEditSuccess.value = null;
  editMyProfileOpen.value = true;
}

function closeEditMyProfile() {
  if (profileEditLoading.value) return;
  editMyProfileOpen.value = false;
}

async function saveEditMyProfile() {
  if (!myUserId.value) {
    profileEditError.value = "Сначала авторизуйтесь через Keycloak.";
    return;
  }

  const currentProfile = profileData.value?.profile || {};

  const payload = {
    // full_name НЕ меняем с фронта: берём текущее значение,
    // чтобы не затирать его null'ом.
    full_name: currentProfile.full_name ?? null,
    phone: editPhone.value || null,
    birth_date: editBirthDate.value || null,
    // настройки тоже не трогаем с UI — просто прокидываем как есть
    settings: currentProfile.settings ?? null,
  };

  profileEditLoading.value = true;
  profileEditError.value = null;
  profileEditSuccess.value = null;

  try {
    const data = await upsertProfile(myUserId.value, payload);

    // обновляем локальное состояние профиля / JSON
    profileData.value = data;
    profileRaw.value = JSON.stringify(data, null, 2);

    profileEditSuccess.value = "Профиль успешно обновлён.";
    editMyProfileOpen.value = false;
  } catch (e: any) {
    profileEditError.value = e.message || String(e);
  } finally {
    profileEditLoading.value = false;
  }
}
</script>

<style scoped>
.app__header {
  margin-bottom: 16px;
}

.app__header h1 {
  margin: 0 0 6px;
  font-size: 20px;
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

.card__header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
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

.success {
  font-size: 13px;
  color: #15803d;
  margin-top: 4px;
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

.field__row {
  display: flex;
  gap: 6px;
}

.mini-btn {
  padding: 4px 8px;
  font-size: 11px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  background: #e5e7eb;
}

.mini-btn--primary {
  background: #2563eb;
  color: #ffffff;
}

/* --- модалка --- */
.modal {
  position: fixed;
  inset: 0;
  z-index: 50;
}

.modal__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
}

.modal__content {
  position: absolute;
  inset: 0;
  margin: auto;
  max-width: 420px;
  max-height: 320px;
  background: #ffffff;
  border-radius: 12px;
  padding: 16px 18px;
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.25);
  display: flex;
  flex-direction: column;
}

.modal__title {
  margin: 0 0 8px;
  font-size: 16px;
}

.modal__buttons {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
