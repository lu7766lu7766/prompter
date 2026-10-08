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

  // 重連狀態（解決長會話跑一段時間後引擎靜默死亡、需重整才恢復的問題）
  const isReconnecting = ref<boolean>(false);
  const lastResultAt = ref<number>(0); // 上次收到辨識結果的時間（Date.now），0 表尚未收到
  const statusTick = ref<number>(0); // 看門狗心跳計數，供 UI 重算「最後辨識 N 秒前」
  let starting = false; // 啟動中旗標，防併發 start()
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let restartAttempts = 0;
  let sessionStartAt = 0;
  let lastLoudAt = 0; // 上次麥克風音量超過閘門的時間（判斷使用者是否正在說話）

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
    // 音量低 + 文本短：視為環境音（有音量時 interim 全放行，即時跟隨）
    if (volume < noiseGateThreshold.value && cleanedTranscript.length < 6) return;
    // 註：interim 不做信心過濾（Chrome interim 常帶低信心值，擋掉會變成斷句才跳；
    // 200 字窗 + 最近匹配本身已具自我修正能力，遠跳則只允許 final）

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
      const sub = cleanedTranscript.slice(-len);
      const found = findNearest(localSlice, sub, localAnchor);
      if (found !== -1) {
        const absIdx = localStart + found + len - 1;
        const delta = absIdx - currentCharPos;

        // 短 anchor (len < 4，如 2~3 字常見詞)：無論 final 與否，極易在長文中重複，
        // 只允許就近向前小步跟隨（-4 到 +40 字以內），嚴禁大幅後退或大步向前跳
        if (len < 4 && (delta < -4 || delta > 40)) continue;

        // 後退需較強證據（朗讀主要為向前推進）：
        // - interim 後退只接受 len >= 5
        // - final 中度後退 (delta < -10) 需要 len >= 5；大幅後退 (delta < -30) 需要 len >= 8
        if (!isFinal && delta < 0 && len < 5) continue;
        if (isFinal && delta < -10 && len < 5) continue;
        if (isFinal && delta < -30 && len < 8) continue;

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
    // 防重入：已有監聽先拆掉，避免重試啟動時佔用兩條音軌
    stopAudioMonitor();
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
      // 全新會話狀態；實例一律由 doBoot 建立（首次與重連皆然，避免沿用卡死實例）
      sessionStartAt = 0;
      lastResultAt.value = 0;
      lastLoudAt = 0;
      restartAttempts = 0;
      isReconnecting.value = false;

      doBoot();
      startAudioMonitor();
      startWatchdog();
      requestWakeLock();
    } catch (err: any) {
      console.error('Failed to start speech recognition:', err);
      errorMessage.value = '啟動語音識別失敗：' + (err?.message || '請確認麥克風設置');
      isListening.value = false;
    }
  }

  // 將四個事件處理器掛到指定實例（每次重建新實例都呼叫一次）
  function attachHandlers(r: ISpeechRecognition) {
    r.onstart = () => {
      starting = false;
      restartAttempts = 0;
      isListening.value = true;
      isReconnecting.value = false;
      sessionStartAt = Date.now();
      errorMessage.value = '';
    };

    r.onresult = (event: SpeechRecognitionEvent) => {
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

        lastResultAt.value = Date.now();
        // 有結果流入代表引擎健康，重設計數器
        restartAttempts = 0;
        if (isReconnecting.value) isReconnecting.value = false;
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

    r.onerror = (event: any) => {
        const code = event?.error as string | undefined;
        if (code === 'no-speech') {
          // 靜音屬正常現象，不報錯（onend 會接著觸發重連）
          return;
        }
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          errorMessage.value = '麥克風存取被拒絕，請至瀏覽器網址列左側允許麥克風權限。';
          shouldKeepListening = false;
          stopListening();
          return;
        }
        if (code === 'audio-capture') {
          errorMessage.value = '找不到可用的麥克風（可能被其他程式佔用或裝置休眠），重連中…';
        } else if (code === 'network') {
          errorMessage.value = '語音辨識需要連網，網路異常時會自動重連…';
        } else {
          console.warn('Speech recognition warning/error:', code);
        }
        // 致命類錯誤（network / audio-capture / aborted / language 等）：
        // 丟棄舊實例，下次用全新實例啟動；onend 若跟著觸發則不再重複排程
        destroyRecognitionInstance();
        scheduleRestart(backoffDelay());
      };

    r.onend = () => {
      starting = false;
      if (!shouldKeepListening) {
        isListening.value = false;
        isReconnecting.value = false;
        return;
      }
      // 已有排程（例如 onerror 剛排過）就不再重複排
      if (restartTimer) return;
      scheduleRestart(backoffDelay());
    };
  }

  // 退避延遲：400ms → 800ms → 1500ms → 2500ms封頂，避免緊迴圈被瀏覽器節流
  function backoffDelay(): number {
    const steps = [400, 800, 1500, 2500];
    return steps[Math.min(restartAttempts, steps.length - 1)];
  }

  // 拆掉舊實例（不動排程計時器，供錯誤復原使用）
  function destroyRecognitionInstance() {
    const r = recognition;
    recognition = null;
    starting = false;
    pendingFarCharIndex = -1;
    pendingFarHits = 0;
    if (r) {
      r.onstart = null;
      r.onresult = null;
      r.onerror = null;
      r.onend = null;
      try {
        r.abort();
      } catch (e) {}
    }
  }

  // 排程重啟（冪等：重複呼叫只會重設計時器）
  function scheduleRestart(delayMs: number) {
    if (!shouldKeepListening) return;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    // 曾經成功跑過才顯示「重連中」，首次啟動失敗不閃爍
    if (isListening.value) isReconnecting.value = true;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      restartAttempts += 1;
      doBoot();
    }, delayMs);
  }

  // 用全新實例啟動一次辨識（每次重連都建新實例，避免沿用卡死的舊實例）
  function doBoot() {
    if (!shouldKeepListening || starting) return;
    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) return;
    // 先清掉可能卡死的舊實例
    destroyRecognitionInstance();
    starting = true;

    const r = new SpeechRecognitionClass();
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 3;
    r.lang = speechLang.value;
    attachHandlers(r);

    recognition = r;
    try {
      r.start();
    } catch (err) {
      // 同步啟動失敗（例如前一次還沒完全釋放）：退避重試，不吞掉狀態
      starting = false;
      scheduleRestart(backoffDelay());
    }
  }

  // 看門狗：每 2 秒檢查一次
  // 1) 有音量（使用者正在說話）卻久無辨識結果 → 實例已卡死 (wedged)，重建並給予寬限期杜絕死循環
  // 2) 預防性重建：單一會話超過 5 分鐘且使用者處於靜音停頓時才重建，嚴禁在發話途中暴力切斷
  // 3) AudioContext 被系統暫停 → 嘗試恢復，讓音量條與閘門保持可信
  function startWatchdog() {
    stopWatchdog();
    watchdogTimer = setInterval(() => {
      statusTick.value += 1;
      if (!shouldKeepListening) return;
      const now = Date.now();

      if (micVolume.value > noiseGateThreshold.value) {
        lastLoudAt = now;
      }

      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }

      // 使用者最近 3.5 秒內是否有發話
      const speakingRecently = lastLoudAt > 0 && now - lastLoudAt < 3500;
      // 距上次收到辨識結果經過的時間（若尚未收到任何結果，以會話啟動時間起算）
      const resultAge = lastResultAt.value === 0
        ? (sessionStartAt > 0 ? now - sessionStartAt : 0)
        : now - lastResultAt.value;

      // 狀況 1：會話已啟動超過 15 秒（給予連線握手充分寬限期），使用者持續發話但超過 12 秒無任何結果流入 → 卡死修復
      if (speakingRecently && sessionStartAt > 0 && now - sessionStartAt > 15000 && resultAge > 12000) {
        console.warn('Speech recognition wedged detected, restarting session...');
        sessionStartAt = now;
        lastResultAt.value = now; // 關鍵修復：重設為目前時間，給予新實例完整寬限期，杜絕每 2 秒重啟死循環
        destroyRecognitionInstance();
        scheduleRestart(400);
        return;
      }

      // 狀況 2：超長會話（> 5 分鐘）預防性維護：
      // 絕對不可在發話中切斷！必須在使用者「處於靜音停頓且至少 3 秒沒聲音」時才執行平滑維護
      const isSilentPause = !speakingRecently && (lastLoudAt === 0 || now - lastLoudAt > 3000);
      if (sessionStartAt > 0 && now - sessionStartAt > 5 * 60 * 1000 && isSilentPause) {
        sessionStartAt = now;
        lastResultAt.value = now;
        destroyRecognitionInstance();
        scheduleRestart(400);
      }
    }, 2000);
  }

  function stopWatchdog() {
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  }

  function stopListening() {
    shouldKeepListening = false;
    isListening.value = false;
    isReconnecting.value = false;
    interimText.value = '';
    stopWatchdog();
    destroyRecognitionInstance();
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
    isReconnecting,
    lastResultAt,
    statusTick,
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
