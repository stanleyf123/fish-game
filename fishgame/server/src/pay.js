'use strict';
// 💳 儲值（綠界 ECPay 全方位金流）：用新台幣購買 💎 寶石 / 🪙 金幣。
// 原則：
// - 商品、價格、數量只來自伺服器上「目前生效的遊戲設定」cfg.pay（後台可編輯、有版本），客戶端只送商品代號。
// - 只有會員（信箱帳號）能下單；訂單金額與入帳內容在建立訂單時寫入 orders.grants。
// - 入帳只在驗證 CheckMacValue＋特店編號＋金額之後，並以 orders.credited_at 保證「每張訂單只入帳一次」（交易內檢查）。
// - 寶石走伺服器寶石帳本（gem_ledger）；金幣直接寫進雲端存檔（rev+1，和後台編輯存檔相同），遊戲會載入較新的雲端存檔。
const { HttpError, bad, clampStr, parseJSON, safeEqual, RateLimiter, toInt } = require('./util');
const { checkMacValue, ecpayConfig, taipeiDate } = require('./payments/ecpay');
const NW = require('./payments/newebpay');
const PROVS = "('ecpay','newebpay')";
const PNAME = { ecpay: '綠界 ECPay', newebpay: '藍新金流 NewebPay' };
const { newOrderId } = require('./commerce');
const { realMoneyProviders, providerInSql, isRealMoneyOrder } = require('./money');

const DEFAULT_PAY = {
  enabled: true,
  firstPurchaseDouble: true, // 寶石：每個方案第一次購買加贈同等數量（首儲雙倍）
  atmExpireDays: 3,          // ATM 繳費期限（天）
  cvsExpireMinutes: 4320,    // 超商代碼繳費期限（分鐘，3 天）
  support: '遊戲內「💬 客服」留言，並附上訂單編號',
  // 金流：兩家都可在後台開關；都開時玩家自己選。藍新付款方式依商店審核狀態在後台開關
  providers: { ecpay: { enabled: true }, newebpay: { enabled: true, methods: { CREDIT: false, VACC: true, CVS: true, WEBATM: false } } },
  // 👑 月卡：立即 💎300＋每天（台北時間）可領 💎40、共 30 天；有效期間每天多 2 次繁殖；再買延長 30 天（沒領的天數不補）
  card: { enabled: true, id: 'card_30', priceTwd: 300, gems: 300, days: 30, dailyGems: 40, extraBreeds: 2 },
  // SHOPV2-PACKS 🎁 新手禮包：每個帳號限購一次（伺服器檢查）；不適用首儲雙倍
  starter: { enabled: true, id: 'starter_30', priceTwd: 30, gems: 120, coins: 20000, fish: 'p_sapphireshrimp' },
  // SHOPV2-PACKS 🏮 首次儲值禮：帳號第一筆真實金流入帳（任何方案，含月卡、新手禮包）加送背景，只送一次
  firstTopupGift: { enabled: true, cosmetic: 'bg_festival' },
  products: [
    { id: 'gems_60', kind: 'gems', priceTwd: 30, qty: 60, enabled: true, sort: 10 },
    { id: 'gems_330', kind: 'gems', priceTwd: 150, qty: 330, enabled: true, sort: 11 },
    { id: 'gems_700', kind: 'gems', priceTwd: 300, qty: 700, enabled: true, sort: 12 },
    { id: 'gems_2400', kind: 'gems', priceTwd: 990, qty: 2400, enabled: true, sort: 13 },
    { id: 'gems_5000', kind: 'gems', priceTwd: 1990, qty: 5000, enabled: true, sort: 14 },
    { id: 'coins_20k', kind: 'coins', priceTwd: 30, qty: 20000, enabled: true, sort: 20 },
    { id: 'coins_110k', kind: 'coins', priceTwd: 150, qty: 110000, enabled: true, sort: 21 },
    { id: 'coins_240k', kind: 'coins', priceTwd: 300, qty: 240000, enabled: true, sort: 22 },
  ],
};
const KIND_NAME = { gems: '寶石', coins: '金幣' };
const ICON = { gems: '💎', coins: '🪙' };
const PAYINFO_OK = new Set(['2', '10100073']); // ATM 取號成功＝2；超商代碼／條碼取號成功＝10100073
const fmtN = (n) => Number(n).toLocaleString('en-US');

function payConfig(cfg) {
  const p = cfg && cfg.pay && typeof cfg.pay === 'object' ? cfg.pay : {};
  const pv = p.providers && typeof p.providers === 'object' ? p.providers : {};
  const providers = { ecpay: { ...DEFAULT_PAY.providers.ecpay, ...(pv.ecpay || {}) }, newebpay: { ...DEFAULT_PAY.providers.newebpay, ...(pv.newebpay || {}), methods: { ...DEFAULT_PAY.providers.newebpay.methods, ...((pv.newebpay && pv.newebpay.methods) || {}) } } };
  return { ...DEFAULT_PAY, ...p, providers, card: { ...DEFAULT_PAY.card, ...(p.card || {}) }, starter: { ...DEFAULT_PAY.starter, ...(p.starter || {}) }, firstTopupGift: { ...DEFAULT_PAY.firstTopupGift, ...(p.firstTopupGift || {}) }, products: Array.isArray(p.products) ? p.products : DEFAULT_PAY.products };
}
function starterGrants(p) {
  const fish = Array.isArray(p.fishRewards) && p.fishRewards.length ? p.fishRewards.map(f=>({species:f.species,count:f.count})) : [{species:p.fish,count:1}];
  return {gems:p.gems,coins:p.coins,fish,starter:1};
}
function productName(p) { return p.name || (p.kind === 'card' ? `👑 月卡 ${p.days} 天` : `${ICON[p.kind]} ${KIND_NAME[p.kind]} ${fmtN(p.qty)}`); }

const FUNNEL_STEPS = ['view', 'select', 'register_block', 'order', 'redirect', 'payinfo', 'paid', 'prompt_show', 'prompt_click'];
const FUNNEL_CLIENT = ['view', 'select', 'register_block', 'redirect', 'prompt_show', 'prompt_click'];
class Pay {
  constructor(ctx) {
    const { db, env, configStore, players, commerce, rewards } = ctx;
    Object.assign(this, { db, env, configStore, players, commerce, rewards });
    this.ec = ecpayConfig(env);
    this.nw = NW.newebpayConfig(env);
    this.prod = env.NODE_ENV === 'production';
    // 正式站用測試特店時：只有 ECPAY_STAGE_TESTERS 列出的玩家可以下單（避免一般玩家用測試卡拿到真的寶石）
    this.testers = new Set(String(env.ECPAY_STAGE_TESTERS || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number));
    this.perPlayerMin = new RateLimiter({ windowMs: 60000, max: toInt(env.PAY_ORDERS_PER_MIN, 5) });
    this.perPlayerHour = new RateLimiter({ windowMs: 3600000, max: toInt(env.PAY_ORDERS_PER_HOUR, 30) });
    this.perIp = new RateLimiter({ windowMs: 600000, max: toInt(env.PAY_ORDERS_PER_IP_10MIN, 30) });
    this.maxPending = toInt(env.PAY_MAX_PENDING, 5);
    this.migrate();
    if (env.NODE_ENV !== 'test') { console.log('[pay] 綠界' + (this.ec.ok ? ' ' : '未啟用：') + this.ec.describe()); console.log('[pay] ' + (this.nw.ok ? '' : '藍新未啟用：') + this.nw.describe()); }
  }

  migrate() {
    const cols = new Set(this.db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name));
    if (!cols.has('payment_type')) this.db.exec('ALTER TABLE orders ADD COLUMN payment_type TEXT');
    if (!cols.has('pay_info')) this.db.exec('ALTER TABLE orders ADD COLUMN pay_info TEXT');
    if (!cols.has('credited_at')) this.db.exec('ALTER TABLE orders ADD COLUMN credited_at INTEGER');
    if (!cols.has('expires_at')) this.db.exec('ALTER TABLE orders ADD COLUMN expires_at INTEGER');
    // v4.1.1：玩家已看過「儲值成功」視窗（每筆只跳一次）；既有、入帳超過 1 小時的訂單視為已看過
    if (!cols.has('acked_at')) { this.db.exec('ALTER TABLE orders ADD COLUMN acked_at INTEGER'); this.db.prepare('UPDATE orders SET acked_at=credited_at WHERE credited_at IS NOT NULL AND credited_at < ?').run(Date.now() - 3600e3); }
    // v4.1.1：藍新回傳原文（加密的 TradeInfo，不含金鑰）＋雜湊＋失敗步驟，供日後除錯
    this.db.exec(`CREATE TABLE IF NOT EXISTS payment_raw (id INTEGER PRIMARY KEY, provider TEXT NOT NULL, kind TEXT, order_id TEXT, body TEXT, body_sha TEXT, step TEXT, result TEXT, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_payment_raw_t ON payment_raw(created_at)`);
    // v4.1.1：儲值漏斗（每人每天每步驟一列；不含個資）
    this.db.exec(`CREATE TABLE IF NOT EXISTS pay_funnel (day TEXT NOT NULL, step TEXT NOT NULL, pack TEXT NOT NULL DEFAULT '', member INTEGER NOT NULL DEFAULT 0, player_id INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 1, first_at INTEGER, last_at INTEGER, PRIMARY KEY (day, step, pack, member, player_id));
      CREATE INDEX IF NOT EXISTS idx_pay_funnel_day ON pay_funnel(day, step)`);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_orders_provider ON orders(provider, created_at)");
  }

  cfg() { return payConfig(this.configStore.active().config); }
  baseUrl(req) {
    const b = this.env.PUBLIC_BASE_URL || (req ? `${req.protocol}://${req.get('host')}` : '');
    return String(b).replace(/\/+$/, '');
  }
  // 這位玩家目前能不能付款（不能時回傳原因）
  // 目前可用的金流（後台開啟＋環境變數設定完成；綠界測試特店在正式站只給測試人員）
  providerList(pid) {
    const pc = this.cfg(), out = [];
    if (pc.providers.newebpay.enabled && this.nw.ok && (!this.prod || this.nw.mode === 'prod' || (pid && this.testers.has(pid)))) out.push('newebpay');
    if (pc.providers.ecpay.enabled && this.ec.ok && !(this.prod && this.ec.mode === 'stage' && !(pid && this.testers.has(pid)))) out.push('ecpay');
    return out;
  }
  availability(pid) {
    const pc = this.cfg();
    if (!pc.enabled) return { ok: false, reason: 'disabled', message: '💳 線上儲值暫停中' };
    if (!this.providerList(pid).length) return { ok: false, reason: 'not_configured', message: '💳 線上儲值即將開放，敬請期待！' };
    return { ok: true };
  }
  isMember(p) { return !!(p && p.username && (p.email || String(p.username).includes('@') || /^(google|line):/.test(String(p.username)))); }

  products() {
    const pc = this.cfg(), C = pc.card;
    const list = pc.products.filter((p) => p && p.enabled !== false && p.kind !== 'card').sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const base = {}; // 每種類型最便宜方案的「每元數量」當基準，算出加贈 %
    for (const p of list) { const r = p.qty / p.priceTwd; if (!base[p.kind] || p.priceTwd < base[p.kind].price) base[p.kind] = { price: p.priceTwd, rate: r }; }
    const out = list.map((p) => ({ id: p.id, kind: p.kind, priceTwd: p.priceTwd, qty: p.qty, name: productName(p), badge: p.badge || '', bonusPct: Math.max(0, Math.round((p.qty / p.priceTwd / base[p.kind].rate - 1) * 100)) }));
    const S = pc.starter, spS = S && S.enabled !== false && S.priceTwd > 0 && this.configStore.active().config.species[S.fish];
    if (spS) out.unshift({ id: S.id, kind: 'starter', priceTwd: S.priceTwd, qty: S.gems, gems: S.gems, coins: S.coins, fish: S.fish, fishName: spS.name, fishRewards: starterGrants(S).fish.map(f=>({...f,name:this.configStore.active().config.species[f.species]?.name||f.species})), name: '🎁 新手禮包', badge: '限購 1 次', bonusPct: 0, once: true }); // SHOPV2-PACKS
    if (C.enabled !== false && C.priceTwd > 0) out.unshift({ id: C.id, kind: 'card', priceTwd: C.priceTwd, qty: C.gems, name: productName({ kind: 'card', days: C.days }), badge: '超值', bonusPct: 0, days: C.days, dailyGems: C.dailyGems, extraBreeds: C.extraBreeds, totalGems: C.gems + C.dailyGems * C.days });
    const sc=require('./sponsor').sponsorCfg(this.configStore.active().config);
    if(sc.enabled)for(const t of sc.tiers)out.push({id:'sponsor_'+t.id,kind:'sponsor',priceTwd:t.priceTwd,qty:0,name:t.badge+' '+t.name,badge:'純外觀贊助',bonusPct:0,sponsor:t});
    return out;
  }
  firstDoubleEligible(pid, productId) {
    if (!this.cfg().firstPurchaseDouble) return false;
    if (!pid) return true;
    return !this.db.prepare(`SELECT 1 FROM orders WHERE player_id=? AND sku=? AND provider IN ${PROVS} AND credited_at IS NOT NULL LIMIT 1`).get(pid, 'pay:' + productId);
  }
  // SHOPV2-PACKS 新手禮包：已入帳過（任何真實金流）就不能再買
  starterUsed(pid) { const S = this.cfg().starter; return !!(pid && this.db.prepare(`SELECT 1 FROM orders WHERE player_id=? AND sku=? AND ${providerInSql(realMoneyProviders(this.env))} AND credited_at IS NOT NULL LIMIT 1`).get(pid, 'pay:' + S.id)); }
  // SHOPV2-PACKS 首次儲值禮：帳號還沒有任何一筆真實金流入帳（排除 exceptId 這張）
  isFirstTopup(pid, exceptId = '') { return !!pid && !this.db.prepare(`SELECT 1 FROM orders WHERE player_id=? AND ${providerInSql(realMoneyProviders(this.env))} AND currency='TWD' AND credited_at IS NOT NULL AND json_extract(grants,'$.sponsor') IS NULL AND id<>? LIMIT 1`).get(pid, String(exceptId)); }
  firstGiftInfo(pid) { const F = this.cfg().firstTopupGift; if (!F || F.enabled === false || !F.cosmetic) return null; const B = require('./gemshop').conf(this.configStore.active().config).cosmetics.backgrounds[F.cosmetic]; if (!B) return null; return { cosmetic: F.cosmetic, name: B.name, icon: B.icon || '🎨', eligible: pid ? this.isFirstTopup(pid) : true }; }
  storefront(pid) {
    const p = pid ? this.players.get(pid) : null;
    const av = this.availability(pid);
    const pc = this.cfg();
    return {
      available: av.ok, message: av.message || null, member: this.isMember(p), mode: this.ec.mode, firstPurchaseDouble: !!pc.firstPurchaseDouble, support: pc.support,
      providers: this.providerList(pid).map((id) => ({ id, name: PNAME[id] })), card: pid ? this.cardStatus(pid) : null,
      products: this.products().map((x) => ({ ...x, firstDouble: x.kind === 'gems' && this.firstDoubleEligible(pid, x.id), ...(x.kind === 'starter' ? { eligible: !this.starterUsed(pid) } : {}) })),
      firstGift: this.firstGiftInfo(pid), // SHOPV2-PACKS
    };
  }

  // ---------- 建立訂單 ----------
  create(pid, productId, req, provider) {
    const p = this.players.get(pid);
    if (!p) throw new HttpError(401, 'unauthorized', '請重新登入');
    if (!this.isMember(p)) { this.funnel(pid, 'register_block', productId, 0); throw new HttpError(403, 'members_only', '儲值僅限會員：請先用信箱註冊會員，購買內容才能安全保存在你的帳號裡'); }
    const av = this.availability(pid);
    if (!av.ok) throw new HttpError(503, 'pay_unavailable', av.message);
    for (const [lim, key] of [[this.perPlayerMin, 'm' + pid], [this.perPlayerHour, 'h' + pid], [this.perIp, 'ip' + (req && req.ip)]]) {
      const c = lim.check(key); if (!c.ok) throw new HttpError(429, 'rate_limited', '建立訂單太頻繁，請稍後再試', { retryAfter: c.retryAfter });
    }
    const provs = this.providerList(pid); const pv = provider ? String(provider) : provs[0];
    if (!provs.includes(pv)) throw new HttpError(400, 'bad_provider', '這個付款方式目前沒有開放');
    const open = this.db.prepare(`SELECT COUNT(*) n FROM orders WHERE player_id=? AND provider IN ${PROVS} AND status='pending' AND created_at > ?`).get(pid, Date.now() - 30 * 60000).n;
    if (open >= this.maxPending) throw new HttpError(429, 'too_many_pending', '你有太多尚未完成的訂單，請先完成付款或稍後再試');
    const prod = this.products().find((x) => x.id === String(productId || ''));
    if (!prod) throw new HttpError(404, 'product_not_found', '找不到這個儲值方案，或已下架');
    const pc = this.cfg();
    if (prod.kind === 'starter') { // SHOPV2-PACKS 每帳號限購一次：已入帳、或有尚未過期的待付款禮包訂單都不能再下單
      if (this.starterUsed(pid)) throw new HttpError(409, 'starter_used', '新手禮包每個帳號限購一次，你已經買過囉');
      const pend = this.db.prepare(`SELECT id FROM orders WHERE player_id=? AND sku=? AND status='pending' AND credited_at IS NULL AND created_at > ? AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`).get(pid, 'pay:' + prod.id, Date.now() - 4 * 86400e3, Date.now());
      if (pend) throw new HttpError(409, 'starter_pending', `你已經有一筆新手禮包訂單（${pend.id}）還沒付款，請先完成那筆或等它過期`);
    }
    const grants = prod.kind === 'sponsor' ? {sponsor:{tier:prod.sponsor.id,level:prod.sponsor.level}} : prod.kind === 'starter' ? starterGrants(prod) : prod.kind === 'card' ? { gems: pc.card.gems, vipDays: pc.card.days, vipPerks: { dailyGems: pc.card.dailyGems, extraBreeds: pc.card.extraBreeds } } : prod.kind === 'gems' ? { gems: prod.qty, firstDouble: this.firstDoubleEligible(pid, prod.id) } : { coins: prod.qty };
    const id = newOrderId(), t = Date.now(), base = this.baseUrl(req);
    this.db.prepare(`INSERT INTO orders (id, player_id, product_id, sku, product_name, amount, currency, status, provider, grants, created_at, updated_at)
      VALUES (?,?,NULL,?,?,?,'TWD','pending',?,?,?,?)`).run(id, pid, 'pay:' + prod.id, prod.name.replace(/^\S+\s/, '') /* 不含 emoji */, prod.priceTwd, pv, JSON.stringify(grants), t, t);
    const itemName = prod.kind === 'sponsor' ? '悠游水族箱 贊助 '+prod.sponsor.name : prod.kind === 'starter' ? '悠游水族箱 新手禮包' : prod.kind === 'card' ? `悠游水族箱 月卡 ${pc.card.days} 天` : `悠游水族箱 ${KIND_NAME[prod.kind]} ${prod.qty}`;
    if (pv === 'newebpay') {
      const m = pc.providers.newebpay.methods || {}, exp = new Date(t + 8 * 3600000 + Math.max(1, Math.min(180, Math.floor(pc.atmExpireDays || 3))) * 86400000);
      const ti = { MerchantID: this.nw.merchantId, RespondType: 'JSON', TimeStamp: String(Math.floor(t / 1000)), Version: '2.0', LangType: 'zh-tw', MerchantOrderNo: id, Amt: String(prod.priceTwd),
        ItemDesc: itemName.replace(/[#&<>=]/g, ''), TradeLimit: '900', ExpireDate: `${exp.getUTCFullYear()}${String(exp.getUTCMonth() + 1).padStart(2, '0')}${String(exp.getUTCDate()).padStart(2, '0')}`,
        ReturnURL: `${base}/api/pay/newebpay/return`, NotifyURL: `${base}/api/pay/newebpay/notify`, CustomerURL: `${base}/api/pay/newebpay/customer`, ClientBackURL: `${base}/?pay=back&order=${id}`,
        Email: p.email || '', EmailModify: '1', LoginType: '0', OrderComment: `玩家 #${pid}`,
        CREDIT: m.CREDIT ? '1' : '0', VACC: m.VACC ? '1' : '0', CVS: m.CVS && prod.priceTwd >= 30 && prod.priceTwd <= 20000 ? '1' : '0', WEBATM: m.WEBATM ? '1' : '0' };
      const TradeInfo = NW.encrypt(NW.buildQuery(ti), this.nw.hashKey, this.nw.hashIV);
      this.players.logEvent(pid, 'pay_order_created', { orderId: id, product: prod.id, amount: prod.priceTwd, provider: pv }); this.funnel(pid, 'order', prod.id, 1);
      return { order: this.publicOrder(this.order(id)), checkout: { type: 'form_post', provider: pv, action: this.nw.endpoint, fields: { MerchantID: this.nw.merchantId, TradeInfo, TradeSha: NW.tradeSha(TradeInfo, this.nw.hashKey, this.nw.hashIV), Version: '2.0', EncryptType: '0' } } };
    }
    const fields = {
      MerchantID: this.ec.merchantId,
      MerchantTradeNo: id,
      MerchantTradeDate: taipeiDate(t),
      PaymentType: 'aio',
      TotalAmount: String(prod.priceTwd),
      TradeDesc: 'FeedFishs',
      ItemName: itemName.replace(/[#&<>]/g, ''),
      ReturnURL: `${base}/api/pay/ecpay/notify`,
      PaymentInfoURL: `${base}/api/pay/ecpay/payinfo`,
      OrderResultURL: `${base}/api/pay/ecpay/result`,
      ClientBackURL: `${base}/?pay=back&order=${id}`,
      ChoosePayment: 'ALL',
      IgnorePayment: 'WebATM#BNPL#TWQR#WeiXin#DigitalPayment#ApplePay', // 只開 信用卡／ATM／超商代碼／超商條碼
      ExpireDate: String(Math.max(1, Math.min(60, Math.floor(pc.atmExpireDays || 3)))),
      StoreExpireDate: String(Math.max(1, Math.min(43200, Math.floor(pc.cvsExpireMinutes || 4320)))),
      NeedExtraPaidInfo: 'N',
      EncryptType: '1',
      CustomField1: String(pid),
    };
    fields.CheckMacValue = checkMacValue(fields, this.ec.hashKey, this.ec.hashIV);
    this.players.logEvent(pid, 'pay_order_created', { orderId: id, product: prod.id, amount: prod.priceTwd }); this.funnel(pid, 'order', prod.id, 1);
    return { order: this.publicOrder(this.order(id)), checkout: { type: 'form_post', provider: pv, action: this.ec.endpoint, fields } };
  }

  // ---------- 綠界回傳 ----------
  // 驗章：回傳 { ok, params, error }。驗章失敗一律不處理。
  verify(raw) {
    const params = Object.fromEntries(new URLSearchParams(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '')));
    if (!params.CheckMacValue) return { ok: false, params, error: 'missing_mac' };
    const want = checkMacValue(params, this.ec.hashKey, this.ec.hashIV);
    if (!safeEqual(String(params.CheckMacValue).toUpperCase(), want)) return { ok: false, params, error: 'bad_mac' };
    if (String(params.MerchantID) !== String(this.ec.merchantId)) return { ok: false, params, error: 'bad_merchant' };
    return { ok: true, params };
  }
  logEvent(kind, params, result, provider = 'ecpay') {
    const evId = `${kind}:${params.MerchantTradeNo || '-'}:${params.TradeNo || '-'}:${params.RtnCode || '-'}:${params.SimulatePaid || 0}`;
    const t = Date.now();
    const safe = { ...params }; // 回傳內容不含金鑰，可留存
    const ins = this.db.prepare('INSERT OR IGNORE INTO payment_events (provider, event_id, order_id, type, payload, result, received_at) VALUES (?,?,?,?,?,?,?)')
      .run(provider, evId, params.MerchantTradeNo || null, kind, JSON.stringify(safe).slice(0, 8000), JSON.stringify(result), t);
    if (!ins.changes) this.db.prepare('UPDATE payment_events SET result=? WHERE provider=? AND event_id=?').run(JSON.stringify({ ...result, repeat: true }), provider, evId);
  }

  // ReturnURL（付款結果）／OrderResultURL 共用：回傳 { reply, result }
  handlePaid(raw, kind = 'notify') {
    const v = this.verify(raw);
    if (!v.ok) {
      this.logEvent(kind + ':rejected', v.params, { ok: false, error: v.error });
      return { reply: '0|CheckMacValue Error', status: 400, result: { ok: false, error: v.error } };
    }
    const P = v.params;
    if (PAYINFO_OK.has(String(P.RtnCode))) { const r = this.applyPayInfo(P); this.logEvent(kind + ':payinfo', P, r); return { reply: '1|OK', status: 200, result: r }; }
    let r;
    try {
      if (String(P.RtnCode) === '1') {
        if (String(P.SimulatePaid) === '1' && this.env.ECPAY_ACCEPT_SIMULATED !== '1') r = { ok: true, ignored: 'simulated' }; // 綠界後台「模擬付款」：不入帳
        else r = this.credit(P.MerchantTradeNo, { amount: Number(P.TradeAmt), tradeNo: P.TradeNo, paymentType: P.PaymentType, by: 'ecpay' });
      } else r = this.markFailed(P.MerchantTradeNo, `${P.RtnCode} ${P.RtnMsg || ''}`.trim());
    } catch (e) { r = { ok: false, error: e.code || e.message }; }
    this.logEvent(kind, P, r);
    // 金額不符、找不到訂單等業務錯誤：仍回 1|OK（重送也不會變），錯誤留在 payment_events 給後台查
    return { reply: '1|OK', status: 200, result: r, orderId: P.MerchantTradeNo };
  }
  handlePayInfo(raw) {
    const v = this.verify(raw);
    if (!v.ok) { this.logEvent('payinfo:rejected', v.params, { ok: false, error: v.error }); return { reply: '0|CheckMacValue Error', status: 400 }; }
    const r = PAYINFO_OK.has(String(v.params.RtnCode)) ? this.applyPayInfo(v.params) : this.markFailed(v.params.MerchantTradeNo, `取號失敗 ${v.params.RtnCode} ${v.params.RtnMsg || ''}`);
    this.logEvent('payinfo', v.params, r);
    return { reply: '1|OK', status: 200, result: r };
  }

  // ---------- 藍新回傳 ----------
  // NotifyURL（伺服器對伺服器）：驗 TradeSha → 解密 → 商店代號 → 金額 → 入帳一次
  // 漏斗：view 打開儲值頁、select 點選方案、register_block 訪客被要求註冊、order 建立訂單、redirect 跳轉付款頁、payinfo 取得繳費資訊、paid 已付款、prompt_show／prompt_click 寶石不足提示
  funnel(pid, step, pack, member) {
    try {
      if (!pid || !FUNNEL_STEPS.includes(step)) return;
      const t = Date.now(), day = new Date(t + 8 * 3600e3).toISOString().slice(0, 10), pp = String(pack || '').replace(/^pay:/, ''), pk = /^[a-z0-9_]{1,24}$/.test(pp) ? pp : '';
      this.db.prepare(`INSERT INTO pay_funnel (day, step, pack, member, player_id, n, first_at, last_at) VALUES (?,?,?,?,?,1,?,?)
        ON CONFLICT(day, step, pack, member, player_id) DO UPDATE SET n=MIN(n+1, 500), last_at=excluded.last_at`).run(day, step, pk, member ? 1 : 0, pid, t, t);
    } catch (e) { /* 統計失敗不影響付款 */ }
  }
  rawLog(kind, raw, step, result, orderId) {
    try {
      const body = String(raw == null ? '' : raw).slice(0, 65536);
      this.db.prepare('INSERT INTO payment_raw (provider, kind, order_id, body, body_sha, step, result, created_at) VALUES (?,?,?,?,?,?,?,?)').run('newebpay', kind, orderId || null, body, require('crypto').createHash('sha256').update(body).digest('hex'), step || null, JSON.stringify(result || {}).slice(0, 2000), Date.now());
      if (Math.random() < 0.02) this.db.prepare('DELETE FROM payment_raw WHERE created_at < ?').run(Date.now() - 180 * 86400e3);
    } catch (e) { console.warn('[pay] payment_raw 寫入失敗', e.message); }
  }
  newebpay(form, kind, raw) {
    const v = NW.parseResponse(form, this.nw);
    this._raw = raw !== undefined ? 1 : null;
    const ev = (r, R = {}) => this.logEvent(kind, { MerchantTradeNo: R.MerchantOrderNo, TradeNo: R.TradeNo, RtnCode: v.status || v.error, PaymentType: R.PaymentType, Amt: R.Amt, PayTime: R.PayTime, BankCode: R.BankCode, CodeNo: R.CodeNo, ExpireDate: R.ExpireDate }, r, 'newebpay');
    if (!v.ok) { ev({ ok: false, error: v.error, step: v.step }); if (this._raw) { this.rawLog(kind, raw, v.step || v.error, { ok: false, error: v.error }, null); this._raw = null; } return { ok: false, status: 400, error: v.error }; }
    const R = v.result, oid = String(R.MerchantOrderNo || '');
    let r;
    try {
      const o = this.order(oid);
      if (!o || o.provider !== 'newebpay') r = { ok: false, error: 'order_not_found' };
      else if (v.status !== 'SUCCESS') r = kind === 'notify' ? this.markFailed(oid, `${v.status} ${v.message}`.trim()) : { ok: true, ignored: v.status };
      else if (kind === 'customer' || (!R.PayTime && (R.CodeNo || R.BankCode || R.Barcode_1))) {
        // ATM／超商代碼取號（尚未付款）
        if (Number(R.Amt) !== o.amount) r = { ok: false, error: 'amount_mismatch' };
        else if (o.status !== 'pending') r = { ok: true, duplicate: true, status: o.status };
        else {
          const info = { type: R.PaymentType, bankCode: R.BankCode || null, vAccount: R.PaymentType === 'VACC' ? R.CodeNo || null : null, paymentNo: R.PaymentType !== 'VACC' ? R.CodeNo || null : null, barcode: [R.Barcode_1, R.Barcode_2, R.Barcode_3].filter(Boolean), expireDate: [R.ExpireDate, R.ExpireTime].filter(Boolean).join(' ') || null };
          const exp = R.ExpireDate ? Date.parse(String(R.ExpireDate).replace(/\//g, '-') + 'T' + (R.ExpireTime || '23:59:59') + '+08:00') : null;
          this.db.prepare('UPDATE orders SET pay_info=?, payment_type=?, provider_txn_id=COALESCE(provider_txn_id, ?), expires_at=?, updated_at=? WHERE id=?').run(JSON.stringify(info), R.PaymentType || null, R.TradeNo || null, Number.isFinite(exp) ? exp : null, Date.now(), o.id);
          r = { ok: true, pending: true, payInfo: info }; this.funnel(o.playerId, 'payinfo', o.sku, 1);
        }
      } else r = this.credit(oid, { amount: Number(R.Amt), tradeNo: R.TradeNo, paymentType: R.PaymentType, by: 'newebpay' });
    } catch (e) { r = { ok: false, error: e.code || e.message }; }
    ev(r, R);
    if (this._raw) { this.rawLog(kind, raw, 'ok', r, oid); this._raw = null; }
    return { ...r, status: 200, orderId: oid };
  }

  applyPayInfo(P) {
    const o = this.order(P.MerchantTradeNo);
    if (!o) return { ok: false, error: 'order_not_found' };
    if (Number(P.TradeAmt) !== o.amount) return { ok: false, error: 'amount_mismatch' };
    if (o.status !== 'pending') return { ok: true, duplicate: true, status: o.status };
    const info = { type: P.PaymentType, bankCode: P.BankCode || null, vAccount: P.vAccount || null, paymentNo: P.PaymentNo || null, barcode: [P.Barcode1, P.Barcode2, P.Barcode3].filter(Boolean), expireDate: P.ExpireDate || null };
    const exp = P.ExpireDate ? Date.parse(P.ExpireDate.replace(/\//g, '-').replace(' ', 'T') + (P.ExpireDate.length <= 10 ? 'T23:59:59' : '') + '+08:00') : null;
    this.db.prepare('UPDATE orders SET pay_info=?, payment_type=?, provider_txn_id=COALESCE(provider_txn_id, ?), expires_at=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(info), P.PaymentType || null, P.TradeNo || null, Number.isFinite(exp) ? exp : null, Date.now(), o.id);
    this.funnel(o.playerId, 'payinfo', o.sku, 1);
    return { ok: true, pending: true, payInfo: info };
  }

  markFailed(orderId, reason) {
    const o = this.order(orderId);
    if (!o) return { ok: false, error: 'order_not_found' };
    if (o.status !== 'pending') return { ok: true, duplicate: true, status: o.status };
    this.db.prepare("UPDATE orders SET status='failed', note=?, updated_at=? WHERE id=? AND status='pending'").run(clampStr(reason, 200), Date.now(), o.id);
    return { ok: true, failed: true };
  }

  // 入帳：交易內以 credited_at 判斷，保證每張訂單只入帳一次
  credit(orderId, { amount, tradeNo, paymentType, by, note, allowFrom = ['pending'] }) {
    const out = this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM orders WHERE id=?').get(String(orderId || ''));
      if (!row || !['ecpay', 'newebpay'].includes(row.provider)) return { ok: false, error: 'order_not_found' };
      if (row.credited_at) return { ok: true, duplicate: true, status: row.status };
      if (!allowFrom.includes(row.status)) return { ok: false, error: 'bad_state', status: row.status };
      if (amount != null && Number(amount) !== row.amount) return { ok: false, error: 'amount_mismatch', mismatch: `金額不符：${PNAME[row.provider] || row.provider} ${amount}，訂單 ${row.amount}` };
      const pid = row.player_id, g = parseJSON(row.grants, {}), t = Date.now();
      const final = { ...g };
      // SHOPV2-PACKS 首次儲值禮：在同一個交易內判斷「這是帳號第一筆真實金流入帳」，所以重複通知（credited_at 已有值）在上面就 return 了，不會重送
      const FG = this.firstGiftInfo(null), firstGift = FG && !g.sponsor && isRealMoneyOrder(row, realMoneyProviders(this.env)) && this.isFirstTopup(pid, row.id) ? FG.cosmetic : null;
      if (g.starter && this.db.prepare(`SELECT 1 FROM orders WHERE player_id=? AND sku=? AND ${providerInSql(realMoneyProviders(this.env))} AND credited_at IS NOT NULL AND id<>? LIMIT 1`).get(pid, row.sku, row.id)) final.starterDup = true; // 極少見：兩筆待付款禮包都付了 → 仍給內容（玩家有付錢），標記讓後台處理退款
      if (g.gems) {
        final.bonusGems = g.firstDouble && !this.db.prepare(`SELECT 1 FROM orders WHERE player_id=? AND sku=? AND provider IN ${PROVS} AND credited_at IS NOT NULL AND id<>? LIMIT 1`).get(pid, row.sku, row.id) ? g.gems : 0;
        this.commerce.ledger(pid, g.gems + final.bonusGems, by === 'admin' ? 'admin_credit' : 'purchase', 'order:' + row.id);
      }
      if (g.vipDays) { // 👑 月卡：從目前到期日接著延長
        const cur = this.db.prepare("SELECT MAX(expires_at) e FROM entitlements WHERE player_id=? AND kind='vip' AND revoked_at IS NULL AND expires_at > ?").get(pid, t).e;
        const start = Math.max(t, cur || 0);
        this.db.prepare("INSERT INTO entitlements (player_id, kind, key, starts_at, expires_at, perks, order_id, created_at) VALUES (?, 'vip', ?, ?, ?, ?, ?, ?)").run(pid, row.sku, start, start + g.vipDays * 86400000, JSON.stringify(g.vipPerks || {}), row.id, t);
        final.vipUntil = start + g.vipDays * 86400000;
      }
      let save = null;
      const fish = Array.isArray(g.fish) ? g.fish : [], cosmetics = firstGift ? [firstGift] : []; // SHOPV2-PACKS
      if (g.coins || fish.length || cosmetics.length) {
        if (this.db.prepare('SELECT 1 FROM saves WHERE player_id=?').get(pid)) { const r = this.players.grantToSave(pid, { coins: g.coins || 0, fish, cosmetics }); save = { rev: r.rev }; if (r.cosAlreadyOwned && r.cosAlreadyOwned.length) final.firstGiftAlreadyOwned = true; }
        else { this.rewards.create({ title: g.starter ? '🎁 新手禮包' : g.coins ? `儲值：🪙 ${fmtN(g.coins)}` : '🏮 首次儲值禮', body: `訂單 ${row.id}`, target: 'player', playerId: pid, coins: g.coins || 0, fish, cosmetics }, { orderId: row.id }); final.viaMailbox = true; }
      }
      if (firstGift) final.firstGift = firstGift;
      this.db.prepare(`UPDATE orders SET status='paid', paid_at=COALESCE(paid_at, ?), credited_at=?, updated_at=?, provider_txn_id=COALESCE(?, provider_txn_id), payment_type=COALESCE(?, payment_type), grants=?,
        note=CASE WHEN ? IS NULL THEN note ELSE ? END WHERE id=?`).run(t, t, t, tradeNo || null, paymentType || null, JSON.stringify(final), note || null, note || null, row.id);
      this.funnel(pid, 'paid', row.sku, 1);
      this.players.logEvent(pid, 'pay_credited', { orderId: row.id, sku: row.sku, amount: row.amount, gems: (final.gems || 0) + (final.bonusGems || 0), coins: final.coins || 0, by, firstGift: final.firstGift || undefined, starterDup: final.starterDup || undefined });
      return { ok: true, credited: true, gems: (final.gems || 0) + (final.bonusGems || 0), coins: final.coins || 0, firstGift: final.firstGift || null, saveRev: save && save.rev };
    })();
    if (out.error === 'amount_mismatch') this.db.prepare("UPDATE orders SET status='failed', note=?, updated_at=? WHERE id=? AND status='pending'").run(out.mismatch, Date.now(), orderId);
    return out;
  }

  // ---------- v4.1.1 藍新查單（QueryTradeInfo）→ 已付款且金額相符才入帳（冪等）----------
  async queryNewebpay(orderId, by = 'newebpay_query') {
    const o = this.order(orderId);
    if (!o || o.provider !== 'newebpay') throw new HttpError(404, 'not_found', '找不到藍新訂單');
    if (!this.nw.ok) throw new HttpError(503, 'newebpay_off', '藍新金流未設定');
    let q;
    try { q = await NW.queryTrade(this.nw, { orderId: o.id, amount: o.amount }, this.fetchImpl || globalThis.fetch); }
    catch (e) { return { ok: false, error: 'query_failed', message: '暫時無法連線到藍新，請稍後再試', order: this.order(o.id) }; }
    const paid = q.verified && q.tradeStatus === '1' && q.amt === o.amount;
    let credit = null;
    if (paid && !o.creditedAt) credit = this.credit(o.id, { amount: q.amt, tradeNo: q.tradeNo, paymentType: q.paymentType, by });
    if (q.verified && (paid ? !o.creditedAt : true)) this.logEvent('query', { MerchantTradeNo: o.id, TradeNo: q.tradeNo, RtnCode: 'TS' + q.tradeStatus + (credit && credit.credited ? ':credited' : ''), PaymentType: q.paymentType, Amt: q.amt, PayTime: q.payTime }, credit || { ok: true, tradeStatus: q.tradeStatus }, 'newebpay');
    const TS = { '0': '尚未付款', '1': '已付款', '2': '付款失敗', '3': '已取消', '6': '已退款' };
    return { ok: true, verified: q.verified, paid, tradeStatus: q.tradeStatus, tradeStatusText: TS[q.tradeStatus] || (q.verified ? q.tradeStatus : (q.message || q.status || '查詢失敗')), payTime: q.payTime, paymentType: q.paymentType, credit, order: this.order(o.id) };
  }
  // 背景查單：待付款的藍新 ATM／超商訂單（3 天內、未逾期），間隔隨訂單年齡拉長
  startPoller(intervalMs = 60000) {
    if (this._poll || !this.nw.ok) return;
    this._next = new Map();
    const tick = async () => {
      if (this._busy) return; this._busy = true;
      try {
        const t = Date.now();
        const rows = this.db.prepare("SELECT id, created_at, expires_at, pay_info FROM orders WHERE provider='newebpay' AND status='pending' AND credited_at IS NULL AND created_at > ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 30").all(t - 3 * 86400e3, t - 2 * 3600e3);
        for (const r of rows) {
          if (!r.pay_info) continue;   // 還沒取號（沒有選 ATM／超商）的訂單不會在背景付款
          const nx = this._next.get(r.id) || 0; if (t < nx) continue;
          const age = t - r.created_at, gap = age < 3600e3 ? 60e3 : age < 6 * 3600e3 ? 5 * 60e3 : age < 24 * 3600e3 ? 15 * 60e3 : 30 * 60e3;
          this._next.set(r.id, t + gap - 2000);
          try { const out = await this.queryNewebpay(r.id, 'newebpay_poll'); if (out.credit && out.credit.credited) console.log(`[pay] 背景查單入帳 ${r.id}（💎${out.credit.gems || 0}／🪙${out.credit.coins || 0}）`); } catch (e) { /* 單筆失敗不影響其他 */ }
        }
        for (const k of this._next.keys()) if (!rows.some((r) => r.id === k)) this._next.delete(k);
      } catch (e) { console.warn('[pay] 背景查單錯誤', e.message); } finally { this._busy = false; }
    };
    this._poll = setInterval(tick, intervalMs); if (this._poll.unref) this._poll.unref();
    this._pollTick = tick;
    setTimeout(tick, 5000).unref?.();
  }
  stopPoller() { if (this._poll) clearInterval(this._poll); this._poll = null; }
  // 玩家「儲值成功」視窗：入帳但還沒看過的訂單；看過後標記
  unacked(pid) { return this.db.prepare(`SELECT * FROM orders WHERE player_id=? AND provider IN ${PROVS} AND credited_at IS NOT NULL AND acked_at IS NULL AND status='paid' ORDER BY credited_at LIMIT 5`).all(pid).map((r) => this.publicOrder(this.row(r))); }
  ack(pid, id) { return { ok: true, changed: this.db.prepare(`UPDATE orders SET acked_at=? WHERE id=? AND player_id=? AND credited_at IS NOT NULL AND acked_at IS NULL`).run(Date.now(), String(id || ''), pid).changes }; }

  // ---------- 後台 ----------
  adminCredit(orderId, { tradeNo, reason }) {
    const o = this.order(orderId);
    if (!o) throw new HttpError(404, 'not_found', '找不到儲值訂單');
    if (o.creditedAt) throw new HttpError(409, 'already_credited', '這張訂單已經入帳過了（每張訂單只會入帳一次）');
    if (!clampStr(reason, 200).trim()) throw bad('reason_required', '請填寫原因（例：已在綠界後台確認收款）');
    const r = this.credit(o.id, { tradeNo: clampStr(tradeNo, 40) || null, by: 'admin', note: `[後台補入帳] ${clampStr(reason, 200)}`, allowFrom: ['pending', 'failed', 'paid'] });
    if (!r.ok) throw new HttpError(409, r.error || 'credit_failed', '補入帳失敗：' + (r.error || ''));
    return { ...r, order: this.order(o.id) };
  }
  adminRefund(orderId, { reason, clawback = true }) {
    const o = this.order(orderId);
    if (!o) throw new HttpError(404, 'not_found', '找不到儲值訂單');
    if (o.status === 'refunded') throw new HttpError(409, 'already_refunded', '已標記退款');
    if (o.status !== 'paid') throw new HttpError(409, 'bad_state', '只有已入帳的訂單可以標記退款');
    if (!clampStr(reason, 200).trim()) throw bad('reason_required', '請填寫退款原因');
    const notes = [];
    this.db.transaction(() => {
      const g = o.grants || {};
      if (clawback && o.creditedAt) {
        const gems = (g.gems || 0) + (g.bonusGems || 0);
        if (gems) { this.commerce.ledger(o.playerId, -gems, 'refund', 'order:' + o.id, true); notes.push(`扣回 💎${gems}`); }
        if (g.vipDays) { const n = this.db.prepare('UPDATE entitlements SET revoked_at=? WHERE order_id=? AND revoked_at IS NULL').run(Date.now(), o.id).changes; if (n) notes.push('取消月卡天數'); }
        if (g.coins) {
          const row = this.db.prepare('SELECT * FROM saves WHERE player_id=?').get(o.playerId);
          if (row) { const sv = JSON.parse(row.data); const take = Math.min(sv.coins || 0, g.coins); sv.coins = (sv.coins || 0) - take; this.players.writeSaveRow(o.playerId, sv, row.rev + 1, Date.now(), false); notes.push(`扣回 🪙${fmtN(take)}${take < g.coins ? `（餘額不足，少扣 ${fmtN(g.coins - take)}）` : ''}`); }
        }
      } else notes.push('未扣回遊戲內容');
      this.db.prepare("UPDATE orders SET status='refunded', refunded_at=?, updated_at=?, note=? WHERE id=?").run(Date.now(), Date.now(), clampStr(`[標記退款] ${reason}；${notes.join('、')}；實際退刷請在${PNAME[o.provider] || '金流'}後台操作`, 500), o.id);
      this.players.logEvent(o.playerId, 'pay_refunded', { orderId: o.id, reason, notes });
    })();
    return { order: this.order(o.id), notes };
  }

  list(f = {}) {
    const where = [`o.provider IN ${PROVS}`], args = [];
    if (f.provider) { where.push('o.provider=?'); args.push(String(f.provider)); }
    if (f.status) { where.push('o.status=?'); args.push(String(f.status)); }
    if (f.playerId) { where.push('o.player_id=?'); args.push(Number(String(f.playerId).replace('#', '')) || 0); }
    if (f.q) { where.push('(o.id LIKE ? OR o.provider_txn_id LIKE ? OR p.email LIKE ?)'); args.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
    if (f.from) { where.push('o.created_at >= ?'); args.push(Number(f.from)); }
    if (f.to) { where.push('o.created_at < ?'); args.push(Number(f.to)); }
    const sql = `FROM orders o JOIN players p ON p.id=o.player_id WHERE ${where.join(' AND ')}`;
    const total = this.db.prepare('SELECT COUNT(*) n ' + sql).get(...args).n;
    const rows = this.db.prepare(`SELECT o.*, p.email, p.username, p.is_demo, p.nickname ${sql} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`).all(...args, Math.min(200, Number(f.limit) || 50), Number(f.offset) || 0);
    return { total, orders: rows.map((r) => ({ ...this.row(r), email: r.email || r.username, nickname: r.nickname || '', isDemo: !!r.is_demo, manual: /\[後台補入帳\]/.test(r.note || '') })) };
  }
  stats({ from, to, day }) {
    const args = [Number(from) || 0, Number(to) || Date.now() + 1];
    const base = `FROM orders WHERE provider IN ${PROVS} AND created_at >= ? AND created_at < ?`;
    const T = this.db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status IN ('paid','refunded') THEN amount END),0) gross,
      COALESCE(SUM(CASE WHEN status='refunded' THEN amount END),0) refunds,
      COUNT(CASE WHEN status IN ('paid','refunded') THEN 1 END) paidOrders,
      COUNT(CASE WHEN status='pending' THEN 1 END) pending,
      COUNT(CASE WHEN status='failed' THEN 1 END) failed,
      COUNT(*) orders,
      COUNT(DISTINCT CASE WHEN status='paid' THEN player_id END) payers ${base}`).get(...args);
    T.net = T.gross - T.refunds;
    const byProduct = this.db.prepare(`SELECT sku, product_name name, COUNT(*) n, SUM(amount) amount ${base} AND status='paid' GROUP BY sku ORDER BY amount DESC`).all(...args);
    const byType = this.db.prepare(`SELECT COALESCE(payment_type,'?') type, COUNT(*) n, SUM(amount) amount ${base} AND status='paid' GROUP BY 1 ORDER BY amount DESC`).all(...args);
    const daily = {};
    for (const o of this.db.prepare(`SELECT amount, status, paid_at, created_at ${base} AND status IN ('paid','refunded')`).all(...args)) { const d = day(o.paid_at || o.created_at); daily[d] = (daily[d] || 0) + (o.status === 'paid' ? o.amount : 0); }
    const byProvider = this.db.prepare(`SELECT provider, COUNT(*) n, SUM(amount) amount ${base} AND status='paid' GROUP BY provider`).all(...args);
    return { totals: T, byProduct, byType, byProvider, daily: Object.entries(daily).sort().map(([d, net]) => ({ day: d, net })), mode: this.ec.mode, merchant: this.ec.merchantId, newebpay: { mode: this.nw.mode, merchant: this.nw.merchantId, ok: this.nw.ok }, providers: this.providerList(null) };
  }

  // ---------- 共用 ----------
  row(r) {
    return r && { id: r.id, playerId: r.player_id, provider: r.provider, sku: r.sku, productName: r.product_name, amount: r.amount, status: r.status, tradeNo: r.provider_txn_id, paymentType: r.payment_type,
      payInfo: parseJSON(r.pay_info, null), grants: parseJSON(r.grants, {}), note: r.note, createdAt: r.created_at, paidAt: r.paid_at, creditedAt: r.credited_at, refundedAt: r.refunded_at, expiresAt: r.expires_at };
  }
  order(id) { return this.row(this.db.prepare(`SELECT * FROM orders WHERE id=? AND provider IN ${PROVS}`).get(String(id || ''))); }
  cardStatus(pid) {
    const pc = this.cfg(), t = Date.now(), s = this.commerce.entitlementsSummary(pid), v = s.vip;
    const left = v.active && v.expiresAt ? Math.ceil((v.expiresAt - t) / 86400000) : 0;
    return { enabled: pc.card.enabled !== false, active: !!v.active, expiresAt: v.expiresAt, daysLeft: left, dailyGems: v.perks.dailyGems || pc.card.dailyGems, claimable: !!(v.active && v.perks.dailyGems && !v.dailyClaimedToday), claimedToday: !!v.dailyClaimedToday, extraBreeds: v.perks.extraBreeds || 0 };
  }
  publicOrder(o) { if (!o) return null; const { note, playerId, ...rest } = o; return { ...rest, expired: o.status === 'pending' && o.expiresAt && o.expiresAt < Date.now() }; }
  myOrders(pid) { return this.db.prepare(`SELECT * FROM orders WHERE player_id=? AND provider IN ${PROVS} ORDER BY created_at DESC LIMIT 20`).all(pid).map((r) => this.publicOrder(this.row(r))); }
}

module.exports = { starterGrants, Pay, DEFAULT_PAY, payConfig, FUNNEL_STEPS, FUNNEL_CLIENT };
