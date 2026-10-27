# cursor-batch-1028 — prep package for 悠游水族箱 cloud agent

Live snapshot time: **2026-10-27 17:09 UTC** (Taipei 10/28 01:09). **Read-only prep; no deploy.**

## Contents

| path | md5 / note |
|------|------------|
| `client-index-live.html` | live `/var/www/feedfishs/index.html` |
| `deco-series-client.js` | live companion JS |
| `server-src-live.tgz` | live `/opt/fishgame/server/{src,scripts}` only |
| `422-report.md` | 422 root-cause analysis |
| `plants-spec.md` / `plants-config.json` / `plants/` | plant system + art |
| `fish-spec.md` / `species-summary.json` | shop/圖鑑 data map |
| `plants-existing.json` | full live plant catalog dump |

## Live build

- Client `BUILD='4.2.126'` (md5 below — **newer than 2026-10-26 r10 bacteria deploy**).
- Server `players.js` still includes BACTERIA-AUTO-NUM-V1 normalize.

## Must-know for Cursor

1. **Do not push to GitHub** as the deploy path; owner ships via server. This zip is the source of truth vs stale GitHub.
2. **5 of 10 requested plants already exist** — see `plants-spec.md`. Only add 5 new procedural config keys.
3. **In-tank plants are procedural canvas**, not PNG sprites. Package PNGs are design references.
4. **Most 422s are `sync_required`**, not coin anticheat — see `422-report.md`.
5. No `node_modules`, `.env`, DB, backups, or secrets in this package.
