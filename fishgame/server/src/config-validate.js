'use strict';
// GAME_CONFIG 結構驗證（對應遊戲 index.html 內建 GAME_CONFIG 的結構，含照護系統）。
// 回傳錯誤訊息陣列（繁體中文，含欄位路徑）；空陣列代表通過。
// 只檢查已知欄位；未知欄位會保留（讓遊戲端日後新增欄位時不會被後台擋下）。
const BODIES = ['fish', 'tall', 'round', 'shrimp', 'elongated', 'torpedo', 'disc', 'arowana', 'catfish', 'pleco', 'eel', 'ray', 'crab', 'crayfish', 'snail', 'seahorse', 'turtle', 'cetacean', 'whaleshark', 'manta', 'python', 'true_shark', 'crocodile'];
const NOFIN_BODIES = ['shrimp', 'turtle', 'cetacean', 'whaleshark', 'manta', 'python', 'true_shark', 'crocodile'];
const ROLES = ['swim', 'bottom', 'glass', 'shrimp'];
const TAILS = ['fan', 'fork', 'small', 'flow', 'lyre', 'sword', 'round', 'double', 'crescent', 'none'];
const FINS = ['std', 'tall', 'flowing', 'round', 'sail', 'shark', 'long', 'spiny', 'none', 'finlets', 'knife', 'pennant', 'lion', 'whip'];
const PATTERNS = ['belly', 'bands', 'neonStripe', 'palette', 'vstripes', 'spots', 'patches', 'scales', 'rainbow', 'sheen', 'stripe', 'dots',
  'tigerBars', 'leopard', 'reticulate', 'ocellus', 'calico', 'lateral', 'mask', 'gradient', 'pearl', 'pinstripe', 'marble', 'saddle', 'belly2', 'bandsShrimp', 'pearl3',
  'galaxy', 'prism', 'goldleaf', 'sakura', 'flame', 'crystal', 'aurora', 'starlight']; // 最後 8 種為限定魚花紋
// 外觀擴充（species/render-ext.js）與性情／體型（species/mechanics.js）
const LOOK_ENUMS = {
  tailPattern: ['bars', 'edge', 'spots', 'rays'],
  mouth: ['normal', 'up', 'under', 'sucker', 'beak', 'snout', 'lips', 'jaw', 'trunk', 'o', 'pompom', 'barbel1'],
  eyes: ['normal', 'red', 'blue', 'yellow', 'telescope', 'bubble', 'celestial', 'mask', 'none'],
  head: ['wen', 'hump', 'dot'], whiskers: ['none', 'short', 'long', 'bristle'], pectoral: ['big', 'wing'],
  trail: ['sparkle', 'bubble', 'petal', 'ember', 'snow', 'star'], // 限定魚游動粒子
};
const LOOK_FLAGS = ['glow', 'transparent', 'spikes', 'flip', 'feelers', 'fanArms', 'coneShell', 'hermit', 'shimmer', 'aura', 'stages', 'ridge', 'flipper'];
const PLANT_TYPES = ['carpet', 'grass', 'crypt', 'ball', 'moss', 'anubias', 'fern', 'rosette', 'stem', 'bushy', 'lily', 'ribbon', 'float', 'lettuce', 'waterlily', 'grape', 'branch'];
const PLANT_ZONES = ['fore', 'attach', 'mid', 'back', 'float'];
const GEAR_CATS = ['light', 'air', 'temp', 'co2', 'uv', 'flow', 'skimmer', 'habitat', 'ocean'];
const TEMPERAMENTS = ['peaceful', 'aggressive', 'predator'];
const AGGRESSION_STYLES = ['nip', 'chase', 'territorial'];
const SIZE_CLASSES = ['mini', 'small', 'medium', 'large', 'giant'];
const WATER_TYPES = ['fresh', 'brackish', 'marine'];
const PREY_TYPES = ['fish', 'invert', 'snail'];
const MAX_SPECIES = 500;
const KEY_RE = /^[a-z][a-zA-Z0-9_]{1,31}$/;
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|(hsl|hsla|rgb|rgba)\([\d.,%\s]+\))$/;

function validateConfig(cfg) {
  const errs = [];
  const err = (p, m) => errs.push(`${p}：${m}`);
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const num = (p, v, min, max, int) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return err(p, '必須是數字'), false;
    if (min != null && v < min) return err(p, `不可小於 ${min}`), false;
    if (max != null && v > max) return err(p, `不可大於 ${max}`), false;
    if (int && !Number.isInteger(v)) return err(p, '必須是整數'), false;
    return true;
  };
  const optNum = (p, v, min, max, int) => v == null || num(p, v, min, max, int);
  const str = (p, v, maxLen = 200, allowEmpty = false) => {
    if (typeof v !== 'string') return err(p, '必須是文字'), false;
    if (!allowEmpty && !v.trim()) return err(p, '不可為空'), false;
    if (v.length > maxLen) return err(p, `長度不可超過 ${maxLen}`), false;
    return true;
  };
  const bool = (p, v, optional) => { if (optional && v == null) return true; if (typeof v !== 'boolean') return err(p, '必須是 true / false'), false; return true; };
  const color = (p, v, optional) => { if (optional && v == null) return true; if (typeof v !== 'string' || !COLOR_RE.test(v.trim())) return err(p, '需為 #hex、hsl()、rgb() 顏色'), false; return true; };
  const arr = (p, v, min = 0, max = 100) => {
    if (!Array.isArray(v)) return err(p, '必須是陣列'), false;
    if (v.length < min) return err(p, `至少需要 ${min} 項`), false;
    if (v.length > max) return err(p, `最多 ${max} 項`), false;
    return true;
  };
  const obj = (p, v) => { if (!isObj(v)) return err(p, '缺少或必須是物件'), false; return true; };
  const range2 = (p, v, min, max) => { if (arr(p, v, 2, 2) && num(`${p}[0]`, v[0], min, max) && num(`${p}[1]`, v[1], min, max) && v[1] < v[0]) err(p, '上限需 ≥ 下限'); };

  if (!isObj(cfg)) return ['設定必須是 JSON 物件'];
  num('version', cfg.version, 1, 1e6, true);
  str('saveKey', cfg.saveKey, 64);
  const optObj = (p, v) => v == null || obj(p, v);
  const nums = (base, o, keys, min, max, int) => keys.forEach((k) => num(`${base}.${k}`, o[k], min, max, int));

  // 魚種
  const spKeys = new Set();
  if (obj('species', cfg.species)) {
    const entries = Object.entries(cfg.species);
    if (!entries.length) err('species', '至少需要一種魚');
    if (entries.length > MAX_SPECIES) err('species', `魚種太多（上限 ${MAX_SPECIES}）`);
    for (const [k, s] of entries) {
      const p = `species.${k}`;
      if (!KEY_RE.test(k)) err(p, '代號需英文字母開頭，只能含英數與底線（2–32 字）');
      spKeys.add(k);
      if (!obj(p, s)) continue;
      str(`${p}.name`, s.name, 20);
      num(`${p}.rarity`, s.rarity, 0, Array.isArray(cfg.rarity) ? cfg.rarity.length - 1 : 9, true);
      num(`${p}.price`, s.price, 0, 1e9, true);
      optNum(`${p}.sellPrice`, s.sellPrice, 0, 1e9, true);
      num(`${p}.coin`, s.coin, 0, 1e6);
      bool(`${p}.breedOnly`, s.breedOnly, true);
      bool(`${p}.disabled`, s.disabled, true);
      num(`${p}.speed`, s.speed, 5, 200);
      str(`${p}.desc`, s.desc, 120, true);
      optNum(`${p}.bioload`, s.bioload, 0, 20);
      optNum(`${p}.hungerMultiplier`, s.hungerMultiplier, 0, 10);
      if (s.role != null && !ROLES.includes(s.role)) err(`${p}.role`, `必須是 ${ROLES.join(' / ')}`);
      if (s.clean != null && obj(`${p}.clean`, s.clean)) {
        optNum(`${p}.clean.wastePerHour`, s.clean.wastePerHour, 0, 100); optNum(`${p}.clean.algaePerHour`, s.clean.algaePerHour, 0, 100);
        bool(`${p}.clean.eatsLeftovers`, s.clean.eatsLeftovers, true);
      }
      // 限定魚：只能用寶石購買（priceGems），金幣售價必須為 0，需設定賣回金幣（sellPrice）
      optNum(`${p}.priceGems`, s.priceGems, 1, 100000, true); bool(`${p}.premium`, s.premium, true);
      const gemOnly = s.priceGems > 0;
      if (gemOnly && s.price !== 0) err(`${p}.price`, '寶石限定魚的金幣售價必須為 0');
      if (gemOnly && s.breedOnly) err(`${p}.breedOnly`, '寶石限定魚不可同時是繁殖限定');
      if (gemOnly && !(s.sellPrice > 0)) err(`${p}.sellPrice`, '寶石限定魚需設定賣回金幣（sellPrice）');
      bool(`${p}.eggExclusive`, s.eggExclusive, true);
      if(s.eggExclusive && (!s.premium || gemOnly || s.price!==0 || !s.breedOnly)) err(`${p}.eggExclusive`, '魚蛋專屬魚需為無直接售價的限定魚種');
      bool(`${p}.starterExclusive`, s.starterExclusive, true);
      if(s.starterExclusive && (!s.premium || gemOnly || s.price!==0 || !s.breedOnly || s.eggExclusive)) err(`${p}.starterExclusive`, '新手專屬魚需無直接售價且不可為魚蛋專屬');
      if (s.premium && !gemOnly && !s.eggExclusive && !s.starterExclusive) err(`${p}.priceGems`, 'premium 魚種需設定寶石價（priceGems）');
      if (!s.breedOnly && !gemOnly && !(s.price > 0)) err(`${p}.price`, '非繁殖限定的魚種售價必須大於 0');
      if (s.breedOnly && !(s.sellPrice > 0)) err(`${p}.sellPrice`, '繁殖限定魚種需設定回收價（sellPrice）');
      const L = s.look;
      if (obj(`${p}.look`, L)) {
        if (!BODIES.includes(L.body)) err(`${p}.look.body`, `必須是 ${BODIES.join(' / ')}`);
        const shrimp = NOFIN_BODIES.includes(L.body);
        if ((!shrimp || L.tail != null) && !TAILS.includes(L.tail)) err(`${p}.look.tail`, `必須是 ${TAILS.join(' / ')}`);
        if ((!shrimp || L.fins != null) && !FINS.includes(L.fins)) err(`${p}.look.fins`, `必須是 ${FINS.join(' / ')}`);
        if (!PATTERNS.includes(L.pattern)) err(`${p}.look.pattern`, `必須是 ${PATTERNS.join(' / ')}`);
        num(`${p}.look.len`, L.len, 6, 120); optNum(`${p}.look.giant`, L.giant, 1, 6); num(`${p}.look.height`, L.height, 3, 60);
        num(`${p}.look.hue`, L.hue, 0, 360); num(`${p}.look.sat`, L.sat, 0, 100); num(`${p}.look.light`, L.light, 0, 100);
        optNum(`${p}.look.tailScale`, L.tailScale, .3, 3); optNum(`${p}.look.eyeScale`, L.eyeScale, .3, 3); optNum(`${p}.look.hueCycle`, L.hueCycle, 0, 720);
        color(`${p}.look.patternColor`, L.patternColor, true); color(`${p}.look.tailColor`, L.tailColor, true);
        bool(`${p}.look.puffs`, L.puffs, true); bool(`${p}.look.barbels`, L.barbels, true);
        for (const [k, list] of Object.entries(LOOK_ENUMS)) if (L[k] != null && !list.includes(L[k])) err(`${p}.look.${k}`, `必須是 ${list.join(' / ')}`);
        if (L.pattern2 != null && !PATTERNS.includes(L.pattern2)) err(`${p}.look.pattern2`, `必須是 ${PATTERNS.join(' / ')}`);
        color(`${p}.look.pattern2Color`, L.pattern2Color, true); color(`${p}.look.accentColor`, L.accentColor, true);
        optNum(`${p}.look.stripeCount`, L.stripeCount, 1, 12, true);
        for (const k of LOOK_FLAGS) bool(`${p}.look.${k}`, L[k], true);
        optNum(`${p}.look.shimmerHue`, L.shimmerHue, 0, 360); color(`${p}.look.auraColor`, L.auraColor, true); color(`${p}.look.trailColor`, L.trailColor, true);
        // 成年型態覆寫（只在成年時套用）
        if (L.adult != null && obj(`${p}.look.adult`, L.adult)) {
          const A = L.adult, q = `${p}.look.adult`;
          for (const k of Object.keys(A)) if (!['tailScale', 'headScale', 'eyeScale', 'sat', 'light', 'tail', 'fins', 'glow', 'aura', 'pattern2', 'pattern2Color', 'accentColor'].includes(k)) err(`${q}.${k}`, '不支援的成年外觀欄位');
          optNum(`${q}.tailScale`, A.tailScale, .3, 3); optNum(`${q}.headScale`, A.headScale, .3, 3); optNum(`${q}.eyeScale`, A.eyeScale, .3, 3);
          optNum(`${q}.sat`, A.sat, 0, 100); optNum(`${q}.light`, A.light, 0, 100);
          if (A.tail != null && !TAILS.includes(A.tail)) err(`${q}.tail`, `必須是 ${TAILS.join(' / ')}`);
          if (A.fins != null && !FINS.includes(A.fins)) err(`${q}.fins`, `必須是 ${FINS.join(' / ')}`);
          if (A.pattern2 != null && !PATTERNS.includes(A.pattern2)) err(`${q}.pattern2`, `必須是 ${PATTERNS.join(' / ')}`);
          bool(`${q}.glow`, A.glow, true); bool(`${q}.aura`, A.aura, true); color(`${q}.pattern2Color`, A.pattern2Color, true); color(`${q}.accentColor`, A.accentColor, true);
        }
      }
      // 性情／體型（皆為選填；缺少時 mechanics.js 會自動推論）
      if (s.family != null) str(`${p}.family`, s.family, 32);
      if (s.familyName != null) str(`${p}.familyName`, s.familyName, 20);
      if (s.scientificName != null) str(`${p}.scientificName`, s.scientificName, 80);
      if (s.temperament != null && !TEMPERAMENTS.includes(s.temperament)) err(`${p}.temperament`, `必須是 ${TEMPERAMENTS.join(' / ')}`);
      optNum(`${p}.aggression`, s.aggression, 0, 5, true);
      if (s.aggressionStyle != null && !AGGRESSION_STYLES.includes(s.aggressionStyle)) err(`${p}.aggressionStyle`, `必須是 ${AGGRESSION_STYLES.join(' / ')}`);
      if (s.sizeClass != null && !SIZE_CLASSES.includes(s.sizeClass)) err(`${p}.sizeClass`, `必須是 ${SIZE_CLASSES.join(' / ')}`);
      optNum(`${p}.adultSizeCm`, s.adultSizeCm, .5, 2000); optNum(`${p}.tankSpace`, s.tankSpace, .1, 400);
      bool(`${p}.plantEater`, s.plantEater, true);
      if (s.temp != null) range2(`${p}.temp`, s.temp, 0, 40);
      if (s.habitat != null && obj(`${p}.habitat`, s.habitat)) { const H = s.habitat; if (H.gear != null && !(cfg.aquascape && cfg.aquascape.gear && cfg.aquascape.gear[H.gear])) err(`${p}.habitat.gear`, `找不到設備「${H.gear}」`); if (H.ocean != null) num(`${p}.habitat.ocean`, H.ocean, 1, 3, true); for (const k of Object.keys(H)) if (!['gear', 'ocean'].includes(k)) err(`${p}.habitat.${k}`, '不支援的棲地欄位'); }
      optNum(`${p}.minTankLevel`, s.minTankLevel, 0, Array.isArray(cfg.capacity && cfg.capacity.upgrades) ? cfg.capacity.upgrades.length : 50, true);
      bool(`${p}.schooling`, s.schooling, true); optNum(`${p}.minGroup`, s.minGroup, 1, 30, true);
      if (s.waterType != null && !WATER_TYPES.includes(s.waterType)) err(`${p}.waterType`, `必須是 ${WATER_TYPES.join(' / ')}`);
      optNum(`${p}.unlockLevel`, s.unlockLevel, 1, 50, true); bool(`${p}.longFins`, s.longFins, true); bool(`${p}.eatsInverts`, s.eatsInverts, true);
      if (s.temperament === 'predator' && s.preyMaxSizeRatio == null) err(`${p}.preyMaxSizeRatio`, '肉食魚需設定可吃的體長比例');
      optNum(`${p}.preyMaxSizeRatio`, s.preyMaxSizeRatio, .05, 3);
      if (s.preyTypes != null && arr(`${p}.preyTypes`, s.preyTypes, 1, 3)) s.preyTypes.forEach((t, j) => { if (!PREY_TYPES.includes(t)) err(`${p}.preyTypes[${j}]`, `必須是 ${PREY_TYPES.join(' / ')}`); });
    }
    if (!entries.some(([, s]) => s && !s.breedOnly && !s.disabled && s.price > 0)) err('species', '至少需要一種可在魚店購買的魚');
  }

  if (obj('start', cfg.start)) {
    num('start.coins', cfg.start.coins, 0, 1e9, true);
    if (arr('start.fish', cfg.start.fish, 0, 30)) cfg.start.fish.forEach((f, i) => {
      if (!isObj(f) || !spKeys.has(f.species)) err(`start.fish[${i}].species`, '找不到此魚種代號');
      else optNum(`start.fish[${i}].growth`, f.growth, 0, 1e5);
    });
  }
  if (arr('names', cfg.names, 1, 500)) cfg.names.forEach((n, i) => str(`names[${i}]`, n, 10));
  if (arr('rarity', cfg.rarity, 1, 10)) cfg.rarity.forEach((r, i) => { if (obj(`rarity[${i}]`, r)) { str(`rarity[${i}].name`, r.name, 10); color(`rarity[${i}].color`, r.color); } });
  if (arr('stages', cfg.stages, 3, 3)) {
    cfg.stages.forEach((s, i) => { if (obj(`stages[${i}]`, s)) { str(`stages[${i}].name`, s.name, 10); num(`stages[${i}].growth`, s.growth, 0, 1e5); num(`stages[${i}].coinMultiplier`, s.coinMultiplier, 0, 100); } });
    const g = cfg.stages.map((s) => s && s.growth);
    if (!(g[0] <= g[1] && g[1] < g[2])) err('stages', '各階段成長門檻必須遞增');
  }
  if (obj('growth', cfg.growth)) { num('growth.passivePerHour', cfg.growth.passivePerHour, 0, 1000); num('growth.passiveMinFullness', cfg.growth.passiveMinFullness, 0, 100); num('growth.sickMultiplier', cfg.growth.sickMultiplier, 0, 10); }
  // 照護系統（真實時間，單位：小時）
  if (obj('care', cfg.care)) { num('care.timeScale', cfg.care.timeScale, .01, 10000); num('care.simStepSec', cfg.care.simStepSec, 1, 86400); num('care.maxCatchUpHours', cfg.care.maxCatchUpHours, 0, 24 * 90); }
  if (obj('hunger', cfg.hunger)) {
    const h = cfg.hunger;
    num('hunger.decayPerHour', h.decayPerHour, 0, 1000); num('hunger.juvenileDecayMultiplier', h.juvenileDecayMultiplier, 0, 10);
    nums('hunger', h, ['seekBelow', 'hungryBelow', 'startFullness', 'offspringFullness'], 0, 100);
    num('hunger.forageFullPerHour', h.forageFullPerHour, 0, 1000);
    if (h.idealFeedingsPerDay != null) str('hunger.idealFeedingsPerDay', String(h.idealFeedingsPerDay), 10);
    if (h.hungryBelow > h.seekBelow) err('hunger.hungryBelow', '不可大於 seekBelow');
  }
  if (obj('health', cfg.health)) {
    const h = cfg.health;
    num('health.sickBelow', h.sickBelow, 0, 100); num('health.healthyDirtBelow', h.healthyDirtBelow, 0, 99); num('health.newFishStressUncycled', h.newFishStressUncycled, 0, 100);
    nums('health', h, ['recoverPerHour', 'starveLossPerHour', 'dirtyLossPerHourAt100'], 0, 1000);
  }
  if (cfg.analytics != null && obj('analytics', cfg.analytics)) {
    const a = cfg.analytics;
    if (a.enabled != null && typeof a.enabled !== 'boolean') err('analytics.enabled', '必須是 true / false');
    if (a.gaMeasurementId != null && a.gaMeasurementId !== '' && !(typeof a.gaMeasurementId === 'string' && /^G-[A-Z0-9]{4,16}$/.test(a.gaMeasurementId))) err('analytics.gaMeasurementId', '格式應為 G-XXXXXXXXXX（或留空＝用網頁內建 ID）');
  }
  if (obj('water', cfg.water)) {
    const w = cfg.water;
    num('water.startDirt', w.startDirt, 0, 100); num('water.wasteMax', w.wasteMax, 1, 1000); num('water.recommendedDirtMax', w.recommendedDirtMax, 1, 100);
    nums('water', w, ['wastePerBioloadHour', 'dirtPerBioloadHour', 'dirtPerWastePerHour', 'algaeBasePerHour', 'algaeDirtFactor'], 0, 100);
    if (w.volumeRefCapacity != null) num('water.volumeRefCapacity', w.volumeRefCapacity, 1, 100000);
    if (w.volumeExponent != null) num('water.volumeExponent', w.volumeExponent, 0, 2);
    if (w.costs != null && obj('water.costs', w.costs)) { const C = w.costs; bool('water.costs.enabled', C.enabled, true); optNum('water.costs.round', C.round, 1, 100); optNum('water.costs.min', C.min, 0, 10000);   // v4.2 換水／清潔費用
      for (const k of ['small', 'big', 'clean']) if (C[k] != null && obj(`water.costs.${k}`, C[k])) { optNum(`water.costs.${k}.base`, C[k].base, 0, 100000); optNum(`water.costs.${k}.perSpace`, C[k].perSpace, 0, 1000); } }
    if (cfg.invite != null && obj('invite', cfg.invite)) optNum('invite.inviteeCoins', cfg.invite.inviteeCoins, 0, 1000000, true);   // v4.2 被邀請者也得獎勵
    if (arr('water.stageBioload', w.stageBioload, 3, 3)) w.stageBioload.forEach((v, i) => num(`water.stageBioload[${i}]`, v, 0, 20));
    if (arr('water.grades', w.grades, 1, 10)) {
      let prev = -1;
      w.grades.forEach((g, i) => {
        const p = `water.grades[${i}]`; if (!obj(p, g)) return;
        str(`${p}.name`, g.name, 10); str(`${p}.icon`, g.icon, 8); color(`${p}.color`, g.color);
        num(`${p}.below`, g.below, 0, 101); num(`${p}.coinMultiplier`, g.coinMultiplier, 0, 10);
        if (typeof g.below === 'number') { if (g.below <= prev) err(`${p}.below`, '門檻需遞增'); prev = g.below; }
      });
      if (prev < 100) err('water.grades', '最後一級的 below 需 ≥ 100（涵蓋所有污染度）');
    }
    if (arr('water.changes', w.changes, 1, 10)) {
      const ids = new Set();
      w.changes.forEach((c, i) => {
        const p = `water.changes[${i}]`; if (!obj(p, c)) return;
        if (typeof c.id !== 'string' || !/^[a-z][a-z0-9_]{0,15}$/.test(c.id)) err(`${p}.id`, '代號需小寫英數'); else if (ids.has(c.id)) err(`${p}.id`, '代號重複'); else ids.add(c.id);
        str(`${p}.name`, c.name, 20);
        nums(p, c, ['pct', 'siphon', 'algaeClean'], 0, 1);
        num(`${p}.cooldownHours`, c.cooldownHours, 0, 720); num(`${p}.stress`, c.stress, 0, 100);
      });
    }
  }
  if (obj('cycling', cfg.cycling)) {
    const c = cfg.cycling;
    num('cycling.hours', c.hours, .01, 24 * 60); num('cycling.startProgress', c.startProgress, 0, 100);
    num('cycling.uncycledDirtMultiplier', c.uncycledDirtMultiplier, 0, 20); num('cycling.riskPerHour', c.riskPerHour, 0, 100); num('cycling.expandPenalty', c.expandPenalty, 0, 100);
    if (obj('cycling.bacteria', c.bacteria)) {
      const b = c.bacteria; str('cycling.bacteria.name', b.name, 20); str('cycling.bacteria.icon', b.icon, 8);
      num('cycling.bacteria.cost', b.cost, 0, 1e9, true); num('cycling.bacteria.boost', b.boost, 0, 100); num('cycling.bacteria.startCount', b.startCount, 0, 100, true);
    }
  }
  if (obj('filter', cfg.filter) && arr('filter.tiers', cfg.filter.tiers, 1, 20)) cfg.filter.tiers.forEach((t, i) => {
    const p = `filter.tiers[${i}]`; if (!obj(p, t)) return;
    str(`${p}.name`, t.name, 20); num(`${p}.mult`, t.mult, 0, 5); num(`${p}.cost`, t.cost, 0, 1e12, true);
  });
  if (obj('reminders', cfg.reminders)) { nums('reminders', cfg.reminders, ['dirtWarn', 'algaeWarn', 'wasteWarn', 'leftoverWarn'], 0, 1000); num('reminders.toastEverySec', cfg.reminders.toastEverySec, 5, 86400); }
  if (obj('coins', cfg.coins)) {
    const c = cfg.coins;
    if (arr('coins.intervalSecByStage', c.intervalSecByStage, 3, 3)) {
      if (c.intervalSecByStage[0] != null) err('coins.intervalSecByStage[0]', '幼魚不掉金幣，請設為 null');
      range2('coins.intervalSecByStage[1]', c.intervalSecByStage[1], 1, 86400);
      range2('coins.intervalSecByStage[2]', c.intervalSecByStage[2], 1, 86400);
    }
    num('coins.hungryMultiplier', c.hungryMultiplier, 0, 10); num('coins.maxOnFloor', c.maxOnFloor, 1, 500, true);
    num('coins.autoCollectSec', c.autoCollectSec, 1, 3600); num('coins.gemThreshold', c.gemThreshold, 1, 1e6);
  }
  if (optObj('input', cfg.input) && cfg.input) optNum('input.longPressMs', cfg.input.longPressMs, 100, 3000);
  if (optObj('audio', cfg.audio) && cfg.audio) nums('audio', Object.assign({ volume: 0, ambientVolume: 0, bubbleVolume: 0 }, cfg.audio), ['volume', 'ambientVolume', 'bubbleVolume'], 0, 1);
  if (obj('display', cfg.display)) {
    num('display.fishScale', cfg.display.fishScale, .2, 10); num('display.juvenileScale', cfg.display.juvenileScale, .05, 1);
    if (cfg.display.refArea != null && arr('display.refArea', cfg.display.refArea, 2, 2)) cfg.display.refArea.forEach((v, i) => num(`display.refArea[${i}]`, v, 100, 10000));
    if (cfg.display.viewScaleRange != null) range2('display.viewScaleRange', cfg.display.viewScaleRange, .1, 5);
  }
  if (obj('capacity', cfg.capacity)) {
    if (cfg.capacity.unit != null && !['count', 'tankSpace'].includes(cfg.capacity.unit)) err('capacity.unit', '必須是 count / tankSpace');
    num('capacity.base', cfg.capacity.base, 1, 200, true);
    if (arr('capacity.upgrades', cfg.capacity.upgrades, 0, 50)) cfg.capacity.upgrades.forEach((u, i) => { if (obj(`capacity.upgrades[${i}]`, u)) { num(`capacity.upgrades[${i}].cost`, u.cost, 0, 1e12, true); num(`capacity.upgrades[${i}].add`, u.add, 1, 1000, true); if (u.name != null) str(`capacity.upgrades[${i}].name`, u.name, 20); } });
  }
  if (obj('food', cfg.food)) {
    num('food.maxPellets', cfg.food.maxPellets, 1, 500, true); num('food.rotSec', cfg.food.rotSec, 1, 3600);
    num('food.rotWaste', cfg.food.rotWaste, 0, 100); num('food.rotDirt', cfg.food.rotDirt, 0, 100);
    if (arr('food.tiers', cfg.food.tiers, 1, 20)) cfg.food.tiers.forEach((t, i) => {
      const p = `food.tiers[${i}]`; if (!obj(p, t)) return;
      str(`${p}.name`, t.name, 20); num(`${p}.nutrition`, t.nutrition, 0, 100); num(`${p}.growth`, t.growth, 0, 1e4);
      color(`${p}.color`, t.color); num(`${p}.count`, t.count, 1, 10, true); num(`${p}.cost`, t.cost, 0, 1e12, true);
    });
  }
  if (obj('feeder', cfg.feeder)) {
    num('feeder.feedBelowFullness', cfg.feeder.feedBelowFullness, 0, 100); num('feeder.pelletsPerHungryFish', cfg.feeder.pelletsPerHungryFish, 0, 20);
    if (arr('feeder.tiers', cfg.feeder.tiers, 1, 20)) cfg.feeder.tiers.forEach((t, i) => {
      const p = `feeder.tiers[${i}]`; if (!obj(p, t)) return;
      str(`${p}.name`, t.name, 20); num(`${p}.intervalHours`, t.intervalHours, i === 0 ? 0 : .05, 720); num(`${p}.cost`, t.cost, 0, 1e12, true);
    });
  }
  if (obj('decorations', cfg.decorations)) for (const [k, d] of Object.entries(cfg.decorations)) {
    const p = `decorations.${k}`;
    if (!KEY_RE.test(k)) err(p, '代號格式錯誤');
    if (!obj(p, d)) continue;
    optNum(`${p}.priceGems`, d.priceGems, 1, 100000, true);
    if(d.priceGems > 0 && d.cost > 0) err(p, '寶石造景不能同時設定金幣價格');

    str(`${p}.name`, d.name, 20); str(`${p}.icon`, d.icon, 8); num(`${p}.cost`, d.cost, 0, 1e12, true);
    num(`${p}.coinBonus`, d.coinBonus, 0, 10); num(`${p}.mutationBonus`, d.mutationBonus, 0, 1); str(`${p}.desc`, d.desc, 60, true);
    if (d.draw != null) str(`${p}.draw`, d.draw, 20); optNum(`${p}.x`, d.x, 0, 1);
  }
  if (obj('breeding', cfg.breeding)) {
    const b = cfg.breeding;
    num('breeding.cooldownSec', b.cooldownSec, 0, 86400); num('breeding.hueJitter', b.hueJitter, 0, 180); num('breeding.sizeJitter', b.sizeJitter, 0, 1);
    range2('breeding.sizeRange', b.sizeRange, .1, 5);
    if (obj('breeding.mutation', b.mutation)) {
      const m = b.mutation;
      num('breeding.mutation.baseChance', m.baseChance, 0, 1); num('breeding.mutation.perParentRarity', m.perParentRarity, 0, 1);
      if (arr('breeding.mutation.pools', m.pools, 1, 20)) m.pools.forEach((pool, i) => {
        const p = `breeding.mutation.pools[${i}]`; if (!obj(p, pool)) return;
        num(`${p}.chance`, pool.chance, 0, 1); optNum(`${p}.chancePerParentRarity`, pool.chancePerParentRarity, 0, 1);
        if (arr(`${p}.species`, pool.species, 1, 100)) pool.species.forEach((k, j) => { if (!spKeys.has(k)) err(`${p}.species[${j}]`, `找不到魚種代號「${k}」`); });
      });
    }
  }
  // 行為機制與成長進化（species/mechanics.js；皆為選填，缺少時用預設值）
  if (cfg.mechanics != null && obj('mechanics', cfg.mechanics)) {
    const M = cfg.mechanics; bool('mechanics.enabled', M.enabled, true);
    if (M.evolution != null && obj('mechanics.evolution', M.evolution)) {
      const E = M.evolution; bool('mechanics.evolution.enabled', E.enabled, true); bool('mechanics.evolution.offlineAnimate', E.offlineAnimate, true);
      optNum('mechanics.evolution.goodCareMult', E.goodCareMult, 0, 10); optNum('mechanics.evolution.poorCareMult', E.poorCareMult, 0, 10);
      for (const k of ['wellFedAbove', 'hungryBelow', 'cleanDirtBelow', 'dirtyAbove', 'stressAbove']) optNum(`mechanics.evolution.${k}`, E[k], 0, 100);
      optNum('mechanics.evolution.animSec', E.animSec, 0, 20);
    }
  }
  if (cfg.premium != null && obj('premium', cfg.premium)) { bool('premium.breedable', cfg.premium.breedable, true); if (cfg.premium.label != null) str('premium.label', cfg.premium.label, 10);
    optNum('premium.breedCooldownSec', cfg.premium.breedCooldownSec, 0, 30 * 86400, true); optNum('premium.hybridSellCap', cfg.premium.hybridSellCap, 0, 1e7); }
  if (cfg.breeding && cfg.breeding.hybrid != null && obj('breeding.hybrid', cfg.breeding.hybrid)) { const H = cfg.breeding.hybrid;
    bool('breeding.hybrid.enabled', H.enabled, true); optNum('breeding.hybrid.parentChance', H.parentChance, 0, 1); optNum('breeding.hybrid.coinFactor', H.coinFactor, 0, 3); optNum('breeding.hybrid.sellFactor', H.sellFactor, 0, 5); }
  // 造景：水草、燈具、設備
  if (cfg.aquascape != null && obj('aquascape', cfg.aquascape)) { const A = cfg.aquascape;
    bool('aquascape.enabled', A.enabled, true); optNum('aquascape.removeRefundRate', A.removeRefundRate, 0, 0.9);   // v4.2 移除水草退款比例
    if (obj('aquascape.rules', A.rules)) { const R = A.rules;
      optNum('aquascape.rules.maxPlants', R.maxPlants, 0, 120, true); optNum('aquascape.rules.beautyBonusMax', R.beautyBonusMax, 0, .5);
      optNum('aquascape.rules.trimAt', R.trimAt, 50, 200); optNum('aquascape.rules.trimTo', R.trimTo, 10, 150);
      if (R.trimAt != null && R.trimTo != null && R.trimTo >= R.trimAt) err('aquascape.rules.trimTo', '需小於 trimAt');
      optNum('aquascape.rules.roomTemp', R.roomTemp, 0, 40);
      for (const [k, v] of Object.entries(R)) if (typeof v === 'number' && (!Number.isFinite(v) || v < 0 || v > 1000)) err(`aquascape.rules.${k}`, '必須是 0–1000 的數字');
      if (R.oceanZoom != null && arr('aquascape.rules.oceanZoom', R.oceanZoom, 1, 6)) R.oceanZoom.forEach((z, i) => num(`aquascape.rules.oceanZoom[${i}]`, z, .2, 1)); }
    if (obj('aquascape.plants', A.plants)) { const ent = Object.entries(A.plants); if (ent.length > 200) err('aquascape.plants', '最多 200 種水草');
      for (const [k, P] of ent) { const p = `aquascape.plants.${k}`; if (!KEY_RE.test(k)) err(p, '代號格式不正確'); if (!obj(p, P)) continue;
        str(`${p}.name`, P.name, 30); if (P.desc != null) str(`${p}.desc`, P.desc, 300, true);
        num(`${p}.price`, P.price, 0, 1e9); optNum(`${p}.priceGems`, P.priceGems, 1, 100000, true);
        if (!PLANT_TYPES.includes(P.type)) err(`${p}.type`, `必須是 ${PLANT_TYPES.join(' / ')}`);
        if (!PLANT_ZONES.includes(P.zone)) err(`${p}.zone`, `必須是 ${PLANT_ZONES.join(' / ')}`);
        num(`${p}.light`, P.light, 0, 3, true); num(`${p}.grow`, P.grow, 0, 50); optNum(`${p}.difficulty`, P.difficulty, 1, 3, true); optNum(`${p}.rarity`, P.rarity, 0, 5, true);
        num(`${p}.hue`, P.hue, 0, 360); optNum(`${p}.sat`, P.sat, 0, 100); optNum(`${p}.lit`, P.lit, 0, 100);
        num(`${p}.h`, P.h, .02, 1); num(`${p}.w`, P.w, 2, 200); optNum(`${p}.absorb`, P.absorb, 0, 5);
        optNum(`${p}.cuttings`, P.cuttings, 0, 10, true); optNum(`${p}.cutSell`, P.cutSell, 0, 1e6);
        if (P.cutSell > 0 && !(P.priceGems > 0) && P.price > 0 && P.cutSell > P.price) err(`${p}.cutSell`, '插枝回收價不可高於水草價格');
        if (P.water != null && !WATER_TYPES.includes(P.water)) err(`${p}.water`, `必須是 ${WATER_TYPES.join(' / ')}`);
        bool(`${p}.co2`, P.co2, true); bool(`${p}.disabled`, P.disabled, true); } }
    if (obj('aquascape.gear', A.gear)) { const G = A.gear;
      for (const [k, g] of Object.entries(G)) { const p = `aquascape.gear.${k}`; if (!KEY_RE.test(k)) err(p, '代號格式不正確'); if (!obj(p, g)) continue;
        str(`${p}.name`, g.name, 30); if (g.desc != null) str(`${p}.desc`, g.desc, 300, true);
        if (!GEAR_CATS.includes(g.cat)) err(`${p}.cat`, `必須是 ${GEAR_CATS.join(' / ')}`);
        num(`${p}.price`, g.price, 0, 1e10); optNum(`${p}.priceGems`, g.priceGems, 1, 100000, true);
        optNum(`${p}.addSpace`, g.addSpace, 0, 2000); if (g.addSpace > 0 && g.cat !== 'ocean') err(`${p}.addSpace`, '只有海洋館可以增加空間');
        if (g.requires != null && !G[g.requires]) err(`${p}.requires`, `找不到設備「${g.requires}」`);
        optNum(`${p}.requiresCap`, g.requiresCap, 0, 50, true); optNum(`${p}.level`, g.level, 0, 5, true); optNum(`${p}.o2`, g.o2, 0, 5); optNum(`${p}.temp`, g.temp, 0, 40);
        bool(`${p}.starter`, g.starter, true); bool(`${p}.disabled`, g.disabled, true); if (g.starter && (g.price > 0 || g.priceGems > 0)) err(`${p}.starter`, '免費附贈的設備價格需為 0'); } } }
  if (obj('offline', cfg.offline)) {
    const o = cfg.offline;
    num('offline.minAwaySec', o.minAwaySec, 0, 86400, true); num('offline.capSec', o.capSec, 0, 30 * 86400, true); num('offline.rate', o.rate, 0, 5);
    if (obj('offline.protection', o.protection)) { bool('offline.protection.allowDeath', o.protection.allowDeath); num('offline.protection.healthFloor', o.protection.healthFloor, 0, 100); }
  }
  if (obj('sell', cfg.sell)) { num('sell.fallbackRateOfPrice', cfg.sell.fallbackRateOfPrice, 0, 10); num('sell.stageBonus', cfg.sell.stageBonus, 0, 10); }
  // 💳 儲值方案（綠界）：可省略（省略時伺服器用內建預設方案）
  if (cfg.pay != null && obj('pay', cfg.pay)) { const Y = cfg.pay;
    bool('pay.enabled', Y.enabled, true); bool('pay.firstPurchaseDouble', Y.firstPurchaseDouble, true);
    optNum('pay.atmExpireDays', Y.atmExpireDays, 1, 60, true); optNum('pay.cvsExpireMinutes', Y.cvsExpireMinutes, 1, 43200, true);
    if (Y.support != null) str('pay.support', Y.support, 200);
    for (const k of Object.keys(Y)) if (!['enabled', 'firstPurchaseDouble', 'atmExpireDays', 'cvsExpireMinutes', 'support', 'products', 'providers', 'card', 'starter', 'firstTopupGift'].includes(k)) err(`pay.${k}`, '不支援的欄位');
    if (Y.providers != null && obj('pay.providers', Y.providers)) { for (const k of Object.keys(Y.providers)) { if (!['ecpay', 'newebpay'].includes(k)) { err(`pay.providers.${k}`, '只支援 ecpay / newebpay'); continue; } const v = Y.providers[k]; if (!obj(`pay.providers.${k}`, v)) continue; bool(`pay.providers.${k}.enabled`, v.enabled, true);
        if (k === 'newebpay' && v.methods != null && obj('pay.providers.newebpay.methods', v.methods)) for (const [m, on] of Object.entries(v.methods)) { if (!['CREDIT', 'VACC', 'CVS', 'WEBATM'].includes(m)) err(`pay.providers.newebpay.methods.${m}`, '只支援 CREDIT / VACC / CVS / WEBATM'); else bool(`pay.providers.newebpay.methods.${m}`, on, true); } } }
    if (Y.starter != null && obj('pay.starter', Y.starter)) {
      bool('pay.starter.enabled', Y.starter.enabled, true);
      if (Y.starter.fishRewards != null && arr('pay.starter.fishRewards',Y.starter.fishRewards,1,5)) {
        const ids=new Set();let total=0;
        Y.starter.fishRewards.forEach((f,i)=>{const q='pay.starter.fishRewards['+i+']';if(!obj(q,f))return;
          if(typeof f.species!=='string'||!cfg.species?.[f.species]||!(cfg.species[f.species].priceGems>0||cfg.species[f.species].starterExclusive)||cfg.species[f.species].disabled)err(q+'.species','必須是已上架的鑽石生物或新手專屬魚');
          if(ids.has(f.species))err(q+'.species','物種不可重複');ids.add(f.species);num(q+'.count',f.count,1,5,true);total+=Number(f.count)||0;
        });if(total>10)err('pay.starter.fishRewards','總數最多10隻');
      }
    } // SHOPV2-PACKS 只開放開關
    if (Y.firstTopupGift != null && obj('pay.firstTopupGift', Y.firstTopupGift)) bool('pay.firstTopupGift.enabled', Y.firstTopupGift.enabled, true);
    if (Y.card != null && obj('pay.card', Y.card)) { const C = Y.card; bool('pay.card.enabled', C.enabled, true); if (C.id != null && (typeof C.id !== 'string' || !/^[a-z0-9_]{2,32}$/.test(C.id))) err('pay.card.id', '代號需為 2–32 個小寫英數或底線');
      optNum('pay.card.priceTwd', C.priceTwd, 1, 50000, true); optNum('pay.card.gems', C.gems, 0, 1e6, true); optNum('pay.card.days', C.days, 1, 365, true); optNum('pay.card.dailyGems', C.dailyGems, 0, 1e5, true); optNum('pay.card.extraBreeds', C.extraBreeds, 0, 10, true); }
    if (Y.products != null && arr('pay.products', Y.products, 0, 30)) { const seen = new Set();
      Y.products.forEach((p, i) => { const q = `pay.products[${i}]`; if (!obj(q, p)) return;
        if (typeof p.id !== 'string' || !/^[a-z0-9_]{2,32}$/.test(p.id)) err(`${q}.id`, '代號需為 2–32 個小寫英數或底線'); else if (seen.has(p.id)) err(`${q}.id`, '代號重複'); else seen.add(p.id);
        if (!['gems', 'coins'].includes(p.kind)) err(`${q}.kind`, '必須是 gems 或 coins');
        num(`${q}.priceTwd`, p.priceTwd, 1, 50000, true);
        num(`${q}.qty`, p.qty, 1, p.kind === 'coins' ? 1e9 : 1e6, true);
        if (p.name != null) str(`${q}.name`, p.name, 40, true); if (p.badge != null) str(`${q}.badge`, p.badge, 12, true);
        bool(`${q}.enabled`, p.enabled, true); optNum(`${q}.sort`, p.sort, -1000, 1000, true);
        for (const k of Object.keys(p)) if (!['id', 'kind', 'priceTwd', 'qty', 'name', 'badge', 'enabled', 'sort'].includes(k)) err(`${q}.${k}`, '不支援的欄位'); }); } }
  // 🐣 每日繁殖次數
  require('./gemshop').validate(cfg, err); // 💎 本週限定／加速／外觀（v4.1）
  if (cfg.breedLimit != null && obj('breedLimit', cfg.breedLimit)) {
    const b = cfg.breedLimit;
    for (const k of ['enabled', 'cardPerk']) if (b[k] != null && typeof b[k] !== 'boolean') err(`breedLimit.${k}`, '必須是 true / false');
    for (const [k, mx] of [['freePerDay', 100], ['harborFreePerDay', 100], ['maxExtraPerDay', 100]]) if (b[k] != null) num(`breedLimit.${k}`, b[k], 0, mx, true);
    if (b.harborFreePerDay != null && b.freePerDay != null && b.harborFreePerDay > b.freePerDay) err('breedLimit.harborFreePerDay', '漁港免費次數不能超過每天免費次數');
    if (b.extraGems != null && (!Array.isArray(b.extraGems) || !b.extraGems.length || b.extraGems.length > 100 || b.extraGems.some((x) => !Number.isInteger(x) || x < 1 || x > 100000))) err('breedLimit.extraGems', '必須是正整數陣列，例如 [10,20,30,40,50]');
  }
  // ⚓ 漁港
  if (cfg.social != null && obj('social', cfg.social)) {
    const so = cfg.social;
    if (so.enabled != null && typeof so.enabled !== 'boolean') err('social.enabled', '必須是 true / false');
    const sec = (k, spec) => { const o = so[k]; if (o == null) return; if (!obj(`social.${k}`, o)) return; for (const [f, [mn, mx, int]] of Object.entries(spec)) if (o[f] != null) num(`social.${k}.${f}`, o[f], mn, mx, int); };
    sec('visit', { maxFish: [5, 200, true], recentDays: [1, 90, true], recommend: [1, 50, true] });
    sec('friends', { max: [1, 1000, true], requestsPerHour: [1, 1000, true] });
    sec('help', { hungryBelow: [1, 100], feedAmount: [1, 100], rewardStranger: [0, 1e6, true], rewardFriend: [0, 1e6, true], rewardPerLevel: [0, 1e5, true], rewardMax: [0, 1e6, true], dailyRewarded: [0, 1000, true], ownerBonus: [0, 1e6, true], minOwnerAgeHours: [0, 10000] });
    sec('breed', { minStage: [0, 2, true], coinBase: [0, 1e7, true], coinPerRarity: [0, 1e7, true], gemFactor: [0, 10], gemMin: [0, 100000, true], gemMax: [0, 100000, true], studFee: [0, 1e6, true] });
    const b = so.breed;
    if (b && b.enabled != null && typeof b.enabled !== 'boolean') err('social.breed.enabled', '必須是 true / false');
    if (b && b.gemMin != null && b.gemMax != null && b.gemMax < b.gemMin) err('social.breed.gemMax', '上限需 ≥ 下限');
  }
  // 💊 藥品
  if (cfg.medicine != null && obj('medicine', cfg.medicine)) {
    const m = cfg.medicine;
    if (m.enabled != null && typeof m.enabled !== 'boolean') err('medicine.enabled', '必須是 true / false');
    if (m.membersOnly != null && typeof m.membersOnly !== 'boolean') err('medicine.membersOnly', '必須是 true / false');
    if (m.maxStock != null) num('medicine.maxStock', m.maxStock, 1, 999, true);
    if (m.hint != null && (typeof m.hint !== 'string' || m.hint.length > 200)) err('medicine.hint', '最多 200 字');
    if (obj('medicine.items', m.items)) for (const [k, it] of Object.entries(m.items)) {
      const p = `medicine.items.${k}`;
      if (!/^med_[a-z0-9_]{1,20}$/.test(k)) err(p, '代號需為 med_ 開頭的小寫英數字');
      if (!obj(p, it)) continue;
      if (typeof it.name !== 'string' || !it.name.trim() || it.name.length > 20) err(`${p}.name`, '名稱 1–20 字');
      if (!['fish', 'tank'].includes(it.scope)) err(`${p}.scope`, '必須是 fish（單條）或 tank（整缸）');
      if (it.priceGems != null) num(`${p}.priceGems`, it.priceGems, 0, 100000, true);
      if (it.price != null) num(`${p}.price`, it.price, 0, 1e9, true);
      if ((it.priceGems > 0 || Array.isArray(it.priceByCap)) && it.price > 0) err(p, '寶石價（priceGems / priceByCap）與金幣價（price）只能擇一');
      if (it.priceByCap != null && (!Array.isArray(it.priceByCap) || !it.priceByCap.length || it.priceByCap.some((x, i) => !Array.isArray(x) || x.length !== 2 || !(x[0] > 0) || !Number.isInteger(x[1]) || x[1] < 1 || (i && x[0] <= it.priceByCap[i - 1][0])))) err(`${p}.priceByCap`, '格式 [[容量上限, 寶石], …]，容量由小到大、寶石為正整數');
      for (const [f, mx] of [['heal', 100], ['immuneHours', 168], ['healPerHour', 100], ['hours', 168], ['cooldownHours', 168], ['minHealth', 100]]) if (it[f] != null) num(`${p}.${f}`, it[f], 0, mx); /*V406M*/
      if (it.desc != null && (typeof it.desc !== 'string' || it.desc.length > 200)) err(`${p}.desc`, '說明最多 200 字');
      if (it.disabled != null && typeof it.disabled !== 'boolean') err(`${p}.disabled`, '必須是 true / false');
    }
  }
  const a = cfg.antiCheat;
  if (obj('antiCheat', a)) {
    if (!['reject', 'flag', 'off'].includes(a.mode)) err('antiCheat.mode', '必須是 reject / flag / off'); /*V406*/
    if (a.minClientBuild != null && !(typeof a.minClientBuild === 'string' && /^([0-9]+(\.[0-9]+){0,3})?$/.test(a.minClientBuild))) err('antiCheat.minClientBuild', '必須是版本號（例如 4.0.6），空白＝不檢查');
    if (a.rejectUnversioned != null && typeof a.rejectUnversioned !== 'boolean') err('antiCheat.rejectUnversioned', '必須是 true / false');
    num('antiCheat.baseAllowance', a.baseAllowance, 0, 1e9); num('antiCheat.rateSlack', a.rateSlack, 1, 100);
    num('antiCheat.minSaveIntervalSec', a.minSaveIntervalSec, 0, 600); num('antiCheat.maxClockSkewSec', a.maxClockSkewSec, 0, 86400);
    num('antiCheat.maxFishSlack', a.maxFishSlack, 0, 100, true); num('antiCheat.firstUploadMaxCoins', a.firstUploadMaxCoins, 0, 1e12);
  }
  return errs;
}

// 公開給遊戲端的設定：
// - 拿掉伺服器專用的 antiCheat
// - 停用（disabled）的魚種：保留定義（玩家已擁有的魚不會消失），但下架（price=0、breedOnly=true）並移出突變池
function publicConfig(cfg) {
  const out = JSON.parse(JSON.stringify(cfg));
  delete out.antiCheat;
  const disabled = new Set(Object.entries(out.species || {}).filter(([, s]) => s.disabled).map(([k]) => k));
  for (const k of disabled) { Object.assign(out.species[k], { price: 0, breedOnly: true }); delete out.species[k].priceGems; }
  if (disabled.size && out.breeding && out.breeding.mutation && Array.isArray(out.breeding.mutation.pools)) {
    out.breeding.mutation.pools = out.breeding.mutation.pools
      .map((p) => ({ ...p, species: p.species.filter((k) => !disabled.has(k)) }))
      .filter((p) => p.species.length);
  }
  return out;
}

module.exports = { validateConfig, publicConfig, PLANT_TYPES, PLANT_ZONES, GEAR_CATS, BODIES, TAILS, FINS, PATTERNS, ROLES, LOOK_ENUMS, TEMPERAMENTS, SIZE_CLASSES, WATER_TYPES };
