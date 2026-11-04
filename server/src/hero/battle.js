/* 悠游水族箱 — 英雄魚戰鬥模擬器（battle.js）
 * 伺服器權威、確定性：同一組 (snapshotA, snapshotB, seed, battleCfg, skills) 永遠產生同一場戰鬥。
 * - 只用整數＋四則運算（不用 Math.log/pow/sin），跨平台結果一致
 * - 亂數：mulberry32(seed)
 * - 回合制「行動條」：每 tick 行動條 += 速度，滿 gauge 即行動；同 tick 同時滿時速度高者先，再平手則由亂數決定
 * 回傳 { winner: 0|1, reason: 'ko'|'timeout', actions, events[], final }，events 給前端重播動畫。
 * 同一份檔案也可在瀏覽器以 <script> 載入（window.HeroBattle），供離線示範。
 */
(function (root) {
  'use strict';
  const SIM_VERSION = 1;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const r2 = (x) => Math.round(x);

  function mkFighter(snap, side) {
    const s = snap.stats;
    return {
      side, name: snap.name, hp: s.hp, maxHp: s.hp, base: { atk: s.atk, def: s.def, spd: s.spd, crit: s.crit, critDmg: s.critDmg, dodge: s.dodge },
      gauge: 0, shield: 0, buffs: [], dots: [], stun: false, reflect: null,
      skills: (snap.skills || []).map((x) => ({ id: x.id, rank: x.rank || 1, cd: 0 })),
    };
  }

  // 目前（含增益／減益）能力值
  function stat(f, k) {
    let v = f.base[k], add = 0;
    for (const b of f.buffs) if (b.stat === k) { if (b.mult != null) v = v * b.mult; if (b.add != null) add += b.add; }
    v += add;
    if (k === 'spd') return Math.max(10, r2(v));
    if (k === 'crit' || k === 'dodge') return Math.max(0, Math.min(k === 'dodge' ? 750 : 1000, r2(v)));
    return Math.max(0, r2(v));
  }

  function simulate(snapA, snapB, seed, bcfg, skillsDef) {
    bcfg = bcfg || {};
    const K = bcfg.defK || 100, VAR = bcfg.variance == null ? 0.08 : bcfg.variance, G = bcfg.gauge || 1000, MAXA = bcfg.maxActions || 70, MIND = bcfg.minDmg || 1, RP = bcfg.rankPer == null ? 0.08 : bcfg.rankPer;
    const rand = mulberry32(seed);
    const F = [mkFighter(snapA, 0), mkFighter(snapB, 1)];
    const events = [];
    let actions = 0, tick = 0, winner = null, reason = null;
    const hpArr = () => [F[0].hp, F[1].hp];
    const shArr = () => [F[0].shield, F[1].shield];

    // 對 target 造成傷害（護盾先吸收）；回傳實際扣血
    function applyDamage(target, dmg) {
      let absorbed = 0;
      if (target.shield > 0) { absorbed = Math.min(target.shield, dmg); target.shield -= absorbed; dmg -= absorbed; }
      target.hp = Math.max(0, target.hp - dmg);
      return { taken: dmg, absorbed };
    }

    function hit(att, def, mult, pierce, rankBoost) {
      const dodge = stat(def, 'dodge');
      if (rand() * 1000 < dodge) return { miss: true, dmg: 0 };
      const atk = stat(att, 'atk'), dv = stat(def, 'def') * (1 - (pierce || 0));
      const vr = 1 - VAR + rand() * VAR * 2;
      let dmg = atk * mult * rankBoost * vr * K / (K + dv);
      const crit = rand() * 1000 < stat(att, 'crit');
      if (crit) dmg = dmg * stat(att, 'critDmg') / 100;
      dmg = Math.max(MIND, r2(dmg));
      const res = applyDamage(def, dmg);
      const out = { dmg: res.taken, absorbed: res.absorbed, crit };
      // 反彈
      if (def.reflect && def.reflect.turns > 0 && res.taken + res.absorbed > 0) {
        const rf = Math.max(1, r2((res.taken + res.absorbed) * def.reflect.pct));
        att.hp = Math.max(0, att.hp - rf); out.reflect = rf;
      }
      return out;
    }

    function hasBuff(f, k) { return f.buffs.some((b) => b.stat === k && b.src === 'self'); }
    function hasDebuff(f, k) { return f.buffs.some((b) => b.stat === k && b.src === 'enemy'); }

    // AI：技能是否值得現在用
    function wants(f, foe, sk) {
      const dealsDmg = sk.mult != null;
      if (dealsDmg) return true;
      if (sk.heal && !sk.shield && f.hp > f.maxHp * 0.65) return false;
      if (sk.heal && sk.shield && f.hp > f.maxHp * 0.8 && f.shield > 0) return false;
      if (sk.shield && !sk.heal && f.shield > f.maxHp * 0.05) return false;
      if (sk.selfBuff && sk.selfBuff.every((b) => hasBuff(f, b.stat))) return false;
      if (sk.reflect && f.reflect && f.reflect.turns > 0) return false;
      if (!sk.selfBuff && !sk.heal && !sk.shield && !sk.reflect && sk.debuff && sk.debuff.every((b) => hasDebuff(foe, b.stat))) return false;
      return true;
    }

    function act(f) {
      const foe = F[1 - f.side];
      const ev = { n: actions, tick, a: f.side, k: 'act' };
      // 持續傷害（行動開始時結算）
      if (f.dots.length) {
        let total = 0;
        for (const d of f.dots) { total += d.dmg; d.turns--; }
        f.dots = f.dots.filter((d) => d.turns > 0);
        const res = applyDamage(f, total);
        ev.dot = res.taken + res.absorbed;
        if (f.hp <= 0) { ev.hp = hpArr(); ev.sh = shArr(); events.push(ev); return; }
      }
      if (f.stun) {
        f.stun = false; ev.k = 'stunned';
      } else {
        let sk = null, skId = null;
        for (const s of f.skills) {
          const def = skillsDef[s.id];
          if (!def || s.cd > 0) continue;
          if (wants(f, foe, def)) { sk = def; skId = s; break; }
        }
        const boost = skId ? 1 + (skId.rank - 1) * RP : 1;
        if (!sk) {
          ev.k = 'atk'; ev.fx = 'basic';
          ev.hits = [hit(f, foe, 1, 0, 1)];
        } else {
          ev.k = 'skill'; ev.sk = skId.id; ev.fx = sk.fx || 'basic';
          skId.cd = sk.cd || 0;
          if (sk.mult != null) {
            ev.hits = [];
            for (let i = 0; i < (sk.hits || 1); i++) {
              const h = hit(f, foe, sk.mult, sk.pierce, boost);
              ev.hits.push(h);
              if (!h.miss) {
                if (sk.lifesteal) { const g = r2(h.dmg * sk.lifesteal); f.hp = Math.min(f.maxHp, f.hp + g); ev.heal = (ev.heal || 0) + g; }
                if (sk.recoil) { const rc = Math.max(1, r2((h.dmg + h.absorbed) * sk.recoil)); f.hp = Math.max(1, f.hp - rc); ev.recoil = (ev.recoil || 0) + rc; }
              }
              if (foe.hp <= 0 || f.hp <= 0) break;
            }
            const landed = ev.hits.some((h) => !h.miss);
            if (landed && foe.hp > 0) {
              if (sk.bleed) { const dmg = Math.max(1, r2(stat(f, 'atk') * sk.bleed.pct * boost)); foe.dots.push({ dmg, turns: sk.bleed.turns, kind: sk.bleed.kind || 'bleed' }); ev.dotApplied = { dmg, turns: sk.bleed.turns, kind: sk.bleed.kind || 'bleed' }; }
              if (sk.stun && rand() < sk.stun) { foe.stun = true; ev.stun = true; }
              if (sk.debuff) { ev.debuff = []; for (const b of sk.debuff) { foe.buffs = foe.buffs.filter((x) => !(x.stat === b.stat && x.src === 'enemy')); foe.buffs.push({ stat: b.stat, mult: b.mult, add: b.add, turns: b.turns, src: 'enemy' }); ev.debuff.push({ stat: b.stat, mult: b.mult, add: b.add, turns: b.turns }); } }
            }
          } else if (sk.debuff) {
            ev.debuff = [];
            for (const b of sk.debuff) { foe.buffs = foe.buffs.filter((x) => !(x.stat === b.stat && x.src === 'enemy')); foe.buffs.push({ stat: b.stat, mult: b.mult, add: b.add, turns: b.turns, src: 'enemy' }); ev.debuff.push({ stat: b.stat, mult: b.mult, add: b.add, turns: b.turns }); }
          }
          if (sk.heal) { const g = Math.min(f.maxHp - f.hp, r2(f.maxHp * sk.heal * boost)); f.hp += g; ev.heal = (ev.heal || 0) + g; }
          if (sk.shield) { const s = r2(f.maxHp * sk.shield * boost); f.shield = Math.max(f.shield, s); ev.shield = s; }
          if (sk.selfBuff) {
            ev.buff = [];
            for (const b of sk.selfBuff) {
              f.buffs = f.buffs.filter((x) => !(x.stat === b.stat && x.src === 'self'));
              const nb = { stat: b.stat, turns: b.turns + 1, src: 'self' }; // +1：施放當回合結束時會先扣 1
              if (b.mult != null) nb.mult = 1 + (b.mult - 1) * boost;
              if (b.add != null) nb.add = r2(b.add * boost);
              f.buffs.push(nb); ev.buff.push({ stat: b.stat, mult: nb.mult, add: nb.add, turns: b.turns });
            }
          }
          if (sk.reflect) { f.reflect = { pct: sk.reflect.pct * boost, turns: sk.reflect.turns + 1 }; ev.reflectOn = sk.reflect.turns; }
        }
        // 冷卻
        for (const s of f.skills) if (s !== skId && s.cd > 0) s.cd--;
      }
      // 自身增益回合遞減；施加在對手身上的減益在對手行動結束時遞減
      for (const b of f.buffs) b.turns--;
      f.buffs = f.buffs.filter((b) => b.turns > 0);
      if (f.reflect) { f.reflect.turns--; if (f.reflect.turns <= 0) f.reflect = null; }
      ev.hp = hpArr(); ev.sh = shArr();
      events.push(ev);
    }

    while (winner == null) {
      tick++;
      for (const f of F) f.gauge += stat(f, 'spd');
      // 本 tick 可行動者
      let ready = F.filter((f) => f.gauge >= G);
      if (ready.length === 2) {
        const sa = stat(F[0], 'spd'), sb = stat(F[1], 'spd');
        const first = F[0].gauge !== F[1].gauge ? (F[0].gauge > F[1].gauge ? 0 : 1) : sa !== sb ? (sa > sb ? 0 : 1) : (rand() < 0.5 ? 0 : 1);
        ready = [F[first], F[1 - first]];
      }
      for (const f of ready) {
        if (winner != null) break;
        f.gauge -= G;
        act(f);
        actions++;
        if (F[0].hp <= 0 || F[1].hp <= 0) {
          // 同歸於盡：最後出手者（反彈／反作用致死）判負
          winner = F[0].hp <= 0 && F[1].hp <= 0 ? 1 - f.side : (F[0].hp <= 0 ? 1 : 0);
          reason = 'ko';
          events.push({ n: actions, tick, k: 'ko', a: 1 - winner, hp: hpArr(), sh: shArr() });
        } else if (actions >= MAXA) {
          // 時間到：剩餘生命比例高者勝（以整數交叉相乘比較）；相同則防守方勝
          const pa = F[0].hp * F[1].maxHp, pb = F[1].hp * F[0].maxHp;
          winner = pa > pb ? 0 : 1; reason = 'timeout';
          events.push({ n: actions, tick, k: 'timeout', hp: hpArr(), sh: shArr() });
        }
      }
      if (tick > 100000) { winner = 1; reason = 'timeout'; }
    }
    return { v: SIM_VERSION, seed, winner, reason, actions, events, final: { hp: hpArr(), maxHp: [F[0].maxHp, F[1].maxHp] } };
  }

  const api = { simulate, mulberry32, SIM_VERSION };
  root.HeroBattle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
