import { ref, computed, onUnmounted } from 'vue';

// 字符/單詞 Token 介面
export interface PrompterToken {
  id: number;
  text: string;
  isPunctuationOrSpace: boolean;
  isNewline: boolean;
}

// 宣告 Web Speech API 型別
interface SpeechRecognitionResult {
  readonly length: number;
  [index: number]: {
    readonly transcript: string;
    readonly confidence: number;
  };
  readonly isFinal: boolean;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: ISpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: ISpeechRecognition, ev: any) => void) | null;
  onend: ((this: ISpeechRecognition, ev: Event) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => ISpeechRecognition;
    webkitSpeechRecognition?: new () => ISpeechRecognition;
  }
}

// 自動判斷語言演算法
export function detectLanguage(content: string): string {
  if (!content || !content.trim()) {
    if (typeof navigator !== 'undefined' && navigator.language) {
      if (navigator.language.startsWith('zh-CN') || navigator.language.startsWith('zh-SG')) return 'zh-CN';
      if (navigator.language.startsWith('en')) return 'en-US';
      return 'zh-TW';
    }
    return 'zh-TW';
  }

  // 計算英文字母數量
  const latinMatches = content.match(/[a-zA-Z]/g);
  const latinCount = latinMatches ? latinMatches.length : 0;

  // 計算中文字元數量
  const cjkMatches = content.match(/[\u4e00-\u9fa5]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;

  // 若英文字元顯著多於中文字元，或有一定英文且無中文，則判定為英文
  if (latinCount > cjkCount * 1.2 || (latinCount > 10 && cjkCount === 0)) {
    return 'en-US';
  }

  // 若以中文為主
  if (cjkCount > 0) {
    // 簡體特徵字元比對
    const simpRegex = /[们这为来时说发对经国学实开样么见应关现将头进长机边过车门体变听让带总认给华济选导计东农电页]/g;
    // 繁體特徵字元比對
    const tradRegex = /[們這為來時說發對經國學實開樣麼見應關現將頭進長機邊過車門體變聽讓帶總認給華濟選導計東農電頁臺點]/g;

    const simpMatches = content.match(simpRegex);
    const tradMatches = content.match(tradRegex);
    const simpCount = simpMatches ? simpMatches.length : 0;
    const tradCount = tradMatches ? tradMatches.length : 0;

    if (simpCount > tradCount) {
      return 'zh-CN';
    }
    return 'zh-TW';
  }

  return 'zh-TW';
}

export function useSpeechPrompter() {
  const isSupported = ref<boolean>(
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  );

  const isListening = ref<boolean>(false);
  const speechLang = ref<string>('zh-TW');
  const interimText = ref<string>('');
  const lastRecognizedText = ref<string>('');
  const errorMessage = ref<string>('');
  const micVolume = ref<number>(0);
  // 環境音閘門：音量低於此值且文本又短時，視為環境音不推進（可在 UI 調整）
  const noiseGateThreshold = ref<number>(10);
  const lastConfidence = ref<number>(0);

  // 遠距跳段待確認狀態（需連續兩次指向同一區才跳，避免雜音誤跳）
  let pendingFarCharIndex = -1;
  let pendingFarHits = 0;

  function setNoiseGate(v: number) {
    noiseGateThreshold.value = Math.min(40, Math.max(0, Math.round(v)));
  }

  // 當前朗讀匹配到的 Token 索引位置 (-1 表示尚未開始)
  const currentTokenIndex = ref<number>(-1);

  // 文稿 Tokens
  const tokens = ref<PrompterToken[]>([]);

  let recognition: ISpeechRecognition | null = null;
  let audioContext: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let analyser: AnalyserNode | null = null;
  let animFrameId: number | null = null;
  let wakeLock: any = null;
  let shouldKeepListening = false;

  // 將原始文稿解析為結構化 Token 清單
  function parseScriptToTokens(content: string) {
    // 自動判斷並套用辨識語言
    speechLang.value = detectLanguage(content);

    const list: PrompterToken[] = [];
    let id = 0;

    // 依字元解析（支援中文逐字、英文逐詞與換行排版）
    const lines = content.split('\n');

    lines.forEach((line, lineIdx) => {
      let i = 0;
      while (i < line.length) {
        const char = line[i];

        // 判斷是否為英數字詞
        if (/[a-zA-Z0-9]/.test(char)) {
          let word = '';
          while (i < line.length && /[a-zA-Z0-9_\-']/.test(line[i])) {
            word += line[i];
            i++;
          }
          list.push({
            id: id++,
            text: word,
            isPunctuationOrSpace: false,
            isNewline: false
          });
        } else if (/\s/.test(char)) {
          list.push({
            id: id++,
            text: char,
            isPunctuationOrSpace: true,
            isNewline: false
          });
          i++;
        } else if (/[，。！？、；：「」『』（）《》〈〉—…,.!?;:()\[\]"']/.test(char)) {
          list.push({
            id: id++,
            text: char,
            isPunctuationOrSpace: true,
            isNewline: false
          });
          i++;
        } else {
          // 中文字元或其他 Unicode 字元
          list.push({
            id: id++,
            text: char,
            isPunctuationOrSpace: false,
            isNewline: false
          });
          i++;
        }
      }

      if (lineIdx < lines.length - 1) {
        list.push({
          id: id++,
          text: '\n',
          isPunctuationOrSpace: true,
          isNewline: true
        });
      }
    });

    tokens.value = list;
    currentTokenIndex.value = -1;
    pendingFarCharIndex = -1;
    pendingFarHits = 0;
    buildCleanedCache();
  }

  // 全文快取字串與字元對齊對應表（支援快速遠程跳段搜尋）
  let fullCleanedText = '';
  let fullTokenMap: number[] = [];
  let tokenFirstCharIndex: number[] = [];

  function buildCleanedCache() {
    fullCleanedText = '';
    fullTokenMap = [];
    tokenFirstCharIndex = new Array(tokens.value.length).fill(0);

    tokens.value.forEach((tok) => {
      tokenFirstCharIndex[tok.id] = fullCleanedText.length;
      if (!tok.isPunctuationOrSpace) {
        const cleaned = cleanText(tok.text);
        for (let c = 0; c < cleaned.length; c++) {
          fullCleanedText += cleaned[c];
          fullTokenMap.push(tok.id);
        }
      }
    });
  }

  // 規範化文字（去除所有標點 / 符號 / 空白並轉小寫，與字數統計一致）
  function cleanText(str: string): string {
    return str.toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
  }

  // 在 haystack 中找出離 anchor 最近的 needle 出現位置（解決重複詞永遠命中第一個的問題）
  function findNearest(haystack: string, needle: string, anchor: number): number {
    if (!needle) return -1;
    let best = -1;
    let bestDist = Infinity;
    let from = 0;
    for (;;) {
      const found = haystack.indexOf(needle, from);
      if (found === -1) break;
      // 偏好前方（朗讀多半向前）：後方距離打 1.5 倍折扣，避免同分時亂跳回前文
      const dist = found <= anchor ? (anchor - found) * 1.5 : found - anchor;
      if (dist < bestDist) {
        bestDist = dist;
        best = found;
      }
      from = found + 1;
    }
    return best;
  }

  function charIndexToToken(charIndex: number): number | undefined {
    if (charIndex < 0 || charIndex >= fullTokenMap.length) return undefined;
    return fullTokenMap[charIndex];
  }

  function commitCharIndex(matchCharIndex: number) {
    const targetTokenIdx = charIndexToToken(matchCharIndex);
    if (targetTokenIdx !== undefined && targetTokenIdx !== currentTokenIndex.value) {
      currentTokenIndex.value = targetTokenIdx;
    }
  }

  // 比對語音轉錄內容與文稿位置
  // 策略：200 字窗內靈敏跟隨（取最長 anchor + 離現況最近者）；窗外遠跳需確認（final 強 anchor 直接跳，否則連兩次才跳）
  function matchTranscript(
    transcript: string,
    opts?: { isFinal?: boolean; confidence?: number; volume?: number }
  ) {
    const cleanedTranscript = cleanText(transcript);
    if (!cleanedTranscript || fullCleanedText.length === 0) return;

    lastRecognizedText.value = transcript;
    const isFinal = opts?.isFinal ?? false;
    const confidence = opts?.confidence ?? 0;
    if (typeof confidence === 'number' && confidence > 0) {
      lastConfidence.value = confidence;
    }
    const volume = opts?.volume ?? micVolume.value;

    // ---- 環境音閘門（現場雜音時不推進） ----
    // 太短的 interim 碎片多半是雜音
    if (!isFinal && cleanedTranscript.length < 2) return;
    // 音量低 + 文本短：視為環境音
    if (volume < noiseGateThreshold.value && cleanedTranscript.length < 6) return;
    // 瀏覽器明確回報低信心（0 視為未知，不擋）
    if (!isFinal && confidence > 0 && confidence < 0.35) return;

    // 取得當前朗讀進度在全文中的字元索引
    const currentIdx = currentTokenIndex.value;
    let currentCharPos = 0;
    if (currentIdx >= 0 && currentIdx < tokenFirstCharIndex.length) {
      currentCharPos = tokenFirstCharIndex[currentIdx];
    }

    // ========== 第一階段：200 字窗內跟隨 ==========
    const TRACK_BEFORE = 200;
    const TRACK_AFTER = 200;
    const localStart = Math.max(0, currentCharPos - TRACK_BEFORE);
    const localEnd = Math.min(fullCleanedText.length, currentCharPos + TRACK_AFTER);
    const localSlice = fullCleanedText.slice(localStart, localEnd);
    const localAnchor = currentCharPos - localStart;

    const maxLocalLen = Math.min(cleanedTranscript.length, 12);
    for (let len = maxLocalLen; len >= 2; len--) {
      // 短 anchor 只允許推進一小步時使用，避免 2~3 字重複詞亂跳：
      // 非 final 且 len < 4 時，只接受「向前小步」（40 字內）
      const sub = cleanedTranscript.slice(-len);
      const found = findNearest(localSlice, sub, localAnchor);
      if (found !== -1) {
        const absIdx = localStart + found + len - 1;
        const delta = absIdx - currentCharPos;
        if (!isFinal && len < 4 && (delta < 0 || delta > 40)) continue;
        // 後退需較強證據：interim 後退只接受 len >= 5
        if (!isFinal && delta < 0 && len < 5) continue;
        commitCharIndex(absIdx);
        // 窗內命中即清除遠跳待確認（已回到正常跟隨）
        pendingFarCharIndex = -1;
        pendingFarHits = 0;
        return;
      }
      // 長 anchor 優先：len >= 6 若沒找到才往更短嘗試；短 anchor 找到也可能誤判，
      // 但上面已加 delta / 後退 guards，可接受
    }

    // ========== 第二階段：窗外遠跳（需確認） ==========
    // interim 碎片不做遠跳；至少需要 6 字才考慮
    if (!isFinal || cleanedTranscript.length < 6) return;

    const anchorMaxLen = Math.min(cleanedTranscript.length, 12);
    let candidate = -1;
    let candidateLen = 0;

    // (A) 前方遠處（窗外之後）：anchor 12 -> 8
    const forwardStart = Math.min(fullCleanedText.length, currentCharPos + TRACK_AFTER);
    const forwardText = fullCleanedText.slice(forwardStart);
    for (let len = anchorMaxLen; len >= 8; len--) {
      const sub = cleanedTranscript.slice(-len);
      const found = forwardText.indexOf(sub);
      if (found !== -1) {
        candidate = forwardStart + found + len - 1;
        candidateLen = len;
        break;
      }
    }

    // (B) 後方遠處（跳回前文）：需要更長 anchor（12 -> 10），避免重複詞誤判
    if (candidate === -1) {
      const backEnd = Math.max(0, currentCharPos - TRACK_BEFORE);
      const backText = fullCleanedText.slice(0, backEnd);
      for (let len = anchorMaxLen; len >= 10; len--) {
        const sub = cleanedTranscript.slice(-len);
        const found = backText.lastIndexOf(sub);
        if (found !== -1) {
          candidate = found + len - 1;
          candidateLen = len;
          break;
        }
      }
    }

    if (candidate === -1) return;

    // 確認機制：連續兩次指向同一 ±60 字區才跳；final + 強 anchor（>=10）可直接跳
    if (pendingFarCharIndex >= 0 && Math.abs(candidate - pendingFarCharIndex) <= 60) {
      pendingFarHits += 1;
    } else {
      pendingFarCharIndex = candidate;
      pendingFarHits = 1;
    }
    if (pendingFarHits >= 2 || candidateLen >= 10) {
      commitCharIndex(candidate);
      pendingFarCharIndex = -1;
      pendingFarHits = 0;
    }
  }

  // 啟用螢幕常亮 (Screen Wake Lock API)
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLock = await (navigator as any).wakeLock.request('screen');
      } catch (err) {
        console.warn('Wake Lock request failed:', err);
      }
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  // 麥克風音量即時監聽（含降噪約束 + 平滑，避免環境音瞬間峰值誤觸）
  async function startAudioMonitor() {
    try {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
      } catch {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(mediaStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let smoothed = 0;
      const updateVolume = () => {
        if (!analyser) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const instant = Math.min(100, Math.round((avg / 128) * 100));
        smoothed = smoothed * 0.7 + instant * 0.3;
        micVolume.value = Math.round(smoothed);
        animFrameId = requestAnimationFrame(updateVolume);
      };
      updateVolume();
    } catch (e) {
      console.warn('Microphone volume monitor unavailable:', e);
    }
  }

  function stopAudioMonitor() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    micVolume.value = 0;
  }

  // 初始化並開始語音識別
  function startListening() {
    errorMessage.value = '';
    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      errorMessage.value = '目前瀏覽器不支援 Web Speech API，建議使用 Chrome 或 Edge 瀏覽器。';
      return;
    }

    shouldKeepListening = true;

    try {
      if (!recognition) {
        recognition = new SpeechRecognitionClass();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 3;
      }

      recognition.lang = speechLang.value;

      recognition.onstart = () => {
        isListening.value = true;
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = '';
        let final = '';
        let bestConfidence = 0;
        let hasFinal = false;

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          const alt = res[0];
          const conf = typeof alt?.confidence === 'number' ? alt.confidence : 0;
          if (conf > bestConfidence) bestConfidence = conf;
          if (res.isFinal) {
            hasFinal = true;
            final += alt?.transcript ?? '';
          } else {
            interim += alt?.transcript ?? '';
          }
        }
        if (bestConfidence > 0) lastConfidence.value = bestConfidence;

        interimText.value = interim || final;
        const textToMatch = final || interim;
        if (textToMatch) {
          matchTranscript(textToMatch, {
            isFinal: hasFinal,
            confidence: bestConfidence,
            volume: micVolume.value
          });
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') {
          // 靜音屬正常現象，不報錯
          return;
        }
        if (event.error === 'not-allowed') {
          errorMessage.value = '麥克風存取被拒絕，請至瀏覽器網址列左側允許麥克風權限。';
          shouldKeepListening = false;
          stopListening();
        } else {
          console.warn('Speech recognition warning/error:', event.error);
        }
      };

      recognition.onend = () => {
        // 連續識別模式自動重新連線
        if (shouldKeepListening) {
          try {
            recognition?.start();
          } catch (err) {
            // 已在啟動狀態
          }
        } else {
          isListening.value = false;
        }
      };

      recognition.start();
      startAudioMonitor();
      requestWakeLock();
    } catch (err: any) {
      console.error('Failed to start speech recognition:', err);
      errorMessage.value = '啟動語音識別失敗：' + (err?.message || '請確認麥克風設置');
      isListening.value = false;
    }
  }

  function stopListening() {
    shouldKeepListening = false;
    isListening.value = false;
    interimText.value = '';
    if (recognition) {
      try {
        recognition.stop();
      } catch (e) {}
    }
    stopAudioMonitor();
    releaseWakeLock();
  }

  function toggleListening() {
    if (isListening.value) {
      stopListening();
    } else {
      startListening();
    }
  }

  // 手動調整朗讀進度（點擊某個字或使用方向鍵）
  function jumpToTokenIndex(index: number) {
    if (index >= -1 && index < tokens.value.length) {
      currentTokenIndex.value = index;
      pendingFarCharIndex = -1;
      pendingFarHits = 0;
    }
  }

  function resetProgress() {
    currentTokenIndex.value = -1;
    interimText.value = '';
    lastRecognizedText.value = '';
    pendingFarCharIndex = -1;
    pendingFarHits = 0;
  }

  onUnmounted(() => {
    stopListening();
  });

  // 計算目前完成百分比
  const progressPercent = computed(() => {
    if (tokens.value.length === 0 || currentTokenIndex.value <= 0) return 0;
    return Math.min(100, Math.round((currentTokenIndex.value / (tokens.value.length - 1)) * 100));
  });

  return {
    isSupported,
    isListening,
    speechLang,
    interimText,
    lastRecognizedText,
    lastConfidence,
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
    toggleListening,
    jumpToTokenIndex,
    resetProgress
  };
}
