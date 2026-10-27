# 悠游水族箱 1028 交付報告

## 摘要

| 項目 | 狀態 |
|------|------|
| (A) 魚店圖鑑式瀏覽 | 完成 |
| (B) 10 種新水草 | 完成（客戶端程序化生圖 + `seed/plants-1028-patch.json`） |
| (C) sync_required / 422 與反作弊誤殺 | 完成（客戶端恢復流程 + 伺服器 409/限流 + 事件計入） |
| 伺服器 `npm test` | 3/3 通過（含新增 sync-save 測試） |
| 截圖 | `screenshots/` 五張（390×844 / 375×812） |

## 部署時您需要做的事

1. **客戶端**：以本交付的 `index.html` 取代正式站的單頁客戶端（build 仍為 4.2.126 系列，含 `clientBuild` / `_serverSync` 修正）。
2. **伺服器設定**：在資料目錄所在環境執行  
   `DATA_DIR=<您的資料目錄> node scripts/patch-config.js seed/plants-1028-patch.json`  
   （或依現場慣例傳入 patch 路徑；patch 檔見 `plants-1028-patch.json`）。
3. **伺服器程式**：部署 `server-changes.tgz` 內的 `src/anticheat.js`、`src/players.js`；可選同步 `test/sync-save.test.cjs` 至 CI。
4. **重啟** Node 服務進程（無需改 DB schema）。

未觸及：價格經濟、支付、測試帳號、造景系列金幣加成、`legacyDeco` 修剪。

---

## 變更檔案清單

### 客戶端

| 檔案 | 說明 |
|------|------|
| `index.html` | 相對 live 基線之全部客戶端修改（見 `client.diff`） |

### 伺服器

| 檔案 | 說明 |
|------|------|
| `src/players.js` | `sync_required` → HTTP **409** 並附雲端 `save`；相同拒絕限流 |
| `src/anticheat.js` | 金幣速率計入 `deco_sell`、`fish_storage_*`、`task_coin_claim` 等事件 |
| `seed/plants-1028-patch.json` | 10 種水草 `aquascape.plants` 合併 patch |
| `test/sync-save.test.cjs` | sync / anticheat 回歸測試（新增） |

### 工具（非部署）

| 檔案 | 說明 |
|------|------|
| `tools/screenshot-ui.mjs` | 無頭截圖 |
| `tools/apply-features.mjs` | 開發用合併腳本（可選） |

---

## 變更函式／邏輯（依模組）

### (A) 魚店 — `ShopV2`（`index.html`）

- `familyChips` — 依清單魚種聚合 `familyName` 供橫滑 chips
- `fishBrowseBar` — 搜尋框、科別 chips、稀有度／價格排序 chips
- `fishHtml` — 在一般魚列表頂部插入 `fishBrowseBar`；篩選透過既有 `mxShopQ` + `MX.shopList` / `shopList`
- `mxToggle` — 支援 `familyName`、複合 `sort,sortDir`
- `persistShopQ` / `SHOP_Q_KEY`（`ff.shopFishQ`）— session 記住篩選
- 點擊 `data-shop-dex` → `FishDexUI.openFromShop`

### (A) 圖鑑 — `FishDexUI`

- `openFromShop`、`fromShop`、`back` — 從魚店進入詳情並可購買（`data-dex-buy`）
- `actions` — `fromShop` 時顯示購買按鈕

### (A) 列表 — `MX.shopList` / `shopList`

- 中文名部分比對、`sort: 'rarity'|'price'`、`sortDir`

### (B) 水草

- `GAME_CONFIG.aquascape.plants` — 10 keys：`riccia`, `anubias_petite`, `green_palace`, `limnophila_pagoda`, `water_orchid`, `bolbitis`, `staurogyne_repens`, `crypt_balansae`, `blyxa_japonica`, `salvinia_minima`
- `drawPlant` / `AQ` 程序化生圖 — 新/擴充 type（如 bushy、carpet、fern、stem、float 等，與 live 風格一致）

### (C) 雲端存檔 — `Cloud`

- `push` — `clientBuild`/`client` 帶入 `writeSave`；`409`/`sync_required` 時 `adoptCloudSave` + **單次**重試；指數退避；`sessionStorage` 恢復計數
- `rejectNotice` — sync 失敗時 toast + 提示手動重整
- `adoptCloudSave` — 重新拉取伺服器 save 並 `adopt`

### (C) 伺服器 — `players.js`

- 存檔拒絕：`code: 'sync_required'` 改 **409** + 附 `save`
- `RateLimiter`（或同等）— 限制相同玩家重複 sync 拒絕日誌/回應頻率
- 事件查詢擴充（供 anticheat）：`deco_sell`、`fish_storage_buy`/`sell`、`task_coin_claim` 等

### (C) 伺服器 — `anticheat.js`

- 將上述事件的 `sold`/`spent` 納入金幣變化合理範圍，降低造景出售、收藏庫、任務領幣誤殺

---

## 測試結果

```text
cd server && npm test
# ok 1 sync mismatch returns 409 with cloud save (not 422)
# ok 2 anticheat credits deco_sell event coins
# ok 3 anticheat credits fish_storage_buy spend
# tests 3, pass 3, fail 0
```

附註：交付包內 live 伺服器 tarball **未包含**您提到的四個既有失敗用例名稱；本次未新增失敗。

---

## 截圖

| 檔名 | 內容 |
|------|------|
| `shop-fish-search-390x844.png` | 魚店搜尋「燈」 |
| `shop-fish-family-sort-375x812.png` | 科別「燈魚・脂鯉」+ 稀有度↓ |
| `shop-fish-dex-detail-390x844.png` | 從魚店開啟圖鑑詳情 |
| `shop-plants-category-375x812.png` | 水草商店分類 |
| `tank-ten-new-plants-390x844.png` | 魚缸內 10 種新水草 |

---

## Artifacts 目錄

- `index.html` — 完整客戶端
- `client.diff` — 對 `baseline/client-index-live.html`
- `server-changes.tgz` — 變更的伺服器檔
- `server-players.diff` / `server-anticheat.diff`
- `plants-1028-patch.json`
- `screenshots/*.png`
