'use strict';
// 英雄魚模組掛載：建表、建立設定與服務、掛上 /api/hero 與 /admin/api/hero、提供後台頁 /admin/hero
// 整合：在 app.js 的 404 handler 之前呼叫 require('./hero/mount').mountHero(app, ctx)
const path = require('path');
const { migrate } = require('./migration');
const { HeroConfigStore } = require('./config');
const { HeroService } = require('./service');

// 預先算好的公平係數（scripts/hero-precompute.js → seed/hero-fair.json）：開機時匯入 hero_fair，避免第一次對戰冷啟動 ~9 秒
function importFair(ctx) {
  const file = (ctx.env && ctx.env.HERO_FAIR_FILE) || path.join(__dirname, '..', '..', 'seed', 'hero-fair.json');
  try {
    if (!require('fs').existsSync(file)) return 0;
    const { rows } = JSON.parse(require('fs').readFileSync(file, 'utf8'));
    const ins = ctx.db.prepare('INSERT OR IGNORE INTO hero_fair (k, m, created_at) VALUES (?,?,?)');
    const t = Date.now(); let n = 0;
    ctx.db.transaction(() => { for (const [k, m] of Object.entries(rows || {})) if (typeof m === 'number' && Number.isFinite(m)) n += ins.run(k, m, t).changes; })();
    if (n) console.log(`[hero] 匯入預先計算的公平係數 ${n} 筆`);
    return n;
  } catch (e) { console.warn('[hero] 匯入公平係數失敗（改由背景計算）：', e.message); return 0; }
}

function createHero(ctx) {
  migrate(ctx.db);
  importFair(ctx);
  const heroCfg = new HeroConfigStore(ctx.db);
  heroCfg.ensureSeed();
  return new HeroService(ctx, heroCfg);
}

function mountHero(app, ctx) {
  const hero = createHero(ctx);
  ctx.hero = hero;
  if (ctx.env.NODE_ENV !== 'test') hero.monthly.start();
  setImmediate(() => hero.startWarmup());
  app.use('/api/hero', require('../routes/hero')(ctx, hero));
  app.use('/admin/api/hero', require('./admin-routes')(ctx, hero));
  const adminDir = path.join(__dirname, '..', '..', 'admin');
  app.get('/admin/hero', (req, res) => {
    if (!ctx.adminAuth.session(req)) return res.redirect(302, '/admin/login');
    res.sendFile(path.join(adminDir, 'hero.html'));
  });
  // 前端模組：/sdk/hero.js（遊戲與後台共用；檔案在 repo 的 hero/hero.js，可用 HERO_CLIENT_PATH 指定）
  const fs = require('fs');
  const shipped = path.join(__dirname, '..', '..', 'public', 'hero.js');   // 部署封包內的副本（build-v4.sh 從 hero/hero.js 複製）
  const clientPath = (ctx.env && ctx.env.HERO_CLIENT_PATH) || (require('fs').existsSync(shipped) ? shipped : path.join(__dirname, '..', '..', '..', 'hero', 'hero.js'));
  app.get('/sdk/hero.js', (req, res, next) => {
    if (!fs.existsSync(clientPath)) return next();
    res.set('Cache-Control', 'public, max-age=300');
    res.type('application/javascript').sendFile(path.resolve(clientPath));
  });
  return hero;
}

module.exports = { mountHero, createHero };
