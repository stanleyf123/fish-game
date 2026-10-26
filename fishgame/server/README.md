# 悠游水族箱 後端伺服器 + 管理後台

單一 Node.js 程序（Express + SQLite / better-sqlite3），提供：

- `/api/*`：遊戲公開 API（設定檔、訪客帳號、雲端存檔、心跳、事件、公告、信箱、商城、金流 webhook）
- `/admin`：繁體中文管理後台（儀表板、遊戲設定、魚種、玩家、公告、獎勵、營收、商品、訂單、月卡會員、操作紀錄）
- `/sdk/fishsdk.js`、`/sdk/fishrender.js`：前端 SDK 與魚的繪製程式（後台預覽用，與 v1 相同的 look 參數）

正式環境由 **nginx 繼續提供靜態遊戲**（/var/www/feedfishs），只把 `/api/`、`/admin`、`/sdk/` 轉給 Node。

## 架構簡述

| 模組 | 說明 |
|---|---|
| `src/db.js` | SQLite schema（WAL）。所有資料都在 `DATA_DIR/fishgame.sqlite` 一個檔案 |
| `src/config-store.js` + `config-validate.js` | GAME_CONFIG 版本化（只增不改，回復＝建立新版本），驗證錯誤附欄位路徑 |
| `src/players.js` + `anticheat.js` | 訪客 token、帳號綁定（bcrypt）、存檔 rev 樂觀鎖、伺服器端合理性檢查 |
| `src/rewards.js` | 獎勵/補償（單人、全體、條件篩選）→ 遊戲內信箱領取時由伺服器寫入存檔 |
| `src/commerce.js` + `src/payments/*` | 商品、訂單、寶石帳本、月卡/權益、退款；金流抽象層（mock / 綠界 / Stripe） |
| `src/stats.js` | 儀表板與營收統計（台灣時間切日） |
| `src/admin-auth.js` | 後台登入（env 密碼）、Session cookie、CSRF、登入限流、操作紀錄 |

重點設計：
- 寶石（付費貨幣）**只存在伺服器帳本** `gem_ledger`，不在存檔裡；金幣仍在存檔。
- 購買或獎勵的金幣/魚/裝飾一律寄到信箱，玩家領取時伺服器直接寫入存檔（rev+1），防作弊檢查不會誤判。
- 金流 webhook：先驗簽，再以 `(provider, event_id)` 去重；`markPaid` 本身也是冪等的；金額不符會把訂單設為失敗。

## 本機執行

```bash
cd server
npm install
cp .env.example .env    # 改成本機值：NODE_ENV=development、DATA_DIR=./data、COOKIE_SECURE=0、SERVE_GAME_DIR=..、PAYMENT_MOCK_ENABLED=1
npm start               # http://127.0.0.1:3100/admin
npm run demo:seed       # 建立 160 位「示範-」玩家（is_demo=1），畫面展示用
npm run demo:clear      # 清除所有示範資料
npm test                # API 自動測試（node --test）
npm run shots           # headless Chrome 截圖 → shots/*.png（需先 npm start + demo:seed）
```

## 遊戲端整合（SDK）

```html
<script>window.AQUARIUM_CONFIG_URL = '/api/config';</script>
<script src="/sdk/fishsdk.js"></script>
<script>
  const sdk = FishSDK.create({ baseUrl: '' });
  const cfg = await sdk.loadConfig();          // 取代內建 GAME_CONFIG
  await sdk.ensureSession();                   // 自動建立訪客帳號（裝置 token 存 localStorage）
  const { save } = await sdk.loadSave();
  sdk.startHeartbeat();
  const r = await sdk.writeSave(state);        // ok / conflict(409) / rejected(422) / tooFrequent(429)
  const mail = await sdk.getMailbox(); await sdk.claimMail(id);
  const products = await sdk.listProducts();
  await sdk.createOrder('gems_330');           // 目前只有模擬金流
  const ent = await sdk.getEntitlements(); const gems = await sdk.getPremiumBalance();
</script>
```

完整說明見 `public/fishsdk.js` 開頭註解。

## 部署（Linode Ubuntu，尚未執行）

1. 安裝 Node 20 LTS（NodeSource），`sudo useradd --system --home /opt/fishgame --shell /usr/sbin/nologin fishgame`
2. 把 `server/` 放到 `/opt/fishgame/server`，`npm ci --omit=dev`（better-sqlite3 v11 對 Node 20 x64 有預編譯檔）
3. `sudo mkdir /etc/fishgame && sudo cp .env.example /etc/fishgame/fishgame.env`，填入密碼（`openssl rand -hex 32`），`chmod 640`、`chown root:fishgame`
4. `sudo cp deploy/fishgame.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now fishgame`
5. 把 `deploy/nginx-feedfishs.conf` 的 location 貼進 www.feedfishs.com 的 443 server 區塊，`sudo nginx -t && sudo systemctl reload nginx`
6. 驗證 `curl https://www.feedfishs.com/api/health`，登入 `/admin`
7. 備份：每日 `sqlite3 /var/lib/fishgame/fishgame.sqlite ".backup /var/backups/fishgame-$(date +%F).db"`（cron）

## 付費功能上線前需要

- **金流特店**：綠界 ECPay 特店（需公司或行號登記）／或 Stripe 帳號；取得 MerchantID、HashKey、HashIV／Secret key、Webhook secret
- 先用 `ECPAY_STAGE=1` 測試環境完成串接測試（目前 ECPay/Stripe 只有實作骨架與簽章單元測試，**尚未對沙盒實測**）；退款 API 尚未實作（後台退款只處理遊戲內回收，金流端需在特店後台手動退）
- 設定 `PUBLIC_BASE_URL`、`PAYMENT_MOCK_ENABLED=0`，並在後台把商品「上架」
- **法務／消保**：
  - 退款政策與數位內容「解除權」說明（消保法第 19 條例外需事先告知並取得同意）
  - 定型化契約／使用者條款、虛擬貨幣（寶石）使用期限與不可轉讓說明
  - 個資法：隱私權政策／個資告知事項（蒐集目的、類別、利用期間地區對象、當事人權利）
  - 月卡自動續訂（若有）需明確揭露；發票（綠界可整合電子發票）
  - 遊戲軟體分級標示
