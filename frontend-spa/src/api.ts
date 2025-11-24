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
