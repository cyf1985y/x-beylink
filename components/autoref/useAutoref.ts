"use client";

import { useCallback, useEffect, useState } from "react";
import { mergeSettings, type AutorefSettings } from "@/lib/autoref/settings";
import { storage } from "@/lib/autoref/storage";
import type { StoredCalibration } from "@/lib/autoref/vision/calibration";

/** 載入設定與校正資料（IndexedDB） */
export function useAutorefData() {
  const [settings, setSettings] = useState<AutorefSettings | null>(null);
  const [calibration, setCalibration] = useState<StoredCalibration | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([storage.getSettings(), storage.getCalibration()]);
      setSettings(mergeSettings(s));
      setCalibration(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSettings(mergeSettings(null));
      setCalibration(null);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const saveSettings = useCallback(async (s: AutorefSettings) => {
    setSettings(s);
    await storage.putSettings(s);
  }, []);

  return { settings, calibration, error, reload, saveSettings };
}

/** 秒數顯示（相對 LIVE） */
export function fmtSec(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  return `${s.toFixed(2)} 秒`;
}
