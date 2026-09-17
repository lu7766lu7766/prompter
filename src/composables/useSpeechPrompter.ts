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
  }

  // 規範化文字（去除標點、空白並轉小寫）
  function cleanText(str: string): string {
    return str
      .toLowerCase()
      .replace(/[，。！？、；：「」『』（）《》〈〉—…,.!?;:()\[\]"' \t\r\n]/g, '');
  }

  // 比對語音轉錄內容與文稿位置（滑動窗口對齊演算法）
  function matchTranscript(transcript: string) {
    const cleanedTranscript = cleanText(transcript);
    if (!cleanedTranscript || tokens.value.length === 0) return;

    lastRecognizedText.value = transcript;

    const startIdx = Math.max(0, currentTokenIndex.value);
    const windowSize = 45; // 往前搜尋最多 45 個有效字元
    const searchTokens = tokens.value.slice(startIdx, startIdx + windowSize);

    // 建立候選字串
    let candidateChars = '';
    const tokenIndexMap: number[] = [];

    searchTokens.forEach((tok, offset) => {
      if (!tok.isPunctuationOrSpace) {
        const cleaned = cleanText(tok.text);
        for (let c = 0; c < cleaned.length; c++) {
          candidateChars += cleaned[c];
          tokenIndexMap.push(startIdx + offset);
        }
      }
    });

    if (!candidateChars) return;

    // 從最新講到的字串末端取 2~6 個字作為搜尋錨點
    const queryLen = Math.min(cleanedTranscript.length, 6);
    const querySuffix = cleanedTranscript.slice(-queryLen);

    let matchPos = -1;

    // 優先匹配最後幾個字
    for (let len = queryLen; len >= 2; len--) {
      const sub = querySuffix.slice(-len);
      const found = candidateChars.indexOf(sub);
      if (found !== -1) {
        matchPos = found + len - 1;
        break;
      }
    }

    // 若末端沒對到，再嘗試用整段對齊
    if (matchPos === -1 && cleanedTranscript.length >= 3) {
      for (let len = Math.min(cleanedTranscript.length, 5); len >= 2; len--) {
        const sub = cleanedTranscript.slice(-len);
        const found = candidateChars.lastIndexOf(sub);
        if (found !== -1) {
          matchPos = found + len - 1;
          break;
        }
      }
    }

    if (matchPos !== -1 && matchPos < tokenIndexMap.length) {
      const targetTokenIdx = tokenIndexMap[matchPos];
      if (targetTokenIdx >= currentTokenIndex.value) {
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
