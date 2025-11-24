<template>
    <div class="card">
      <h2 class="card__title">Заметки с уровнем доступа</h2>
      <p class="hint">
        Здесь можно создавать заметки с минимальной ролью доступа (USER / MANAGER / ADMIN / SUPERADMIN / OWNER).
        Доступ к заметкам определяется максимальной валидной ролью пользователя в нашей системе.
        Редактировать заметку может только её владелец и только в пределах своей максимальной роли.
      </p>
  
      <!-- 1. Выбор пользователя -->
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
  
      <!-- 2. Создание заметки -->
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
  
      <!-- 3. Список заметок + редактирование -->
      <section class="section">
        <h3 class="section__title">3. Доступные заметки для выбранного пользователя</h3>
        <div v-if="notes.length === 0 && !loading" class="info">
          Заметок пока нет или доступных заметок для этого пользователя нет.
        </div>
  
        <div v-for="n in notes" :key="n.id" class="note">
          <div class="note__header">
            <div class="note__title" v-if="editingNoteId !== n.id">
              {{ n.title }}
            </div>
            <div class="note__title" v-else>
              <input v-model="editTitle" />
            </div>
  
            <span class="pill">
              min_role:
              <strong v-if="editingNoteId !== n.id">{{ n.min_role }}</strong>
              <select v-else v-model="editMinRole" class="min-role-select">
                <option
                  v-for="r in availableMinRoles"
                  :key="r"
                  :value="r"
                >
                  {{ r }}
                </option>
              </select>
            </span>
          </div>
  
          <div class="note__meta">
            <span>owner: <code>{{ shortId(n.owner_user_id) }}</code></span>
            <span>создано: {{ formatDate(n.created_at) }}</span>
          </div>
  
          <div class="note__body" v-if="editingNoteId !== n.id">
            {{ n.body }}
          </div>
          <div class="note__body" v-else>
            <textarea v-model="editBody" rows="3" />
          </div>
  
          <div class="note__actions" v-if="userId && String(n.owner_user_id) === String(userId)">
            <button
              v-if="editingNoteId !== n.id"
              class="btn btn--small"
              @click="startEdit(n)"
            >
              Редактировать
            </button>
            <template v-else>
              <button class="btn btn--small" @click="saveEdit(n.id)" :disabled="savingEdit">
                Сохранить
              </button>
              <button class="btn btn--small btn--secondary" @click="cancelEdit" :disabled="savingEdit">
                Отмена
              </button>
            </template>
          </div>
  
          <div v-if="editError && editingNoteId === n.id" class="error">
            {{ editError }}
          </div>
          <div v-if="editSuccess && editingNoteId === n.id" class="success">
            {{ editSuccess }}
          </div>
        </div>
      </section>
    </div>
</template>
  
<script setup lang="ts">
  import { computed, ref } from 'vue';
  import { getRolesVerify, listNotes, createNote, updateNote } from '../api';
  
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
  
  // state для редактирования
  const editingNoteId = ref<string | null>(null);
  const editTitle = ref('');
  const editBody = ref('');
  const editMinRole = ref('');
  const savingEdit = ref(false);
  const editError = ref<string | null>(null);
  const editSuccess = ref<string | null>(null);
  
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
    cancelEdit();
  
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
  
  // ---- редактирование ----
  function startEdit(note: any) {
    editingNoteId.value = note.id;
    editTitle.value = note.title;
    editBody.value = note.body;
    editMinRole.value = note.min_role;
    editError.value = null;
    editSuccess.value = null;
  }
  
  function cancelEdit() {
    editingNoteId.value = null;
    editTitle.value = '';
    editBody.value = '';
    editMinRole.value = '';
    editError.value = null;
    editSuccess.value = null;
  }
  
  async function saveEdit(noteId: string) {
    if (!editingNoteId.value || editingNoteId.value !== noteId) return;
    if (!userId.value) return;
  
    savingEdit.value = true;
    editError.value = null;
    editSuccess.value = null;
  
    try {
      const payload: any = {};
      if (editTitle.value.trim().length > 0) payload.title = editTitle.value.trim();
      if (editBody.value.trim().length > 0) payload.body = editBody.value.trim();
      if (editMinRole.value) payload.min_role = editMinRole.value;
  
      if (!payload.title && !payload.body && !payload.min_role) {
        editError.value = "Нечего сохранять";
        savingEdit.value = false;
        return;
      }
  
      await updateNote(userId.value, noteId, payload);
      editSuccess.value = "Заметка обновлена";
  
      // обновляем список заметок
      const notesRes = await listNotes(userId.value);
      notes.value = notesRes.notes || [];
  
      // сбрасываем режим редактирования
      cancelEdit();
    } catch (e: any) {
      editError.value = e.message || String(e);
    } finally {
      savingEdit.value = false;
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
  
  .btn--small {
    padding: 4px 8px;
    font-size: 12px;
  }
  
  .btn--secondary {
    background: #4b5563;
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
    gap: 8px;
  }
  
  .note__title {
    font-weight: 600;
    flex: 1;
  }
  
  .note__title input {
    width: 100%;
    padding: 4px 6px;
    font-size: 13px;
  }
  
  .min-role-select {
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 999px;
    border: 1px solid #d1d5db;
    background: #f9fafb;
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
  
  .note__body textarea {
    width: 100%;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid #d1d5db;
    font-size: 13px;
    white-space: pre-wrap;
  }
  
  .note__actions {
    margin-top: 6px;
    display: flex;
    gap: 6px;
  }
</style>
  