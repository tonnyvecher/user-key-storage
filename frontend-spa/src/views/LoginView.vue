<template>
  <div class="card login">
    <h2 class="login__title">Вход в систему</h2>
    <p class="login__text">
      Для работы с системой хранения ключевой информации нужно авторизоваться
      через корпоративный SSO (Keycloak).
    </p>
    <button class="login__btn" @click="onLogin">Войти через Keycloak</button>
    <p v-if="error" class="login__error">
      {{ error }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { login, authState } from "../auth";

const error = computed(() => authState.error);

function onLogin() {
  login();
}
</script>

<style scoped>
.card.login {
  max-width: 420px;
  margin: 60px auto;
  text-align: center;
}

.login__title {
  margin: 0 0 8px;
  font-size: 20px;
}

.login__text {
  font-size: 13px;
  color: #4b5563;
  margin: 0 0 16px;
}

.login__btn {
  padding: 8px 16px;
  font-size: 14px;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  background: #2563eb;
  color: #ffffff;
}

.login__btn:hover {
  background: #1d4ed8;
}

.login__error {
  margin-top: 10px;
  font-size: 12px;
  color: #b91c1c;
}
</style>
