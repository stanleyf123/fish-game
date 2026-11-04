'use strict';
// 付費／會員核心邏輯（尚未串接真實金流）。
// 原則：寶石（premium currency）只存在伺服器，所有增減都寫入 gem_ledger；客戶端回報的數字一律不採信。
const crypto = require('crypto');
const { HttpError, bad, parseJSON, clampStr } = require('./util');

const PRODUCT_TYPES = ['gems', 'vip', 'item', 'bundle'];
const SKU_RE = /^[a-z0-9][a-z0-9_.-]{1,47}$/;
const ENT_FLAGS = ['no_ads', 'starter'];
const ORDER_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'canceled'];

// 綠界 MerchantTradeNo 限 20 碼英數，所以訂單編號只用英數
const newOrderId = () => 'FG' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 7);

class Commerce {
  constructor(db, players, rewards, configStore, dayFn) { this.db = db; this.players = players; this.rewards = rewards; this.cfg = configStore; this.day = dayFn; this.providers = {}; }

  // ---------- 商品 ----------
  normalizeGrants(g) {
    g = g && typeof g === 'object' ? g : {};
    const cfg = this.cfg.active().config;
    const int = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
    const perks = g.vipPerks && typeof g.vipPerks === 'object' ? g.vipPerks : {};
    const out = {
      gems: int(g.gems, 1e6), bonusGems: int(g.bonusGems, 1e6), vipDays: int(g.vipDays, 3650), coins: int(g.coins, 1e9),
      fish: (Array.isArray(g.fish) ? g.fish : []).filter((f) => f && cfg.species[f.species]).map((f) => ({ species: f.species, count: int(f.count, 20) || 1 })),
      decorations: (Array.isArray(g.decorations) ? g.decorations : []).filter((d) => cfg.decorations[d]),
      entitlements: (Array.isArray(g.entitlements) ? g.entitlements : []).filter((e) => ENT_FLAGS.includes(e)),
    };
    if (out.vipDays) out.vipPerks = { coinBonus: Math.max(0, Math.min(5, Number(perks.coinBonus) || 0)), offlineCapBonusSec: int(perks.offlineCapBonusSec, 7 * 86400), dailyGems: int(perks.dailyGems, 10000) };
    return out;
  }

  validateProduct(b, existingId) {
    const sku = String(b.sku || '').trim();
    if (!SKU_RE.test(sku)) throw bad('invalid_sku', 'SKU 需為 2–48 個小寫英數、底線、點或連字號');
    const dupe = this.db.prepare('SELECT id FROM products WHERE sku=?').get(sku);
    if (dupe && dupe.id !== existingId) throw new HttpError(409, 'sku_taken', 'SKU 已存在');
    if (!PRODUCT_TYPES.includes(b.type)) throw bad('invalid_type', '商品類型錯誤');
    const name = clampStr(b.name, 40).trim();
    if (!name) throw bad('name_required', '請輸入商品名稱');
    const priceTwd = b.priceTwd === '' || b.priceTwd == null ? null : Math.floor(Number(b.priceTwd));
    const priceGems = b.priceGems === '' || b.priceGems == null ? null : Math.floor(Number(b.priceGems));
    if (priceTwd != null && !(priceTwd >= 1 && priceTwd <= 100000)) throw bad('invalid_price', '新台幣價格需為 1–100000');
    if (priceGems != null && !(priceGems >= 1 && priceGems <= 1e6)) throw bad('invalid_price', '寶石價格需為 1–1000000');
    if (priceTwd == null && priceGems == null) throw bad('price_required', '至少要設定新台幣或寶石其中一種價格');
    if (b.type === 'gems' && priceTwd == null) throw bad('invalid_price', '寶石包只能用新台幣購買');
    const grants = this.normalizeGrants(b.grants);
    if (grants.gems && priceGems != null) throw bad('invalid_grants', '用寶石購買的商品不可再給寶石');
    const empty = !grants.gems && !grants.bonusGems && !grants.vipDays && !grants.coins && !grants.fish.length && !grants.decorations.length && !grants.entitlements.length;
    if (empty) throw bad('empty_grants', '商品內容不可為空');
    const limit = b.limitPerPlayer === '' || b.limitPerPlayer == null ? null : Math.max(1, Math.floor(Number(b.limitPerPlayer)));
    return { sku, type: b.type, name, description: clampStr(b.description, 200), priceTwd, priceGems, grants, limit, active: b.active === false || b.active === 0 ? 0 : 1, sort: Math.floor(Number(b.sort) || 0) };
  }

  createProduct(b) {
    const p = this.validateProduct(b);
    const t = Date.now();
    return Number(this.db.prepare(`INSERT INTO products (sku,type,name,description,price_twd,price_gems,grants,limit_per_player,active,sort,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(p.sku, p.type, p.name, p.description, p.priceTwd, p.priceGems, JSON.stringify(p.grants), p.limit, p.active, p.sort, t, t).lastInsertRowid);
  }

  updateProduct(id, b) {
    if (!this.db.prepare('SELECT 1 FROM products WHERE id=?').get(id)) throw new HttpError(404, 'not_found', '找不到商品');
    const p = this.validateProduct(b, id);
    this.db.prepare(`UPDATE products SET sku=?,type=?,name=?,description=?,price_twd=?,price_gems=?,grants=?,limit_per_player=?,active=?,sort=?,updated_at=? WHERE id=?`)
      .run(p.sku, p.type, p.name, p.description, p.priceTwd, p.priceGems, JSON.stringify(p.grants), p.limit, p.active, p.sort, Date.now(), id);
  }

  productRow(r) { return r && { id: r.id, sku: r.sku, type: r.type, name: r.name, description: r.description, priceTwd: r.price_twd, priceGems: r.price_gems, grants: parseJSON(r.grants, {}), limitPerPlayer: r.limit_per_player, active: !!r.active, sort: r.sort, createdAt: r.created_at, updatedAt: r.updated_at }; }
  listProducts(all) { return this.db.prepare(`SELECT * FROM products ${all ? '' : 'WHERE active=1'} ORDER BY sort, id`).all().map((r) => this.productRow(r)); }
  getProductBySku(sku) { return this.productRow(this.db.prepare('SELECT * FROM products WHERE sku=?').get(sku)); }

  // 給遊戲端的商品列表（含此玩家是否已達購買上限）
  storefront(pid) {
    return this.listProducts(false).map((p) => {
      const bought = pid ? this.db.prepare("SELECT COUNT(*) n FROM orders WHERE player_id=? AND sku=? AND status='paid'").get(pid, p.sku).n : 0;
      return { sku: p.sku, type: p.type, name: p.name, description: p.description, priceTwd: p.priceTwd, priceGems: p.priceGems, grants: p.grants, limitPerPlayer: p.limitPerPlayer, purchasable: p.limitPerPlayer == null || bought < p.limitPerPlayer };
    });
  }

  // ---------- 寶石帳本 ----------
  balance(pid) { const r = this.db.prepare('SELECT gems FROM players WHERE id=?').get(pid); return r ? r.gems : 0; }

  // delta 可正可負；allowNegative=false 時不足會拋錯（退款扣回允許變負數）
  ledger(pid, delta, reason, ref, allowNegative = false) {
    delta = Math.trunc(delta);
    const run = this.db.transaction(() => {
      const cur = this.balance(pid);
      const next = cur + delta;
      if (delta < 0 && next < 0 && !allowNegative) throw new HttpError(402, 'insufficient_gems', '寶石不足', { balance: cur });
      this.db.prepare('UPDATE players SET gems=? WHERE id=?').run(next, pid);
      this.db.prepare('INSERT INTO gem_ledger (player_id, delta, balance_after, reason, ref, created_at) VALUES (?,?,?,?,?,?)').run(pid, delta, next, reason, ref || null, Date.now());
      return next;
    });
    return run();
  }

  ledgerOf(pid, limit = 100) { return this.db.prepare('SELECT * FROM gem_ledger WHERE player_id=? ORDER BY id DESC LIMIT ?').all(pid, limit); }

  // ---------- 會員權益 ----------
  activeEntitlements(pid, t = Date.now()) {
    return this.db.prepare('SELECT * FROM entitlements WHERE player_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY id').all(pid, t)
      .map((e) => ({ ...e, perks: parseJSON(e.perks, {}) }));
  }

  vipPerks(pid) {
    const vip = this.activeEntitlements(pid).filter((e) => e.kind === 'vip');
    const perks = { coinBonus: 0, offlineCapBonusSec: 0, dailyGems: 0, extraBreeds: 0 };
    for (const v of vip) for (const k of Object.keys(perks)) perks[k] = Math.max(perks[k], Number(v.perks[k]) || 0); // 同時有多張月卡時取最大值，不疊加
    return perks;
  }

  entitlementsSummary(pid) {
    const t = Date.now();
    const ents = this.activeEntitlements(pid, t);
    const vip = ents.filter((e) => e.kind === 'vip');
    const vipExpires = vip.length ? Math.max(...vip.map((e) => e.expires_at)) : null;
    return {
      gems: this.balance(pid),
      vip: { active: vip.length > 0, expiresAt: vipExpires, perks: this.vipPerks(pid), dailyClaimedToday: !!this.db.prepare('SELECT 1 FROM vip_daily_claims WHERE player_id=? AND day=?').get(pid, this.day(t)) },
      flags: [...new Set(ents.filter((e) => e.kind !== 'vip').map((e) => e.kind))],
      serverTime: t,
    };
  }

  claimVipDaily(pid) {
    return this.db.transaction(() => {
      const perks = this.vipPerks(pid);
      if (!perks.dailyGems) throw new HttpError(403, 'not_vip', '目前不是月卡會員');
      const day = this.day();
      const r = this.db.prepare('INSERT OR IGNORE INTO vip_daily_claims (player_id, day) VALUES (?,?)').run(pid, day);
      if (!r.changes) throw new HttpError(409, 'already_claimed', '今天已經領過了');
      return { gems: perks.dailyGems, balance: this.ledger(pid, perks.dailyGems, 'vip_daily', 'vip:' + day) };
    })();
  }

  // ---------- 訂單 ----------
  orderRow(o) { return o && { id: o.id, playerId: o.player_id, sku: o.sku, productName: o.product_name, amount: o.amount, currency: o.currency, status: o.status, provider: o.provider, providerTxnId: o.provider_txn_id, grants: parseJSON(o.grants, {}), note: o.note, createdAt: o.created_at, updatedAt: o.updated_at, paidAt: o.paid_at, refundedAt: o.refunded_at }; }
  getOrder(id) { return this.orderRow(this.db.prepare('SELECT * FROM orders WHERE id=?').get(id)); }

  checkLimit(pid, product) {
    if (product.limitPerPlayer == null) return;
    // 已付款 + 30 分鐘內尚未完成的 pending 訂單都算進上限（避免同時開多張單繞過限購）
    const n = this.db.prepare("SELECT COUNT(*) n FROM orders WHERE player_id=? AND sku=? AND (status='paid' OR (status='pending' AND created_at > ?))").get(pid, product.sku, Date.now() - 30 * 60000).n;
    if (n >= product.limitPerPlayer) throw new HttpError(409, 'limit_reached', '此商品已達購買上限');
  }

  // 現金訂單：建立 pending 訂單並向金流取得付款資訊
  async createOrder(pid, { sku, provider, idempotencyKey }, ctx = {}) {
    const product = this.getProductBySku(String(sku || ''));
    if (!product || !product.active) throw new HttpError(404, 'product_not_found', '找不到商品或已下架');
    if (product.priceTwd == null) throw bad('not_for_cash', '此商品只能用寶石購買');
    const prov = this.providers[provider];
    if (!prov || !prov.enabled) throw bad('provider_unavailable', `金流「${provider}」目前未啟用`);
    const idem = idempotencyKey ? clampStr(idempotencyKey, 64) : null;
    if (idem) {
      const ex = this.db.prepare('SELECT * FROM orders WHERE player_id=? AND idempotency_key=?').get(pid, idem);
      if (ex) return { order: this.orderRow(ex), checkout: parseJSON(ex.note, {}).checkout || null, reused: true };
    }
    this.checkLimit(pid, product);
    const id = newOrderId();
    const t = Date.now();
    this.db.prepare(`INSERT INTO orders (id, player_id, product_id, sku, product_name, amount, currency, status, provider, idempotency_key, grants, created_at, updated_at)
      VALUES (?,?,?,?,?,?,'TWD','pending',?,?,?,?,?)`).run(id, pid, product.id, product.sku, product.name, product.priceTwd, provider, idem, JSON.stringify(product.grants), t, t);
    let checkout;
    try { checkout = await prov.createCheckout(this.getOrder(id), product, ctx); }
    catch (e) { this.setStatus(id, 'failed', { note: '建立付款失敗：' + e.message }); throw new HttpError(502, 'checkout_failed', '建立付款失敗', { detail: e.message }); }
    if (checkout.providerTxnId) this.db.prepare('UPDATE orders SET provider_txn_id=? WHERE id=?').run(checkout.providerTxnId, id);
    this.db.prepare('UPDATE orders SET note=? WHERE id=?').run(JSON.stringify({ checkout }), id);
    this.players.logEvent(pid, 'order_created', { orderId: id, sku: product.sku, amount: product.priceTwd, provider });
    return { order: this.getOrder(id), checkout };
  }

  setStatus(id, status, extra = {}) {
    const t = Date.now();
    this.db.prepare(`UPDATE orders SET status=?, updated_at=?, paid_at=COALESCE(?, paid_at), refunded_at=COALESCE(?, refunded_at), provider_txn_id=COALESCE(?, provider_txn_id),
      note=CASE WHEN ? IS NULL THEN note ELSE ? END WHERE id=?`).run(status, t, extra.paidAt || null, extra.refundedAt || null, extra.providerTxnId || null, extra.note || null, extra.note || null, id);
  }

  // 付款成功（由 webhook 呼叫）。冪等：已付款的訂單再次通知不會重複發貨。
  markPaid(orderId, { amount, providerTxnId, provider }) {
    const out = this.db.transaction(() => {
      const o = this.getOrder(orderId);
      if (!o) throw new HttpError(404, 'order_not_found', '找不到訂單');
      if (provider && o.provider !== provider) throw bad('provider_mismatch', '金流與訂單不符');
      if (o.status === 'paid' || o.status === 'refunded') return { order: o, duplicate: true };
      if (o.status !== 'pending') throw new HttpError(409, 'bad_state', `訂單狀態為 ${o.status}，不可設為已付款`);
      if (amount != null && Number(amount) !== o.amount) return { mismatch: `金額不符：通知 ${amount}，訂單 ${o.amount}` };
      this.setStatus(orderId, 'paid', { paidAt: Date.now(), providerTxnId });
      this.fulfill(this.getOrder(orderId));
      this.players.logEvent(o.playerId, 'order_paid', { orderId, sku: o.sku, amount: o.amount });
      return { order: this.getOrder(orderId), duplicate: false };
    })();
    if (out.mismatch) {
      // 在 transaction 外標記失敗，避免被 rollback；不發貨，留待人工查核
      this.setStatus(orderId, 'failed', { note: out.mismatch, providerTxnId });
      throw new HttpError(409, 'amount_mismatch', '付款金額與訂單不符');
    }
    return out;
  }

  markFailed(orderId, reason) {
    const o = this.getOrder(orderId);
    if (!o) throw new HttpError(404, 'order_not_found', '找不到訂單');
    if (o.status !== 'pending') return { order: o, duplicate: true };
    this.setStatus(orderId, 'failed', { note: clampStr(reason || '付款失敗', 200) });
    return { order: this.getOrder(orderId) };
  }

  // 發貨：寶石入帳、月卡延長、旗標權益；金幣／魚／裝飾走信箱（由玩家領取時寫入存檔）
  fulfill(o) {
    const g = o.grants || {};
    const pid = o.playerId;
    const gems = (g.gems || 0) + (g.bonusGems || 0);
    if (gems) this.ledger(pid, gems, o.provider === 'admin' ? 'admin_grant' : 'purchase', 'order:' + o.id);
    const t = Date.now();
    if (g.vipDays) {
      const cur = this.db.prepare("SELECT MAX(expires_at) e FROM entitlements WHERE player_id=? AND kind='vip' AND revoked_at IS NULL AND expires_at > ?").get(pid, t).e;
      const start = Math.max(t, cur || 0);
      this.db.prepare("INSERT INTO entitlements (player_id, kind, key, starts_at, expires_at, perks, order_id, created_at) VALUES (?, 'vip', ?, ?, ?, ?, ?, ?)")
        .run(pid, o.sku, start, start + g.vipDays * 86400000, JSON.stringify(g.vipPerks || {}), o.id, t);
    }
    for (const k of g.entitlements || []) {
      this.db.prepare('INSERT INTO entitlements (player_id, kind, key, starts_at, expires_at, perks, order_id, created_at) VALUES (?,?,?,?,NULL,\'{}\',?,?)').run(pid, k, o.sku, t, o.id, t);
    }
    if (g.coins || (g.fish && g.fish.length) || (g.decorations && g.decorations.length)) {
      this.rewards.create({ title: `購買內容：${o.productName}`, body: `訂單 ${o.id}`, target: 'player', playerId: pid, coins: g.coins, fish: g.fish, decorations: g.decorations }, { orderId: o.id });
    }
  }

  // 寶石購買（伺服器扣款＋發貨，同一個 transaction）
  buyWithGems(pid, sku, idempotencyKey) {
    return this.db.transaction(() => {
      const product = this.getProductBySku(String(sku || ''));
      if (!product || !product.active) throw new HttpError(404, 'product_not_found', '找不到商品或已下架');
      if (product.priceGems == null) throw bad('not_for_gems', '此商品不能用寶石購買');
      const idem = idempotencyKey ? clampStr(idempotencyKey, 64) : null;
      if (idem) { const ex = this.db.prepare('SELECT * FROM orders WHERE player_id=? AND idempotency_key=?').get(pid, idem); if (ex) return { order: this.orderRow(ex), balance: this.balance(pid), reused: true }; }
      this.checkLimit(pid, product);
      const id = newOrderId(); const t = Date.now();
      this.db.prepare(`INSERT INTO orders (id, player_id, product_id, sku, product_name, amount, currency, status, provider, idempotency_key, grants, created_at, updated_at, paid_at)
        VALUES (?,?,?,?,?,?,'GEM','paid','gems',?,?,?,?,?)`).run(id, pid, product.id, product.sku, product.name, product.priceGems, idem, JSON.stringify(product.grants), t, t, t);
      this.ledger(pid, -product.priceGems, 'spend', 'order:' + id);
      this.fulfill(this.getOrder(id));
      this.players.logEvent(pid, 'gems_spent', { orderId: id, sku: product.sku, gems: product.priceGems });
      return { order: this.getOrder(id), balance: this.balance(pid) };
    })();
  }

  // 寶石購買限定魚：同一個 transaction 內 檢查魚種／魚缸空間 → 建立訂單 → 扣寶石 → 把魚直接寫入雲端存檔（rev +1）
  // 魚種資料來自目前生效的遊戲設定（species.<id>.priceGems），後台改價立即生效。
  buySpecies(pid, spId, idempotencyKey, opts = {}) {
    const { usedSpaceOf, capacityOf } = require('./anticheat');
    return this.db.transaction(() => {
      const cfg = this.cfg.active().config;
      const id0 = String(spId || '');
      const s = Object.prototype.hasOwnProperty.call(cfg.species, id0) ? cfg.species[id0] : null;
      if (!s || !(s.priceGems > 0) || s.disabled) throw new HttpError(404, 'species_not_for_sale', '找不到這個限定魚，或已下架');
      const idem = idempotencyKey ? clampStr(idempotencyKey, 64) : null;
      if (idem) {
        const ex = this.db.prepare('SELECT * FROM orders WHERE player_id=? AND idempotency_key=?').get(pid, idem);
        if (ex) { const sv = this.players.getSave(pid); return { order: this.orderRow(ex), balance: this.balance(pid), save: sv.save, rev: sv.rev, reused: true }; }
      }
      const row = this.db.prepare('SELECT data FROM saves WHERE player_id=?').get(pid);
      if (!row) throw new HttpError(409, 'no_save', '請先同步一次雲端存檔再購買');
      const save = JSON.parse(row.data), capLv = (save.up && save.up.cap) || 0;
      if (!opts.storage) {
      { const h = s.habitat || {}, A = cfg.aquascape || {}, GE = A.gear || {}, own = (save.gear && save.gear.own) || {};
        if (h.gear && !own[h.gear]) throw new HttpError(409, 'habitat_missing', `${s.name}需要「${(GE[h.gear] || {}).name || h.gear}」`);
        const oc = Object.keys(own).reduce((m, k) => Math.max(m, (GE[k] && GE[k].ocean) || 0), 0);
        if (h.ocean && oc < h.ocean) { const k = Object.keys(GE).find((x) => GE[x].ocean === h.ocean); throw new HttpError(409, 'habitat_missing', `${s.name}需要「${k ? GE[k].name : '海洋館 Lv' + h.ocean}」`); } }
      if ((s.minTankLevel || 0) > capLv) throw new HttpError(409, 'tank_too_small', `${s.name}需要更大的魚缸（魚缸等級 ${s.minTankLevel} 以上）`);
      const used = usedSpaceOf(cfg, save.fish || []), cap = capacityOf(cfg, capLv, save), need = cfg.capacity.unit === 'tankSpace' ? (s.tankSpace > 0 ? s.tankSpace : 1) : 1;
      if (used + need > cap + 1e-9) throw new HttpError(409, 'tank_full', `魚缸空間不足（需要 ${need} 格，剩 ${Math.max(0, +(cap - used).toFixed(2))} 格）`);
      }
      if (opts.check) opts.check(save);
      const price = Number.isInteger(opts.price) && opts.price > 0 ? opts.price : s.priceGems, sku = opts.sku || 'species:' + id0;
      const bal = this.balance(pid);
      if (bal < price) throw new HttpError(402, 'insufficient_gems', '寶石不足', { balance: bal, price });
      const id = newOrderId(); const t = Date.now();
      const grants = { fish: [{ species: id0, count: 1 }] };
      this.db.prepare(`INSERT INTO orders (id, player_id, product_id, sku, product_name, amount, currency, status, provider, idempotency_key, grants, created_at, updated_at, paid_at)
        VALUES (?,?,NULL,?,?,?,'GEM','paid','gems',?,?,?,?,?)`).run(id, pid, sku, (opts.label || '限定魚・') + s.name, price, idem, JSON.stringify(grants), t, t, t);
      this.ledger(pid, -price, 'spend', 'order:' + id);
      const g = this.players.grantToSave(pid, { fish: [{ species: id0, count: 1, growth: 0 }] });
      this.players.logEvent(pid, 'gems_spent', { orderId: id, sku, gems: price });
      return { order: this.getOrder(id), balance: this.balance(pid), save: g.save, rev: g.rev, fish: g.addedFish[0] };
    })();
  }

  // 寶石購買水草（放進插枝庫存）或設備（燈具／海洋館等）：同一個 transaction 內檢查 → 建立訂單 → 扣寶石 → 寫入雲端存檔
  buyItem(pid, kind, itemId, idempotencyKey) {
    if (String(kind || '') === 'med') return this.buyMedicine(pid, itemId, idempotencyKey);
    return this.db.transaction(() => {
      const cfg = this.cfg.active().config, A = cfg.aquascape || {}, k = String(kind || ''), id0 = String(itemId || '');
      if (!['plant', 'gear', 'deco'].includes(k)) throw new HttpError(400, 'bad_kind', 'kind 必須是 plant、gear 或 deco');
      const list = (k === 'deco' ? cfg.decorations : k === 'plant' ? A.plants : A.gear) || {};
      const it = Object.prototype.hasOwnProperty.call(list, id0) ? list[id0] : null;
      if (!it || !(it.priceGems > 0) || it.disabled) throw new HttpError(404, 'item_not_for_sale', '找不到這個商品，或已下架');
      const idem = idempotencyKey ? clampStr(idempotencyKey, 64) : null;
      if (idem) {
        const ex = this.db.prepare('SELECT * FROM orders WHERE player_id=? AND idempotency_key=?').get(pid, idem);
        if (ex) { const sv = this.players.getSave(pid); return { order: this.orderRow(ex), balance: this.balance(pid), save: sv.save, rev: sv.rev, reused: true }; }
      }
      const row = this.db.prepare('SELECT data FROM saves WHERE player_id=?').get(pid);
      if (!row) throw new HttpError(409, 'no_save', '請先同步一次雲端存檔再購買');
      const save = JSON.parse(row.data), own = (save.gear && save.gear.own) || {};
      if (k === 'deco') {
        if ((save.up?.deco || []).includes(id0)||this.players.decoInventory?.has(pid,id0)) throw new HttpError(409, 'already_owned', `已經擁有「${it.name}」`);
      } else if (k === 'gear') {
        if (own[id0]) throw new HttpError(409, 'already_owned', `已經擁有「${it.name}」`);
        if (it.requires && !own[it.requires]) throw new HttpError(409, 'requires', `需要先購買「${(A.gear[it.requires] || {}).name || it.requires}」`);
        if (it.requiresCap != null && ((save.up && save.up.cap) || 0) < it.requiresCap) throw new HttpError(409, 'requires', `需要先把魚缸擴建到 Lv${it.requiresCap}`);
      } else if (((save.cut && save.cut[id0]) || 0) >= 99) throw new HttpError(409, 'too_many', '插枝庫存已滿');
      const bal = this.balance(pid);
      if (bal < it.priceGems) throw new HttpError(402, 'insufficient_gems', '寶石不足', { balance: bal, price: it.priceGems });
      const id = newOrderId(); const t = Date.now(), sku = k + ':' + id0;
      const grants = k === 'deco' ? { decorations: [id0] } : k === 'gear' ? { gear: [id0] } : { cuttings: { [id0]: 1 }, gcut: { [id0]: 1 } };
      this.db.prepare(`INSERT INTO orders (id, player_id, product_id, sku, product_name, amount, currency, status, provider, idempotency_key, grants, created_at, updated_at, paid_at)
        VALUES (?,?,NULL,?,?,?,'GEM','paid','gems',?,?,?,?,?)`).run(id, pid, sku, (k === 'deco' ? '造景・' : k === 'gear' ? '設備・' : '水草・') + it.name, it.priceGems, idem, JSON.stringify(grants), t, t, t);
      this.ledger(pid, -it.priceGems, 'spend', 'order:' + id);
      const g = this.players.grantToSave(pid, grants);
      this.players.logEvent(pid, 'gems_spent', { orderId: id, sku, gems: it.priceGems });
      return { order: this.getOrder(id), balance: this.balance(pid), save: g.save, rev: g.rev };
    })();
  }

  // 💊 寶石購買特效藥（v4.0.5）：會員限定；價格／開關來自目前生效的遊戲設定 medicine.items（後台可改）；放進存檔 items.<id>（庫存）
  buyMedicine(pid, itemId, idempotencyKey) {
    const { medItem, medPrice, medCfg } = require('./medicine');
    const { capacityOf } = require('./anticheat');
    return this.db.transaction(() => {
      const cfg = this.cfg.active().config, id0 = String(itemId || ''), M = medCfg(cfg);
      const it = medItem(cfg, id0);
      if (!it || !(it.priceGems > 0 || Array.isArray(it.priceByCap))) throw new HttpError(404, 'item_not_for_sale', '找不到這個藥品，或已下架');
      const p = this.players.get(pid);
      if (!p || (M.membersOnly !== false && !p.username)) throw new HttpError(403, 'members_only', '寶石藥品只開放給註冊會員，請先註冊或登入');
      const idem = idempotencyKey ? clampStr(idempotencyKey, 64) : null;
      if (idem) {
        const ex = this.db.prepare('SELECT * FROM orders WHERE player_id=? AND idempotency_key=?').get(pid, idem);
        if (ex) { const sv = this.players.getSave(pid); return { order: this.orderRow(ex), balance: this.balance(pid), save: sv.save, rev: sv.rev, reused: true }; }
      }
      const row = this.db.prepare('SELECT data FROM saves WHERE player_id=?').get(pid);
      if (!row) throw new HttpError(409, 'no_save', '請先同步一次雲端存檔再購買');
      const save = JSON.parse(row.data), have = (save.items && save.items[id0]) || 0, maxStock = M.maxStock || 20;
      if (have >= maxStock) throw new HttpError(409, 'too_many', `「${it.name}」最多存放 ${maxStock} 份，先用掉一些吧`);
      const price = medPrice(it, capacityOf(cfg, (save.up && save.up.cap) || 0, save));
      if (!(price > 0)) throw new HttpError(404, 'item_not_for_sale', '找不到這個藥品，或已下架');
      const bal = this.balance(pid);
      if (bal < price) throw new HttpError(402, 'insufficient_gems', '寶石不足', { balance: bal, price });
      const id = newOrderId(); const t = Date.now(), sku = 'med:' + id0, grants = { items: { [id0]: 1 } };
      this.db.prepare(`INSERT INTO orders (id, player_id, product_id, sku, product_name, amount, currency, status, provider, idempotency_key, grants, created_at, updated_at, paid_at)
        VALUES (?,?,NULL,?,?,?,'GEM','paid','gems',?,?,?,?,?)`).run(id, pid, sku, '藥品・' + it.name, price, idem, JSON.stringify(grants), t, t, t);
      this.ledger(pid, -price, 'spend', 'order:' + id);
      const g = this.players.grantToSave(pid, grants);
      this.players.logEvent(pid, 'gems_spent', { orderId: id, sku, gems: price });
      return { order: this.getOrder(id), balance: this.balance(pid), save: g.save, rev: g.rev, price };
    })();
  }

  // 後台手動發放商品（不收款）
  adminGrantProduct(pid, sku, note) {
    if (!this.players.get(pid)) throw new HttpError(404, 'player_not_found', '找不到玩家');
    const product = this.getProductBySku(String(sku || ''));
    if (!product) throw new HttpError(404, 'product_not_found', '找不到商品');
    return this.db.transaction(() => {
      const id = newOrderId(); const t = Date.now();
      this.db.prepare(`INSERT INTO orders (id, player_id, product_id, sku, product_name, amount, currency, status, provider, grants, note, created_at, updated_at, paid_at)
        VALUES (?,?,?,?,?,0,'TWD','paid','admin',?,?,?,?,?)`).run(id, pid, product.id, product.sku, product.name, JSON.stringify(product.grants), clampStr(note || '後台手動發放', 200), t, t, t);
      this.fulfill(this.getOrder(id));
      return this.getOrder(id);
    })();
  }

  // 退款：訂單標記 refunded、扣回寶石（可變負數）、撤銷權益、撤回未領取的信箱內容。
  // 注意：真實金流的退款需另外呼叫金流 API（provider.refund），此處只處理遊戲內狀態。
  async refund(orderId, { by = 'admin', reason = '', callProvider = false } = {}) {
    const o = this.getOrder(orderId);
    if (!o) throw new HttpError(404, 'order_not_found', '找不到訂單');
    if (o.status === 'refunded') return { order: o, duplicate: true };
    if (o.status !== 'paid') throw new HttpError(409, 'bad_state', '只有已付款訂單可以退款');
    let providerResult = null;
    if (callProvider && this.providers[o.provider] && this.providers[o.provider].refund) providerResult = await this.providers[o.provider].refund(o);
    const notes = [];
    this.db.transaction(() => {
      const g = o.grants || {};
      const gems = (g.gems || 0) + (g.bonusGems || 0);
      if (gems) this.ledger(o.playerId, -gems, 'refund', 'order:' + o.id, true);
      if (o.provider === 'gems') this.ledger(o.playerId, o.amount, 'refund', 'order:' + o.id); // 寶石購買退回寶石
      this.db.prepare('UPDATE entitlements SET revoked_at=? WHERE order_id=? AND revoked_at IS NULL').run(Date.now(), o.id);
      const rw = this.db.prepare('SELECT r.id, (SELECT COUNT(*) FROM reward_claims c WHERE c.reward_id=r.id) claimed FROM rewards r WHERE order_id=?').all(o.id);
      if (String(o.sku).startsWith('species:')) notes.push('限定魚已直接放入玩家魚缸，退款不會自動移除（如需移除請到玩家存檔編輯）');
      for (const r of rw) { if (r.claimed) notes.push(`信箱內容 #${r.id} 已被領取，金幣/魚無法自動收回`); else this.db.prepare('UPDATE rewards SET revoked=1 WHERE id=?').run(r.id); }
      this.setStatus(o.id, 'refunded', { refundedAt: Date.now(), note: clampStr(`[${by}] ${reason} ${notes.join('；')}`.trim(), 500) });
      this.players.logEvent(o.playerId, 'order_refunded', { orderId: o.id, by, reason });
    })();
    return { order: this.getOrder(o.id), notes, providerResult };
  }

  listOrders(f = {}) {
    const where = []; const args = [];
    if (f.status && ORDER_STATUSES.includes(f.status)) { where.push('o.status=?'); args.push(f.status); }
    if (f.provider) { where.push('o.provider=?'); args.push(f.provider); }
    if (f.playerId) { where.push('o.player_id=?'); args.push(Number(f.playerId)); }
    if (f.sku) { where.push('o.sku=?'); args.push(f.sku); }
    if (f.q) { where.push('(o.id LIKE ? OR o.provider_txn_id LIKE ?)'); args.push(`%${f.q}%`, `%${f.q}%`); }
    if (f.from) { where.push('o.created_at >= ?'); args.push(Number(f.from)); }
    if (f.to) { where.push('o.created_at <= ?'); args.push(Number(f.to)); }
    if (f.excludeDemo) where.push('p.is_demo=0');
    const sql = `FROM orders o JOIN players p ON p.id=o.player_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
    const total = this.db.prepare('SELECT COUNT(*) n ' + sql).get(...args).n;
    const rows = this.db.prepare(`SELECT o.*, p.username, p.nickname, p.is_demo ${sql} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`).all(...args, Math.min(200, Number(f.limit) || 50), Number(f.offset) || 0);
    return { total, orders: rows.map((r) => ({ ...this.orderRow(r), username: r.username, nickname: r.nickname, isDemo: !!r.is_demo })) };
  }

  memberships({ includeExpired = false } = {}) {
    const t = Date.now();
    return this.db.prepare(`SELECT p.id player_id, p.username, p.nickname, p.is_demo, MIN(e.starts_at) since, MAX(e.expires_at) expires_at, COUNT(*) cards
      FROM entitlements e JOIN players p ON p.id=e.player_id WHERE e.kind='vip' AND e.revoked_at IS NULL ${includeExpired ? '' : 'AND e.expires_at > ?'}
      GROUP BY p.id ORDER BY expires_at DESC LIMIT 500`).all(...(includeExpired ? [] : [t]))
      .map((r) => ({ playerId: r.player_id, username: r.username, nickname: r.nickname, isDemo: !!r.is_demo, since: r.since, expiresAt: r.expires_at, active: r.expires_at > t, cards: r.cards }));
  }
}

module.exports = { Commerce, PRODUCT_TYPES, ORDER_STATUSES, newOrderId };
