const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  const text = await res.text();

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Некорректный JSON: ${text}`);
  }

  if (!res.ok) {
    throw new Error(data.message || `${res.status} ${res.statusText}`);
  }

  return data as T;
}

export async function getProfile(userId: string) {
  return apiGet<{
    status: string;
    profile: any | null;
  }>(`/users/${userId}/profile`);
}

export async function getRolesVerify(userId: string) {
  return apiGet<{
    status: string;
    count: number;
    roles: any[];
  }>(`/users/${userId}/roles/verify`);
}

export async function secureTest(userId: string) {
  return apiGet<any>(`/secure-test?userId=${encodeURIComponent(userId)}`);
}

// список пользователей
export async function listUsers() {
  return apiGet<{
    status: string;
    count: number;
    users: {
      id: string;
      primary_email: string;
      is_active: boolean;
      created_at: string;
    }[];
  }>('/users');
}

export async function listUsersWithStatus() {
  return apiGet<{
    status: string;
    count: number;
    users: {
      id: string;
      primary_email: string;
      is_active: boolean;
      created_at: string;
      roles_count: number;
      has_issues: boolean;
    }[];
  }>('/admin/users/status');
}

export async function listNotes(userId: string) {
  return apiGet<{
    status: string;
    user_id: string;
    user_max_role_rank: number;
    count: number;
    notes: {
      id: string;
      owner_user_id: string;
      title: string;
      body: string;
      min_role: string;
      created_at: string;
      updated_at: string;
    }[];
  }>(`/notes?userId=${encodeURIComponent(userId)}`);
}

export async function createNote(userId: string, payload: { title: string; body: string; min_role: string }) {
  const res = await fetch(`${API_BASE}/notes?userId=${encodeURIComponent(userId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Некорректный JSON: ${text}`);
  }

  if (!res.ok) {
    throw new Error(data.message || `${res.status} ${res.statusText}`);
  }

  return data;
}

export async function updateNote(
  userId: string,
  noteId: string,
  payload: { title?: string; body?: string; min_role?: string }
) {
  const res = await fetch(`${API_BASE}/notes/${encodeURIComponent(noteId)}?userId=${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Некорректный JSON: ${text}`);
  }

  if (!res.ok) {
    throw new Error(data.message || `${res.status} ${res.statusText}`);
  }

  return data;
}


