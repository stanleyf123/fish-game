'use strict';
const path = require('path');
const express = require('express');
const { openDb } = require('./db');
const { ConfigStore } = require('./config-store');
const { Players } = require('./players');
const { Rewards } = require('./rewards');
const { Commerce } = require('./commerce');
const { Stats } = require('./stats');
const { AdminAuth } = require('./admin-auth');
const { buildProviders } = require('./payments');
const { Pay } = require('./pay');
const { OAuth } = require('./oauth');
const { Newbie } = require('./newbie');
const { Invite } = require('./invite');
const { makeDayFn, HttpError } = require('./util');

const ROOT = path.join(__dirname, '..');

function createApp(opts = {}) {
  const env = { ...process.env, ...(opts.env || {}) };
  const adminPassword = env.ADMIN_PASSWORD;
  const sessionSecret = env.SESSION_SECRET;
  const prod = env.NODE_ENV === 'production';
  if (!adminPassword || !sessionSecret) throw new Error('必須設定 ADMIN_PASSWORD 與 SESSION_SECRET 環境變數');
  if (prod && (adminPassword.length < 8 || sessionSecret.length < 32)) throw new Error('正式環境 ADMIN_PASSWORD 至少 8 字元、SESSION_SECRET 至少 32 字元');
  if (prod && adminPassword.length < 12) console.warn('[fishgame] ⚠️ 建議：ADMIN_PASSWORD 少於 12 字元，請考慮改用更長的密碼（後台已有登入限流）');

  if (prod && env.PAYMENT_MOCK_ENABLED === '1') console.warn('[fishgame] ⚠️ 警告：正式環境啟用了模擬金流（PAYMENT_MOCK_ENABLED=1），任何人都能免費「付款」！');
  const db = openDb(opts.dataDir || env.DATA_DIR || path.join(ROOT, 'data'));
  const dayFn = makeDayFn(env.STATS_TZ || 'Asia/Taipei');
  const configStore = new ConfigStore(db);
  configStore.ensureSeed(opts.seedConfig || path.join(ROOT, 'seed/default-config.json'));
  const commerceRef = { current: null };
  const players = new Players(db, configStore, dayFn, commerceRef);
  /*V406P*/ require('./playstats').migrate(db, dayFn); const playstats = new (require('./playstats').PlayStats)(db, dayFn); players.ps = playstats;
  const rewards = new Rewards(db, players, configStore, commerceRef);
  const commerce = new Commerce(db, players, rewards, configStore, dayFn);
  commerceRef.current = commerce;
  const providers = buildProviders(env, { sessionSecret });
  commerce.providers = providers;
  const stats = new Stats(db, configStore, dayFn);
  { const rp = require('./money').realMoneyProviders(env); stats.realProviders = rp; playstats.realProviders = rp; }   // 現金儲值判定（排除寶石／後台／正式環境的模擬金流）
  const adminAuth = new AdminAuth(db, { password: adminPassword, sessionSecret, secureCookie: env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' : prod });

  // 第一次啟動時建立範例商品（正式環境預設為下架狀態）
  if (!db.prepare('SELECT COUNT(*) n FROM products').get().n && env.SEED_SAMPLE_PRODUCTS !== '0') {
    for (const p of require(path.join(ROOT, 'seed/default-products.json'))) commerce.createProduct({ ...p, active: !prod });
  }

  const pay = new Pay({ db, env, configStore, players, commerce, rewards });
  if (env.NODE_ENV !== 'test' && env.NEWEBPAY_POLL !== '0') pay.startPoller(Number(env.NEWEBPAY_POLL_MS) || 60000);   // v4.1.1：背景查單（待付款的 ATM／超商訂單）
  const oauth = new OAuth({ db, env, configStore, players, fetchImpl: opts && opts.fetchImpl });   // v4.2-auth：Google／LINE 登入
  const newbie = new Newbie({ db, configStore, players, commerce }); players.newbieRef = newbie;   // v4.1.3：新手體驗
  const invite = new Invite({ db, configStore, players, rewards, baseUrl: String(env.PUBLIC_BASE_URL || 'https://www.feedfishs.com').replace(/\/+$/, '') }); players.inviteRef = invite;   // v4.1.4：邀請朋友
  const plantRefund = new (require('./plantrefund').PlantRefund)({ db, configStore, players, commerce });   // v4.2 移除水草退款
  const ctx = { db, env, configStore, players, rewards, commerce, providers, stats, playstats, adminAuth, pay, oauth, newbie, invite, plantRefund };
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY || 'loopback');

  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
    next();
  });

  // CORS（只有在遊戲與 API 不同網域時才需要；同網域部署可不設定）
  const origins = String(env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origins.length) app.use('/api', (req, res, next) => {
    const o = req.get('origin');
    if (o && origins.includes(o)) {
      res.set({ 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Expose-Headers': 'ETag, X-Config-Revision', 'Access-Control-Max-Age': '600' });
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });

  app.use('/api/pay', require('./routes/pay')(ctx));   // 💳 儲值（綠界）
  app.use('/api/auth', require('./routes/oauth')(ctx));
  app.use('/api/newbie', require('./routes/newbie')(ctx));
  require('./sponsor').mountSponsor(app, ctx);
  require('./monthly-fish').mountMonthlyFish(app, ctx);
  app.use('/api/invite', require('./routes/invite')(ctx));   // v4.1.4   // v4.1.3   // v4.2-auth
  app.use('/api', require('./routes/api')(ctx));

  // ---------- 後台 ----------
  const adminDir = path.join(ROOT, 'admin');
  app.use('/admin', (req, res, next) => {
    res.set({ 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    next();
  });
  app.use('/admin/api', require('./routes/admin')(ctx));
  app.get('/admin/login', (req, res) => res.sendFile(path.join(adminDir, 'login.html')));
  app.use('/admin/assets', express.static(path.join(adminDir, 'assets'), { maxAge: 0 }));
  app.get(['/admin', '/admin/'], (req, res) => {
    if (!adminAuth.session(req)) return res.redirect(302, '/admin/login');
    res.sendFile(path.join(adminDir, 'index.html'));
  });

  // ---------- SDK 與共用繪圖程式（遊戲端引用） ----------
  app.use('/sdk', express.static(path.join(ROOT, 'public'), { maxAge: '5m' }));

  // 本機開發用：讓 node 直接提供遊戲靜態檔（正式環境由 nginx 提供）
  if (env.SERVE_GAME_DIR) app.use('/', express.static(path.resolve(env.SERVE_GAME_DIR)));

  require('./gemshop').mountGemShop(app, ctx);   // 💎 本週限定／加速／外觀：/api/gemshop
  require('./breedlimit').mountBreedLimit(app, ctx);   // 🐣 每日繁殖次數：/api/breed（自家＋漁港共用）
  require('./social').mountSocial(app, ctx);   // ⚓ 漁港：/api/social、/admin/api/social
  require('./friendsv2').mountFriendsV2(app, ctx);   // FRIENDSV2：/api/social/v2、/admin/api/social/v2（玩家看得到的部分預設關閉）
  require('./hybrid-share').mount(app, ctx);
  require('./tank-share-og').mount(app, ctx);
  require('./social-share-task').mount(app, ctx);
  require('./task-rewards').mount(app, ctx);
  require('./diamond-eggs').mount(app, ctx);
  require('./support').mountSupport(app, ctx);   // 💬 客服訊息：/api/support、/admin/api/support
  require('./adminreports').mountAdminReports(app, ctx);   // v4.5 後台唯讀：⚓ 玩家漁港、👥 邀請報表（/admin/api/reports）
  require('./hero/mount').mountHero(app, ctx);   // ⚔️ 英雄魚：/api/hero、/admin/api/hero、/admin/hero、/sdk/hero.js
  require('./avatar').mountAvatar(app, ctx);   // 🐠 玩家頭像：/api/avatar（AVATAR-V1）
  app.use((req, res, next) => next(new HttpError(404, 'not_found', '找不到此路徑')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'bad_json', 'JSON 格式錯誤');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'too_large', '內容過大');
    const status = err.status || 500;
    if (status >= 500 && !(err instanceof HttpError)) console.error('[error]', req.method, req.originalUrl, err);
    res.status(status).json({ error: err.code || 'server_error', message: err instanceof HttpError ? err.message : '伺服器錯誤', ...(err.extra || {}) });
  });

  return { app, ctx, close: () => { pay.stopPoller(); ctx.hero?.monthly?.stop(); db.close(); } };
}

module.exports = { createApp };
