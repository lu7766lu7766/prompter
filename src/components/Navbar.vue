<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Download, Upload, Plus, MonitorPlay, Sparkles } from 'lucide-vue-next';
import logoImg from '../assets/logo.png';

const emit = defineEmits<{
  (e: 'new-script'): void;
  (e: 'import-file', event: Event): void;
  (e: 'export-backup'): void;
  (e: 'reset-demo'): void;
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);
const deferredPrompt = ref<any>(null);
const showInstallBtn = ref<boolean>(false);

onMounted(() => {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt.value = e;
    showInstallBtn.value = true;
  });
});

async function installPwa() {
  if (!deferredPrompt.value) return;
  deferredPrompt.value.prompt();
  const { outcome } = await deferredPrompt.value.userChoice;
  if (outcome === 'accepted') {
    showInstallBtn.value = false;
  }
  deferredPrompt.value = null;
}

function triggerFileInput() {
  fileInputRef.value?.click();
}
</script>

<template>
  <header class="navbar glass-panel">
    <div class="brand">
      <img :src="logoImg" alt="Logo" class="brand-logo" />
      <div class="brand-text">
        <h1 class="brand-title">智慧語音提詞機</h1>
        <span class="brand-subtitle">Smart Voice Prompter PWA</span>
      </div>
    </div>

    <!-- 隱藏的檔案上傳 input -->
    <input
      ref="fileInputRef"
      type="file"
      accept=".txt,.md,.json"
      style="display: none"
      @change="emit('import-file', $event)"
    />

    <div class="nav-actions">
      <!-- 示範稿快速還原 -->
      <button class="btn btn-secondary btn-sm" @click="emit('reset-demo')" title="載入官方繁中示範講稿">
        <Sparkles :size="16" />
        <span>示範稿</span>
      </button>

      <!-- 匯入按鈕 -->
      <button class="btn btn-secondary btn-sm" @click="triggerFileInput" title="匯入 .txt / .md / .json 文稿">
        <Upload :size="16" />
        <span>匯入文稿</span>
      </button>

      <!-- 匯出備份 -->
      <button class="btn btn-secondary btn-sm" @click="emit('export-backup')" title="匯出全部文稿 JSON 備份">
        <Download :size="16" />
        <span>備份匯出</span>
      </button>

      <!-- PWA 安裝按鈕 -->
      <button v-if="showInstallBtn" class="btn btn-secondary btn-sm install-btn" @click="installPwa" title="安裝為本機應用程式">
        <MonitorPlay :size="16" />
        <span>安裝 PWA</span>
      </button>

      <!-- 新增文稿 -->
      <button class="btn btn-primary" @click="emit('new-script')">
        <Plus :size="18" />
        <span>新增文稿</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  margin: 16px 24px 0 24px;
  z-index: 10;
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.brand-logo {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-glow);
  object-fit: cover;
  transition: transform var(--transition-fast);
}

.brand-logo:hover {
  transform: scale(1.05) rotate(-2deg);
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-title {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.5px;
  background: linear-gradient(135deg, #FFFFFF 0%, #E2E8F0 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.brand-subtitle {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-weight: 500;
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 13px;
}

.install-btn {
  border-color: rgba(6, 182, 212, 0.4);
  color: #22D3EE;
}

.install-btn:hover {
  background: rgba(6, 182, 212, 0.15);
}

@media (max-width: 768px) {
  .navbar {
    margin: 8px;
    padding: 10px 14px;
  }
  .brand-subtitle {
    display: none;
  }
  .nav-actions .btn span {
    display: none;
  }
  .nav-actions .btn {
    padding: 8px;
  }
}
</style>
