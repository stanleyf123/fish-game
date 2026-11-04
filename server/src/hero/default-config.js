'use strict';
// 英雄魚（Hero Fish）預設設定 — 全部數值可在後台「英雄魚 PvP › 設定」調整（存在 hero_config_versions，含驗證與版本回復）。
// 物種能力不寫死在這裡：由遊戲設定（GAME_CONFIG.species）的體型／性情／攻擊性／稀有度／泳速＋下面的「科別輪廓」推導。

const HERO_DEFAULT_CONFIG = {
  version: 1,
  enabled: true,

  // ---------- 基礎能力（Lv1、成年、無訓練無裝備時的「平均魚」） ----------
  base: { hp: 340, atk: 80, def: 50, spd: 100, crit: 80 /* ‰ */, critDmg: 150 /* % */, dodge: 40 /* ‰ */ },
  // 戰力正規化：所有魚種調整到相同「戰力指數」，差別只在能力分配與技能（避免大魚／限定魚碾壓）
  // spdExp：速度越快技能循環越多，價值高於線性，所以正規化時給速度較高的指數（由平衡模擬校正）
  normalize: { enabled: true, rarityBonus: 0.03 /* 每一級稀有度 +3% 戰力 */, spdExp: 1.5, defExp: 1 },
  stage: [0.88, 0.94, 1.0], // 幼魚／亞成／成年 的戰力倍率
  traits: {
    sizeHp: 0.25, sizeDef: 0.15, sizeSpd: 0.18,        // 體型（以成魚公分的對數換算 0..1）
    aggrAtk: 0.04, aggrCrit: 0.06, aggrDef: 0.02,      // 攻擊性 0–5，每級
    temperament: {
      predator: { atk: 1.06, crit: 1.1 },
      aggressive: { atk: 1.04, crit: 1.05 },
      peaceful: { hp: 1.05, def: 1.04 },
    },
    swimSpeed: { mid: 34, span: 30, max: 0.25 },        // 遊戲內泳速 → 速度
  },
  level: { max: 50, xpBase: 80, xpExp: 1.4, hpPerLv: 0.04, atkPerLv: 0.04, defPerLv: 0.03 },

  // 自動公平校正：每個「魚種＋技能組合＋等級」以二分搜尋找出戰力倍率，使其對參考對手群（各科別代表魚）的模擬勝率 ≈ 50%。
  // 想刻意加強／削弱某科別，請設定 families.<科>.bias（例如 1.05），不會被自動校正抵銷。
  autoBalance: { enabled: true, levels: [1, 3, 8, 15, 30], panelPerFamily: 2, panelRounds: 2, seeds: 6, iterations: 9, min: 0.6, max: 1.7 },

  // ---------- 科別輪廓（能力權重 hp/atk/def/spd/crit、招牌技、技能池） ----------
  families: {
    piranha:     { name: '食人魚', w: { hp: 1, atk: 1.25, def: 0.85, spd: 1.1, crit: 1.1 }, signature: 'bite', pool: ['frenzy', 'armorbreak', 'swarm'] },
    puffer:      { name: '河豚', w: { hp: 1.15, atk: 0.95, def: 1.15, spd: 0.85, crit: 1 }, signature: 'puff', pool: ['sting', 'regen', 'fortify'] },
    shark:       { name: '鯊', w: { hp: 1, atk: 1.2, def: 0.95, spd: 1.15, crit: 1 }, signature: 'ram', pool: ['frenzy', 'armorbreak', 'charge'] },
    turtle:      { name: '龜', w: { hp: 1.25, atk: 0.9, def: 1.35, spd: 0.7, crit: 0.9 }, signature: 'shell', pool: ['fortify', 'regen', 'headbutt'] },
    ocean:       { name: '海洋巨物', w: { hp: 1.3, atk: 1, def: 1.1, spd: 0.8, crit: 0.9 }, signature: 'tide', pool: ['ram', 'sonar', 'fortify'] },
    arowana:     { name: '龍魚', w: { hp: 1, atk: 1.15, def: 1, spd: 1.05, crit: 1.1 }, signature: 'dragon', pool: ['tailwhip', 'focus', 'frenzy'] },
    fantasy:     { name: '幻想', w: { hp: 1.05, atk: 1.05, def: 1.05, spd: 1.05, crit: 1.05 }, signature: 'dragon', pool: ['flash', 'regen', 'focus'] },
    premium:     { name: '限定', w: { hp: 1.05, atk: 1.05, def: 1.05, spd: 1.05, crit: 1.05 }, signature: 'flash', pool: ['regen', 'focus', 'evade'] },
    tetra:       { name: '燈魚', w: { hp: 0.9, atk: 1, def: 0.85, spd: 1.3, crit: 1.15 }, signature: 'swarm', pool: ['evade', 'flash', 'focus'] },
    rainbowfish: { name: '彩虹魚', w: { hp: 0.95, atk: 1, def: 0.9, spd: 1.25, crit: 1.1 }, signature: 'flash', pool: ['evade', 'swarm', 'focus'] },
    livebearer:  { name: '卵胎生', w: { hp: 1, atk: 0.95, def: 0.95, spd: 1.15, crit: 1 }, signature: 'regen', pool: ['evade', 'swarm', 'bubble'] },
    killifish:   { name: '鱂魚', w: { hp: 0.95, atk: 1.05, def: 0.9, spd: 1.2, crit: 1.1 }, signature: 'flash', pool: ['evade', 'focus', 'charge'] },
    cyprinid:    { name: '鯉科', w: { hp: 1, atk: 1, def: 1, spd: 1.1, crit: 1 }, signature: 'swarm', pool: ['regen', 'evade', 'charge'] },
    goldfish:    { name: '金魚', w: { hp: 1.2, atk: 0.95, def: 1.05, spd: 0.85, crit: 1 }, signature: 'headbutt', pool: ['bubble', 'regen', 'fortify'] },
    koi:         { name: '錦鯉', w: { hp: 1.15, atk: 1, def: 1.05, spd: 0.9, crit: 1 }, signature: 'tailwhip', pool: ['regen', 'headbutt', 'fortify'] },
    cichlid_sa:  { name: '南美慈鯛', w: { hp: 1.05, atk: 1.15, def: 1, spd: 1, crit: 1.05 }, signature: 'frenzy', pool: ['headbutt', 'armorbreak', 'charge'] },
    cichlid_af:  { name: '非洲慈鯛', w: { hp: 1, atk: 1.15, def: 1, spd: 1.05, crit: 1.05 }, signature: 'frenzy', pool: ['charge', 'armorbreak', 'focus'] },
    anabantoid:  { name: '迷鰓魚', w: { hp: 1, atk: 1.1, def: 0.95, spd: 1.05, crit: 1.1 }, signature: 'bubble', pool: ['frenzy', 'tailwhip', 'focus'] },
    catfish:     { name: '鯰魚', w: { hp: 1.15, atk: 1, def: 1.15, spd: 0.85, crit: 0.95 }, signature: 'mudcloud', pool: ['armorbreak', 'fortify', 'regen'] },
    pleco:       { name: '異型', w: { hp: 1.1, atk: 0.95, def: 1.35, spd: 0.75, crit: 0.95 }, signature: 'fortify', pool: ['armorbreak', 'shell', 'regen'] },
    loach:       { name: '鰍', w: { hp: 1, atk: 1, def: 1, spd: 1.1, crit: 1 }, signature: 'mudcloud', pool: ['evade', 'sting', 'regen'] },
    oddball:     { name: '異形猛魚', w: { hp: 1.05, atk: 1.15, def: 1, spd: 1, crit: 1.05 }, signature: 'charge', pool: ['bite', 'armorbreak', 'mudcloud'] },
    marine:      { name: '海水魚', w: { hp: 1, atk: 1.05, def: 1, spd: 1.05, crit: 1.05 }, signature: 'sting', pool: ['flash', 'evade', 'regen'] },
    invert:      { name: '甲殼／螺', w: { hp: 0.95, atk: 1.05, def: 1.2, spd: 0.95, crit: 1 }, signature: 'pinch', pool: ['fortify', 'shell', 'armorbreak'] },
    _default:    { name: '其他', w: { hp: 1, atk: 1, def: 1, spd: 1, crit: 1 }, signature: 'charge', pool: ['regen', 'focus', 'fortify'] },
  },
  // 外形優先決定招牌技（鰻形→放電、龜→龜殼…），找不到再用科別
  signatureByBody: { eel: 'shock', turtle: 'shell', crab: 'pinch', crayfish: 'pinch', snail: 'shell', cetacean: 'sonar', ray: 'sting', whaleshark: 'tide', manta: 'tide', seahorse: 'evade', shrimp: 'evade' },

  // ---------- 技能（效果欄位皆可選；伺服器模擬器依欄位自動決定 AI 使用時機） ----------
  // mult 傷害倍率、hits 段數、pierce 無視防禦、bleed 持續傷害(攻擊力比例/回合)、stun 暈眩機率、debuff 敵方減益、
  // selfBuff 自身增益、shield 護盾(最大HP比例)、heal 回復、reflect 反彈、recoil 反作用、lifesteal 吸血；cd 冷卻（自身行動次數）
  skillSlots: { unlockLevels: [1, 3, 8, 15] },
  skillUnlock: [1, 2, 6, 12],           // 招牌技、技能池第 1/2/3 招 的解鎖等級
  skillRank: { max: 5, perRank: 0.08, costCoins: [0, 200, 500, 1200, 2500], minLevelPerRank: 4 },
  skills: {
    bite:       { name: '食人魚撕咬', icon: '🦷', fx: 'bite', cd: 3, mult: 1.2, bleed: { pct: 0.1, turns: 3 }, desc: '撕裂敵人並造成 3 回合流血' },
    shock:      { name: '電鰻放電', icon: '⚡', fx: 'shock', cd: 4, mult: 1.2, pierce: 0.4, stun: 0.3, desc: '無視 40% 防禦，30% 機率麻痺' },
    puff:       { name: '河豚膨脹', icon: '🐡', fx: 'puff', cd: 3, selfBuff: [{ stat: 'def', mult: 2.0, turns: 2 }], reflect: { pct: 0.6, turns: 2 }, desc: '防禦 ×2 並反彈 60% 傷害（2 回合）' },
    ram:        { name: '鯊魚衝撞', icon: '🦈', fx: 'ram', cd: 3, mult: 1.75, recoil: 0.08, desc: '全力衝撞造成大量傷害（自身受 8% 反作用）' },
    shell:      { name: '龜殼防禦', icon: '🛡️', fx: 'shell', cd: 4, shield: 0.26, desc: '縮進龜殼，獲得 26% 最大生命的護盾' },
    regen:      { name: '水流再生', icon: '💚', fx: 'heal', cd: 4, heal: 0.28, desc: '回復 28% 最大生命（生命低於 65% 時使用）' },
    frenzy:     { name: '狂怒', icon: '🔥', fx: 'frenzy', cd: 4, selfBuff: [{ stat: 'atk', mult: 2.0, turns: 3 }], desc: '攻擊 +100%（3 回合）' },
    evade:      { name: '幻影游移', icon: '💨', fx: 'evade', cd: 4, selfBuff: [{ stat: 'dodge', add: 500, turns: 3 }], desc: '閃避 +50%（3 回合）' },
    pinch:      { name: '巨螯夾擊', icon: '🦀', fx: 'pinch', cd: 3, mult: 0.75, hits: 2, debuff: [{ stat: 'def', mult: 0.7, turns: 2 }], desc: '連夾 2 次並降低敵方防禦 30%' },
    armorbreak: { name: '破甲', icon: '💥', fx: 'break', cd: 3, mult: 1.3, debuff: [{ stat: 'def', mult: 0.6, turns: 3 }], desc: '重擊並使敵方防禦 -40%（3 回合）' },
    tailwhip:   { name: '尾鰭橫掃', icon: '🌊', fx: 'slash', cd: 3, mult: 1.35, debuff: [{ stat: 'spd', mult: 0.82, turns: 2 }], desc: '橫掃並使敵方減速 18%' },
    dragon:     { name: '龍威', icon: '🐉', fx: 'dragon', cd: 4, mult: 1.3, debuff: [{ stat: 'atk', mult: 0.8, turns: 2 }], desc: '龍之威壓：重擊並使敵方攻擊 -20%' },
    sonar:      { name: '聲納鎖定', icon: '📡', fx: 'sonar', cd: 4, mult: 1.3, selfBuff: [{ stat: 'crit', add: 400, turns: 3 }], desc: '鎖定要害：攻擊並使暴擊率 +40%（3 回合）' },
    tide:       { name: '深海潮湧', icon: '🌀', fx: 'tide', cd: 4, heal: 0.13, shield: 0.15, desc: '回復 13% 生命並獲得 15% 護盾' },
    sting:      { name: '毒刺', icon: '☠️', fx: 'sting', cd: 3, mult: 0.9, bleed: { pct: 0.16, turns: 3, kind: 'poison' }, desc: '注入毒素，3 回合中毒' },
    mudcloud:   { name: '泥沙遮蔽', icon: '🌫️', fx: 'ink', cd: 4, selfBuff: [{ stat: 'dodge', add: 400, turns: 3 }], debuff: [{ stat: 'atk', mult: 0.8, turns: 3 }], desc: '揚起泥沙：自身閃避 +40%、敵方攻擊 -20%（3 回合）' },
    swarm:      { name: '群游突襲', icon: '🐟', fx: 'swarm', cd: 3, mult: 0.4, hits: 4, desc: '魚群連續突擊 4 次' },
    headbutt:   { name: '頭槌', icon: '💢', fx: 'ram', cd: 3, mult: 1.4, stun: 0.18, desc: '重重一撞，18% 機率暈眩' },
    focus:      { name: '獵殺專注', icon: '🎯', fx: 'focus', cd: 4, selfBuff: [{ stat: 'crit', add: 400, turns: 3 }, { stat: 'atk', mult: 1.6, turns: 3 }], desc: '暴擊 +40%、攻擊 +60%（3 回合）' },
    charge:     { name: '衝鋒', icon: '➡️', fx: 'ram', cd: 3, mult: 1.55, desc: '高速衝鋒造成重擊' },
    fortify:    { name: '鱗甲硬化', icon: '🪨', fx: 'shell', cd: 4, selfBuff: [{ stat: 'def', mult: 2.1, turns: 3 }], shield: 0.11, desc: '防禦 +110%（3 回合）並獲得 11% 護盾' },
    bubble:     { name: '泡泡護盾', icon: '🫧', fx: 'bubble', cd: 4, shield: 0.26, desc: '吐出泡泡巢，獲得 26% 護盾' },
    flash:      { name: '閃光鱗片', icon: '✨', fx: 'flash', cd: 3, mult: 1.1, stun: 0.2, debuff: [{ stat: 'atk', mult: 0.85, turns: 2 }], desc: '炫目閃光：20% 暈眩、敵方攻擊 -15%' },
  },

  // ---------- 訓練（現實時間冷卻；花費金幣、獲得經驗與訓練點） ----------
  training: {
    capPerStatPerLevel: 1, // 每項訓練點上限 = 等級 × 此值
    pointValue: { hp: 0.015, atk: 0.015, def: 0.015, spd: 0.012, crit: 6 /* ‰/點 */ },
    types: {
      hp:   { name: '耐力訓練', icon: '💪', stat: 'hp', cdMin: 30, coins: 40, coinsPerLv: 8, xp: 35, desc: '長距離逆流游泳，提升生命' },
      atk:  { name: '撕咬訓練', icon: '🦷', stat: 'atk', cdMin: 30, coins: 40, coinsPerLv: 8, xp: 35, desc: '對著餌料標靶練習，提升攻擊' },
      def:  { name: '鱗甲鍛鍊', icon: '🛡️', stat: 'def', cdMin: 30, coins: 40, coinsPerLv: 8, xp: 35, desc: '在砂礫中翻滾，提升防禦' },
      spd:  { name: '激流衝刺', icon: '💨', stat: 'spd', cdMin: 30, coins: 40, coinsPerLv: 8, xp: 35, desc: '激流中短距衝刺，提升速度' },
      crit: { name: '獵殺專注', icon: '🎯', stat: 'crit', cdMin: 45, coins: 50, coinsPerLv: 10, xp: 40, desc: '盯準要害練習，提升暴擊' },
      camp: { name: '全面特訓', icon: '🏟️', stat: null, cdMin: 240, coins: 100, coinsPerLv: 20, xp: 160, desc: '4 小時的全面特訓，大量經驗' },
    },
  },

  // ---------- 裝備（金幣或寶石；伺服器扣款） ----------
  gearSlots: { weapon: '牙刃', armor: '鱗甲', charm: '飾品' },
  gear: {
    w_tooth:   { slot: 'weapon', name: '磨利牙套', icon: '🦷', coins: 300, minLevel: 1, mods: { atkPct: 6 } },
    w_steel:   { slot: 'weapon', name: '鋼鰭刃', icon: '🗡️', coins: 1200, minLevel: 8, mods: { atkPct: 11, crit: 20 } },
    w_obsidian:{ slot: 'weapon', name: '黑曜獠牙', icon: '⚔️', coins: 4000, minLevel: 18, mods: { atkPct: 16, crit: 40 } },
    w_trident: { slot: 'weapon', name: '深淵三叉鰭', icon: '🔱', gems: 60, minLevel: 12, mods: { atkPct: 12, critDmg: 15 } },
    a_scale:   { slot: 'armor', name: '硬化鱗片', icon: '🐚', coins: 300, minLevel: 1, mods: { defPct: 8 } },
    a_titan:   { slot: 'armor', name: '鈦合金鱗甲', icon: '🛡️', coins: 1200, minLevel: 8, mods: { defPct: 12, hpPct: 5 } },
    a_basalt:  { slot: 'armor', name: '玄武甲', icon: '🪨', coins: 4000, minLevel: 18, mods: { defPct: 16, hpPct: 9 } },
    a_coral:   { slot: 'armor', name: '珊瑚王冠甲', icon: '🪸', gems: 60, minLevel: 12, mods: { defPct: 12, hpPct: 7 } },
    c_bubble:  { slot: 'charm', name: '氣泡護符', icon: '🫧', coins: 250, minLevel: 1, mods: { hpPct: 6 } },
    c_pearl:   { slot: 'charm', name: '黑珍珠', icon: '⚫', coins: 1000, minLevel: 6, mods: { crit: 40, critDmg: 10 } },
    c_current: { slot: 'charm', name: '激流徽章', icon: '🌊', coins: 1000, minLevel: 6, mods: { spdPct: 7 } },
    c_moon:    { slot: 'charm', name: '月光鱗墜', icon: '🌙', coins: 3500, minLevel: 15, mods: { hpPct: 8, spdPct: 5 } },
    c_aurora:  { slot: 'charm', name: '極光之心', icon: '💠', gems: 80, minLevel: 10, mods: { spdPct: 6, dodge: 30, hpPct: 5 } },
  },

  // ---------- 英雄更換 ----------
  change: { firstFree: true, coins: 500, coinsStep: 250, coinsMax: 3000, cooldownHours: 12 },

  // ---------- 戰鬥模擬（伺服器權威、確定性） ----------
  battle: { defK: 100, variance: 0.15, gauge: 1000, maxActions: 60, minDmg: 1, rankPer: 0.08 },

  // ---------- 非同步 PvP ----------
  pvp: {
    memberOnly: true,
    ticketsMax: 8, refillMinutes: 90, ticketRefillGems: 20,                 // 挑戰次數：上限 8，每 90 分鐘回復 1
    opponents: 5, offerTtlSec: 900, refreshCooldownSec: 5,
    startRating: 1000, kFactor: 32, kFactorNew: 48, newBattles: 10, defenderFactor: 0.5, minDelta: 1,
    maxVsSameOpponentPerDay: 3, sameOpponentDecay: [1, 0.5, 0.25],
    sameIpNoRating: true, minAccountAgeHours: 0,
    ratingWindow: 200, npcFill: true, npcXpFactor: 0.5,
    xp: { win: 40, lose: 15, defendWin: 5 },
    rateLimit: { actionsPerMin: 40, challengesPerMin: 6, listPerMin: 20 },
    pairFlagThreshold: 6,                              // 7 天內同一對玩家互打超過此數 → 後台「可疑配對」
  },
  ranks: [
    { key: 'bronze', name: '青銅', min: 0, color: '#c08457' },
    { key: 'silver', name: '白銀', min: 1100, color: '#c9d3dd' },
    { key: 'gold', name: '黃金', min: 1250, color: '#f3c94b' },
    { key: 'platinum', name: '白金', min: 1400, color: '#6fe0d0' },
    { key: 'diamond', name: '鑽石', min: 1550, color: '#7fb8ff' },
    { key: 'master', name: '大師', min: 1700, color: '#c58bff' },
    { key: 'legend', name: '傳奇', min: 1850, color: '#ff5d5d' },
  ],
  season: {
    softReset: 0.5, // 新賽季分數 = 起始分 + (舊分 − 起始分) × 0.5
    minBattles: 5,  // 至少打 5 場才有賽季獎勵
    rewards: {
      bronze: { coins: 300 }, silver: { coins: 600 }, gold: { coins: 1000, gems: 5 }, platinum: { coins: 1500, gems: 10 },
      diamond: { coins: 2500, gems: 20 }, master: { coins: 4000, gems: 30 }, legend: { coins: 6000, gems: 50 },
    },
    topBonus: [{ top: 1, gems: 100 }, { top: 10, gems: 40 }, { top: 100, gems: 10 }],
  },
};

module.exports = { HERO_DEFAULT_CONFIG };
