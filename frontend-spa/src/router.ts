import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import HomeView from './views/HomeView.vue';
import UsersView from './views/UsersView.vue';
import UserDetailsView from './views/UserDetailsView.vue';
import NotesView from './views/NotesView.vue';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomeView
  },
  {
    path: '/users',
    name: 'users',
    component: UsersView
  },
  {
    path: '/users/:id',
    name: 'user-details',
    component: UserDetailsView,
    props: true
  },
  { 
    path: '/notes',
    name: 'notes',
    component: NotesView }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

export default router;
