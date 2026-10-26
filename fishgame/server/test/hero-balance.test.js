'use strict';
// 英雄魚平衡：所有魚種（＋隨機混種）在相同等級、無訓練、無裝備下兩兩對打（互換攻守），
// 任何魚種勝率都不可超過 65%。結果寫入 hero/BALANCE.md 與 hero/balance-lv10.csv。
// 預設測 Lv10（全對全）＋ Lv1、Lv30（每魚種隨機 40 對手）；HERO_BALANCE_FULL=1 時三個等級都全對全。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runBalance } = require('../src/hero/balance');
const { HERO_DEFAULT_CONFIG: H } = require('../src/hero/default-config');
const G = require('../seed/default-config.json');

const OUT = path.join(__dirname, '..', '..', 'hero');
const pct = (x) => (x * 100).toFixed(1) + '%';

test('平衡：任何魚種在同等級同裝備下勝率 ≤ 65%（含混種）', { timeout: 600000 }, () => {
  const full = process.env.HERO_BALANCE_FULL === '1';
  const runs = [
    { level: 10, opponents: 0, hybrids: 40 },
    { level: 1, opponents: full ? 0 : 80, hybrids: 40 },
    { level: 30, opponents: full ? 0 : 80, hybrids: 40 },
  ];
  const results = runs.map((o) => ({ ...o, r: runBalance(H, G, { ...o, seed: 777 }) }));
  // ---- 報表 ----
  const lines = ['# 英雄魚 平衡模擬報告', '', `產生時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}（台灣時間）・由 \`server/test/hero-balance.test.js\` 自動產生`, '',
    '條件：同等級、成年、無訓練、無裝備、預設技能（依等級解鎖）；每一對互換攻守各打一次（不同種子）。混種為隨機抽 40 組。', '',
    '| 等級 | 對戰方式 | 魚種數 | 場數 | 最高勝率 | 最低勝率 | 超時判定比例 | 平均行動數 |', '|---|---|---|---|---|---|---|---|'];
  for (const { level, opponents, r } of results) lines.push(`| Lv${level} | ${opponents ? `每魚種隨機 ${opponents} 對手×2` : '全對全×2'} | ${r.rows.length} | ${r.battles.toLocaleString()} | ${pct(r.max.winrate)}（${r.max.name}） | ${pct(r.min.winrate)}（${r.min.name}） | ${pct(r.timeouts / r.battles)} | ${r.avgActions.toFixed(1)} |`);
  const r10 = results[0].r;
  lines.push('', '## Lv10 科別勝率', '', '| 科別 | 魚種數 | 勝率 |', '|---|---|---|');
  for (const f of r10.families) lines.push(`| ${f.family === 'hybrid' ? '混種' : (H.families[f.family] || {}).name || f.family} (${f.family}) | ${f.species} | ${pct(f.winrate)} |`);
  const row = (x) => `| ${x.name} | ${x.id} | ${x.family} | ${pct(x.winrate)} | ${x.hp} | ${x.atk} | ${x.def} | ${x.spd} | ${(x.crit / 10).toFixed(1)}% | ${x.skills.map((s) => H.skills[s].name).join('、')} | ${x.fair} |`;
  const hdr = ['| 魚種 | 代號 | 科別 | 勝率 | HP | 攻 | 防 | 速 | 暴擊 | 技能 | 公平係數 |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  lines.push('', '## Lv10 勝率最高 15', '', ...hdr, ...r10.rows.slice(0, 15).map(row));
  lines.push('', '## Lv10 勝率最低 15', '', ...hdr, ...r10.rows.slice(-15).map(row));
  lines.push('', '完整 Lv10 表格：`hero/balance-lv10.csv`', '');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'BALANCE.md'), lines.join('\n'));
  fs.writeFileSync(path.join(OUT, 'balance-lv10.csv'), '\uFEFFid,name,family,winrate,games,hp,atk,def,spd,crit_permille,skills,fair\n' + r10.rows.map((x) => [x.id, x.name, x.family, x.winrate.toFixed(4), x.games, x.hp, x.atk, x.def, x.spd, x.crit, x.skills.join('|'), x.fair].join(',')).join('\n'));
  for (const { level, r } of results) {
    assert.ok(r.max.winrate <= 0.65, `Lv${level} ${r.max.name}(${r.max.id}) 勝率 ${pct(r.max.winrate)} 超過 65%`);
    assert.ok(r.min.winrate >= 0.3, `Lv${level} ${r.min.name}(${r.min.id}) 勝率 ${pct(r.min.winrate)} 過低`);
  }
});
