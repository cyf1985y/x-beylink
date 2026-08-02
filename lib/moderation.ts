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
  "🦈",
  "🐯",
  "🦂",
  "🕷️",
  "🐍",
  "🛡️",
  "⚔️",
  "🌟",
  "☄️",
  "🚀",
  "🤖",
  "👾",
  "🥷",
  "🦸",
  "🏆",
  "💎",
  "🌪️",
] as const;

/** 台灣縣市（居住縣市選項） */
export const TAIWAN_CITIES = [
  "宜蘭縣",
  "基隆市",
  "台北市",
  "新北市",
  "桃園市",
  "新竹市",
  "新竹縣",
  "苗栗縣",
  "台中市",
  "彰化縣",
  "南投縣",
  "雲林縣",
  "嘉義市",
  "嘉義縣",
  "台南市",
  "高雄市",
  "屏東縣",
  "花蓮縣",
  "台東縣",
  "澎湖縣",
  "金門縣",
  "連江縣",
] as const;

export function isValidCity(city: string): boolean {
  return (TAIWAN_CITIES as readonly string[]).includes(city);
}

/** 戰隊名稱檢查（選填；同樣過敏感詞） */
export function checkTeamName(team: string): string | null {
  const trimmed = team.trim();
  if (trimmed.length === 0) return null; // 選填
  if ([...trimmed].length > 15) return "戰隊名稱最多 15 個字";
  const err = checkNickname(trimmed);
  if (err && err.includes("不適當")) return "戰隊名稱含有不適當字詞，請換一個";
  return null;
}

export function isValidAvatar(avatar: string): boolean {
  return (AVATARS as readonly string[]).includes(avatar);
}

export function isValidBirthYear(year: number): boolean {
  const now = new Date().getFullYear();
  return Number.isInteger(year) && year >= now - 80 && year <= now - 3;
}
