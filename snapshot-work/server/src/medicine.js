'use strict';
// 💊 藥品（v4.0.5）：寶石特效藥由伺服器扣寶石後寫入存檔 items.<id>；金幣魚藥由客戶端購買（防作弊計入花費）
// 使用藥品在客戶端（扣 items 數量 → 魚 health / imm（免疫到期時間）/ herb（草本藥效到期時間））；防作弊檢查「有用掉藥才可以出現新的免疫」
const MS_H = 3600000;
function medCfg(cfg) { const m = cfg && cfg.medicine; return m && typeof m === 'object' && m.items && typeof m.items === 'object' ? m : null; }
function medItem(cfg, id) { const m = medCfg(cfg); if (!m || m.enabled === false) return null; const it = Object.prototype.hasOwnProperty.call(m.items, id) ? m.items[id] : null; return it && !it.disabled ? it : null; }
// 寶石價格：priceByCap = [[容量上限, 寶石], …]（由小到大），依目前魚缸容量決定；沒有就用 priceGems
function medPrice(it, cap) {
  if (Array.isArray(it.priceByCap) && it.priceByCap.length) { for (const [lim, g] of it.priceByCap) if (cap <= lim) return g; return it.priceByCap[it.priceByCap.length - 1][1]; }
  return it.priceGems || 0;
}
// 防作弊：回傳 { spent（金幣藥花費）, suspicious[] }
function medCheck(cfg, prev, next, nowMs) {
  const m = medCfg(cfg), out = { spent: 0, suspicious: [], limit: [] }; /*V406M*/
  if (!m) return out;
  const pi = (prev && prev.items) || {}, ni = (next && next.items) || {}, used = {};
  for (const [k, it] of Object.entries(m.items)) {
    const p0 = pi[k] || 0, n1 = ni[k] || 0;
    if (n1 > p0) { if (it.priceGems > 0 || Array.isArray(it.priceByCap)) out.suspicious.push(`藥品「${it.name}」只能用寶石購買`); else out.spent += (n1 - p0) * (it.price || 0); }
    used[k] = Math.max(0, p0 - n1);
  }
  let fishUsed = 0, tankImm = 0, herbUsed = 0, maxH = 0;
  for (const [k, it] of Object.entries(m.items)) {
    if ((it.immuneHours || 0) > 0) { maxH = Math.max(maxH, it.immuneHours); if (it.scope === 'tank') tankImm += used[k]; else fishUsed += used[k]; }
    if ((it.healPerHour || 0) > 0) { maxH = Math.max(maxH, it.hours || 0); herbUsed += used[k]; }
  }
  const pf = new Map(((prev && prev.fish) || []).map((f) => [f.id, f]));
  let immUp = 0, herbUp = 0;
  const lim = nowMs + (maxH || 0) * MS_H + 2 * MS_H; // 容許玩家手機時鐘誤差
  for (const f of (next && next.fish) || []) {
    const o = pf.get(f.id);
    if (typeof f.imm === 'number' && f.imm > ((o && o.imm) || 0) + 60000) immUp++;
    if (typeof f.herb === 'number' && f.herb > ((o && o.herb) || 0) + 60000) herbUp++;
    if ((typeof f.imm === 'number' && f.imm > lim && f.imm > ((o && o.imm) || 0)) || (typeof f.herb === 'number' && f.herb > lim && f.herb > ((o && o.herb) || 0))) out.suspicious.push('藥效時間超過上限');
  }
  if (prev && immUp > 0 && !tankImm && immUp > fishUsed) out.suspicious.push(`有 ${immUp} 條魚出現新的免疫，但只用掉 ${fishUsed} 份特效藥`);
  // 草本魚藥（金幣藥、效果小）：同一次存檔內「買了又用掉」數量不變，無法分辨，所以只檢查藥效時間上限
  // v4.0.6：整缸冷卻（cooldownHours）。每次使用會把整缸的 herb 設成「用藥時間＋藥效小時」，所以兩次用藥的間隔＝新舊 herb 最大值的差
  if (prev && herbUp > 0) for (const [k, it] of Object.entries(m.items)) {
    if (!((it.healPerHour || 0) > 0) || !((it.cooldownHours || 0) > 0)) continue;
    const sc = Math.max(1, (cfg.care && cfg.care.timeScale) || 1), cd = it.cooldownHours * MS_H / sc;
    let pm = 0, nm = 0; for (const f of prev.fish || []) if (typeof f.herb === 'number') pm = Math.max(pm, f.herb);
    for (const f of next.fish || []) { const o = pf.get(f.id); if (typeof f.herb === 'number' && f.herb > ((o && o.herb) || 0) + 60000) nm = Math.max(nm, f.herb); }
    if (pm > 0 && nm > 0 && nm - pm < cd - 10 * 60000) out.limit.push(`「${it.name}」每 ${it.cooldownHours} 小時只能用一次（距離上次約 ${Math.max(0, Math.round((nm - pm) / 60000))} 分鐘）`);
  }
  out.suspicious = [...new Set(out.suspicious)];
  return out;
}
module.exports = { medCfg, medItem, medPrice, medCheck };
