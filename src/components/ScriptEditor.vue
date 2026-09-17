<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { ScriptItem } from '../db';
import { 
  ArrowLeft, 
  Save, 
  Play, 
  Hash, 
  Clock, 
  Layers, 
  CheckCircle2, 
  Tag as TagIcon 
} from 'lucide-vue-next';

const props = defineProps<{
  initialScript: ScriptItem | null;
}>();

const emit = defineEmits<{
  (e: 'save', payload: Partial<ScriptItem>): void;
  (e: 'start-prompter', script: ScriptItem): void;
  (e: 'cancel'): void;
}>();

const title = ref(props.initialScript?.title || '未命名文稿');
const content = ref(props.initialScript?.content || '');
const tagsInput = ref(props.initialScript?.tags?.join(', ') || '');
const isSaved = ref(true);

// 實時字數計算
const wordCount = computed(() => {
  return content.value.replace(/\s+/g, '').length;
});

// 段落數計算
const paragraphCount = computed(() => {
  if (!content.value.trim()) return 0;
  return content.value.split(/\n+/).filter(p => p.trim().length > 0).length;
});

// 預估朗讀時間 (秒數，以每分鐘 220 字計算)
const estimatedSeconds = computed(() => {
  if (wordCount.value === 0) return 0;
  return Math.round((wordCount.value / 220) * 60);
});

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0 秒';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs} 秒`;
  return `${mins} 分 ${secs} 秒`;
}

watch([title, content, tagsInput], () => {
  isSaved.value = false;
});

function getParsedTags(): string[] {
  return tagsInput.value
    .split(/[,，]/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

function handleSave() {
  const payload: Partial<ScriptItem> = {
    title: title.value.trim() || '未命名文稿',
    content: content.value,
    tags: getParsedTags(),
    wordCount: wordCount.value,
    speechDurationSeconds: estimatedSeconds.value,
    updatedAt: Date.now()
  };
  if (props.initialScript?.id) {
    payload.id = props.initialScript.id;
  }
  emit('save', payload);
  isSaved.value = true;
}

function handleStartPrompter() {
  handleSave();
  const fullScript: ScriptItem = {
    id: props.initialScript?.id,
    title: title.value.trim() || '未命名文稿',
    content: content.value,
    tags: getParsedTags(),
    wordCount: wordCount.value,
    speechDurationSeconds: estimatedSeconds.value,
    createdAt: props.initialScript?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  emit('start-prompter', fullScript);
}
</script>

<template>
  <div class="editor-container">
    <!-- 頂部操作欄 -->
    <div class="editor-header glass-panel">
      <div class="left-actions">
        <button class="btn btn-secondary" @click="emit('cancel')">
          <ArrowLeft :size="16" />
          <span>返回文稿庫</span>
        </button>
        <span class="save-status">
          <CheckCircle2 v-if="isSaved" :size="15" class="saved-icon" />
          <span :class="{ unsaved: !isSaved }">{{ isSaved ? '變更已保存' : '有未保存的編輯' }}</span>
        </span>
      </div>

      <div class="right-actions">
        <button class="btn btn-secondary" @click="handleSave">
          <Save :size="16" />
          <span>儲存草稿</span>
        </button>
        <button class="btn btn-primary" @click="handleStartPrompter">
          <Play :size="16" fill="currentColor" />
          <span>開始提詞</span>
        </button>
      </div>
    </div>

    <!-- 編輯器主體 -->
    <div class="editor-body glass-panel">
      <div class="title-row">
        <input
          v-model="title"
          type="text"
          class="title-input"
          placeholder="請輸入文稿標題..."
        />
      </div>

      <div class="tags-row">
        <TagIcon :size="15" class="tag-icon" />
        <input
          v-model="tagsInput"
          type="text"
          class="tags-input"
          placeholder="標籤（以逗號區隔，如：產品發表, 開場白）"
        />
      </div>

      <div class="content-row">
        <textarea
          v-model="content"
          class="content-textarea"
          placeholder="在此貼上或輸入您的演講稿、影片口播稿或訪談大綱...

按下開始提詞後，系統將透過麥克風辨識您的語速，逐字發光標記並自動平滑滾動！"
        ></textarea>
      </div>

      <!-- 即時統計欄 -->
      <div class="stats-bar">
        <div class="stat-badge">
          <Hash :size="14" />
          <span>字數：<strong>{{ wordCount.toLocaleString() }}</strong> 字</span>
        </div>
        <div class="stat-badge">
          <Layers :size="14" />
          <span>段落：<strong>{{ paragraphCount }}</strong> 段</span>
        </div>
        <div class="stat-badge highlight">
          <Clock :size="14" />
          <span>預估朗讀時間：<strong>{{ formatDuration(estimatedSeconds) }}</strong></span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px;
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;
  flex: 1;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
}

.left-actions, .right-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.save-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-muted);
}

.saved-icon {
  color: var(--accent-emerald);
}

.save-status span.unsaved {
  color: #FBBF24;
}

.editor-body {
  display: flex;
  flex-direction: column;
  padding: 28px 32px;
  flex: 1;
  gap: 16px;
}

.title-input {
  font-size: 24px;
  font-weight: 800;
  background: transparent;
  border: none;
  border-bottom: 2px solid var(--border-subtle);
  border-radius: 0;
  padding: 8px 0;
  color: var(--text-primary);
}

.title-input:focus {
  border-bottom-color: var(--accent-primary);
  box-shadow: none;
}

.tags-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tag-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.tags-input {
  background: rgba(255, 255, 255, 0.03);
  font-size: 13px;
  padding: 6px 12px;
}

.content-row {
  flex: 1;
  display: flex;
}

.content-textarea {
  flex: 1;
  min-height: 440px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 20px;
  font-size: 18px;
  line-height: 1.8;
  color: #F1F5F9;
  resize: vertical;
  font-family: var(--font-sans);
}

.content-textarea:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
}

.stats-bar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding-top: 14px;
  border-top: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 13px;
}

.stat-badge {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stat-badge strong {
  color: var(--text-primary);
}

.stat-badge.highlight {
  color: var(--accent-cyan);
}

.stat-badge.highlight strong {
  color: #22D3EE;
}

@media (max-width: 768px) {
  .editor-container {
    padding: 12px;
  }
  .editor-body {
    padding: 16px;
  }
  .stats-bar {
    flex-wrap: wrap;
    gap: 10px;
  }
}
</style>
