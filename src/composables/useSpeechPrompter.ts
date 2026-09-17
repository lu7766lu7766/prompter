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

  // 規範化文字（去除標點、空白並轉小寫）
  function cleanText(str: string): string {
    return str
      .toLowerCase()
      .replace(/[，。！？、；：「」『』（）《》〈〉—…,.!?;:()\[\]"' \t\r\n]/g, '');
  }

  // 比對語音轉錄內容與文稿位置（雙層階層搜尋：局部精確追蹤 + 遠距跳段跳篇搜尋）
  function matchTranscript(transcript: string) {
    const cleanedTranscript = cleanText(transcript);
    if (!cleanedTranscript || fullCleanedText.length === 0) return;

    lastRecognizedText.value = transcript;

    // 取得當前朗讀進度在全文中的字元索引
    const currentIdx = currentTokenIndex.value;
    let currentCharPos = 0;
    if (currentIdx >= 0 && currentIdx < tokenFirstCharIndex.length) {
      currentCharPos = tokenFirstCharIndex[currentIdx];
    }

    let matchCharIndex = -1;

    // ========== 第一階段：局部窗口搜尋 (優先防漂移) ==========
    // 在當前進度附近（前 15 字 ~ 後 90 字）尋找匹配，確保正常連續朗讀時平穩鎖定
    const localStart = Math.max(0, currentCharPos - 15);
    const localEnd = Math.min(fullCleanedText.length, currentCharPos + 90);
    const localSlice = fullCleanedText.slice(localStart, localEnd);

    const queryLen = Math.min(cleanedTranscript.length, 8);
    const querySuffix = cleanedTranscript.slice(-queryLen);

    // 1. 局部末端比對（長度從 queryLen 遞減到 2）
    for (let len = queryLen; len >= 2; len--) {
      const sub = querySuffix.slice(-len);
      const found = localSlice.indexOf(sub);
      if (found !== -1) {
        matchCharIndex = localStart + found + len - 1;
        break;
      }
    }

    // 2. 局部整句比對
    if (matchCharIndex === -1 && cleanedTranscript.length >= 3) {
      for (let len = Math.min(cleanedTranscript.length, 6); len >= 2; len--) {
        const sub = cleanedTranscript.slice(-len);
        const found = localSlice.lastIndexOf(sub);
        if (found !== -1) {
          matchCharIndex = localStart + found + len - 1;
          break;
        }
      }
    }

    // ========== 第二階段：遠程跨段落搜尋 (支援跳一段、跳兩段或跳大章節) ==========
    // 當局部窗口完全無法吻合時，代表講者跳過內容或念了遠處段落
    if (matchCharIndex === -1 && cleanedTranscript.length >= 3) {
      const anchorMaxLen = Math.min(cleanedTranscript.length, 12);
      const anchorSuffix = cleanedTranscript.slice(-anchorMaxLen);

      // (A) 優先搜尋前方遠處段落（從當前位置 + 30 之後往後找）
      const forwardStart = Math.min(fullCleanedText.length, currentCharPos + 30);
      const forwardText = fullCleanedText.slice(forwardStart);

      // 優先用末端 3~12 個字元比對後續段落
      for (let len = anchorMaxLen; len >= 3; len--) {
        const sub = anchorSuffix.slice(-len);
        const found = forwardText.indexOf(sub);
        if (found !== -1) {
          matchCharIndex = forwardStart + found + len - 1;
          break;
        }
      }

      // (B) 若末端沒對到，用最新整句或開頭 4~10 個字元在後續段落尋找
      if (matchCharIndex === -1 && cleanedTranscript.length >= 4) {
        for (let len = Math.min(cleanedTranscript.length, 10); len >= 4; len--) {
          const sub = cleanedTranscript.slice(0, len);
          const found = forwardText.indexOf(sub);
          if (found !== -1) {
            matchCharIndex = forwardStart + found + len - 1;
            break;
          }
        }
      }

      // (C) 全文範圍廣域比對（支援大跨度跳轉或跳回前文）
      if (matchCharIndex === -1 && anchorMaxLen >= 4) {
        for (let len = anchorMaxLen; len >= 4; len--) {
          const sub = anchorSuffix.slice(-len);
          const found = fullCleanedText.indexOf(sub);
          if (found !== -1) {
            matchCharIndex = found + len - 1;
            break;
          }
        }
      }
    }

    // ========== 更新朗讀 Token 位置 ==========
    if (matchCharIndex >= 0 && matchCharIndex < fullTokenMap.length) {
      const targetTokenIdx = fullTokenMap[matchCharIndex];
      if (targetTokenIdx !== undefined && targetTokenIdx !== currentTokenIndex.value) {
        currentTokenIndex.value = targetTokenIdx;
      }
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

  // 麥克風音量即時監聽
  async function startAudioMonitor() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(mediaStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        if (!analyser) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        micVolume.value = Math.min(100, Math.round((avg / 128) * 100));
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
        recognition.maxAlternatives = 1;
      }

      recognition.lang = speechLang.value;

      recognition.onstart = () => {
        isListening.value = true;
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            final += res[0].transcript;
          } else {
            interim += res[0].transcript;
          }
        }

        interimText.value = interim || final;
        const textToMatch = final || interim;
        if (textToMatch) {
          matchTranscript(textToMatch);
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
    }
  }

  function resetProgress() {
    currentTokenIndex.value = -1;
    interimText.value = '';
    lastRecognizedText.value = '';
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
    errorMessage,
    micVolume,
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
