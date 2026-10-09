"use client";

/**
 * IndexedDB 儲存：校正資料、設定、比賽紀錄、每局影片與事件。不需要後端。
 */
import type { MatchState } from "./match.ts";
import type { AutorefSettings } from "./settings.ts";
import type { BattleCall, BattleEvent } from "./types.ts";
import type { StoredCalibration } from "./vision/calibration.ts";

const DB_NAME = "autoref";
const DB_VERSION = 1;

export interface BattleLog {
  /** `${matchId}:${battle}` */
  key: string;
  matchId: string;
  battle: number;
  call: BattleCall;
  events: BattleEvent[];
  /** LIVE 開始的影片時間（秒），回放對齊用 */
  liveAt: number | null;
  /** 錄影開始的影片時間 */
  recordAt: number | null;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("matches")) db.createObjectStore("matches", { keyPath: "id" });
      if (!db.objectStoreNames.contains("battles")) {
        const s = db.createObjectStore("battles", { keyPath: "key" });
        s.createIndex("matchId", "matchId");
      }
      if (!db.objectStoreNames.contains("videos")) db.createObjectStore("videos");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      })
  );
}

export const storage = {
  async getCalibration(): Promise<StoredCalibration | null> {
    return (await tx<StoredCalibration | undefined>("kv", "readonly", (s) => s.get("calibration"))) ?? null;
  },
  putCalibration(c: StoredCalibration) {
    return tx("kv", "readwrite", (s) => s.put(c, "calibration"));
  },
  deleteCalibration() {
    return tx("kv", "readwrite", (s) => s.delete("calibration"));
  },
  async getSettings(): Promise<Partial<AutorefSettings> | null> {
    return (await tx<Partial<AutorefSettings> | undefined>("kv", "readonly", (s) => s.get("settings"))) ?? null;
  },
  putSettings(v: AutorefSettings) {
    return tx("kv", "readwrite", (s) => s.put(v, "settings"));
  },
  async getCurrentMatchId(): Promise<string | null> {
    return (await tx<string | undefined>("kv", "readonly", (s) => s.get("currentMatch"))) ?? null;
  },
  putCurrentMatchId(id: string | null) {
    return id
      ? tx("kv", "readwrite", (s) => s.put(id, "currentMatch"))
      : tx("kv", "readwrite", (s) => s.delete("currentMatch"));
  },
  putMatch(m: MatchState) {
    return tx("matches", "readwrite", (s) => s.put(m));
  },
  async getMatch(id: string): Promise<MatchState | null> {
    return (await tx<MatchState | undefined>("matches", "readonly", (s) => s.get(id))) ?? null;
  },
  async listMatches(): Promise<MatchState[]> {
    const all = await tx<MatchState[]>("matches", "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },
  async deleteMatch(id: string) {
    const logs = await this.listBattles(id);
    for (const l of logs) {
      await tx("videos", "readwrite", (s) => s.delete(l.key));
      await tx("battles", "readwrite", (s) => s.delete(l.key));
    }
    await tx("matches", "readwrite", (s) => s.delete(id));
  },
  putBattle(b: BattleLog) {
    return tx("battles", "readwrite", (s) => s.put(b));
  },
  async listBattles(matchId: string): Promise<BattleLog[]> {
    const all = await tx<BattleLog[]>("battles", "readonly", (s) => s.index("matchId").getAll(matchId));
    return all.sort((a, b) => a.battle - b.battle);
  },
  putVideo(key: string, blob: Blob) {
    return tx("videos", "readwrite", (s) => s.put(blob, key));
  },
  async getVideo(key: string): Promise<Blob | null> {
    return (await tx<Blob | undefined>("videos", "readonly", (s) => s.get(key))) ?? null;
  },
  async estimate(): Promise<{ usage: number; quota: number } | null> {
    try {
      const e = await navigator.storage.estimate();
      return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
    } catch {
      return null;
    }
  },
};

/** 下載檔案（匯出 JSON／影片） */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
