import Dexie, { type Table } from 'dexie';

export interface ScriptItem {
  id?: number;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  wordCount: number;
  speechDurationSeconds: number;
  tags?: string[];
}

export interface PrompterSettings {
  id: string; // 'global'
  enableAutoScroll: boolean; // 自動滾動開關 (可與語音辨識同時開啟或關閉)
  enableVoice: boolean; // 語音辨識開關 (可與自動滾動同時開啟或關閉)
  scrollSpeed: number; // 滾動速度 1 ~ 10
  fontSize: number; // px, 24 ~ 96
  lineHeight: number; // 1.4 ~ 2.6
  containerWidth: number; // 400 ~ 1200
  mirrorH: boolean; // 水平鏡像
  mirrorV: boolean; // 垂直鏡像
  showGuideLine: boolean; // 焦點輔助線
  speechLang: string; // 'zh-TW' | 'en-US' | 'zh-CN'
  highlightColor: string; // 當前朗讀文字發光色
  speedWpm: number; // 預估語速
}

export class PrompterDatabase extends Dexie {
  scripts!: Table<ScriptItem, number>;
  settings!: Table<PrompterSettings, string>;

  constructor() {
    super('SmartPrompterDB');
    this.version(1).stores({
      scripts: '++id, title, createdAt, updatedAt',
      settings: 'id'
    });
  }
}

export const db = new PrompterDatabase();

export const DEFAULT_SETTINGS: PrompterSettings = {
  id: 'global',
  enableAutoScroll: true,
  enableVoice: true,
  scrollSpeed: 3,
  fontSize: 48,
  lineHeight: 1.8,
  containerWidth: 840,
  mirrorH: false,
  mirrorV: false,
  showGuideLine: true,
  speechLang: 'zh-TW',
  highlightColor: '#F59E0B',
  speedWpm: 220,
};

// 預設示範講稿（繁體中文）
export const SAMPLE_SCRIPT: Omit<ScriptItem, 'id'> = {
  title: '✨ 歡迎使用智慧語音提詞機（示範講稿）',
  content: `各位朋友大家好，歡迎使用全新一代的智慧語音讀稿機！

這是一款專為演講者、自媒體創作者以及專業影音錄製設計的純前端提詞工具。

當您按下麥克風按鈕開始演說時，系統會運用先進的語音識別技術，即時捕捉您的發音。

隨著您的朗讀進度，字詞會以卡拉 OK 般的發光效果逐字反白標記，並自動將您正在朗讀的句子平滑滾動至視野中央的焦點線。

無論您講得快、還是講得慢，提詞機都能靈敏跟隨您的節奏，徹底告別手動調節速度的困擾。

本工具具備完善的離線 PWA 支援，所有文稿皆安全存放在您的本機瀏覽器資料庫中，絕對不會上傳至任何雲端伺服器，全面保障您的隱私。

您還可以隨時使用控制面板，自由調整字體大小、行距、閱讀欄寬，甚至開啟水平鏡像翻轉以支援專業的分光鏡提詞器硬體。

現在，請深呼吸，按下上方或底部的開始按鈕，大聲唸出這段文字，親身體驗語音跟隨的流暢感吧！祝您演講圓滿精彩！`,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  wordCount: 350,
  speechDurationSeconds: 95,
  tags: ['歡迎', '示範', '語音辨識']
};

export async function initDatabase(): Promise<void> {
  try {
    const count = await db.scripts.count();
    if (count === 0) {
      await db.scripts.add({ ...SAMPLE_SCRIPT });
    }
    const settings = await db.settings.get('global');
    if (!settings) {
      await db.settings.put({ ...DEFAULT_SETTINGS });
    }
  } catch (err) {
    console.error('Failed to initialize IndexedDB:', err);
  }
}
