/**
 * COINSINK-B2 設定檔升版說明（v72 → v73）
 *
 * 本檔案為 Fishman 操作文件，不含可執行程式碼。
 * 請在確認部署 COINSINK-B2 之後，將下列變更套用至 config_versions。
 *
 * ==========================================================================
 * 一、魚種金幣調整（discus 七彩系 coin 11 → 6）
 * ==========================================================================
 *
 * 修改項目：
 *   species.discusblue.coin  : 11  →  6
 *   species.discusred.coin   : 11  →  6
 *
 * 原因：七彩系同時透過 DR 遞減（同群 41-80 條降為 60%、81+ 條降為 30%）
 *       和 softcap 被壓制，基礎 coin 11 在 DR 豁免狀態下（少量飼養）
 *       仍可讓新手玩家每小時獲得超過其他魚種兩倍的收益。
 *       調整為 6 後，10 條以內仍比一般魚略高，但不再破壞經濟平衡。
 *
 * 注意事項：
 *   - discusblue × discusred 混種（hx:discusblue+discusred）的 coin
 *     由 hybrid.js 自動推算：min(max(6,6), round((6+6)/2 × 1.1 × 10)/10) = 6
 *     無需手動調整。
 *   - 不更動 discusblue.price（1700）與 discusred.price（1700）。
 *   - 不更動任何其他魚種。
 *
 * ==========================================================================
 * 二、全新設定鍵（coins 物件下新增三個欄位）
 * ==========================================================================
 *
 * 1. coins.dailyCapPerPlayer : 250000
 *    每名玩家每台北時間（UTC+8）自然日的最大魚兒生產金幣量。
 *    不計：IAP、商店金幣包、任務獎勵、郵件、補償、管理員贈與。
 *
 * 2. coins.drThresholds : [40, 80]
 *    DR（遞減收益）的魚隻數門檻。
 *    - 第 1 條到第 40 條：倍率 × 1.0（由 drRates[0] 決定）
 *    - 第 41 條到第 80 條：倍率 × 0.6（由 drRates[1] 決定）
 *    - 第 81 條以上：倍率 × 0.3（由 drRates[2] 決定）
 *
 * 3. coins.drRates : [1, 0.6, 0.3]
 *    DR 各階段的倍率，與 drThresholds 一一對應。
 *
 * ==========================================================================
 * 三、現有設定不動
 * ==========================================================================
 *
 * - coins.softcap（kneePerHour、exp）：維持不變。
 * - 其他所有魚種的 coin、price、tankSpace：維持不變。
 * - 造景、任務、海洋館、繁殖：維持不變。
 *
 * ==========================================================================
 * 四、DB migration（首次部署時執行一次）
 * ==========================================================================
 *
 * 在伺服器啟動時，daily-production.js 的 createTable() 會自動建立：
 *
 *   CREATE TABLE IF NOT EXISTS player_production_daily (
 *     player_id TEXT NOT NULL,
 *     day_key   TEXT NOT NULL,
 *     produced  INTEGER NOT NULL DEFAULT 0,
 *     PRIMARY KEY (player_id, day_key)
 *   );
 *
 * 不需要手動 migration，也不影響現有資料表。
 *
 * ==========================================================================
 * 五、版本號
 * ==========================================================================
 *
 * GAME_BUILD 客戶端：4.2.227 → 4.2.228（index.html 第 6928 行）
 * config_versions：  v72     → v73
 */

// 這個函式僅供在測試環境中驗證設定鍵是否正確套用
function verifyConfigV73(cfg) {
  const errors = [];
  if ((cfg.species?.discusblue?.coin || 0) !== 6) errors.push('discusblue.coin 應為 6');
  if ((cfg.species?.discusred?.coin || 0) !== 6) errors.push('discusred.coin 應為 6');
  if ((cfg.coins?.dailyCapPerPlayer || 0) !== 250000) errors.push('coins.dailyCapPerPlayer 應為 250000');
  const th = cfg.coins?.drThresholds;
  if (!Array.isArray(th) || th[0] !== 40 || th[1] !== 80) errors.push('coins.drThresholds 應為 [40, 80]');
  const rt = cfg.coins?.drRates;
  if (!Array.isArray(rt) || rt[0] !== 1 || rt[1] !== 0.6 || rt[2] !== 0.3) errors.push('coins.drRates 應為 [1, 0.6, 0.3]');
  return errors;
}

module.exports = { verifyConfigV73 };
