import { createApp } from 'vue';
import './index.css';
import App from './App.vue';
import { initDatabase } from './db';

// 初始化 IndexedDB 種子資料與設定
initDatabase().finally(() => {
  createApp(App).mount('#app');
});
