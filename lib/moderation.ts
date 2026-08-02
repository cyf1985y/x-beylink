/**
 * 暱稱敏感詞檢查。
 * 選手多為 6–12 歲兒童，公開頁會顯示暱稱，需擋掉粗俗、歧視、成人字眼。
 * 比對前先正規化：轉小寫、移除空白與常見符號，避免用符號穿插繞過。
 */

const BLOCKLIST: string[] = [
  // 中文粗俗／攻擊性
  "幹",
  "靠北",
  "靠腰",
  "他媽",
  "她媽",
  "你媽",
  "妳媽",
  "媽的",
  "馬的",
  "操你",
  "肏",
  "雞掰",
  "機掰",
  "機歪",
  "雞歪",
  "北七",
  "白癡",
  "白痴",
  "智障",
  "腦殘",
  "低能",
  "廢物",
  "去死",
  "婊",
  "賤",
  "屌",
  "陽具",
  "自慰",
  "打炮",
  "打砲",
  "援交",
  "色情",
  // 英文
  "fuck",
  "fck",
  "fxck",
  "shit",
  "bitch",
  "asshole",
  "dick",
  "cock",
  "pussy",
  "cunt",
  "nigger",
  "nigga",
  "porn",
  "sex",
  "nazi",
  "hitler",
  // 假冒官方
  "官方",
  "admin",
  "administrator",
  "客服",
  "系統",
];

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s\-_\.\*·。，,!！?？~@#$%^&+=(){}\[\]<>/\\|'"`]/g, "");
}

/** 通過回傳 null，否則回傳錯誤訊息 */
export function checkNickname(nickname: string): string | null {
  const trimmed = nickname.trim();
  if (trimmed.length < 1) return "暱稱不能空白";
  if ([...trimmed].length > 12) return "暱稱最多 12 個字";
  const normalized = normalize(trimmed);
  if (normalized.length === 0) return "暱稱不能只有符號";
  for (const word of BLOCKLIST) {
    if (normalized.includes(normalize(word))) {
      return "暱稱含有不適當字詞，請換一個";
    }
  }
  return null;
}

/** 內建虛擬頭像（不蒐集兒童照片） */
export const AVATARS = [
  "🌀",
  "⚡",
  "🔥",
  "🐉",
  "🦁",
  "🐺",
  "🦅",
  "🛡️",
  "⚔️",
  "🌟",
  "🚀",
  "🤖",
  "👾",
  "🏆",
  "💎",
  "🌪️",
] as const;

export function isValidAvatar(avatar: string): boolean {
  return (AVATARS as readonly string[]).includes(avatar);
}

export function isValidBirthYear(year: number): boolean {
  const now = new Date().getFullYear();
  return Number.isInteger(year) && year >= now - 80 && year <= now - 3;
}
