# 悠游水族箱 1028 交付報告

（同 `/opt/cursor/artifacts/REPORT-1028.md` 內容；完整版見該路徑。）

## 部署

1. 替換正式 `index.html`
2. `DATA_DIR=... node scripts/patch-config.js seed/plants-1028-patch.json`
3. 部署 `server-changes.tgz` 內 `players.js`、`anticheat.js`
4. 重啟服務

## 測試

`cd server && npm test` → 3/3 通過

## 交付物

`index.html`、`client.diff`、`server-changes.tgz`、`plants-1028-patch.json`、`screenshots/`、本報告詳版在 artifacts。
