import { reactive } from 'vue';
import keycloak from './keycloak';
import { API_BASE } from './api';

export interface AuthState {
  initialized: boolean;
  authenticated: boolean;
  loading: boolean;
  error: string | null;
  token: string | null;
  tokenParsed: any | null;
  internalUserId: string | null;
  internalUser: any | null;
}

export const authState = reactive<AuthState>({
  initialized: false,
  authenticated: false,
  loading: false,
  error: null,
  token: null,
  tokenParsed: null,
  internalUserId: null,
  internalUser: null
});

export async function initAuth() {
  authState.loading = true;
  authState.error = null;

  try {
    const authenticated = await keycloak.init({
      onLoad: 'check-sso', // login-required - жесткий режим, check-sso - мягкий режим
      pkceMethod: 'S256',
      checkLoginIframe: false
    });

    authState.initialized = true;
    authState.authenticated = authenticated;

    if (!authenticated) {
      authState.loading = false;
      return;
    }

    authState.token = keycloak.token || null;
    authState.tokenParsed = keycloak.tokenParsed || null;

    // Настраиваем авто-обновление токена
    keycloak.onTokenExpired = async () => {
      try {
        const refreshed = await keycloak.updateToken(30);
        if (refreshed && keycloak.token) {
          authState.token = keycloak.token;
          authState.tokenParsed = keycloak.tokenParsed || null;
        }
      } catch (e) {
        console.error('Token refresh failed', e);
      }
    };

    // Синхронизация с backend: /api/auth/keycloak
    await syncWithBackend();
  } catch (e: any) {
    console.error('initAuth error', e);
    authState.error = e?.message || String(e);
  } finally {
    authState.loading = false;
  }
}

export async function syncWithBackend() {
  if (!authState.token) return;

  try {
    const res = await fetch(`${API_BASE}/auth/keycloak`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authState.token}`
      }
    });

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Некорректный JSON от /auth/keycloak: ${text}`);
    }

    if (!res.ok) {
      throw new Error(data.message || `Ошибка /auth/keycloak: ${res.status}`);
    }

    authState.internalUserId = data.user?.id || null;
    authState.internalUser = data.user || null;
  } catch (e: any) {
    console.error('syncWithBackend error', e);
    authState.error = e?.message || String(e);
  }
}

export function login() {
  return keycloak.login({
    redirectUri: window.location.origin
  });
}

export function logout() {
  return keycloak.logout({
    redirectUri: window.location.origin
  });
}

export function getAuthToken(): string | null {
  return authState.token;
}
