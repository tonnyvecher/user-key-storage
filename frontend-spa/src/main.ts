import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { initAuth } from './auth';

async function bootstrap() {
  // Сначала инициализируем Keycloak / auth
  await initAuth();

  const app = createApp(App);
  app.use(router);
  app.mount('#app');
}

bootstrap();
