<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ScriptItem } from '../db';
import { 
  Play, 
  Edit3, 
  Trash2, 
  Copy, 
  Search, 
  FileText, 
  Clock, 
  Hash, 
  ArrowUpDown,
  PlusCircle,
  Sparkles
} from 'lucide-vue-next';

const props = defineProps<{
  scripts: ScriptItem[];
}>();

const emit = defineEmits<{
  (e: 'select-script', script: ScriptItem): void;
  (e: 'edit-script', script: ScriptItem): void;
  (e: 'delete-script', id: number): void;
  (e: 'duplicate-script', script: ScriptItem): void;
  (e: 'new-script'): void;
}>();

const searchQuery = ref('');
const sortBy = ref<'updated' | 'created' | 'words'>('updated');

// 統計資訊
const totalStats = computed(() => {
  const count = props.scripts.length;
  const totalWords = props.scripts.reduce((acc, s) => acc + (s.wordCount || 0), 0);
  const totalSeconds = props.scripts.reduce((acc, s) => acc + (s.speechDurationSeconds || 0), 0);
  return {
    count,
    totalWords,
    minutes: Math.ceil(totalSeconds / 60)
  };
});

// 搜尋與排序過濾後的列表
const filteredScripts = computed(() => {
  let list = props.scripts.slice();

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase().trim();
    list = list.filter(s => 
      s.title.toLowerCase().includes(q) || 
      s.content.toLowerCase().includes(q) ||
      (s.tags && s.tags.some(t => t.toLowerCase().includes(q)))
    );
  }

  if (sortBy.value === 'updated') {
    list.sort((a, b) => b.updatedAt - a.updatedAt);
  } else if (sortBy.value === 'created') {
    list.sort((a, b) => b.createdAt - a.createdAt);
  } else if (sortBy.value === 'words') {
    list.sort((a, b) => b.wordCount - a.wordCount);
  }

  return list;
});

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0 秒';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs} 秒`;
  return `${mins} 分 ${secs} 秒`;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
</script>

<template>
  <div class="script-list-container">
    <!-- 頂部統計指標卡 -->
    <div class="stats-overview glass-panel">
      <div class="stat-item">
        <div class="stat-icon-wrap amber">
          <FileText :size="20" />
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ totalStats.count }}</span>
          <span class="stat-label">篇保存文稿</span>
        </div>
      </div>

      <div class="stat-item">
        <div class="stat-icon-wrap cyan">
          <Hash :size="20" />
        </div>
        <div class="stat-info">
          <span class="stat-value">{{ totalStats.totalWords.toLocaleString() }}</span>
          <span class="stat-label">累積字數</span>
        </div>
      </div>

      <div class="stat-item">
        <div class="stat-icon-wrap emerald">
          <Clock :size="20" />
        </div>
        <div class="stat-info">
          <span class="stat-value">~{{ totalStats.minutes }} 分鐘</span>
          <span class="stat-label">預估總演說時長</span>
        </div>
      </div>
    </div>

    <!-- 工具欄：搜尋與排序 -->
    <div class="toolbar">
      <div class="search-box">
        <Search :size="18" class="search-icon" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜尋文稿標題、內文關鍵字或標籤..."
        />
      </div>

      <div class="sort-box">
        <ArrowUpDown :size="16" class="sort-icon" />
        <select v-model="sortBy">
          <option value="updated">依最後修改時間</option>
          <option value="created">依建立時間</option>
          <option value="words">依字數多寡</option>
        </select>
      </div>
    </div>

    <!-- 文稿卡片清單 -->
    <div v-if="filteredScripts.length > 0" class="cards-grid">
      <div
        v-for="item in filteredScripts"
        :key="item.id"
        class="glass-card script-card"
      >
        <div class="card-header">
          <h2 class="card-title" :title="item.title">{{ item.title }}</h2>
          <div class="card-meta">
            <span class="badge badge-amber">
              <Hash :size="12" />
              {{ item.wordCount }} 字
            </span>
            <span class="badge badge-cyan">
              <Clock :size="12" />
              {{ formatDuration(item.speechDurationSeconds) }}
            </span>
          </div>
        </div>

        <p class="card-preview">
          {{ item.content.slice(0, 140) }}{{ item.content.length > 140 ? '...' : '' }}
        </p>

        <!-- 標籤 -->
        <div v-if="item.tags && item.tags.length" class="card-tags">
          <span v-for="tag in item.tags" :key="tag" class="tag-pill">
            #{{ tag }}
          </span>
        </div>

        <div class="card-footer">
          <span class="date-text">更新於 {{ formatDate(item.updatedAt) }}</span>
          
          <div class="card-actions">
            <button 
              class="btn-icon" 
              @click.stop="emit('edit-script', item)" 
              title="編輯文稿內容"
            >
              <Edit3 :size="16" />
            </button>
            <button 
              class="btn-icon" 
              @click.stop="emit('duplicate-script', item)" 
              title="複製文稿"
            >
              <Copy :size="16" />
            </button>
            <button 
              class="btn-icon danger" 
              @click.stop="item.id && emit('delete-script', item.id)" 
              title="刪除文稿"
            >
              <Trash2 :size="16" />
            </button>
            <button 
              class="btn btn-primary btn-play" 
              @click="emit('select-script', item)"
              title="開始全螢幕語音提詞"
            >
              <Play :size="16" fill="currentColor" />
              <span>開始提詞</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 空白狀態 -->
    <div v-else class="empty-state glass-panel">
      <Sparkles :size="48" class="empty-icon" />
      <h3>{{ searchQuery ? '找不到符合的文稿' : '目前文稿庫中尚無文稿' }}</h3>
      <p>{{ searchQuery ? '嘗試調整搜尋字詞或清除搜尋' : '點擊下方按鈕建立您的第一篇講稿吧！' }}</p>
      <button class="btn btn-primary" @click="emit('new-script')">
        <PlusCircle :size="18" />
        <span>新增第一篇講稿</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.script-list-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

/* 統計指標卡 */
.stats-overview {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  padding: 20px 32px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 16px;
}

.stat-icon-wrap {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-icon-wrap.amber {
  background: rgba(245, 158, 11, 0.15);
  color: #FBBF24;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.stat-icon-wrap.cyan {
  background: rgba(6, 182, 212, 0.15);
  color: #22D3EE;
  border: 1px solid rgba(6, 182, 212, 0.3);
}

.stat-icon-wrap.emerald {
  background: rgba(16, 185, 129, 0.15);
  color: #34D399;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-value {
  font-size: 24px;
  font-weight: 800;
  color: var(--text-primary);
  line-height: 1.2;
}

.stat-label {
  font-size: 13px;
  color: var(--text-muted);
}

/* 工具列 */
.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
}

.search-box {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 14px;
  color: var(--text-muted);
  pointer-events: none;
}

.search-box input {
  padding-left: 42px;
  font-size: 15px;
}

.sort-box {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 180px;
}

.sort-icon {
  position: absolute;
  left: 12px;
  color: var(--text-muted);
  pointer-events: none;
}

.sort-box select {
  padding-left: 36px;
  cursor: pointer;
}

/* 卡片格點 */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 20px;
}

.script-card {
  display: flex;
  flex-direction: column;
  padding: 22px;
  border-radius: var(--radius-lg);
  cursor: pointer;
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.card-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.card-meta {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.card-preview {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 16px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
}

.tag-pill {
  font-size: 11px;
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-muted);
  border-radius: var(--radius-full);
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 14px;
  border-top: 1px solid var(--border-subtle);
}

.date-text {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-icon.danger:hover {
  background: rgba(244, 63, 94, 0.2);
  color: #FB7185;
  border-color: rgba(244, 63, 94, 0.4);
}

.btn-play {
  padding: 6px 14px;
  font-size: 13px;
}

/* 空白狀態 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 24px;
  text-align: center;
  gap: 16px;
}

.empty-icon {
  color: var(--accent-primary);
  opacity: 0.8;
}

.empty-state h3 {
  font-size: 20px;
  font-weight: 700;
}

.empty-state p {
  color: var(--text-secondary);
  max-width: 400px;
}

@media (max-width: 768px) {
  .script-list-container {
    padding: 16px;
  }
  .stats-overview {
    grid-template-columns: 1fr;
    gap: 14px;
    padding: 16px;
  }
  .toolbar {
    flex-direction: column;
  }
  .cards-grid {
    grid-template-columns: 1fr;
  }
}
</style>
