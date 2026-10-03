<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import type { ScriptItem, PrompterSettings } from '../db';
import { useSpeechPrompter, detectLanguage } from '../composables/useSpeechPrompter';
import { 
  Play,
  Pause,
  Mic, 
  MicOff, 
  RotateCcw, 
  X, 
  Maximize2, 
  Minimize2, 
  Sliders, 
  HelpCircle,
  Gauge
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
  scrollSpeed: props.initialSettings.scrollSpeed || 3,
  micGate: props.initialSettings.micGate ?? 10,
  showGuideLine: true,
  mirrorH: false,
  mirrorV: false
});

// 語音提詞引擎
const {
  isSupported,
  isListening,
  speechLang,
  errorMessage,
  micVolume,
  noiseGateThreshold,
  setNoiseGate,
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

// 觸控滑動檢測（避免滑動捲動時誤觸發隱藏/顯示工具列）
let touchStartX = 0;
let touchStartY = 0;
let isTouchScroll = false;

function handleTouchStart(e: TouchEvent) {
  if (e.touches.length === 1) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isTouchScroll = false;
  }
}

function handleTouchMove(e: TouchEvent) {
  if (e.touches.length === 1) {
    const dx = Math.abs(e.touches[0].clientX - touchStartX);
    const dy = Math.abs(e.touches[0].clientY - touchStartY);
    if (dx > 10 || dy > 10) {
      isTouchScroll = true;
    }
  }
}

// 點擊畫面任意處切換工具列顯示/隱藏
function handleScreenClick(e: MouseEvent) {
  if (isTouchScroll) {
    isTouchScroll = false;
    return;
  }
  const target = e.target as HTMLElement;
  // 若點擊在按鈕、滑桿、選單或彈窗內，不切換
  if (target.closest('button, input, select, textarea, .floating-controls, .prompter-top-bar, .modal-card')) {
    return;
  }
  showControls.value = !showControls.value;
}

// 自動滾動執行狀態與浮點數累計器（防止瀏覽器 DOM scrollTop 整數截斷導致低速 1, 2, 3 無法滾動）
const isAutoScrolling = ref(settings.value.enableAutoScroll);
let scrollAccumulator = 0;
let animFrameId: number | null = null;
let lastScrollTimestamp = 0;

// 語音跟隨統一捲動控制器：語音只設定目標，由同一個 rAF 迴圈做平滑趨近，
// 避免每個 token 觸發一次原生 smooth scroll 互相搶奪造成抖動
let voiceScrollTarget: number | null = null;
let lastVoiceTargetAt = 0;
let lastManualScrollAt = 0;
const reduceMotion = typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const scrollContainerRef = ref<HTMLElement | null>(null);

// 自動滾動 + 語音跟隨共用動畫循環
function runAutoScrollLoop(timestamp: number) {
  if (!lastScrollTimestamp) lastScrollTimestamp = timestamp;
  const deltaSeconds = Math.min((timestamp - lastScrollTimestamp) / 1000, 0.1);
  lastScrollTimestamp = timestamp;

  const container = scrollContainerRef.value;
  if (container) {
    const hasFreshVoiceTarget = settings.value.enableVoice &&
      voiceScrollTarget !== null &&
      timestamp - lastVoiceTargetAt < 3000 &&
      timestamp - lastManualScrollAt > 2500;

    if (hasFreshVoiceTarget && voiceScrollTarget !== null) {
      const diff = voiceScrollTarget - scrollAccumulator;
      if (Math.abs(diff) < 1) {
        scrollAccumulator = voiceScrollTarget;
        container.scrollTop = scrollAccumulator;
      } else if (reduceMotion) {
        scrollAccumulator = voiceScrollTarget;
        container.scrollTop = scrollAccumulator;
      } else {
        scrollAccumulator += diff * Math.min(1, deltaSeconds * 5);
        container.scrollTop = scrollAccumulator;
      }
    } else if (settings.value.enableAutoScroll && isAutoScrolling.value) {
      const speedPxPerSec = 4 + settings.value.scrollSpeed * 16;
      scrollAccumulator += speedPxPerSec * deltaSeconds;
      container.scrollTop = scrollAccumulator;
    }
  }

  animFrameId = requestAnimationFrame(runAutoScrollLoop);
}

// 監聽容器手動滾動（滑鼠滾輪/觸控手勢/捲軸拖曳），同步累計器並短暫抑制語音拉回
function handleContainerScroll() {
  if (!scrollContainerRef.value) return;
  const current = scrollContainerRef.value.scrollTop;
  if (Math.abs(current - scrollAccumulator) > 2) {
    scrollAccumulator = current;
    lastManualScrollAt = performance.now();
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
    voiceScrollTarget = null;
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
  if (settings.value.enableAutoScroll) {
    isAutoScrolling.value = !isAutoScrolling.value;
  } else if (settings.value.enableVoice) {
    if (isListening.value) {
      stopListening();
    } else {
      startListening();
    }
  }
}

// 初始化解析文稿並啟動
onMounted(() => {
  // 自動偵測文稿語系
  const autoLang = detectLanguage(props.script.content);
  speechLang.value = autoLang;
  settings.value.speechLang = autoLang;
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
  setNoiseGate(settings.value.micGate ?? 10);
  noiseGateThreshold.value = settings.value.micGate ?? 10;

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

// 當前語音朗讀字詞改變時，只設定跟隨目標，由 rAF 迴圈平滑趨近（避免連發 smooth scroll 打架抖動）
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

    // 微小位移不更新目標，減少逐字推進時的抖動
    if (voiceScrollTarget !== null && Math.abs(targetScrollTop - voiceScrollTarget) < 24) return;

    voiceScrollTarget = targetScrollTop;
    lastVoiceTargetAt = performance.now();
  });
});

// 收音閘門變更即時套用到底層引擎
watch(() => settings.value.micGate, (v) => {
  setNoiseGate(v ?? 10);
});

// 監聽設定變更並保存
watch(settings, (newVal) => {
  emit('update-settings', { ...newVal });
}, { deep: true });

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
  // 'H' 鍵：說明彈窗
  else if (e.key.toLowerCase() === 'h' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    showHelpModal.value = !showHelpModal.value;
  }
}

function handleReset() {
  resetProgress();
  voiceScrollTarget = null;
  scrollAccumulator = 0;
  if (scrollContainerRef.value) {
    scrollContainerRef.value.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
</script>

<template>
  <div class="prompter-mode">
    <!-- 頂部沉浸式資訊條 -->
    <div class="prompter-top-bar" @click.stop>
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
          title="切換工具列 (輕觸畫面任意處亦可隱藏/顯示)"
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

    <!-- 文字滾動閱讀主區（點擊畫面切換隱藏/顯示工具列） -->
    <main 
      ref="scrollContainerRef" 
      class="prompter-scroll-viewport"
      @scroll="handleContainerScroll"
      @click="handleScreenClick"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
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

          <!-- 可點擊字符/單詞（雙擊可跳轉進度） -->
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
            @dblclick.stop="jumpToTokenIndex(token.id)"
            title="雙擊跳轉至此處 / 點擊畫面切換工具列"
          >{{ token.text }}</span>
        </template>

        <!-- 底部防遮擋墊高區塊 -->
        <div class="scroll-padding-bottom"></div>
      </div>
    </main>

    <!-- 工具列隱藏時的提示條 -->
    <div v-if="!showControls" class="tap-hint-pill">
      <span>輕觸畫面顯示工具列</span>
    </div>

    <!-- 懸浮專業控制面板 (可收合) -->
    <transition name="slide-up">
      <div v-if="showControls" class="floating-controls glass-panel" @click.stop>
        <div class="controls-grid">
          <!-- 獨立開關區 -->
          <div class="ctrl-group main-actions">
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

          <div class="ctrl-divider desktop-only"></div>

          <!-- 滑桿群組 -->
          <div class="ctrl-sliders-row">
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
            <div class="ctrl-slider-item width-slider desktop-only">
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

            <!-- 收音閘門（過濾環境音，越高越嚴格） -->
            <div class="ctrl-slider-item gate-slider" :class="{ disabled: !settings.enableVoice }" title="現場吵雜時調高；講話小聲會跟不上時調低">
              <div class="slider-header">
                <span>收音閘門</span>
                <span class="slider-val">{{ settings.micGate }}</span>
              </div>
              <input
                v-model.number="settings.micGate"
                type="range"
                min="0"
                max="40"
                step="1"
                :disabled="!settings.enableVoice"
              />
              <div class="mic-meter">
                <div class="mic-meter-fill" :style="{ width: `${Math.min(100, micVolume)}%` }"></div>
                <div class="mic-gate-mark" :style="{ left: `${Math.min(100, settings.micGate)}%` }"></div>
              </div>
            </div>
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
  min-width: 0;
}

.top-left {
  flex: 1 1 auto;
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
  overflow: hidden;
  min-width: 0;
  flex: 1 1 auto;
}

.script-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  max-width: clamp(90px, 28vw, 220px);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.progress-label {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--accent-primary);
  white-space: nowrap;
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
  flex-shrink: 0;
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
  padding: 0 20px;
  position: relative;
  scrollbar-width: none;
  cursor: pointer;
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
  word-break: break-word;
  overflow-wrap: break-word;
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

/* 工具列隱藏提示 */
.tap-hint-pill {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 7px 16px;
  border-radius: var(--radius-full);
  background: rgba(15, 23, 42, 0.75);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: var(--text-secondary);
  font-size: 12px;
  letter-spacing: 0.5px;
  pointer-events: none;
  z-index: 40;
  animation: fadeInOut 3s forwards;
  white-space: nowrap;
}

@keyframes fadeInOut {
  0% { opacity: 0; transform: translate(-50%, 10px); }
  15% { opacity: 1; transform: translate(-50%, 0); }
  80% { opacity: 1; transform: translate(-50%, 0); }
  100% { opacity: 0; transform: translate(-50%, 0); }
}

/* 懸浮控制面板：流體 RWD（依容器寬度自動換行，不綁特定機型） */
.floating-controls {
  position: absolute;
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  padding: 14px 20px;
  z-index: 60;
  width: min(940px, calc(100vw - 24px));
  max-height: calc(100dvh - 160px);
  overflow-y: auto;
  overscroll-behavior: contain;
  box-sizing: border-box;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
  cursor: default;
}

.controls-grid {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 12px 16px;
}

.ctrl-group.main-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex: 1 1 260px;
  min-width: 0;
}

.ctrl-group.main-actions .btn {
  flex: 1 1 0;
  min-width: 0;
}

.ctrl-group.main-actions .btn span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.ctrl-group.disabled, .ctrl-slider-item.disabled {
  opacity: 0.4;
  pointer-events: none;
}

.ctrl-divider {
  width: 1px;
  height: 32px;
  background: var(--border-subtle);
  flex-shrink: 0;
}

.ctrl-sliders-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 12px 16px;
  flex: 2 1 320px;
  min-width: 0;
  width: 100%;
  align-items: start;
}

.ctrl-slider-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  min-width: 0;
}

.ctrl-slider-item.speed-slider {
  width: 100%;
  min-width: 0;
}

/* 收音閘門即時音量條（綠條=目前音量，白線=閘門位置） */
.mic-meter {
  position: relative;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
  margin-top: 4px;
}

.mic-meter-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0;
  background: linear-gradient(90deg, #10B981, #22D3EE);
  border-radius: 3px;
  transition: width 0.12s linear;
}

.mic-gate-mark {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: rgba(255, 255, 255, 0.85);
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
  text-align: center;
}

.preset-tag:hover, .preset-tag.active {
  background: var(--accent-primary);
  color: #000;
  border-color: var(--accent-primary);
  font-weight: 700;
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
  transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-up-enter-from, .slide-up-leave-to {
  transform: translate(-50%, 40px);
  opacity: 0;
}

/* 流體 RWD 斷點（依排版需求，非特定機型） */
/* 中等寬度：工具列轉為上下堆疊，隱藏直式分隔線 */
@media (max-width: 960px) {
  .controls-grid {
    flex-direction: column;
    align-items: stretch;
  }

  .ctrl-divider {
    display: none;
  }

  .ctrl-group.main-actions {
    flex-basis: auto;
    width: 100%;
  }

  .ctrl-sliders-row {
    flex-basis: auto;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ctrl-slider-item.speed-slider {
    grid-column: 1 / -1;
  }

  .floating-controls {
    padding: 12px 14px;
  }
}

/* 窄寬度：頂列與按鈕收斂，slider 維持可讀不爆版 */
@media (max-width: 640px) {
  .prompter-top-bar {
    padding: 8px 12px;
    gap: 8px;
  }

  .top-left, .top-right {
    min-width: 0;
    gap: 8px;
  }

  .script-title {
    font-size: 13px;
  }

  .btn-top-exit {
    padding: 5px 8px;
    font-size: 12px;
    gap: 4px;
    flex-shrink: 0;
  }

  .btn-icon-top {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
  }

  .floating-controls {
    bottom: calc(10px + env(safe-area-inset-bottom, 0px));
    width: calc(100vw - 16px);
    max-height: calc(100dvh - 120px);
  }

  .ctrl-group.main-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }

  .ctrl-group.main-actions .btn {
    padding: 8px 4px;
    font-size: 11px;
    justify-content: center;
    text-align: center;
  }

  .ctrl-group.main-actions .btn span {
    font-size: 11px;
  }

  .desktop-only {
    display: none !important;
  }

  .tap-hint-pill {
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    max-width: calc(100vw - 32px);
    white-space: normal;
    text-align: center;
  }
}

@media (max-width: 400px) {
  .top-left, .top-right {
    gap: 6px;
  }

  .ctrl-group.main-actions .btn {
    font-size: 10px;
    padding: 7px 2px;
  }

  .ctrl-group.main-actions .btn span {
    font-size: 10px;
  }

  .ctrl-sliders-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
