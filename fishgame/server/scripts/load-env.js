// 讀取 server/.env（若存在），不覆蓋既有環境變數
const fs = require('fs');
const path = require('path');
const f = process.env.ENV_FILE || path.join(__dirname, '..', '.env');
if (fs.existsSync(f)) for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
