// 文稿統計共用工具：字數去除標點符號，預估時間以固定 WPM 計算
export const DEFAULT_WPM = 220;

/** 去除標點符號 / 符號 / 空白後的有效字數（中日韓逐字計算、英文依單字計算） */
export function countEffectiveWords(content: string): number {
  if (!content) return 0;
  // 中日韓文字逐字計數
  const cjkMatches = content.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  // 英數字詞依完整單字計數
  const wordMatches = content.match(/[a-zA-Z0-9_\-]+/g);
  const wordCount = wordMatches ? wordMatches.length : 0;

  const total = cjkCount + wordCount;
  if (total > 0) return total;
  // 後備方案：去除標點符號空白後計算字元數
  return content.replace(/[\p{P}\p{S}\s]/gu, '').length;
}

/** 以每分鐘 wpm 字估算朗讀秒數 */
export function estimateSpeechSeconds(wordCount: number, wpm: number = DEFAULT_WPM): number {
  if (!wordCount || wordCount <= 0) return 0;
  return Math.round((wordCount / wpm) * 60);
}

