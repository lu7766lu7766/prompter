<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import type { ScriptItem, PrompterSettings } from '../db';
import { useSpeechPrompter } from '../composables/useSpeechPrompter';
import { 
  Play,
  Pause,
  Mic, 
  MicOff, 
  RotateCcw, 
  X, 
  Maximize2, 
  Minimize2, 
  FlipHorizontal, 
  FlipVertical, 
  Eye, 
  Sliders, 
  HelpCircle,
  Volume2,
  Gauge,
  Plus,
  Minus,
  Hand
} from 'lucide-vue-next';

const props = defineProps<{
  script: ScriptItem;
  initialSettings: PrompterSettings;
}>();

const emit = defineEmits<{
  (e: 'exit'): void;
  (e: 'update-settings', settings: PrompterSettings): void;
}>();

// 提詞設定狀態（自動滾動與語音辨識皆為獨立開關）
const settings = ref<PrompterSettings>({ 
  ...props.initialSettings,
  enableAutoScroll: props.initialSettings.enableAutoScroll ?? true,
  enableVoice: props.initialSettings.enableVoice ?? true,
  scrollSpeed: props.initialSettings.scrollSpeed || 3
});

// 語音提詞引擎
const {
  isSupported,
  isListening,
  speechLang,
  interimText,
  lastRecognizedText,
  errorMessage,
  micVolume,
  tokens,
  currentTokenIndex,
  progressPercent,
  parseScriptToTokens,
  startListening,
  stopListening,
  jumpToTokenIndex,
  resetProgress
} = useSpeechPrompter();

// 控制面板顯示狀態
const showControls = ref(true);
const showHelpModal = ref(false);
const isFullscreen = ref(false);

// 自動滾動執行狀態與浮點數累計器（防止瀏覽器 DOM scrollTop 整數截斷導致低速 1, 2, 3 無法滾動）
const isAutoScrolling = ref(settings.value.enableAutoScroll);
let scrollAccumulator = 0;
let animFrameId: number | null = null;
let lastScrollTimestamp = 0;

const scrollContainerRef = ref<HTMLElement | null>(null);

// 自動滾動動畫循環 (以 JS 浮點數累進，徹底解決速度 1, 2, 3 次像素被截斷問題)
function runAutoScrollLoop(timestamp: number) {
  if (!lastScrollTimestamp) lastScrollTimestamp = timestamp;
  const deltaSeconds = Math.min((timestamp - lastScrollTimestamp) / 1000, 0.1);
  lastScrollTimestamp = timestamp;

  if (settings.value.enableAutoScroll && isAutoScrolling.value && scrollContainerRef.value) {
    // 速度係數：速度 1 = 20px/s，速度 2 = 36px/s，速度 3 = 52px/s，速度 10 = 164px/s
    const speedPxPerSec = 4 + settings.value.scrollSpeed * 16;
    scrollAccumulator += speedPxPerSec * deltaSeconds;
    scrollContainerRef.value.scrollTop = scrollAccumulator;
  }

  animFrameId = requestAnimationFrame(runAutoScrollLoop);
}

// 監聽容器手動滾動（滑鼠滾輪/觸控手勢/捲軸拖曳），同步累計器
function handleContainerScroll() {
  if (!scrollContainerRef.value) return;
  const current = scrollContainerRef.value.scrollTop;
  if (Math.abs(current - scrollAccumulator) > 2) {
    scrollAccumulator = current;
  }
}

// 切換自動滾動開關 (獨立開關)
function toggleAutoScroll() {
  settings.value.enableAutoScroll = !settings.value.enableAutoScroll;
  if (settings.value.enableAutoScroll) {
    if (scrollContainerRef.value) {
      scrollAccumulator = scrollContainerRef.value.scrollTop;
    }
    isAutoScrolling.value = true;
  } else {
    isAutoScrolling.value = false;
  }
}

// 切換語音辨識開關 (獨立開關)
function toggleVoice() {
  settings.value.enableVoice = !settings.value.enableVoice;
  if (settings.value.enableVoice) {
    if (isSupported.value) {
      startListening();
    }
  } else {
    stopListening();
  }
}

// 速度調整
function adjustSpeed(delta: number) {
  const current = settings.value.scrollSpeed;
  const next = Math.round((current + delta) * 2) / 2;
  settings.value.scrollSpeed = Math.min(10, Math.max(1, next));
}

function setSpeed(spd: number) {
  settings.value.scrollSpeed = spd;
}

// 空白鍵一鍵控制播放/暫停
function handleSpaceToggle() {
  // 若有開啟自動滾動，優先切換自動滾動的暫停/播放
  if (settings.value.enableAutoScroll) {
    isAutoScrolling.value = !isAutoScrolling.value;
  }
  // 若只有語音辨識開啟，則切換收音暫停/開始
  else if (settings.value.enableVoice) {
    if (isListening.value) {
      stopListening();
    } else {
      startListening();
    }
  }
}

// 初始化解析文稿並啟動
onMounted(() => {
  speechLang.value = settings.value.speechLang;
  parseScriptToTokens(props.script.content);

  // 依獨立開關個別啟動
  if (settings.value.enableAutoScroll) {
    isAutoScrolling.value = true;
  }
  if (settings.value.enableVoice && isSupported.value) {
    startListening();
  }

  animFrameId = requestAnimationFrame(runAutoScrollLoop);
  window.addEventListener('keydown', handleKeyDown);
  document.addEventListener('fullscreenchange', handleFullscreenChange);

  nextTick(() => {
    if (scrollContainerRef.value) {
      scrollAccumulator = scrollContainerRef.value.scrollTop;
    }
  });
});

onUnmounted(() => {
  stopListening();
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  window.removeEventListener('keydown', handleKeyDown);
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
});

// 當前語音朗讀字詞改變時，若開啟語音辨識則自動平滑對齊
watch(currentTokenIndex, (newIdx) => {
  if (!settings.value.enableVoice || newIdx < 0 || !scrollContainerRef.value) return;

  nextTick(() => {
    const el = document.getElementById(`token-${newIdx}`);
    if (!el || !scrollContainerRef.value) return;

    const container = scrollContainerRef.value;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    const offset = elRect.top - containerRect.top;
    const targetScrollTop = container.scrollTop + offset - (containerRect.height / 2) + (elRect.height / 2);

    scrollAccumulator = targetScrollTop;
    container.scrollTo({
      top: targetScrollTop,
      behavior: 'smooth'
    });
  });
});

// 監聽設定變更並保存
watch(settings, (newVal) => {
  emit('update-settings', { ...newVal });
}, { deep: true });

function handleLanguageChange(e: Event) {
  const select = e.target as HTMLSelectElement;
  settings.value.speechLang = select.value;
  speechLang.value = select.value;
  if (isListening.value && settings.value.enableVoice) {
    stopListening();
    startListening();
  }
}

// 全螢幕切換
async function toggleFullscreen() {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen().catch(() => {});
  } else {
    await document.exitFullscreen().catch(() => {});
  }
}

function handleFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
}

// 鍵盤快速鍵
function handleKeyDown(e: KeyboardEvent) {
  // 空白鍵：播放 / 暫停
  if (e.code === 'Space') {
    e.preventDefault();
    handleSpaceToggle();
  }
  // ESC：退出提詞模式
  else if (e.code === 'Escape') {
    if (showHelpModal.value) {
      showHelpModal.value = false;
    } else {
      emit('exit');
    }
  }
  // 'A' 鍵：切換自動滾動
  else if (e.key.toLowerCase() === 'a' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    toggleAutoScroll();
  }
  // 'V' 鍵：切換語音辨識
  else if (e.key.toLowerCase() === 'v' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    toggleVoice();
  }
  // [ 或 方向鍵左：減速
  else if (e.key === '[' || e.code === 'ArrowLeft') {
    e.preventDefault();
    adjustSpeed(-0.5);
  }
  // ] 或 方向鍵右：加速
  else if (e.key === ']' || e.code === 'ArrowRight') {
    e.preventDefault();
    adjustSpeed(0.5);
  }
  // 方向鍵上：向上手動滾動
  else if (e.code === 'ArrowUp') {
    e.preventDefault();
    if (scrollContainerRef.value) {
      scrollAccumulator = Math.max(0, scrollAccumulator - 60);
      scrollContainerRef.value.scrollTop = scrollAccumulator;
    }
  }
  // 方向鍵下：向下手動滾動
  else if (e.code === 'ArrowDown') {
    e.preventDefault();
    if (scrollContainerRef.value) {
      scrollAccumulator += 60;
      scrollContainerRef.value.scrollTop = scrollAccumulator;
    }
  }
  // 'F' 鍵：全螢幕
  else if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    toggleFullscreen();
  }
  // 'M' 鍵：水平鏡像
  else if (e.key.toLowerCase() === 'm' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    settings.value.mirrorH = !settings.value.mirrorH;
  }
  // 'H' 鍵：說明彈窗
  else if (e.key.toLowerCase() === 'h' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    showHelpModal.value = !showHelpModal.value;
  }
}

function handleReset() {
  resetProgress();
  scrollAccumulator = 0;
  if (scrollContainerRef.value) {
    scrollContainerRef.value.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
</script>

<template>
  <div class="prompter-mode">
    <!-- 頂部沉浸式資訊條 -->
    <div class="prompter-top-bar">
      <div class="top-left">
        <button class="btn-top-exit" @click="emit('exit')" title="結束提詞 (ESC)">
          <X :size="18" />
          <span>結束</span>
        </button>

        <div class="script-headline">
          <span class="script-title">{{ script.title }}</span>
          <span v-if="settings.enableVoice" class="progress-label">{{ progressPercent }}% 完成</span>
        </div>
      </div>

      <!-- 中央控制：獨立雙開關狀態 -->
      <div class="top-center">
        <!-- 開關一：自動滾動獨立開關與速度調整 -->
        <div class="feature-toggle-cluster">
          <button 
            class="feature-toggle-btn"
            :class="{ active: settings.enableAutoScroll }"
            @click="toggleAutoScroll"
            :title="settings.enableAutoScroll ? '關閉自動滾動 (快捷鍵 A)' : '開啟自動滾動 (快捷鍵 A)'"
          >
            <Gauge :size="14" />
            <span>自動滾動: {{ settings.enableAutoScroll ? (isAutoScrolling ? '滾動中' : '已暫停') : '關閉' }}</span>
          </button>

          <!-- 自動滾動開啟時的速度快速調節 -->
          <div v-if="settings.enableAutoScroll" class="speed-mini-ctrl">
            <button class="btn-speed-step" @click="adjustSpeed(-0.5)" title="減速 ([ 或 ←)">
              <Minus :size="12" />
            </button>
            <span class="speed-readout">{{ settings.scrollSpeed }}x</span>
            <button class="btn-speed-step" @click="adjustSpeed(0.5)" title="加速 (] 或 →)">
              <Plus :size="12" />
            </button>
          </div>
        </div>

        <!-- 開關二：語音辨識獨立開關與即時反饋 -->
        <div class="feature-toggle-cluster">
          <button 
            class="feature-toggle-btn voice-btn"
            :class="{ active: settings.enableVoice && isListening, inactive: !settings.enableVoice }"
            @click="toggleVoice"
            :title="settings.enableVoice ? '關閉語音辨識 (快捷鍵 V)' : '開啟語音辨識 (快捷鍵 V)'"
          >
            <div class="mic-indicator-dot">
              <span v-if="settings.enableVoice && isListening" class="pulse-ring-dot"></span>
              <Mic v-if="settings.enableVoice" :size="14" />
              <MicOff v-else :size="14" />
            </div>
            <span>語音辨識: {{ settings.enableVoice ? (isListening ? '收音中' : '暫停') : '關閉' }}</span>

            <!-- 收音即時音量小條 -->
            <div v-if="settings.enableVoice && isListening" class="vol-meter" :title="`收音音量: ${micVolume}%`">
              <div class="vol-bar" :style="{ width: `${micVolume}%` }"></div>
            </div>
          </button>

          <!-- 即時語音文字反饋 -->
          <div v-if="settings.enableVoice && (interimText || lastRecognizedText)" class="recognized-pill">
            <Volume2 :size="13" class="rec-icon" />
            <span class="rec-text">{{ interimText || lastRecognizedText }}</span>
          </div>
        </div>

        <!-- 當兩者皆關閉時提示純手動滑動模式 -->
        <div v-if="!settings.enableAutoScroll && !settings.enableVoice" class="manual-notice-badge">
          <Hand :size="14" />
          <span>純手動滑動模式（滑鼠滾輪/觸控/方向鍵）</span>
        </div>
      </div>

      <div class="top-right">
        <button class="btn-icon-top" @click="showHelpModal = true" title="快速鍵指南 (H)">
          <HelpCircle :size="18" />
        </button>
        <button class="btn-icon-top" @click="toggleFullscreen" :title="isFullscreen ? '退出全螢幕' : '全螢幕 (F)'">
          <Minimize2 v-if="isFullscreen" :size="18" />
          <Maximize2 v-else :size="18" />
        </button>
        <button 
          class="btn-icon-top" 
          :class="{ active: showControls }" 
          @click="showControls = !showControls"
          title="切換控制面板"
        >
          <Sliders :size="18" />
        </button>
      </div>
    </div>

    <!-- 頂部進度條 (語音模式時顯示進度) -->
    <div v-if="settings.enableVoice" class="reading-progress-track">
      <div class="reading-progress-fill" :style="{ width: `${progressPercent}%` }"></div>
    </div>

    <!-- 錯誤警告提示 -->
    <div v-if="errorMessage && settings.enableVoice" class="error-banner glass-panel">
      <span>{{ errorMessage }}</span>
      <button class="btn btn-secondary btn-sm" @click="startListening">重試授權</button>
    </div>

    <!-- 視覺焦點水平指示線 (Spotlight Focus Line) -->
    <div 
      v-if="settings.showGuideLine" 
      class="focus-guide-line"
    >
      <div class="guide-pointer left">▶</div>
      <div class="guide-beam"></div>
      <div class="guide-pointer right">◀</div>
    </div>

    <!-- 文字滾動閱讀主區 -->
    <main 
      ref="scrollContainerRef" 
      class="prompter-scroll-viewport"
      @scroll="handleContainerScroll"
    >
      <div 
        class="prompter-text-container"
        :class="{
          'mirror-h': settings.mirrorH && !settings.mirrorV,
          'mirror-v': settings.mirrorV && !settings.mirrorH,
          'mirror-both': settings.mirrorH && settings.mirrorV
        }"
        :style="{
          maxWidth: `${settings.containerWidth}px`,
          fontSize: `${settings.fontSize}px`,
          lineHeight: `${settings.lineHeight}`
        }"
      >
        <!-- 頂部防遮擋墊高區塊 -->
        <div class="scroll-padding-top"></div>

        <!-- 字符級 Token 渲染 -->
        <template v-for="token in tokens" :key="token.id">
          <!-- 換行 -->
          <br v-if="token.isNewline" />

          <!-- 可點擊字符/單詞 -->
          <span
            v-else
            :id="`token-${token.id}`"
            class="token"
            :class="{
              'token-active': settings.enableVoice && token.id === currentTokenIndex,
              'token-read': settings.enableVoice && token.id < currentTokenIndex && currentTokenIndex >= 0,
              'token-unread': !settings.enableVoice || token.id > currentTokenIndex || currentTokenIndex < 0,
              'token-punct': token.isPunctuationOrSpace
            }"
            @click="jumpToTokenIndex(token.id)"
            :title="`點擊跳轉至此處`"
          >{{ token.text }}</span>
        </template>

        <!-- 底部防遮擋墊高區塊 -->
        <div class="scroll-padding-bottom"></div>
      </div>
    </main>

    <!-- 懸浮專業控制面板 (可收合) -->
    <transition name="slide-up">
      <div v-if="showControls" class="floating-controls glass-panel">
        <div class="controls-grid">
          <!-- 獨立開關區 -->
          <div class="ctrl-group">
            <!-- 自動滾動獨立開關按鈕 -->
            <button 
              class="btn"
              :class="settings.enableAutoScroll ? 'btn-primary' : 'btn-secondary'"
              @click="toggleAutoScroll"
              title="開關自動滾動 (快捷鍵 A)"
            >
              <Pause v-if="settings.enableAutoScroll && isAutoScrolling" :size="16" />
              <Play v-else-if="settings.enableAutoScroll" :size="16" fill="currentColor" />
              <Gauge v-else :size="16" />
              <span>自動滾動: {{ settings.enableAutoScroll ? (isAutoScrolling ? '滾動中' : '已暫停') : '關閉' }}</span>
            </button>

            <!-- 語音辨識獨立開關按鈕 -->
            <button 
              class="btn"
              :class="settings.enableVoice && isListening ? 'btn-cyan' : 'btn-secondary'"
              @click="toggleVoice"
              title="開關語音辨識 (快捷鍵 V)"
            >
              <Mic v-if="settings.enableVoice && isListening" :size="16" />
              <MicOff v-else :size="16" />
              <span>語音辨識: {{ settings.enableVoice ? (isListening ? '收音中' : '暫停') : '關閉' }}</span>
            </button>

            <button class="btn btn-secondary" @click="handleReset" title="回到文稿最開頭">
              <RotateCcw :size="16" />
              <span>重頭開始</span>
            </button>
          </div>

          <div class="ctrl-divider"></div>

          <!-- 自動滾動速度調整 (自動滾動開啟時可調) -->
          <div class="ctrl-slider-item speed-slider" :class="{ disabled: !settings.enableAutoScroll }">
            <div class="slider-header">
              <span>滾動速度</span>
              <span class="slider-val">{{ settings.scrollSpeed }}x</span>
            </div>
            <input 
              v-model.number="settings.scrollSpeed" 
              type="range" 
              min="1" 
              max="10" 
              step="0.5" 
              :disabled="!settings.enableAutoScroll"
            />
            <div class="speed-presets">
              <button class="preset-tag" :class="{ active: settings.scrollSpeed === 1.5 }" @click="setSpeed(1.5)" :disabled="!settings.enableAutoScroll">慢</button>
              <button class="preset-tag" :class="{ active: settings.scrollSpeed === 3 }" @click="setSpeed(3)" :disabled="!settings.enableAutoScroll">標</button>
              <button class="preset-tag" :class="{ active: settings.scrollSpeed === 5 }" @click="setSpeed(5)" :disabled="!settings.enableAutoScroll">快</button>
              <button class="preset-tag" :class="{ active: settings.scrollSpeed === 8 }" @click="setSpeed(8)" :disabled="!settings.enableAutoScroll">特快</button>
            </div>
          </div>

          <!-- 語音語言切換 -->
          <div class="ctrl-group" :class="{ disabled: !settings.enableVoice }">
            <select 
              :value="settings.speechLang" 
              class="lang-select" 
              @change="handleLanguageChange"
              :disabled="!settings.enableVoice"
              title="語音辨識語言"
            >
              <option value="zh-TW">繁體中文 (TW)</option>
              <option value="en-US">English (US)</option>
              <option value="zh-CN">普通话 (CN)</option>
            </select>
          </div>

          <div class="ctrl-divider"></div>

          <!-- 字級調整 -->
          <div class="ctrl-slider-item">
            <div class="slider-header">
              <span>字體大小</span>
              <span class="slider-val">{{ settings.fontSize }}px</span>
            </div>
            <input 
              v-model.number="settings.fontSize" 
              type="range" 
              min="24" 
              max="96" 
              step="2" 
            />
          </div>

          <!-- 行距調整 -->
          <div class="ctrl-slider-item">
            <div class="slider-header">
              <span>行距倍率</span>
              <span class="slider-val">{{ settings.lineHeight }}x</span>
            </div>
            <input 
              v-model.number="settings.lineHeight" 
              type="range" 
              min="1.4" 
              max="2.6" 
              step="0.1" 
            />
          </div>

          <!-- 欄寬調整（集中視線） -->
          <div class="ctrl-slider-item">
            <div class="slider-header">
              <span>閱讀寬度</span>
              <span class="slider-val">{{ settings.containerWidth }}px</span>
            </div>
            <input 
              v-model.number="settings.containerWidth" 
              type="range" 
              min="400" 
              max="1200" 
              step="20" 
            />
          </div>

          <div class="ctrl-divider"></div>

          <!-- 開關按鈕群 -->
          <div class="ctrl-toggles">
            <!-- 水平鏡像 -->
            <button 
              class="btn-icon" 
              :class="{ active: settings.mirrorH }" 
              @click="settings.mirrorH = !settings.mirrorH"
              title="水平鏡像翻轉（相容實體提詞機分光鏡）"
            >
              <FlipHorizontal :size="16" />
            </button>

            <!-- 垂直鏡像 -->
            <button 
              class="btn-icon" 
              :class="{ active: settings.mirrorV }" 
              @click="settings.mirrorV = !settings.mirrorV"
              title="垂直鏡像翻轉"
            >
              <FlipVertical :size="16" />
            </button>

            <!-- 視覺輔助線開關 -->
            <button 
              class="btn-icon" 
              :class="{ active: settings.showGuideLine }" 
              @click="settings.showGuideLine = !settings.showGuideLine"
              title="焦點引導水平線開關"
            >
              <Eye :size="16" />
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- 快速鍵指南彈窗 -->
    <div v-if="showHelpModal" class="modal-backdrop" @click="showHelpModal = false">
      <div class="modal-card glass-panel" @click.stop>
        <div class="modal-header">
          <h3>提詞快捷鍵指南</h3>
          <button class="btn-icon" @click="showHelpModal = false"><X :size="16" /></button>
        </div>
        <div class="shortcuts-list">
          <div class="shortcut-item">
            <kbd>Space</kbd>
            <span>一鍵播放 / 暫停（自動滾動或語音辨識）</span>
          </div>
          <div class="shortcut-item">
            <kbd>A</kbd>
            <span>獨立切換「自動滾動」開啟 / 關閉</span>
          </div>
          <div class="shortcut-item">
            <kbd>V</kbd>
            <span>獨立切換「語音辨識」開啟 / 關閉</span>
          </div>
          <div class="shortcut-item">
            <kbd>[</kbd> <kbd>]</kbd> 或 <kbd>←</kbd> <kbd>→</kbd>
            <span>滾動速度 慢 / 快 (0.5x 級距)</span>
          </div>
          <div class="shortcut-item">
            <kbd>↑</kbd> <kbd>↓</kbd>
            <span>上下手動捲動 60px</span>
          </div>
          <div class="shortcut-item">
            <kbd>F</kbd>
            <span>切換全螢幕模式</span>
          </div>
          <div class="shortcut-item">
            <kbd>M</kbd>
            <span>切換水平鏡像翻轉（分光鏡用）</span>
          </div>
          <div class="shortcut-item">
            <kbd>ESC</kbd>
            <span>結束並退出提詞模式</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.prompter-mode {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  background-color: #000000;
  z-index: 999;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
}

/* 頂部資訊條 */
.prompter-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: rgba(8, 12, 20, 0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  z-index: 50;
}

.top-left, .top-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-top-exit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  border-radius: var(--radius-md);
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-top-exit:hover {
  background: rgba(244, 63, 94, 0.2);
  color: #FB7185;
  border-color: rgba(244, 63, 94, 0.4);
}

.script-headline {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.script-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  max-width: 200px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.progress-label {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--accent-primary);
}

.top-center {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 獨立功能開關群組 */
.feature-toggle-cluster {
  display: flex;
  align-items: center;
  gap: 6px;
}

.feature-toggle-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.feature-toggle-btn.active {
  background: rgba(245, 158, 11, 0.18);
  border-color: rgba(245, 158, 11, 0.5);
  color: #FBBF24;
}

.feature-toggle-btn.voice-btn.active {
  background: rgba(6, 182, 212, 0.18);
  border-color: rgba(6, 182, 212, 0.5);
  color: #22D3EE;
}

.speed-mini-ctrl {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  padding: 2px 6px;
}

.btn-speed-step {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: var(--text-primary);
  cursor: pointer;
}

.btn-speed-step:hover {
  background: rgba(255, 255, 255, 0.25);
}

.speed-readout {
  font-size: 11px;
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--accent-primary);
  min-width: 30px;
  text-align: center;
}

.mic-indicator-dot {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pulse-ring-dot {
  position: absolute;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(6, 182, 212, 0.4);
  animation: micPulse 1.4s infinite ease-out;
}

/* 音量條 */
.vol-meter {
  width: 28px;
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
  margin-left: 4px;
}

.vol-bar {
  height: 100%;
  background: var(--accent-cyan);
  transition: width 0.05s ease-out;
}

/* 即時文字反饋 */
.recognized-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  background: rgba(6, 182, 212, 0.1);
  border: 1px solid rgba(6, 182, 212, 0.25);
  color: #22D3EE;
  font-size: 11px;
  max-width: 200px;
}

.rec-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 純手動提示徽章 */
.manual-notice-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.08);
  border: 1px dashed var(--border-subtle);
  color: var(--text-secondary);
  font-size: 12px;
}

.btn-cyan {
  background: linear-gradient(135deg, #06B6D4 0%, #0284C7 100%);
  color: #FFFFFF;
  box-shadow: 0 4px 14px rgba(6, 182, 212, 0.35);
}

.btn-icon-top {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-icon-top:hover, .btn-icon-top.active {
  background: rgba(255, 255, 255, 0.15);
  color: var(--text-primary);
}

/* 進度條 */
.reading-progress-track {
  width: 100%;
  height: 3px;
  background: rgba(255, 255, 255, 0.05);
  z-index: 50;
}

.reading-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #F59E0B 0%, #06B6D4 100%);
  transition: width 0.2s ease-out;
}

/* 視覺焦點指示線 */
.focus-guide-line {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  pointer-events: none;
  z-index: 10;
}

.guide-beam {
  flex: 1;
  height: 2px;
  margin: 0 14px;
  background: linear-gradient(
    90deg,
    rgba(245, 158, 11, 0.0) 0%,
    rgba(245, 158, 11, 0.7) 15%,
    rgba(251, 191, 36, 0.95) 50%,
    rgba(245, 158, 11, 0.7) 85%,
    rgba(245, 158, 11, 0.0) 100%
  );
  box-shadow: 0 0 16px rgba(245, 158, 11, 0.7);
}

.guide-pointer {
  color: var(--accent-primary);
  font-size: 16px;
  text-shadow: 0 0 10px rgba(245, 158, 11, 0.9);
}

/* 滾動視圖區 */
.prompter-scroll-viewport {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  justify-content: center;
  padding: 0 24px;
  position: relative;
  scrollbar-width: none;
}

.prompter-scroll-viewport::-webkit-scrollbar {
  display: none;
}

.prompter-text-container {
  width: 100%;
  margin: 0 auto;
  text-align: left;
  font-weight: 600;
  letter-spacing: 1px;
  user-select: none;
  position: relative;
}

.scroll-padding-top {
  height: 50vh;
}

.scroll-padding-bottom {
  height: 60vh;
}

/* 字符狀態 */
.token {
  display: inline;
  cursor: pointer;
  padding: 1px 2px;
  border-radius: 4px;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.token:hover {
  background-color: rgba(255, 255, 255, 0.08);
}

.token-punct {
  cursor: default;
}

/* 懸浮控制面板 */
.floating-controls {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 14px 22px;
  z-index: 60;
  max-width: 95vw;
}

.controls-grid {
  display: flex;
  align-items: center;
  gap: 16px;
}

.ctrl-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ctrl-group.disabled, .ctrl-slider-item.disabled {
  opacity: 0.4;
  pointer-events: none;
}

.ctrl-divider {
  width: 1px;
  height: 32px;
  background: var(--border-subtle);
}

.ctrl-slider-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100px;
}

.ctrl-slider-item.speed-slider {
  width: 130px;
}

.speed-presets {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.preset-tag {
  flex: 1;
  padding: 2px 4px;
  font-size: 10px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-secondary);
  cursor: pointer;
}

.preset-tag:hover, .preset-tag.active {
  background: var(--accent-primary);
  color: #000;
  border-color: var(--accent-primary);
}

.slider-header {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary);
}

.slider-val {
  color: var(--accent-primary);
  font-family: var(--font-mono);
  font-weight: 700;
}

.ctrl-toggles {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lang-select {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
}

/* 快捷鍵彈窗 */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.modal-card {
  width: 100%;
  max-width: 440px;
  padding: 24px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.shortcuts-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.shortcut-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
}

kbd {
  display: inline-block;
  padding: 3px 8px;
  font-size: 12px;
  font-family: var(--font-mono);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  color: var(--accent-primary);
}

/* 轉場動畫 */
.slide-up-enter-active, .slide-up-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-up-enter-from, .slide-up-leave-to {
  transform: translate(-50%, 40px);
  opacity: 0;
}

@media (max-width: 900px) {
  .floating-controls {
    bottom: 12px;
    padding: 10px 14px;
  }
  .controls-grid {
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
  }
  .ctrl-slider-item {
    width: 80px;
  }
  .script-title {
    max-width: 120px;
  }
  .recognized-pill {
    display: none;
  }
}
</style>
