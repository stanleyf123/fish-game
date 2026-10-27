# HTTP 422 PUT /api/save — last ~24h analysis (read-only)

Window: ~2026-10-26 17:09 UTC → 2026-10-27 17:09 UTC (Taipei 10/27 01:09 → 10/28 01:09).  
Sources: nginx `feedfishs.access.log`, `events` table, `src/players.js` + `src/anticheat.js` from live snapshot. **No player names/IDs/tokens/IPs in examples.**

## Headline

| metric | value |
|--------|------:|
| PUT /api/save → **422** | **8080** |
| of which response body size **222** | **8067 (99.8%)** |
| distinct client IPs (all 422) | **21** |
| top IP share | **~7083 (~88%)** |
| logged `anticheat_reject` events | **24** |
| distinct players in those events | **5** |
| `antiCheat.mode` (live config) | **`reject`** |

**The ~400–700/hour 422 rate is almost entirely `code: sync_required`, not “suspicious values” anticheat.**  
True anticheat rejects are rare (~1/hour) and all were coin-rate related.

Hourly 422 (UTC 10/27): ~680–700 for hours 00–09, then ~170 for 10–15, then drop — consistent with a small number of stuck clients retrying.

## Where 422 is produced (code)

File: `server/src/players.js` → `putSave` → `HttpError(422, 'suspicious_save', …)`  
Emitter: `server/src/app.js` JSON `{ error, message, ...extra }`.

### A) `sync_required` (body size **222**) — dominant

```js
if (prev && prev._serverSync && next && next._serverSync !== prev._serverSync) {
  if (!build || cmpBuild(build, '4.2.10') < 0)
    throw new HttpError(422, 'suspicious_save', '儲值或獎勵已入帳，請更新遊戲載入最新魚缸',
      { code:'sync_required', reload:false, reasons:['儲值或獎勵已安全入帳，請手動重新整理以完成同步'] });
  throw new HttpError(409, 'server_state_changed', ...); // modern clients
}
```

- Fires when the cloud save has a newer `_serverSync` generation (payment/reward/server grant) than the client upload.
- **Old/missing `body.client` build (< 4.2.10)** → **422 sync_required**.
- Build ≥ 4.2.10 → **409** with cloud save payload (correct recovery).
- **Not written to `events`** (no `anticheat_reject` row) — nginx size is the fingerprint.
- Compact JSON length for this payload is exactly **222** bytes.

**Likely player impact:** anyone on a cached/old webview, missing client build header, or a bot/script that never adopts `_serverSync` will spin on 422 forever after any server grant. One IP produced the large majority of hits (retry ~every 20s).

### B) Anticheat `suspicious` → 422 (logged)

When `checkSave` returns `suspicious.length` and `antiCheat.mode === 'reject'`:

```js
this.logEvent(pid, 'anticheat_reject', { reasons, info, build, flagged:true });
return { rejected: { code:'suspicious', reasons, info } };
// → HttpError 422 suspicious_save
```

**Last 24h: 24 events, 5 players, 100% reason family = 金幣增加過快.**

| reason pattern | events | players |
|----------------|-------:|--------:|
| `金幣增加過快：+Δ，T 秒內上限約 Cap` (rate vs `baseAllowance` + elapsed×rate×`rateSlack` + sold − spent) | 23 | 5 |
| `金幣增加過快：新買的魚 🪙N 沒有扣到金幣` (buy without coin debit) | 1 | 1 |

Anonymized examples (deltas only):

1. Δcoins **+24719** in **51s**, cap ~**10318**, build 4.2.124 — rate far above `maxCoinRate`.
2. Δcoins **+4669** in **65s**, cap ~**4205**, build 4.2.125 — repeated bursts same player.
3. Δcoins **+21** but reason **新買的魚 🪙260 沒有扣到金幣** (spent accounted 670, sold 65) — shop debit desync.

Other 422 constructors (negligible in window): `client_outdated`, `med_cooldown`, `breed_limit` (1 med + 1 breed reject event).

Structural failures are **400** (`invalid_save`), not 422.

## Why journal/nginx alone looked like “suspicious values”

Client toast for all `suspicious_save` errors shares the family message 「存檔數值異常…」 / owner wording about suspicious values. **`sync_required` uses the same `error: suspicious_save` code** with a different `message` / `code` field. Counting nginx 422 without body/`code` conflates stuck sync with anticheat.

## What Cursor should fix (suggested)

1. **Treat `sync_required` as the main 422 volume:** ensure client always sends `client` build ≥ 4.2.10; on 422 with `code=sync_required` (or message 儲值或獎勵), **reload cloud save** / prompt refresh — do not retry the same payload. Consider server: always 409+save (even for old builds) or log `sync_required` events.
2. **Rate-limit or backoff** identical failing PUTs (one IP was ~7k/day).
3. **Coin-rate false positives (secondary):** review `maxCoinRate` / `rateSlack` / VIP / task-coin / storage-sell paths for the 5 players; the `新買的魚沒有扣到金幣` case is a real client debit bug to fix in shop buy.
4. Optional: log `code` + truncated reasons on every 422 to nginx or `events` so this triage does not need body-size forensics.

## Offline re-validation of saves

Skipped. Replaying anticheat on DB saves would require exporting player save blobs (personal game state). Events already carry anonymizable reason strings for true rejects; sync_required leaves no save diff to replay.
