"use client";

import { useEffect } from "react";

/** 註冊自動裁判的 service worker（離線可用）。只在 /autoref 底下生效。 */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/autoref-sw.js", { scope: "/autoref/" }).catch(() => {});
  }, []);
  return null;
}
