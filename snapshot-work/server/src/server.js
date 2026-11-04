'use strict';
// 進入點：讀環境變數 → 建立 app → 監聽 PORT

// 讀取 .env（不覆蓋已存在的環境變數；正式環境由 systemd EnvironmentFile 提供）
require('../scripts/load-env');

const { createApp } = require('./app');
const { app, close } = createApp();
const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`[fishgame] 悠游水族箱伺服器啟動：http://${host}:${port}  (後台 /admin，API /api)`));
const shutdown = () => { server.close(() => { close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
