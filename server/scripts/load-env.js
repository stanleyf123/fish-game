'use strict';
// Dev stub: snapshot omits full scripts/; parse optional .env without overriding existing env.
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '../.env');
if (!fs.existsSync(envPath)) return;
for (const line of fs.readFileSync(envPath, 'utf8').split(/\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 1) continue;
  const k = t.slice(0, i).trim();
  if (process.env[k] != null && process.env[k] !== '') continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[k] = v;
}
