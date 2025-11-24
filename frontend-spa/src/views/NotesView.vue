<template>
    <div class="card">
      <h2 class="card__title">Заметки с уровнем доступа</h2>
      <p class="hint">
        Здесь можно создавать заметки с минимальной ролью доступа (USER / MANAGER / ADMIN / SUPERADMIN / OWNER).
        Доступ к заметкам определяется максимальной валидной ролью пользователя в нашей системе.
      </p>
  
      <section class="section">
        <h3 class="section__title">1. Выбор пользователя</h3>
        <div class="field">
          <label for="userId">userId (UUID):</label>
          <input
            id="userId"
            v-model="userId"
            placeholder="вставь сюда UUID пользователя (например, D)"
          />
        </div>
        <button class="btn" @click="loadContext" :disabled="!userId || loading">
          Загрузить роли и заметки для пользователя
        </button>
        <span v-if="loading" class="loading">Загрузка...</span>
        <div v-if="error" class="error">Ошибка: {{ error }}</div>
  
        <div v-if="userMaxRoleRank !== null" class="info">
          Максимальная роль (по валидным подписям):
          <strong>{{ maxRoleName || 'нет валидных ролей' }}</strong>
        </div>
        <div v-if="validRoles.length" class="info">
          Доступные роли пользователя:
          <span class="pill pill--ok" v-for="r in validRoles" :key="r.role_name">
            {{ r.role_name }}
          </span>
        </div>
      </section>
  
      <section class="section">
        <h3 class="section__title">2. Создать заметку</h3>
        <p class="hint">
          Пользователь может создавать заметки только с <strong>min_role</strong>, не превышающей его максимальную роль.
        </p>
  
        <div class="field">
          <label for="title">Заголовок:</label>
          <input id="title" v-model="newTitle" />
        </div>
  
        <div class="field">
          <label for="body">Текст заметки:</label>
          <textarea id="body" v-model="newBody" rows="3" />
        </div>
  
        <div class="field">
          <label for="minRole">Минимальная роль для доступа:</label>
          <select id="minRole" v-model="newMinRole">
            <option disabled value="">-- выбери роль --</option>
            <option
              v-for="r in availableMinRoles"
              :key="r"
              :value="r"
            >
              {{ r }}
            </option>
          </select>
        </div>
  
        <button class="btn" @click="submitNote" :disabled="!canCreateNote">
          Создать заметку
        </button>
  
        <div v-if="noteError" class="error">Ошибка при создании заметки: {{ noteError }}</div>
        <div v-if="noteSuccess" class="success">{{ noteSuccess }}</div>
      </section>
  
      <section class="section">
        <h3 class="section__title">3. Доступные заметки для выбранного пользователя</h3>
        <div v-if="notes.length === 0 && !loading" class="info">
          Заметок пока нет или доступных заметок для этого пользователя нет.
        </div>
  
        <div v-for="n in notes" :key="n.id" class="note">
          <div class="note__header">
            <div class="note__title">{{ n.title }}</div>
            <span class="pill">
              min_role: <strong>{{ n.min_role }}</strong>
            </span>
          </div>
          <div class="note__meta">
            <span>owner: <code>{{ shortId(n.owner_user_id) }}</code></span>
            <span>создано: {{ formatDate(n.created_at) }}</span>
          </div>
          <div class="note__body">
            {{ n.body }}
          </div>
        </div>
      </section>
    </div>
</template>
  
<script setup lang="ts">
  import { computed, ref } from 'vue';
  import { getRolesVerify, listNotes, createNote } from '../api';
  
  const userId = ref('');
  const loading = ref(false);
  const error = ref<string | null>(null);
  
  const rolesData = ref<any | null>(null);
  const userMaxRoleRank = ref<number | null>(null);
  
  const notes = ref<any[]>([]);
  
  const newTitle = ref('');
  const newBody = ref('');
  const newMinRole = ref('');
  const noteError = ref<string | null>(null);
  const noteSuccess = ref<string | null>(null);
  
  const validRoles = computed(() =>
    (rolesData.value?.roles || []).filter((r: any) => r.valid)
  );
  
  const ROLE_RANK: Record<string, number> = {
    USER: 1,
    MANAGER: 2,
    ADMIN: 3,
    SUPERADMIN: 4,
    OWNER: 5
  };
  
  const maxRoleName = computed(() => {
    if (!validRoles.value.length) return '';
    let best = '';
    let bestRank = 0;
    for (const r of validRoles.value) {
      const name = String(r.role_name || '').toUpperCase();
      const rank = ROLE_RANK[name] || 0;
      if (rank > bestRank) {
        bestRank = rank;
        best = name;
      }
    }
    return best;
  });
  
  const availableMinRoles = computed(() => {
    const maxName = maxRoleName.value;
    if (!maxName) return [];
    const maxRank = ROLE_RANK[maxName] || 0;
    return Object.entries(ROLE_RANK)
      .filter(([_, rank]) => rank <= maxRank)
      .map(([name]) => name);
  });
  
  const canCreateNote = computed(() => {
    return (
      userId.value &&
      newTitle.value.trim().length > 0 &&
      newBody.value.trim().length > 0 &&
      newMinRole.value &&
      availableMinRoles.value.includes(newMinRole.value)
    );
  });
  
  function shortId(id: string) {
    if (!id) return '';
    return id.slice(0, 8) + '...';
  }
  
  function formatDate(iso: string) {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  }
  
  async function loadContext() {
    if (!userId.value) return;
    loading.value = true;
    error.value = null;
    noteError.value = null;
    noteSuccess.value = null;
  
    try {
      // 1) загружаем роли и считаем max
      const roles = await getRolesVerify(userId.value);
      rolesData.value = roles;
  
      let maxRank = 0;
      for (const r of roles.roles || []) {
        if (r.valid) {
          const name = String(r.role_name || '').toUpperCase();
          const rank = ROLE_RANK[name] || 0;
          if (rank > maxRank) maxRank = rank;
        }
      }
      userMaxRoleRank.value = maxRank || null;
  
      // 2) загружаем заметки, которые backend разрешает этому пользователю
      const notesRes = await listNotes(userId.value);
      notes.value = notesRes.notes || [];
  
    } catch (e: any) {
      error.value = e.message || String(e);
    } finally {
      loading.value = false;
    }
  }
  
  async function submitNote() {
    if (!canCreateNote.value) return;
    noteError.value = null;
    noteSuccess.value = null;
  
    try {
      await createNote(userId.value, {
        title: newTitle.value.trim(),
        body: newBody.value.trim(),
        min_role: newMinRole.value
      });
      noteSuccess.value = 'Заметка создана';
  
      newTitle.value = '';
      newBody.value = '';
      newMinRole.value = '';
  
      // перезагружаем список заметок
      const notesRes = await listNotes(userId.value);
      notes.value = notesRes.notes || [];
    } catch (e: any) {
      noteError.value = e.message || String(e);
    }
  }
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
    font-size: 18px;
  }
  
  .hint {
    font-size: 12px;
    color: #6b7280;
    margin-bottom: 8px;
  }
  
  .section {
    margin-top: 12px;
    margin-bottom: 12px;
    border-top: 1px solid #e5e7eb;
    padding-top: 10px;
  }
  
  .section__title {
    margin: 0 0 6px;
    font-size: 15px;
  }
  
  .field {
    margin-bottom: 8px;
  }
  
  .field label {
    display: block;
    font-size: 13px;
    margin-bottom: 4px;
  }
  
  .field input,
  .field textarea,
  .field select {
    width: 100%;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid #d1d5db;
    font-size: 14px;
  }
  
  .btn {
    padding: 6px 10px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-size: 13px;
    background: #2563eb;
    color: #fff;
    margin-top: 2px;
  }
  
  .loading {
    margin-left: 8px;
    font-size: 12px;
    color: #6b7280;
  }
  
  .error {
    font-size: 13px;
    color: #b91c1c;
    margin-top: 6px;
  }
  
  .success {
    font-size: 13px;
    color: #15803d;
    margin-top: 6px;
  }
  
  .info {
    font-size: 13px;
    color: #4b5563;
    margin-top: 6px;
  }
  
  .pill {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 999px;
    font-size: 11px;
    margin-right: 4px;
    background: #e5e7eb;
    color: #111827;
  }
  
  .pill--ok {
    background: #dcfce7;
    color: #166534;
  }
  
  .note {
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 8px 10px;
    margin-top: 8px;
    font-size: 13px;
  }
  
  .note__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }
  
  .note__title {
    font-weight: 600;
  }
  
  .note__meta {
    font-size: 12px;
    color: #6b7280;
    display: flex;
    gap: 12px;
    margin-bottom: 4px;
  }
  
  .note__body {
    white-space: pre-wrap;
  }
</style>
  