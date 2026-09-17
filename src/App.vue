<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { db, type ScriptItem, type PrompterSettings, DEFAULT_SETTINGS, SAMPLE_SCRIPT } from './db';
import Navbar from './components/Navbar.vue';
import ScriptList from './components/ScriptList.vue';
import ScriptEditor from './components/ScriptEditor.vue';
import PrompterView from './components/PrompterView.vue';

const scripts = ref<ScriptItem[]>([]);
const settings = ref<PrompterSettings>({ ...DEFAULT_SETTINGS });
const currentView = ref<'list' | 'editor' | 'prompter'>('list');
const selectedScript = ref<ScriptItem | null>(null);
const editingScript = ref<ScriptItem | null>(null);

// 提示訊息 Toast
const toastMessage = ref<string>('');
let toastTimer: any = null;

function showToast(msg: string) {
  toastMessage.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMessage.value = '';
  }, 3000);
}

// 載入資料
async function loadData() {
  try {
    const list = await db.scripts.toArray();
    scripts.value = list;

    const savedSettings = await db.settings.get('global');
    if (savedSettings) {
      settings.value = savedSettings;
    }
  } catch (err) {
    console.error('Error loading data from IndexedDB:', err);
  }
}

onMounted(() => {
  loadData();
});

// 新增文稿
function handleNewScript() {
  editingScript.value = {
    title: '未命名講稿',
    content: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    wordCount: 0,
    speechDurationSeconds: 0,
    tags: []
  };
  currentView.value = 'editor';
}

// 編輯文稿
function handleEditScript(script: ScriptItem) {
  editingScript.value = { ...script };
  currentView.value = 'editor';
}

// 儲存文稿
async function handleSaveScript(payload: Partial<ScriptItem>) {
  try {
    if (payload.id) {
      await db.scripts.update(payload.id, payload);
    } else {
      const newId = await db.scripts.add({
        title: payload.title || '未命名文稿',
        content: payload.content || '',
        createdAt: payload.createdAt || Date.now(),
        updatedAt: Date.now(),
        wordCount: payload.wordCount || 0,
        speechDurationSeconds: payload.speechDurationSeconds || 0,
        tags: payload.tags || []
      });
      payload.id = newId as number;
    }
    await loadData();
    showToast('文稿已成功儲存至本機資料庫！');
  } catch (err) {
    console.error('Failed to save script:', err);
    showToast('儲存失敗，請重試');
  }
}

// 開始提詞
function handleStartPrompter(script: ScriptItem) {
  selectedScript.value = script;
  currentView.value = 'prompter';
}

// 刪除文稿
async function handleDeleteScript(id: number) {
  const item = scripts.value.find(s => s.id === id);
  const confirmDelete = window.confirm(`確定要刪除文稿「${item?.title || '此文稿'}」嗎？`);
  if (!confirmDelete) return;

  try {
    await db.scripts.delete(id);
    await loadData();
    showToast('文稿已刪除');
  } catch (err) {
    console.error('Failed to delete script:', err);
    showToast('刪除失敗');
  }
}

// 複製文稿
async function handleDuplicateScript(script: ScriptItem) {
  try {
    await db.scripts.add({
      title: `${script.title} (副本)`,
      content: script.content,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      wordCount: script.wordCount,
      speechDurationSeconds: script.speechDurationSeconds,
      tags: script.tags ? [...script.tags] : []
    });
    await loadData();
    showToast('已建立文稿副本');
  } catch (err) {
    console.error('Failed to duplicate script:', err);
  }
}

// 還原示範講稿
async function handleResetDemo() {
  try {
    await db.scripts.add({ ...SAMPLE_SCRIPT });
    await loadData();
    showToast('已載入繁體中文示範講稿！');
  } catch (err) {
    console.error('Failed to reset demo:', err);
  }
}

// 匯入文稿 (.txt, .md, .json)
async function handleImportFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    const text = event.target?.result as string;
    if (!text) return;

    try {
      if (file.name.endsWith('.json')) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            delete item.id;
            await db.scripts.add(item);
          }
          showToast(`成功匯入 ${parsed.length} 篇備份文稿！`);
        } else if (parsed.content) {
          delete parsed.id;
          await db.scripts.add(parsed);
          showToast('文稿匯入成功！');
        }
      } else {
        // 純文字或 Markdown
        const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        const words = text.replace(/\s+/g, '').length;
        await db.scripts.add({
          title: fileNameWithoutExt,
          content: text,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          wordCount: words,
          speechDurationSeconds: Math.round((words / 220) * 60),
          tags: ['匯入']
        });
        showToast(`已成功匯入「${fileNameWithoutExt}」！`);
      }
      await loadData();
    } catch (err) {
      console.error('Import failed:', err);
      showToast('檔案格式解析失敗，請確認檔案內容');
    }
    input.value = '';
  };
  reader.readAsText(file);
}

// 匯出 JSON 備份
function handleExportBackup() {
  if (scripts.value.length === 0) {
    showToast('文稿庫中目前無文稿可匯出');
    return;
  }
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(scripts.value, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `prompter-scripts-backup-${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast('已下載完整文稿備份 JSON 檔案！');
}

// 更新提詞設定
async function handleUpdateSettings(newSettings: PrompterSettings) {
  settings.value = newSettings;
  try {
    await db.settings.put(newSettings);
  } catch (err) {
    console.error('Failed to update settings in IndexedDB:', err);
  }
}
</script>

<template>
  <div class="app-root">
    <!-- 主視圖：文稿清單模式 -->
    <template v-if="currentView === 'list'">
      <Navbar
        @new-script="handleNewScript"
        @import-file="handleImportFile"
        @export-backup="handleExportBackup"
        @reset-demo="handleResetDemo"
      />

      <main class="main-content">
        <ScriptList
          :scripts="scripts"
          @select-script="handleStartPrompter"
          @edit-script="handleEditScript"
          @delete-script="handleDeleteScript"
          @duplicate-script="handleDuplicateScript"
          @new-script="handleNewScript"
        />
      </main>
    </template>

    <!-- 編輯器視圖 -->
    <template v-else-if="currentView === 'editor'">
      <ScriptEditor
        :initial-script="editingScript"
        @save="handleSaveScript"
        @start-prompter="handleStartPrompter"
        @cancel="currentView = 'list'"
      />
    </template>

    <!-- 提詞機全螢幕專注視圖 -->
    <template v-else-if="currentView === 'prompter' && selectedScript">
      <PrompterView
        :script="selectedScript"
        :initial-settings="settings"
        @exit="currentView = 'list'"
        @update-settings="handleUpdateSettings"
      />
    </template>

    <!-- 底部微提示 Toast -->
    <transition name="toast-fade">
      <div v-if="toastMessage" class="toast-bubble glass-panel">
        <span>{{ toastMessage }}</span>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.app-root {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: radial-gradient(circle at 50% 0%, rgba(15, 23, 42, 0.8) 0%, #080C14 70%);
  position: relative;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* Toast 提示 */
.toast-bubble {
  position: fixed;
  bottom: 24px;
  right: 24px;
  padding: 12px 20px;
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(245, 158, 11, 0.4);
  color: #FBBF24;
  font-size: 14px;
  font-weight: 600;
  border-radius: var(--radius-md);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 8px;
}

.toast-fade-enter-active, .toast-fade-leave-active {
  transition: all 0.25s ease;
}

.toast-fade-enter-from, .toast-fade-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
</style>
