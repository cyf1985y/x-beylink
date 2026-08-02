import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * 伺服器端專用 Supabase client（service role）。
 * 本專案採自訂 LINE 登入（非 Supabase Auth），所有資料庫讀寫都在伺服器端進行，
 * 擁有權檢查在程式碼層執行；RLS 已開啟以阻擋 anon key 直連。
 * 絕不可將此 client 或 SUPABASE_SERVICE_ROLE_KEY 洩漏到瀏覽器端。
 */
let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 環境變數"
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // Next.js 會把 fetch GET 結果放進 Data Cache，導致頁面讀到舊資料；
      // 資料庫查詢一律不快取（bug：選手卡結算後仍顯示 0 獎盃）
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return cached;
}

export type DbUser = {
  id: string;
  line_user_id: string;
  display_name: string | null;
  created_at: string;
};

export type DbPlayer = {
  id: string;
  user_id: string;
  nickname: string;
  birth_year: number;
  avatar: string;
  attendance_ok: number;
  attendance_total: number;
  penalty_points: number;
  banned_until: string | null;
  created_at: string;
};
