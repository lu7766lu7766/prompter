// 文稿統計共用工具：字數去除標點符號，預估時間以固定 WPM 計算
export const DEFAULT_WPM = 220;

/** 去除標點符號 / 符號 / 空白後的有效字數 */
export function countEffectiveWords(content: string): number {
  if (!content) return 0;
  return content.replace(/[\p{P}\p{S}\s]/gu, '').length;
}

/** 以每分鐘 wpm 字估算朗讀秒數 */
export function estimateSpeechSeconds(wordCount: number, wpm: number = DEFAULT_WPM): number {
  if (!wordCount || wordCount <= 0) return 0;
  return Math.round((wordCount / wpm) * 60);
}
