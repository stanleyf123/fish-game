// 遊戲設定 / 魚種 頁面
(function () {
  const { h } = A;

  function flatten(o, p = '', out = {}) {
    if (o && typeof o === 'object') {
      const ks = Object.keys(o);
      if (!ks.length) out[p] = Array.isArray(o) ? '[]' : '{}';
      for (const k of ks) flatten(o[k], p ? `${p}.${k}` : k, out);
    } else out[p] = o;
    return out;
  }
  function diff(a, b) {
    const fa = flatten(a), fb = flatten(b), rows = [];
    for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) if (JSON.stringify(fa[k]) !== JSON.stringify(fb[k])) rows.push({ k, a: fa[k], b: fb[k] });
    return rows.sort((x, y) => x.k.localeCompare(y.k));
  }
  const diffTable = (rows, la = '目前', lb = '新') => rows.length
    ? `<table class="diff"><tr><th>欄位</th><th>${h(la)}</th><th>${h(lb)}</th></tr>${rows.slice(0, 300).map((r) => `<tr><td>${h(r.k)}</td><td class="old">${h(r.a === undefined ? '（無）' : JSON.stringify(r.a))}</td><td class="new">${h(r.b === undefined ? '（刪除）' : JSON.stringify(r.b))}</td></tr>`).join('')}</table>${rows.length > 300 ? `<p class="muted">…另有 ${rows.length - 300} 項</p>` : ''}`
    : '<p class="muted">沒有差異</p>';
  window.ConfigDiff = { diff, diffTable };

  // ---------- 設定表單描述 ----------
  const F = (path, label, type = 'num', extra = {}) => ({ path, label, type, ...extra });
  const SECTIONS = [
    { id: 'basic', title: '基本 / 開局', fields: [F('version', '設定結構版本', 'int', { hint: '遊戲存檔會記錄此值' }), F('saveKey', '本機存檔鍵名', 'text', { hint: '改了會讓玩家本機存檔失效！' }), F('start.coins', '開局金幣', 'int')],
      tables: [{ path: 'start.fish', title: '開局魚隻', cols: [['species', '魚種', 'species'], ['growth', '初始成長值', 'num']], tpl: () => ({ species: 'goldfish', growth: 0 }) }],
      extra: 'names' },
    { id: 'stage', title: '稀有度 / 成長階段', fields: [],
      tables: [{ path: 'rarity', title: '稀有度', cols: [['name', '名稱', 'text'], ['color', '顏色', 'color']], tpl: () => ({ name: '新稀有度', color: '#ffffff' }) },
        { path: 'stages', title: '成長階段（固定 3 階：幼魚 / 成魚 / 大魚）', fixed: true, cols: [['name', '名稱', 'text'], ['growth', '成長門檻', 'num'], ['coinMultiplier', '金幣倍率', 'num']] }] },
    { id: 'care', title: '照護 / 飢餓 / 健康', note: '照護系統以真實時間計算（單位：小時）。care.timeScale > 1 會加速所有真實時間機制，只供測試。',
      fields: [F('care.timeScale', '照護時鐘倍率', 'num', { hint: '1 = 真實時間' }), F('care.simStepSec', '離線補算每步秒數'), F('care.maxCatchUpHours', '離線最多補算（小時）', 'num', { hint: '336 = 14 天' }),
      F('growth.passivePerHour', '自然成長 / 小時'), F('growth.passiveMinFullness', '自然成長所需飽食度'), F('growth.sickMultiplier', '生病時成長倍率'),
      F('hunger.decayPerHour', '飽食度下降 / 小時'), F('hunger.juvenileDecayMultiplier', '幼魚下降倍率'), F('hunger.seekBelow', '低於此值會找食物'), F('hunger.hungryBelow', '「餓了」門檻'),
      F('hunger.startFullness', '新魚初始飽食度'), F('hunger.offspringFullness', '幼魚出生飽食度'), F('hunger.forageFullPerHour', '清潔隊覓食 / 小時'), F('hunger.idealFeedingsPerDay', '建議每日餵食次數', 'text'),
      F('health.sickBelow', '健康低於此值＝生病'), F('health.recoverPerHour', '恢復 / 小時'), F('health.starveLossPerHour', '挨餓扣血 / 小時'), F('health.healthyDirtBelow', '污染度低於此值不傷身'),
      F('health.dirtyLossPerHourAt100', '污染 100 時扣血 / 小時'), F('health.newFishStressUncycled', '未養水時新魚緊張扣血')] },
    { id: 'water', title: '水質 / 換水', fields: [F('water.startDirt', '新魚缸污染度'), F('water.stageBioload.0', '幼魚負載倍率'), F('water.stageBioload.1', '成魚負載倍率'), F('water.stageBioload.2', '大魚負載倍率'),
      F('water.wastePerBioloadHour', '每負載排泄 / 小時'), F('water.wasteMax', '底砂髒污上限'), F('water.dirtPerBioloadHour', '每負載污染 / 小時'), F('water.dirtPerWastePerHour', '每單位髒污的污染 / 小時'),
      F('water.algaeBasePerHour', '藻類基本生長 / 小時'), F('water.algaeDirtFactor', '污染對藻類的加成'), F('water.recommendedDirtMax', '建議換水前污染上限'),
      F('water.volumeRefCapacity', '大缸稀釋：基準容量（格）', 'num', { hint: '容量 ≤ 此值的魚缸污染速度不變（預設 50）' }), F('water.volumeExponent', '大缸稀釋：指數', 'num', { hint: '污染 ÷ (容量/基準)^指數；0 = 關閉，0.5 = 平方根（預設）' })],
      tables: [{ path: 'water.grades', title: '水質等級（依污染度 below 遞增，最後一級需 ≥ 100）', cols: [['name', '名稱', 'text'], ['icon', '圖示', 'text'], ['below', '污染度低於', 'num'], ['coinMultiplier', '金幣倍率', 'num'], ['color', '顏色', 'color']], tpl: () => ({ name: '新等級', icon: '💧', below: 101, coinMultiplier: 1, color: '#7cc8ff' }) },
        { path: 'water.changes', title: '換水選項', cols: [['id', '代號', 'text'], ['name', '名稱', 'text'], ['pct', '換水比例', 'num'], ['siphon', '吸除髒污比例', 'num'], ['algaeClean', '清藻比例', 'num'], ['cooldownHours', '冷卻（小時）', 'num'], ['stress', '對魚的壓力', 'num']], tpl: () => ({ id: 'mid', name: '換水 40%', pct: .4, siphon: .6, algaeClean: .15, cooldownHours: 8, stress: 3 }) }] },
    { id: 'analytics', title: '數據分析（Google Analytics 4）', note: '評估 ID 留空＝使用網頁內建的 ID；只在正式網域 feedfishs.com 載入。改完約 1 分鐘內（玩家重新整理網頁後）生效。',
      fields: [F('analytics.enabled', '啟用 GA4', 'bool'), F('analytics.gaMeasurementId', '評估 ID（G-XXXXXXXXXX）', 'text', { hint: '空白＝網頁內建 G-P3VPSMHM4F' })] },
    { id: 'auth', title: '🔐 Google／LINE 登入', note: '留空＝隱藏該登入按鈕。Google 用戶端 ID 與 LINE Channel ID 都是公開值；LINE Channel secret 只放在伺服器環境變數 LINE_CHANNEL_SECRET（沒有 secret 時 LINE 按鈕不會出現）。', fields: [F('auth.googleClientId', 'Google 用戶端 ID（…apps.googleusercontent.com）', 'text'), F('auth.lineChannelId', 'LINE Login Channel ID', 'text')] },   // v4.2-auth
    { id: 'breedLimit', title: '🐣 每日繁殖次數（自家魚缸＋漁港共用）', note: '台北時間每天午夜重置。免費次數用完後，用寶石加購，價格依序遞增（第 1、2、3… 次加購）。漁港最多用掉幾次免費次數另外設定。月卡加成在月卡上線後才會開啟。',
      fields: [F('breedLimit.enabled', '啟用每日繁殖次數限制', 'bool'), F('breedLimit.freePerDay', '每天免費次數（合計）', 'int'), F('breedLimit.harborFreePerDay', '其中漁港可免費幾次', 'int'), F('breedLimit.maxExtraPerDay', '每天最多加購次數', 'int'),
      F('breedLimit.extraGems.0', '加購第 1 次 💎', 'int'), F('breedLimit.extraGems.1', '加購第 2 次 💎', 'int'), F('breedLimit.extraGems.2', '加購第 3 次 💎', 'int'), F('breedLimit.extraGems.3', '加購第 4 次 💎', 'int'), F('breedLimit.extraGems.4', '加購第 5 次 💎', 'int'),
      F('breedLimit.cardPerk', '👑 月卡加成：月卡期間自家魚缸每天多幾次免費（次數在「💳 儲值 → 儲值方案」設定）', 'bool')] },
    { id: 'weeklyShop', title: '🗓 本週限定商店（寶石）', note: '台北時間每週一 00:00 換檔，所有玩家看到同一批商品（依週別自動輪替限定魚與背景）。要指定某一週的商品，請到「原始 JSON」編輯 weeklyShop.override，例如 {"2026-10-26": ["p_galaxykoi", "bg_space"]}（鍵為該週週一日期）。',
      fields: [F('weeklyShop.enabled', '開放本週限定', 'bool'), F('weeklyShop.fishSlots', '每週限定魚數量', 'int'), F('weeklyShop.cosmeticSlots', '每週背景數量', 'int'), F('weeklyShop.discountPct', '折扣（%）', 'int', { hint: '20 = 打 8 折' }), F('weeklyShop.perPlayerLimit', '每人每項限購', 'int')] },
    { id: 'speedups', title: '⏩ 寶石加速', note: '「立即長大」依魚的體型定價；魚缸等級不足（長不大）的魚不能加速。「立即完成養水」只在養水未完成時可用。背景主題的名稱／價格／顏色請在「原始 JSON」的 cosmetics.backgrounds 編輯。',
      fields: [F('speedups.enabled', '開放加速', 'bool'), F('speedups.grow.mini', '立即長大：迷你 💎', 'int'), F('speedups.grow.small', '立即長大：小型 💎', 'int'), F('speedups.grow.medium', '立即長大：中型 💎', 'int'), F('speedups.grow.large', '立即長大：大型 💎', 'int'), F('speedups.grow.giant', '立即長大：巨型 💎', 'int'), F('speedups.cycle', '立即完成養水 💎', 'int'), F('cosmetics.enabled', '開放背景主題（外觀）', 'bool')] },
    { id: 'social', title: '⚓ 漁港（拜訪／好友／幫忙餵食／借魚繁殖）', note: '台北時間每天午夜重置次數。每天繁殖次數與加購價格請到「🐣 每日繁殖次數」設定；限定魚繁殖寶石 = 限定魚售價 × 係數（介於下限與上限）。',
      fields: [F('social.enabled', '開放漁港', 'bool'), F('social.visit.maxFish', '拜訪最多顯示幾條魚', 'int'), F('social.friends.max', '好友上限', 'int'), F('social.friends.requestsPerHour', '每小時好友邀請上限', 'int'),
      F('social.help.rewardStranger', '🍤 餵食獎勵：陌生人', 'int'), F('social.help.rewardFriend', '🍤 餵食獎勵：好友', 'int'), F('social.help.rewardPerLevel', '🍤 每等級加成', 'int'), F('social.help.rewardMax', '🍤 單次獎勵上限', 'int'),
      F('social.help.dailyRewarded', '🍤 每天有獎勵次數', 'int'), F('social.help.ownerBonus', '🍤 主人獲得金幣', 'int'), F('social.help.feedAmount', '🍤 飽足度增加'), F('social.help.hungryBelow', '🍤 低於多少算餓'), F('social.help.minOwnerAgeHours', '🍤 對方帳號滿幾小時才有獎勵'),
      F('social.breed.enabled', '💕 開放借魚繁殖', 'bool'),
      F('social.breed.coinBase', '💕 一般魚 金幣基本費', 'int'), F('social.breed.coinPerRarity', '💕 一般魚 每級稀有度加價', 'int'), F('social.breed.gemFactor', '💕 限定魚 寶石係數（× 售價）'), F('social.breed.gemMin', '💕 限定魚 寶石下限', 'int'), F('social.breed.gemMax', '💕 限定魚 寶石上限', 'int'),
      F('social.breed.studFee', '💕 主人借魚費（金幣）', 'int'), F('social.breed.minStage', '💕 最低成長階段（2＝成年）', 'int')] },
    { id: 'medicine', title: '💊 藥品（特效藥）', note: '寶石藥由伺服器扣寶石（會員限定）；全缸特效藥價格依魚缸容量分級（原始 JSON 的 priceByCap）。免疫期間魚不會因水質／養水掉血，但藥效過後水還髒就會再生病。',
      fields: [F('medicine.enabled', '開放藥品', 'bool'), F('medicine.membersOnly', '寶石藥只限會員', 'bool'), F('medicine.maxStock', '每種最多存放', 'int'), F('medicine.hint', '提示文字', 'text'),
      F('medicine.items.med_fish.priceGems', '💊 特效藥 寶石價', 'int'), F('medicine.items.med_fish.immuneHours', '💊 免疫小時'), F('medicine.items.med_fish.disabled', '💊 下架', 'bool'),
      F('medicine.items.med_tank.priceByCap.0.1', '🧪 全缸 ≤50 格 寶石價', 'int'), F('medicine.items.med_tank.priceByCap.1.1', '🧪 全缸 ≤120 格 寶石價', 'int'), F('medicine.items.med_tank.priceByCap.2.1', '🧪 全缸 更大 寶石價', 'int'), F('medicine.items.med_tank.immuneHours', '🧪 免疫小時'), F('medicine.items.med_tank.disabled', '🧪 下架', 'bool'),
      F('medicine.items.med_guard.priceGems', '🛡️ 防病藥劑 寶石價', 'int'), F('medicine.items.med_guard.immuneHours', '🛡️ 防護小時'), F('medicine.items.med_guard.disabled', '🛡️ 下架', 'bool'),
      F('medicine.items.med_herb.price', '🌿 草本魚藥 金幣價', 'int'), F('medicine.items.med_herb.healPerHour', '🌿 每小時恢復'), F('medicine.items.med_herb.hours', '🌿 藥效小時'), F('medicine.items.med_herb.cooldownHours', '🌿 冷卻小時（整缸，0＝不限）'), F('medicine.items.med_herb.minHealth', '🌿 健康低於此值無效（只能用特效藥）', 'int'), F('medicine.items.med_herb.desc', '🌿 說明文字', 'text'), /*V406M*/ F('medicine.items.med_herb.disabled', '🌿 下架', 'bool')] },
    { id: 'cycling', title: '養水 / 過濾器 / 提醒', fields: [F('cycling.hours', '養水所需小時'), F('cycling.startProgress', '新魚缸養水進度 %'), F('cycling.uncycledDirtMultiplier', '未養水時污染倍率'), F('cycling.riskPerHour', '未養水生病風險 / 小時'),
      F('cycling.expandPenalty', '擴建後養水進度扣除 %'), F('cycling.bacteria.name', '硝化菌名稱', 'text'), F('cycling.bacteria.icon', '硝化菌圖示', 'text'), F('cycling.bacteria.cost', '硝化菌價格', 'int'), F('cycling.bacteria.boost', '每罐養水進度 +%'), F('cycling.bacteria.startCount', '開局贈送罐數', 'int'),
      F('reminders.dirtWarn', '污染提醒門檻'), F('reminders.algaeWarn', '藻類提醒門檻'), F('reminders.wasteWarn', '髒污提醒門檻'), F('reminders.leftoverWarn', '殘餌提醒顆數'), F('reminders.toastEverySec', '同一提醒間隔秒數')],
      tables: [{ path: 'filter.tiers', title: '過濾器等級（第 1 級＝無過濾器；mult＝髒污產生倍率）', cols: [['name', '名稱', 'text'], ['mult', '髒污倍率', 'num'], ['cost', '價格', 'int']], tpl: () => ({ name: '新過濾器', mult: .3, cost: 3000 }) }] },
    { id: 'coins', title: '金幣 / 出售', fields: [F('coins.intervalSecByStage.1.0', '成魚掉幣間隔（最短秒）'), F('coins.intervalSecByStage.1.1', '成魚掉幣間隔（最長秒）'), F('coins.intervalSecByStage.2.0', '大魚掉幣間隔（最短秒）'), F('coins.intervalSecByStage.2.1', '大魚掉幣間隔（最長秒）'),
      F('coins.hungryMultiplier', '餓肚子時產量倍率'), F('coins.maxOnFloor', '地上最多金幣數', 'int'), F('coins.autoCollectSec', '幾秒後自動收進存錢筒'), F('coins.gemThreshold', '面額 ≥ 此值顯示為大金幣'), F('sell.fallbackRateOfPrice', '出售價 = 售價 × 此比例', 'num', { hint: '未設 sellPrice 的魚' }), F('sell.stageBonus', '每階段出售加成'),
      F('display.fishScale', '魚隻顯示倍率'), F('display.juvenileScale', '幼魚相對大小')] },
    { id: 'upgrades', title: '升級', fields: [F('capacity.base', '魚缸基本容量', 'int'), F('food.maxPellets', '水中飼料上限', 'int'), F('food.rotSec', '殘餌幾秒後腐爛'), F('food.rotWaste', '腐爛產生髒污'), F('food.rotDirt', '腐爛產生污染'),
      F('feeder.feedBelowFullness', '餵食器：飽食度低於才餵'), F('feeder.pelletsPerHungryFish', '餵食器：每條餓魚幾顆')],
      tables: [{ path: 'capacity.upgrades', title: '魚缸擴建（每一級）', cols: [['cost', '價格', 'int'], ['add', '增加容量', 'int']], tpl: () => ({ cost: 1000, add: 3 }) },
        { path: 'food.tiers', title: '飼料等級（第 1 級免費）', cols: [['name', '名稱', 'text'], ['nutrition', '營養', 'num'], ['growth', '成長', 'num'], ['color', '顏色', 'color'], ['count', '每次顆數', 'int'], ['cost', '升級價格', 'int']], tpl: () => ({ name: '新飼料', nutrition: 50, growth: 20, color: '#ffffff', count: 2, cost: 2000 }) },
        { path: 'feeder.tiers', title: '自動餵食器等級（第 1 級＝未安裝；以小時計，離線也有效）', cols: [['name', '名稱', 'text'], ['intervalHours', '間隔（小時）', 'num'], ['cost', '升級價格', 'int']], tpl: () => ({ name: '每 4 小時', intervalHours: 4, cost: 2500 }) }] },
    { id: 'deco', title: '裝飾', fields: [], extra: 'decorations' },
    { id: 'breed', title: '繁殖 / 突變', fields: [F('breeding.cooldownSec', '繁殖冷卻秒數'), F('breeding.hueJitter', '子代色相偏移'), F('breeding.sizeJitter', '子代大小偏移'), F('breeding.sizeRange.0', '子代大小下限'), F('breeding.sizeRange.1', '子代大小上限'),
      F('breeding.mutation.baseChance', '突變基礎機率', 'num', { hint: '0.1 = 10%' }), F('breeding.mutation.perParentRarity', '父母每級稀有度加成'),
      F('breeding.hybrid.enabled', '開放跨種混種', 'bool'), F('breeding.hybrid.parentChance', '跨種時生出父母其中一種的機率', 'num', { hint: '0.5 = 一半機率是父母品種、一半是混種' }),
      F('breeding.hybrid.coinFactor', '混種金幣倍率（不超過較高的父母）', 'num'), F('breeding.hybrid.sellFactor', '混種回收價倍率（父母平均 ×）', 'num'),
      F('premium.breedable', '限定魚可繁殖', 'bool'), F('premium.breedCooldownSec', '限定魚父母冷卻秒數', 'int', { hint: '14400 = 4 小時；同種限定魚寶寶之間也至少間隔這麼久（伺服器驗證）' }),
      F('premium.hybridSellCap', '限定魚血統混種回收價上限', 'int')],
      tables: [{ path: 'breeding.mutation.pools', title: '突變池（依序擲骰，最後一池保底）', cols: [['species', '魚種代號（逗號分隔）', 'csv'], ['chance', '機率', 'num'], ['chancePerParentRarity', '每級稀有度加成', 'num']], tpl: () => ({ species: ['betta'], chance: .5, chancePerParentRarity: 0 }) }] },
    { id: 'aqua', title: '水草 / 燈具 / 設備', note: '水草、燈具、設備與海洋館的價格與效果。寶石價 > 0 的項目只能用寶石購買（伺服器扣款）。代號與繪製樣式由遊戲決定，這裡不能新增，只能調整或停用（停用＝下架，已擁有的不受影響）。',
      fields: [F('aquascape.rules.maxPlants', '每缸水草上限', 'int'), F('aquascape.rules.beautyBonusMax', '造景美觀最高金幣加成', 'num', { hint: '0.08 = +8%' }), F('aquascape.rules.trimAt', '超過此成長 % 需要修剪'), F('aquascape.rules.trimTo', '修剪後剩下 %'),
        F('aquascape.rules.absorbPerPlant', '每株吸收污染'), F('aquascape.rules.absorbMax', '吸收污染上限'), F('aquascape.rules.algaeCompetePerPlant', '每株抑制藻類'), F('aquascape.rules.algaeCompeteMax', '抑制藻類上限'),
        F('aquascape.rules.co2Boost', 'CO2 成長倍率'), F('aquascape.rules.noCo2Mult', '需 CO2 的水草沒 CO2 時成長倍率'), F('aquascape.rules.meltDirtAbove', '污染度高於此值開始溶葉'), F('aquascape.rules.meltPerHour', '溶葉 / 小時'), F('aquascape.rules.recoverPerHour', '水草恢復 / 小時'),
        F('aquascape.rules.nibblePerHour', '草食動物啃食 / 小時'), F('aquascape.rules.coverMax', '掩蔽效果上限'), F('aquascape.rules.roomTemp', '室溫 °C'), F('aquascape.rules.tempOffCoin', '水溫不合時收益倍率'), F('aquascape.rules.tempOffGrowth', '水溫不合時成長倍率'),
        F('aquascape.rules.lowO2Coin', '溶氧不足時收益倍率'), F('aquascape.rules.lowO2Growth', '溶氧不足時成長倍率')], extra: 'aquascape' },
    { id: 'offline', title: '離線收益', fields: [F('offline.minAwaySec', '離開至少幾秒才計算', 'int'), F('offline.capSec', '最多計算秒數', 'int', { hint: '28800 = 8 小時' }), F('offline.rate', '離線效率', 'num', { hint: '0.5 = 線上的 50%' }), F('offline.protection.allowDeath', '離線期間魚會死亡', 'bool'), F('offline.protection.healthFloor', '離線保護：健康最低保留')] },
    { id: 'anti', title: '防作弊（伺服器）', note: '此區塊只在伺服器使用，不會出現在 GET /api/config。', fields: [F('antiCheat.mode', '模式', 'select', { options: [['reject', 'reject：拒絕可疑存檔'], ['flag', 'flag：接受但標記'], ['off', 'off：不檢查']] }),
      F('antiCheat.baseAllowance', '每次存檔額外容許金幣'), F('antiCheat.rateSlack', '產速容忍倍數'), F('antiCheat.minSaveIntervalSec', '最短存檔間隔（秒）'), F('antiCheat.maxClockSkewSec', '時鐘最大超前（秒）'), F('antiCheat.maxFishSlack', '魚數可超出容量', 'int'), F('antiCheat.firstUploadMaxCoins', '首次上傳金幣上限')] },
  ];

  function input(type, path, val, extra = {}, meta) {
    const dp = `data-path="${h(path)}" data-type="${type}"`;
    if (type === 'bool') return `<input type="checkbox" ${dp} ${val ? 'checked' : ''}>`;
    if (type === 'select') return `<select ${dp}>${extra.options.map(([v, l]) => `<option value="${h(v)}" ${v === val ? 'selected' : ''}>${h(l)}</option>`).join('')}</select>`;
    if (type === 'species') return `<select ${dp}>${meta.species.map((s) => `<option value="${h(s.key)}" ${s.key === val ? 'selected' : ''}>${h(s.name)}（${h(s.key)}）</option>`).join('')}</select>`;
    if (type === 'color') return `<input ${dp} value="${h(val)}" style="border-left:14px solid ${h(val)}">`;
    if (type === 'csv') return `<input ${dp} value="${h((val || []).join(', '))}">`;
    if (type === 'text') return `<input ${dp} value="${h(val)}">`;
    return `<input type="number" step="any" ${dp} value="${val == null ? '' : h(val)}">`;
  }
  function parseVal(el) {
    const t = el.dataset.type;
    if (t === 'bool') return el.checked;
    if (t === 'num' || t === 'int') { if (el.value === '') return null; const n = Number(el.value); return t === 'int' ? Math.round(n) : n; }
    if (t === 'csv') return el.value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    return el.value;
  }

  Views.config = async function (main) {
    const [active, versions] = await Promise.all([A.get('/config'), A.get('/config/versions')]);
    if((location.hash.slice(1).split('/')[0]||'dashboard')!=='config')return;
    let draft = JSON.parse(JSON.stringify(active.config));
    let tab = 'form', section = 'basic';
    A.setLeaveGuard(() => {
      let value = draft;
      if(tab === 'json') { const field = main.querySelector('#json'); if(field)try{value=JSON.parse(field.value)}catch{return true} }
      return diff(active.config, value).length > 0;
    });
    const meta = { species: Object.entries(active.config.species).map(([k, s]) => ({ key: k, name: s.name })) };

    function sectionHtml(sec) {
      let s = `<div class="card"><h2>${h(sec.title)}</h2>${sec.note ? `<p class="banner info">${h(sec.note)}</p>` : ''}<div class="fields">`;
      for (const f of sec.fields) s += `<label class="f">${h(f.label)}${input(f.type, f.path, A.getPath(draft, f.path), f, meta)}${f.hint ? `<span class="hint">${h(f.hint)}</span>` : ''}<span class="hint mono">${h(f.path)}</span></label>`;
      s += '</div></div>';
      for (const t of sec.tables || []) {
        const rows = A.getPath(draft, t.path) || [];
        s += `<div class="card"><div class="section-title"><h3>${h(t.title)}</h3>${t.fixed ? '' : `<button class="btn small" data-add="${h(t.path)}" data-tpl="${SECTIONS.indexOf(sec)}:${sec.tables.indexOf(t)}">＋ 新增一列</button>`}</div>
          <table class="tbl-edit"><tr><th>#</th>${t.cols.map((c) => `<th>${h(c[1])}</th>`).join('')}<th></th></tr>
          ${rows.map((r, i) => `<tr><td class="muted">${i + 1}</td>${t.cols.map((c) => `<td>${input(c[2], `${t.path}.${i}.${c[0]}`, r[c[0]], {}, meta)}</td>`).join('')}<td>${t.fixed ? '' : `<button class="btn small danger" data-del="${h(t.path)}" data-idx="${i}">刪除</button>`}</td></tr>`).join('')}</table></div>`;
      }
      if (sec.extra === 'aquascape' && draft.aquascape) {
        const PL = Object.entries(draft.aquascape.plants || {}), GE = Object.entries(draft.aquascape.gear || {});
        const row = (base, k, d, cols) => `<tr><td class="mono">${h(k)}</td>${cols.map(([f, t]) => `<td>${input(t, `${base}.${k}.${f}`, d[f])}</td>`).join('')}</tr>`;
        const pc = [['name', 'text'], ['price', 'int'], ['priceGems', 'int'], ['light', 'int'], ['grow', 'num'], ['absorb', 'num'], ['cuttings', 'int'], ['cutSell', 'int'], ['difficulty', 'int'], ['disabled', 'bool']];
        s += `<div class="card"><h3>🌿 水草（${PL.length} 種）</h3><table class="tbl-edit"><tr><th>代號</th><th>名稱</th><th>金幣價</th><th>寶石價</th><th>需光 0–3</th><th>成長 %/時</th><th>吸收污染</th><th>修剪插枝數</th><th>插枝回收價</th><th>難度 1–3</th><th>停用</th></tr>${PL.map(([k, d]) => row('aquascape.plants', k, d, pc)).join('')}</table></div>`;
        const gc = [['name', 'text'], ['price', 'int'], ['priceGems', 'int'], ['L', 'num'], ['o2', 'num'], ['temp', 'num'], ['addSpace', 'int'], ['desc', 'text'], ['disabled', 'bool']];
        s += `<div class="card"><h3>💡 燈具 / ⚙️ 設備 / 🐋 海洋館（${GE.length} 項）</h3><table class="tbl-edit"><tr><th>代號</th><th>名稱</th><th>金幣價</th><th>寶石價</th><th>光照</th><th>溶氧</th><th>水溫 °C</th><th>海洋館加格</th><th>說明</th><th>停用</th></tr>${GE.map(([k, d]) => row('aquascape.gear', k, d, gc)).join('')}</table>
          <p class="muted mini">光照只對燈具有效、溶氧只對打氣類設備、水溫只對加熱棒／冷水機、加格只對海洋館。留空＝不設定。</p></div>`;
      }
      if (sec.extra === 'names') s += `<div class="card"><h3>隨機魚名（以逗號或空白分隔）</h3><textarea data-path="names" data-type="csv" rows="3" style="width:100%">${h((draft.names || []).join(', '))}</textarea></div>`;
      if (sec.extra === 'decorations') {
        const ds = Object.entries(draft.decorations || {});
        s += `<div class="card"><div class="section-title"><h3>裝飾（金幣加成 0.1 = +10%）</h3><button class="btn small" data-adddeco>＋ 新增裝飾</button></div><table class="tbl-edit"><tr><th>代號</th><th>名稱</th><th>圖示</th><th>價格</th><th>金幣加成</th><th>突變加成</th><th>說明</th><th>繪製樣式</th><th>水平位置</th><th></th></tr>
          ${ds.map(([k, d]) => `<tr><td class="mono">${h(k)}</td>${[['name', 'text'], ['icon', 'text'], ['cost', 'int'], ['coinBonus', 'num'], ['mutationBonus', 'num'], ['desc', 'text'], ['draw', 'text'], ['x', 'num']].map(([f, t]) => `<td>${input(t, `decorations.${k}.${f}`, d[f])}</td>`).join('')}<td><button class="btn small danger" data-deldeco="${h(k)}">刪除</button></td></tr>`).join('')}</table>
          <p class="muted mini">繪製樣式：coral / wreck / chest / crystal 有專屬圖案，其他值會以圖示 emoji 顯示。</p></div>`;
      }
      return s;
    }

    function render() {
      main.innerHTML = `<h1>⚙️ 遊戲設定 GAME_CONFIG</h1><p class="sub">目前生效版本 <b>v${active.version}</b>（${A.fmtTime(active.createdAt)}）。遊戲透過 <span class="mono">GET /api/config</span> 讀取；每次儲存都會建立新版本，可隨時回復。</p>
      <div class="tabs"><button data-tab="form" class="${tab === 'form' ? 'on' : ''}">表單編輯</button><button data-tab="json" class="${tab === 'json' ? 'on' : ''}">原始 JSON</button><button data-tab="history" class="${tab === 'history' ? 'on' : ''}">版本紀錄（${versions.versions.length}）</button></div>
      <div id="cfgBody"></div>`;
      const body = main.querySelector('#cfgBody');
      if (tab === 'form') {
        const changed = diff(active.config, draft).length;
        body.innerHTML = `<div class="cfg-section-picker"><label class="f">設定分類<select data-config-section>${SECTIONS.map(s=>`<option value="${h(s.id)}" ${s.id===section?'selected':''}>${h(s.title)}</option>`).join('')}</select></label></div><div class="toolbar cfg-section-buttons">${SECTIONS.map((s) => `<button class="btn small ${s.id === section ? 'primary' : 'ghost'}" data-sec="${s.id}">${h(s.title)}</button>`).join('')}</div>
          <div class="toolbar"><span class="${changed ? 'ok' : 'muted'}" id="chg">${changed ? `已修改 ${changed} 個欄位（尚未儲存）` : '尚未修改'}</span><span style="flex:1"></span><button class="btn" data-validate>驗證</button><button class="btn ghost" data-revert>放棄修改</button><button class="btn primary" data-save>儲存為新版本…</button></div>
          <div id="errs"></div>${sectionHtml(SECTIONS.find((s) => s.id === section))}<p class="muted mini">魚種請到「🐟 魚種」頁面編輯（含即時預覽）。</p>`;
      } else if (tab === 'json') {
        body.innerHTML = `<div class="toolbar"><button class="btn" data-jcheck>格式檢查 + 驗證</button><button class="btn" data-jload>載入到表單</button><button class="btn primary" data-jsave>直接儲存為新版本…</button><span id="jmsg" class="muted"></span></div><div id="errs"></div>
          <textarea class="code" id="json" spellcheck="false">${h(JSON.stringify(draft, null, 2))}</textarea>`;
      } else {
        body.innerHTML = `<div class="card"><table><tr><th>版本</th><th>時間</th><th>備註</th><th>建立者</th><th class="num">大小</th><th></th></tr>
          ${versions.versions.map((v) => `<tr><td><b>v${v.version}</b> ${v.version === active.version ? '<span class="badge b-ok">生效中</span>' : ''}</td><td class="nowrap">${A.fmtTime(v.created_at)}</td><td>${h(v.note)}</td><td>${h(v.created_by)}</td><td class="num">${(v.size / 1024).toFixed(1)} KB</td>
          <td class="btns"><button class="btn small" data-view="${v.version}">檢視 / 差異</button>${v.version !== active.version ? `<button class="btn small danger" data-rollback="${v.version}">回復到此版</button>` : ''}</td></tr>`).join('')}</table></div>`;
      }
    }
    const updChg = () => { const c = diff(active.config, draft).length; const el = main.querySelector('#chg'); if (el) { el.textContent = c ? `已修改 ${c} 個欄位（尚未儲存）` : '尚未修改'; el.className = c ? 'ok' : 'muted'; } };

    async function saveFlow(cfg) {
      const v = await A.post('/config/validate', { config: cfg });
      const errs = main.querySelector('#errs');
      if (v.errors.length) { errs.innerHTML = A.errList(v.errors); A.toast('驗證未通過，請修正後再儲存', true); return; }
      errs.innerHTML = '';
      const rows = diff(active.config, cfg);
      if (!rows.length) { A.toast('沒有任何變更'); return; }
      const b = A.openModal(`<h2>儲存為 v${active.version + 1}</h2><p class="muted">以下 ${rows.length} 個欄位將變更：</p>${diffTable(rows)}<label class="f" style="margin-top:12px">版本備註（必填）<input id="note" placeholder="例如：調高錦鯉金幣產量"></label><div class="btns" style="margin-top:12px"><button class="btn primary" data-ok>確認儲存並發布</button><button class="btn ghost" data-close>取消</button></div>`);
      b.querySelector('[data-ok]').onclick = async () => {
        const note = b.querySelector('#note').value.trim();
        if (!note) { A.toast('請填寫備註', true); return; }
        try { const r = await A.put('/config', { config: cfg, note, baseVersion: active.version }); A.closeModal(); A.toast(`已發布 v${r.version}`); Views.config(main); }
        catch (e) { A.closeModal(); errs.innerHTML = A.errList(e.data && e.data.errors) || `<div class="errors">${h(e.message)}</div>`; A.errToast(e); }
      };
    }

    main.oninput = main.onchange = (e) => {
      const el = e.target;
      if(el.hasAttribute('data-config-section')){section=el.value;render();return}
      if (el.dataset && el.dataset.path && (tab === 'form')) { A.setPath(draft, el.dataset.path, parseVal(el)); if (el.dataset.type === 'color') el.style.borderLeftColor = el.value; updChg(); }
    };
    main.onclick = async (e) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.tab) { if (tab === 'json') { try { draft = JSON.parse(main.querySelector('#json').value); } catch (err) { A.toast('JSON 格式有誤，內容已保留；修正後再切換分頁',true); return; } } tab = t.dataset.tab; render(); }
      else if (t.dataset.sec) { section = t.dataset.sec; render(); }
      else if (t.dataset.add) { const [si, ti] = t.dataset.tpl.split(':').map(Number); const arr = A.getPath(draft, t.dataset.add); arr.push(SECTIONS[si].tables[ti].tpl()); render(); }
      else if (t.dataset.del) { A.getPath(draft, t.dataset.del).splice(Number(t.dataset.idx), 1); render(); }
      else if (t.hasAttribute('data-adddeco')) { const k = await A.promptDlg('新增裝飾', '裝飾代號（英文，例如 lantern）'); if (k && /^[a-z][a-zA-Z0-9_]{1,31}$/.test(k) && !draft.decorations[k]) { draft.decorations[k] = { name: '新裝飾', icon: '🏮', cost: 500, coinBonus: .05, mutationBonus: 0, desc: '金幣收益 +5%', draw: 'icon', x: .5 }; render(); } else if (k) A.toast('代號格式錯誤或已存在', true); }
      else if (t.dataset.deldeco) { delete draft.decorations[t.dataset.deldeco]; render(); }
      else if (t.hasAttribute('data-validate')) { const v = await A.post('/config/validate', { config: draft }); main.querySelector('#errs').innerHTML = v.errors.length ? A.errList(v.errors) : '<div class="banner info">✅ 驗證通過</div>'; }
      else if (t.hasAttribute('data-revert')) { if(diff(active.config,draft).length && !await A.confirmDlg('放棄設定修改','這會還原尚未發布的修改，要繼續嗎？','放棄修改'))return; draft = JSON.parse(JSON.stringify(active.config)); render(); }
      else if (t.hasAttribute('data-save')) saveFlow(draft);
      else if (t.hasAttribute('data-jcheck') || t.hasAttribute('data-jload') || t.hasAttribute('data-jsave')) {
        const ta = main.querySelector('#json'), errs = main.querySelector('#errs');
        let parsed;
        try { parsed = JSON.parse(ta.value); }
        catch (err) {
          const m = /position (\d+)/.exec(err.message); let where = '';
          if (m) { const pos = Number(m[1]); const before = ta.value.slice(0, pos); where = `（第 ${before.split('\n').length} 行，第 ${pos - before.lastIndexOf('\n')} 字）`; ta.focus(); ta.setSelectionRange(pos, pos + 1); }
          errs.innerHTML = `<div class="errors">JSON 語法錯誤${where}：${h(err.message)}</div>`; return;
        }
        if (t.hasAttribute('data-jcheck')) { const v = await A.post('/config/validate', { config: parsed }); errs.innerHTML = v.errors.length ? A.errList(v.errors) : '<div class="banner info">✅ JSON 格式正確且驗證通過</div>'; }
        else if (t.hasAttribute('data-jload')) { draft = parsed; tab = 'form'; render(); A.toast('已載入到表單（尚未儲存）'); }
        else saveFlow(parsed);
      }
      else if (t.dataset.view) {
        const v = await A.get('/config/versions/' + t.dataset.view);
        const rows = diff(active.config, v.config);
        A.openModal(`<h2>v${v.version} — ${h(v.note)}</h2><p class="muted">${A.fmtTime(v.created_at)} · 與目前生效版本 v${active.version} 的差異（${rows.length} 項）</p>${diffTable(rows, `v${active.version}（目前）`, `v${v.version}`)}<details style="margin-top:10px"><summary>完整 JSON</summary><pre class="json">${h(JSON.stringify(v.config, null, 2))}</pre></details>`);
      }
      else if (t.dataset.rollback) {
        const v = Number(t.dataset.rollback);
        if (await A.confirmDlg('回復設定', `確定要把遊戲設定回復成 <b>v${v}</b> 嗎？系統會以 v${v} 的內容建立新版本 v${active.version + 1}，玩家下次載入即生效。`, '回復', true)) {
          try { const r = await A.post('/config/rollback/' + v); A.toast(`已回復，目前為 v${r.version}`); Views.config(main); } catch (err) { A.errToast(err); }
        }
      }
    };
    render();
  };

  // ---------- 魚種 ----------
  const LOOK = { body: [['fish', '一般魚形'], ['tall', '高身（神仙魚）'], ['round', '圓形（河豚）'], ['shrimp', '蝦（無尾鰭／背鰭）'], ['elongated', '細長'], ['torpedo', '魚雷形（鯊）'], ['disc', '圓盤（七彩）'], ['arowana', '龍魚'], ['catfish', '鯰魚'], ['pleco', '異型'], ['eel', '鰻'], ['ray', '魟'], ['crab', '蟹'], ['crayfish', '螯蝦'], ['snail', '螺'], ['seahorse', '海馬'], ['turtle', '🐢 烏龜'], ['cetacean', '🐋 鯨豚'], ['whaleshark', '🦈 鯨鯊'], ['manta', '鬼蝠魟']],
    role: [['swim', '一般（悠游）'], ['bottom', '底棲（吃底砂髒污）'], ['glass', '貼玻璃（吃藻）'], ['shrimp', '爬行蝦（到處撿食）']], tail: [['fan', '扇形'], ['fork', '叉形'], ['small', '小尾'], ['flow', '飄逸長尾']],
    fins: [['std', '一般'], ['tall', '高鰭'], ['flowing', '飄逸大鰭'], ['round', '小圓鰭']],
    pattern: [['belly', '亮腹'], ['bands', '直條紋（小丑魚）'], ['neonStripe', '霓虹帶'], ['palette', '調色盤（倒吊）'], ['vstripes', '細直紋'], ['spots', '斑點'], ['patches', '色塊（錦鯉）'], ['scales', '鱗片閃光'], ['rainbow', '彩虹'], ['sheen', '光澤'], ['stripe', '橫向黑線（飛狐）'], ['dots', '細點（沼蝦）']] };
  const NEW_SPECIES = () => ({ name: '新魚種', rarity: 0, price: 50, coin: 2, breedOnly: false, disabled: false, speed: 40, bioload: 1, desc: '', look: { body: 'fish', tail: 'fan', fins: 'std', pattern: 'belly', len: 30, height: 18, hue: 180, sat: 80, light: 55 } });

  Views.species = async function (main, params) {
    const active = await A.get('/config');
    if(location.hash.slice(1).split('/')[0]!=='species')return;
    const cfg = active.config;
    const keys = Object.keys(cfg.species);
    let selKey = params[0] && (cfg.species[params[0]] || params[0] === '__new') ? params[0] : keys[0];
    let isNew = false, newKey = '';
    let speciesQuery='';
    const dirty=()=>isNew?(!!newKey||JSON.stringify(sp)!==JSON.stringify(NEW_SPECIES())):JSON.stringify(sp)!==JSON.stringify(cfg.species[selKey]);
    A.setLeaveGuard(dirty);
    function filterSpecies(){let n=0;for(const row of main.querySelectorAll('.spitem')){const key=row.dataset.k,show=!speciesQuery||(key+' '+cfg.species[key].name).toLowerCase().includes(speciesQuery.toLowerCase());row.hidden=!show;if(show)n++}const count=main.querySelector('#speciesCount');if(count)count.textContent=`找到 ${n} / ${keys.length} 種`}

    let sp = JSON.parse(JSON.stringify(cfg.species[selKey] || NEW_SPECIES()));
    const rar = cfg.rarity;

    function listHtml() {
      return keys.map((k) => { const s = cfg.species[k]; return `<div class="spitem ${k === selKey && !isNew ? 'on' : ''} ${s.disabled ? 'dis' : ''}" data-k="${h(k)}"><canvas width="168" height="104" data-mini="${h(k)}"></canvas><div><div class="nm">${h(s.name)} ${A.rarBadge(s.rarity, rar)}</div><div class="muted mini mono">${h(k)}</div><div class="mini">${s.priceGems > 0 ? `<span class="badge b-purple">💎${s.priceGems} 限定</span>` : s.breedOnly ? '<span class="badge b-blue">繁殖限定</span>' : `🪙${s.price}`} ${s.disabled ? '<span class="badge b-off">已停用</span>' : ''}</div></div></div>`; }).join('');
    }
    const num = (p, label, min, max, step = 1) => { const v = A.getPath(sp, p); return `<label class="f">${h(label)}<span class="rangef"><input type="range" min="${min}" max="${max}" step="${step}" data-sp="${p}" data-type="num" value="${v ?? min}"><input type="number" step="any" data-sp="${p}" data-type="num" value="${v ?? ''}"></span></label>`; };
    const sel = (p, label, opts0) => { const cur = A.getPath(sp, p), opts = cur != null && !opts0.some(([v]) => v === cur) ? opts0.concat([[cur, String(cur)]]) : opts0; return `<label class="f">${h(label)}<select data-sp="${p}">${opts.map(([v, l]) => `<option value="${v}" ${A.getPath(sp, p) === v ? 'selected' : ''}>${h(l)}</option>`).join('')}</select></label>`; };
    const txt = (p, label, hint = '') => `<label class="f">${h(label)}<input data-sp="${p}" value="${h(A.getPath(sp, p) ?? '')}">${hint ? `<span class="hint">${h(hint)}</span>` : ''}</label>`;
    const int = (p, label, hint = '') => `<label class="f">${h(label)}<input type="number" step="any" data-sp="${p}" data-type="num" value="${A.getPath(sp, p) ?? ''}">${hint ? `<span class="hint">${h(hint)}</span>` : ''}</label>`;
    const chk = (p, label) => `<label class="chk"><input type="checkbox" data-sp="${p}" data-type="bool" ${A.getPath(sp, p) ? 'checked' : ''}>${h(label)}</label>`;

    function formHtml() {
      return `<div class="card"><div class="section-title"><h2>${isNew ? '新增魚種' : `編輯：${h(cfg.species[selKey].name)} <span class="mono muted">${h(selKey)}</span>`}</h2>
        <div class="btns">${!isNew ? `<button class="btn ${sp.disabled ? '' : 'danger'}" data-toggle>${cfg.species[selKey].disabled ? '重新啟用' : '停用此魚種'}</button>` : ''}<button class="btn primary" data-savesp>${isNew ? '建立並發布' : '儲存並發布'}</button></div></div>
        <div id="errs"></div>
        <div class="preview-wrap"><canvas id="pv" width="360" height="220"></canvas><div><canvas id="pvSil" width="160" height="100"></canvas><div class="muted mini">圖鑑未解鎖剪影</div></div>
          <div><canvas id="pvH1" width="120" height="76"></canvas><canvas id="pvH2" width="120" height="76"></canvas><div class="muted mini">個體色相差異 ±8°</div></div></div></div>
        <div class="card"><h3>基本資料</h3><div class="fields">
          ${isNew ? `<label class="f">代號（英文，建立後不可改）<input id="newKey" value="${h(newKey)}" placeholder="例如 seahorse"></label>` : ''}
          ${txt('name', '名稱')}${sel('rarity', '稀有度', rar.map((r, i) => [i, r.name]))}
          <label class="f">售價幣別<select data-cur><option value="coins" ${sp.priceGems > 0 ? '' : 'selected'}>🪙 金幣（一般魚店）</option><option value="gems" ${sp.priceGems > 0 ? 'selected' : ''}>💎 寶石（限定魚，只能在伺服器購買）</option></select></label>
          ${sp.priceGems > 0 ? int('priceGems', '寶石價格 💎', '玩家在魚店「限定」區用寶石購買；改價儲存後立即生效') : int('price', '魚店售價', '0 = 不在魚店販售')}${int('sellPrice', '回收價（選填）', sp.priceGems > 0 ? '限定魚必填（賣回得到的金幣）' : '繁殖限定魚必填')}${int('coin', '成魚每次掉落金幣')}${int('speed', '游速')}
          </div><div class="fields" style="margin-top:10px">${chk('breedOnly', '繁殖限定（只能突變取得）')}${chk('disabled', '停用（下架並移出突變池，已擁有的不受影響）')}</div>
          <label class="f" style="margin-top:10px">描述<input data-sp="desc" value="${h(sp.desc || '')}" maxlength="120"></label></div>
        <div class="card"><h3>照護 / 清潔隊</h3><div class="fields">
          ${int('bioload', '生物負載（越高水越髒）', '預設 1；蝦約 0.1')}${int('hungerMultiplier', '飢餓速度倍率', '預設 1；清潔隊 0.4')}${sel('role', '角色', LOOK.role)}
          ${(sp.role && sp.role !== 'swim') ? `${int('clean.wastePerHour', '清除底砂髒污 / 小時')}${int('clean.algaePerHour', '清除藻類 / 小時')}` : ''}
          </div>${(sp.role && sp.role !== 'swim') ? `<div class="fields" style="margin-top:10px">${chk('clean.eatsLeftovers', '會吃殘餌')}</div>` : '<p class="muted mini">選擇「底棲／貼玻璃／爬行蝦」角色即可設定清潔能力（會列入魚店的「清潔隊」）。</p>'}</div>
        <div class="card"><h3>外觀參數（即時預覽）</h3><div class="fields">
          ${sel('look.body', '身形', LOOK.body)}${sel('look.tail', '尾巴', LOOK.tail)}${sel('look.fins', '背鰭／腹鰭', LOOK.fins)}${sel('look.pattern', '花紋', LOOK.pattern)}
          ${num('look.hue', '色相 Hue', 0, 360)}${num('look.sat', '飽和度', 0, 100)}${num('look.light', '亮度', 0, 100)}${num('look.len', '身長', 10, 90)}${num('look.height', '身高', 5, 60)}
          ${num('look.tailScale', '尾巴大小', .3, 3, .05)}${num('look.eyeScale', '眼睛大小', .3, 3, .05)}${num('look.hueCycle', '色相旋轉（度/秒）', 0, 360)}
          ${txt('look.patternColor', '花紋顏色（選填）', '#hex / hsl() / rgb()')}${txt('look.tailColor', '尾巴顏色（選填）', '#hex / hsl() / rgb()')}
          </div><div class="fields" style="margin-top:10px">${chk('look.puffs', '吃東西時會鼓起（河豚）')}${chk('look.barbels', '有鬚（金龍魚）')}</div></div>`;
    }

    function render() {
      main.innerHTML = `<h1>🐟 魚種管理</h1><p class="sub">共 ${keys.length} 種（設定版本 v${active.version}）。儲存後會建立新的設定版本，並可在「遊戲設定 → 版本紀錄」回復。</p>
        <div class="row"><div style="width:280px"><button class="btn primary block" data-new style="margin-bottom:8px">＋ 新增魚種</button><label class="f species-search">搜尋魚種<input type="search" id="speciesSearch" placeholder="魚名或英文代號" value="${h(speciesQuery)}"></label><div id="speciesCount" class="muted mini" aria-live="polite"></div><div class="splist">${listHtml()}</div></div><div class="grow" id="spForm">${formHtml()}</div></div>`;
      filterSpecies();
      main.querySelectorAll('canvas[data-mini]').forEach((c) => FishRender.drawPreview(c, FishRender.resolve(cfg.species[c.dataset.mini]), { t: 1.2 }));
      animate();
    }
    let raf = 0;
    function clean(o) { for (const k of Object.keys(o)) { if (o[k] === '' || o[k] == null || (k === 'sellPrice' && !o[k])) delete o[k]; else if (typeof o[k] === 'object' && !Array.isArray(o[k])) clean(o[k]); } return o; }
    function animate() {
      cancelAnimationFrame(raf);
      const pv = main.querySelector('#pv'); if (!pv) return;
      const t0 = performance.now();
      const step = (now) => {
        if (!document.body.contains(pv)) return;
        const t = (now - t0) / 1000, r = FishRender.resolve(clean(JSON.parse(JSON.stringify(sp))));
        FishRender.drawPreview(pv, r, { t, puff: r.puffs ? (Math.sin(t) > .6 ? 1 : 0) : 0 });
        FishRender.drawPreview(main.querySelector('#pvSil'), r, { t: 1.2, sil: true, bg: true });
        FishRender.drawPreview(main.querySelector('#pvH1'), r, { t: t + 1, hue: (r.hue + 352) % 360 });
        FishRender.drawPreview(main.querySelector('#pvH2'), r, { t: t + 2, hue: (r.hue + 8) % 360 });
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }
    main.oninput = main.onchange = (e) => {
      const el = e.target; if(el.id==='speciesSearch'){speciesQuery=el.value;filterSpecies();return} if (el.id === 'newKey') { newKey = el.value.trim(); return; }
      if (el.dataset && el.dataset.cur != null) { // 切換金幣／寶石定價
        if (el.value === 'gems') { sp.priceGems = sp.priceGems > 0 ? sp.priceGems : 100; sp.price = 0; sp.premium = true; sp.breedOnly = false; if (!(sp.sellPrice > 0)) sp.sellPrice = Math.max(100, (sp.coin || 1) * 100); }
        else { delete sp.priceGems; delete sp.premium; sp.price = sp.price > 0 ? sp.price : 100; }
        const y = window.scrollY; render(); window.scrollTo(0, y); return;
      }
      const p = el.dataset && el.dataset.sp; if (!p) return;
      let v = el.dataset.type === 'bool' ? el.checked : el.dataset.type === 'num' ? (el.value === '' ? null : Number(el.value)) : el.value;
      if (p === 'rarity') v = Number(v);
      A.setPath(sp, p, v);
      if (p === 'role') { if (v === 'swim') delete sp.clean; else sp.clean = sp.clean || { wastePerHour: 0, algaePerHour: 0, eatsLeftovers: true }; const y = window.scrollY; render(); window.scrollTo(0, y); return; }
      if (p === 'look.body') { const y = window.scrollY; render(); window.scrollTo(0, y); return; }
      main.querySelectorAll(`[data-sp="${p}"]`).forEach((o) => { if (o !== el && o.type !== 'checkbox') o.value = v ?? ''; });
    };
    main.onclick = async (e) => {
      const item = e.target.closest('.spitem');
      if (item) { if(item.dataset.k===selKey&&!isNew)return;if(dirty()&&!await A.confirmDlg('尚未儲存的魚種修改','切換魚種會放棄目前的修改，要繼續嗎？','放棄並切換'))return;selKey = item.dataset.k; isNew = false; sp = JSON.parse(JSON.stringify(cfg.species[selKey])); render(); return; }
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-new')) { if(dirty()&&!await A.confirmDlg('尚未儲存的魚種修改','新增魚種會放棄目前的修改，要繼續嗎？','放棄並新增'))return;isNew = true; newKey = ''; sp = NEW_SPECIES(); render(); }
      else if (b.hasAttribute('data-toggle')) {
        const dis = !cfg.species[selKey].disabled;
        if (!(await A.confirmDlg(dis ? '停用魚種' : '啟用魚種', dis ? `停用「${h(cfg.species[selKey].name)}」後，魚店與突變池都不會再出現，但玩家已擁有的魚會保留。` : `重新啟用「${h(cfg.species[selKey].name)}」？`, dis ? '停用' : '啟用', dis))) return;
        try { const r = await A.post(`/species/${selKey}/disabled`, { disabled: dis }); A.toast(`已${dis ? '停用' : '啟用'}，設定 v${r.version}`); Views.species(main, [selKey]); } catch (err) { A.errToast(err); }
      } else if (b.hasAttribute('data-savesp')) {
        const key = isNew ? newKey : selKey;
        if (isNew && (!/^[a-z][a-zA-Z0-9_]{1,31}$/.test(key) || cfg.species[key])) { main.querySelector('#errs').innerHTML = '<div class="errors">代號需為英文字母開頭的 2–32 個英數字或底線，且不可與現有魚種重複</div>'; return; }
        const body = clean(JSON.parse(JSON.stringify(sp)));
        if (!body.role || body.role === 'swim') { delete body.clean; delete body.role; }
        if (body.disabled == null) body.disabled = false;
        try { const r = await A.put('/species/' + key, { species: body, baseVersion: active.version }); A.toast(`已發布設定 v${r.version}`); Views.species(main, [key]); }
        catch (err) { main.querySelector('#errs').innerHTML = A.errList(err.data && err.data.errors) || `<div class="errors">${h(err.message)}</div>`; A.errToast(err); }
      }
    };
    render();
  };
})();
