# 悠游水族箱 source snapshot — cursor-coinsink-b1

Pulled read-only from production on 2026-11-04 ~09:25 JST (UTC+9). No deploy, no server changes.

**Live `/var/www/feedfishs/index.html` md5 at pull time: `b47d2a8b84e95a51eed24fb9c47d7c54`** (copy in `client/index.html` matches). BUILD: see `BUILD=` in index.html → BUILD='4.2.186'.

> ⚠️ GitHub `stanleyf123/fish-game` is **STALE** — do NOT use it as a base. This package is the source of truth. Do not push to GitHub as a deploy path.

## Layout
| path | what |
|---|---|
| `client/` | `/var/www/feedfishs` — index.html, deco-series-client.js, purchase-info.html, invite-og.html, showcase/, og images, and all non-media files (js/json/html/css incl. every `meta.json`) under art/, fishing/, fishing-test/, yuyou-baby-test/ |
| `client/ART_FILES_EXCLUDED.tsv` | size+path of every excluded image/audio file (live folder is 155 MB; art/ 85 MB, yuyou-baby-test 51 MB) |
| `server/src/`, `server/admin/`, `server/package.json`, `server/package-lock.json` | `/opt/fishgame/server` code |
| `config/live-config-v59.json` | latest `config_versions` row (version 59, created 2026-11-01 21:50 JST, note「巨獸占格下修17種含原色釣魚，混種隨雙親重算」). Config only. |

Excluded: node_modules, .env*, /etc/fishgame/*, sqlite DB, backups/, logs, deploy/, test/, seed/, scripts/, keys, player data. Missing sprites will 404 locally; the game should fall back / show blanks — use live `https://` art URLs if visual checks are needed.

## Run client locally
```
cd client && python3 -m http.server 8080   # or: npx serve -l 8080 .
```
Open http://localhost:8080/ . API calls (/api/*) need the server below (or will fail → offline/guest behavior).

## Run server locally (no real keys)
Live: Node **v22.23.2**, `WorkingDirectory=/opt/fishgame/server`, `ExecStart=/usr/bin/node src/server.js` (env from /etc/fishgame/fishgame.env — NOT included, never request it).
```
cd server && npm ci            # better-sqlite3, sharp, express, bcryptjs
export NODE_ENV=development PORT=3000 HOST=127.0.0.1 DATA_DIR=./data \
  SESSION_SECRET=dev-only ADMIN_PASSWORD=dev-only PAYMENT_MOCK_ENABLED=1 \
  NEWEBPAY_POLL=0 SERVE_GAME_DIR=../client
mkdir -p data && node src/server.js     # or: npm start ; tests: npm test
```
Leave all ECPAY_*/NEWEBPAY_*/STRIPE_*/LINE_CHANNEL_SECRET unset (payments/LINE login disabled). Load `config/live-config-v59.json` via the admin config editor (/admin) or by inserting into the fresh DB's `config_versions` to reproduce live balance. Env var names the code reads: see `grep -rho "env\.[A-Z_]*" server/src`.

## Secrets check
grep for NEWEBPAY|ECPAY|HashKey|HashIV|LINODE|PASSWORD=|PRIVATE KEY|channel secret, emails, bcrypt hashes: only code identifiers / env var *names* / provider labels; config `pay` block holds only enabled flags. Only email: support@feedfishs.com (public) and you@example.com placeholder. One bcrypt string in players.js:119 is the constant dummy hash for timing-safe login (not a user's). **No secret values.**

## File list
see FILELIST.txt
