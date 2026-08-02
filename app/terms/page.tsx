import Link from "next/link";

export const metadata = { title: "服務條款｜陀螺集結 X-BeyLink" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
        ← 首頁
      </Link>
      <h1 className="mt-4 text-2xl font-black">服務條款與隱私說明</h1>
      <div className="mt-4 space-y-5 text-sm leading-relaxed text-slate-300">
        <section>
          <h2 className="font-bold text-cyanx">1. 平台性質</h2>
          <p className="mt-1">
            陀螺集結（X-BeyLink）是戰鬥陀螺（BEYBLADE X）比賽的報名媒合平台。比賽由各主辦方（店家）舉辦，平台提供報名、報到與數位獎盃紀錄服務；賽事現場的安排與安全由主辦方負責。
          </p>
        </section>
        <section>
          <h2 className="font-bold text-cyanx">2. 帳號與兒少保護</h2>
          <p className="mt-1">
            本平台以 LINE 帳號登入，選手多為未成年人，帳號應由家長／監護人建立與管理。我們刻意不蒐集選手的真實姓名、照片或聯絡方式：選手僅以自訂暱稱與虛擬頭像呈現，暱稱經過不當字詞過濾。公開頁面只顯示暱稱、頭像、戰績與獎盃。
          </p>
        </section>
        <section>
          <h2 className="font-bold text-cyanx">3. 個人資料</h2>
          <p className="mt-1">
            平台儲存的資料包括：LINE 帳號識別碼與顯示名稱、選手暱稱與出生年（用於分組）、報名與出席紀錄、獎盃紀錄。資料僅用於平台服務運作與賽事推播通知，不會提供給第三方作行銷使用。如需刪除帳號資料，請透過官方帳號聯絡我們。
          </p>
        </section>
        <section>
          <h2 className="font-bold text-cyanx">4. 信譽制度</h2>
          <p className="mt-1">
            為了保障成團品質：無故缺席記 1 點、開賽前 72 小時內取消記 0.5 點；累計 2 點停權 30 天、3 點停權 90 天。賽事流局或主辦方取消時，玩家信譽一律不受影響。對記點有異議可向平台申訴。
          </p>
        </section>
        <section>
          <h2 className="font-bold text-cyanx">5. 數位獎盃</h2>
          <p className="mt-1">
            獎盃由該場賽事的主辦方於結算時發放，等級跟隨賽事（金／銀／銅），玩家不可自行修改；主辦方誤發可於 48 小時內撤回。獎盃為榮譽紀錄，不具財產價值。
          </p>
        </section>
        <section>
          <h2 className="font-bold text-cyanx">6. 條款更新</h2>
          <p className="mt-1">
            平台可能因服務調整而更新本條款，重大變更會透過官方帳號公告。繼續使用即視為同意更新後的條款。
          </p>
        </section>
        <p className="text-xs text-slate-500">2026 年 8 月版｜宜蘭試點</p>
      </div>
    </main>
  );
}
