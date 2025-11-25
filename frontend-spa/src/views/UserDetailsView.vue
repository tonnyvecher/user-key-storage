<template>
  <div>
    <div class="card">
      <div class="card__header-row">
        <h2 class="card__title">
          {{ isSelf ? "Ваш профиль" : "Профиль пользователя" }}
        </h2>

        <!-- Кнопка редактирования только для самого себя -->
        <button
          v-if="isSelf"
          class="mini-btn mini-btn--primary"
          type="button"
          @click="openEditProfile"
        >
          Редактировать профиль
        </button>
      </div>

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
      <div class="empty" v-else>/secure-test ещё не вызывался.</div>
    </section>

    <!-- МОДАЛКА РЕДАКТИРОВАНИЯ ПРОФИЛЯ (только для isSelf) -->
    <div v-if="editProfileOpen" class="modal">
      <div class="modal__backdrop" @click="closeEditProfile"></div>
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
            @click="saveEditProfile"
            :disabled="profileEditLoading"
          >
            Сохранить
          </button>
          <button
            type="button"
            class="secondary"
            @click="closeEditProfile"
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
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { getProfile, getRolesVerify, secureTest, upsertProfile } from "../api";
import { authState } from "../auth";

const route = useRoute();
const userId = computed(() => route.params.id as string);

const profileData = ref<any | null>(null);
const profileRaw = ref<string | null>(null);
const rolesData = ref<any | null>(null);
const rolesRaw = ref<string | null>(null);
const secureTestRaw = ref<string | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);

const isSelf = computed(() => authState.internalUserId === route.params.id);

// --- состояние модалки редактирования ---
const editProfileOpen = ref(false);
const editPhone = ref("");
const editBirthDate = ref("");
const profileEditLoading = ref(false);
const profileEditError = ref<string | null>(null);
const profileEditSuccess = ref<string | null>(null);

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

// ---- модалка ----
function openEditProfile() {
  if (!isSelf.value) return;

  const currentProfile = profileData.value?.profile || null;
  editPhone.value = currentProfile?.phone || "";
  editBirthDate.value = currentProfile?.birth_date || "";

  profileEditError.value = null;
  profileEditSuccess.value = null;
  editProfileOpen.value = true;
}

function closeEditProfile() {
  if (profileEditLoading.value) return;
  editProfileOpen.value = false;
}

async function saveEditProfile() {
  if (!isSelf.value || !userId.value) {
    profileEditError.value = "Редактировать профиль можно только для себя.";
    return;
  }

  const currentProfile = profileData.value?.profile || {};

  const payload = {
    // full_name не меняем с фронта — берём текущее значение
    full_name: currentProfile.full_name ?? null,
    phone: editPhone.value || null,
    birth_date: editBirthDate.value || null,
    settings: currentProfile.settings ?? null,
  };

  profileEditLoading.value = true;
  profileEditError.value = null;
  profileEditSuccess.value = null;

  try {
    const data = await upsertProfile(userId.value, payload);
    profileData.value = data;
    profileRaw.value = JSON.stringify(data, null, 2);
    profileEditSuccess.value = "Профиль успешно обновлён.";
    editProfileOpen.value = false;
  } catch (e: any) {
    profileEditError.value = e.message || String(e);
  } finally {
    profileEditLoading.value = false;
  }
}

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

.card__header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
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

.success {
  font-size: 13px;
  color: #15803d;
  margin-top: 4px;
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

/* модалка */
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

.field {
  margin-bottom: 10px;
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
</style>
