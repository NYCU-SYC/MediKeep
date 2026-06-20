// Patient-facing problem hygiene.
//
// NHI 匯入 / 早期測試資料會把一些「不該出現在病人眼前」的東西混進 Problem 清單：
//   1. 明顯的垃圾名稱（例如測試用的 "SSSSSSSS"、單一字元重複、空字串）
//   2. 純標點 / 過短的無意義字串
//
// 這裡只在「呈現層」過濾，不刪除任何資料（CMO 後台仍看得到、可整理）。
// 真正的結構化整理（把急性就診描述收斂成慢性 Problem）屬後端 NHI 整理層，另案處理。

export function isJunkProblemName(name: string | null | undefined): boolean {
  const s = (name ?? '').trim();
  if (!s) return true;
  // 單一字元重複 4 次以上：SSSSSSSS、aaaa、＝＝＝＝ …
  if (/^(.)\1{3,}$/.test(s)) return true;
  // 去掉空白後，只剩標點/符號，沒有任何中英數
  if (!/[\p{L}\p{N}]/u.test(s)) return true;
  // 全形/半形重複符號占滿（例如 "----"、"．．．．"）
  if (/^[\s\-_.·。，、=＝]+$/.test(s)) return true;
  return false;
}

export function cleanPatientProblems<T extends { display_name?: string | null; display_layman?: string | null }>(
  list: T[],
): T[] {
  return (list ?? []).filter(
    (p) => !(isJunkProblemName(p.display_name) && isJunkProblemName(p.display_layman)),
  );
}
