/* 🎣 FISHING-ADMIN-V11 釣魚後台：數據總覽、開關與次數、賣魚價格、商店價格、機率與掉落、每日任務、大賽、玩家查詢（完整紀錄＋補發道具）、稽核
   所有數值存在 config.fishing（跟遊戲參數一樣有版本），按「發布」即生效、不用部署。 */
(function(){const {h}=A,RN=['普通','稀有','傳說','限定'],RC=['#bcd7e6','#6cc4ff','#ffd166','#ff7eb6'];
 const css=`.fa{--g:#ffd166}.fa h2{display:flex;align-items:center;gap:10px;margin:0 0 4px}.fa .vtag{font-size:12px;font-weight:700;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:2px 10px}
.fa .tabs{position:sticky;top:0;z-index:5;background:var(--bg);padding-top:6px}.fa .tabs button{font-size:14px}
.fa .kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:6px 0 4px}.fa .kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 12px}.fa .kpi small{display:block;color:var(--muted);font-size:12px}.fa .kpi b{font-size:22px;color:var(--text)}.fa .kpi em{font-style:normal;color:var(--muted);font-size:12px;margin-left:4px}
.fa table{width:100%;border-collapse:collapse;font-size:13.5px}.fa td,.fa th{padding:6px 7px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}.fa th{color:var(--muted);font-weight:700;font-size:12.5px;white-space:nowrap}.fa tr:hover td{background:rgba(255,255,255,.02)}
.fa .num{text-align:right;font-variant-numeric:tabular-nums}.fa .on{color:var(--ok);font-weight:800}.fa .off{color:var(--bad);font-weight:800}
.fa .alert{border-radius:10px;padding:9px 12px;margin:6px 0;font-weight:700}.fa .alert.bad{background:rgba(255,123,123,.14);border:1px solid rgba(255,123,123,.5);color:#ffc2c2}.fa .alert.warn{background:rgba(255,209,102,.12);border:1px solid rgba(255,209,102,.45);color:#ffe2a0}.fa .alert.ok{background:rgba(94,230,168,.1);border:1px solid rgba(94,230,168,.4);color:#b8f5d8}
.fa .bars{display:flex;align-items:flex-end;gap:6px;height:120px;padding:8px 0}.fa .bars div{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;font-size:11px;color:var(--muted)}.fa .bars i{display:block;width:100%;border-radius:6px 6px 2px 2px;background:linear-gradient(#ffd166,#e09a20);min-height:2px}.fa .bars div.today i{background:linear-gradient(#ff9ec6,#e0508a)}
.fa .fgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}.fa .fld{display:flex;flex-direction:column;gap:3px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 10px}.fa .fld>span{font-weight:700;font-size:13px}.fa .fld small{color:var(--muted);font-size:11.5px}.fa .fld input,.fa .fld select{width:100%}
.fa input.ovr,.fa select.ovr{border-color:var(--g);box-shadow:0 0 0 1px rgba(255,209,102,.35)}.fa input.bad{border-color:var(--bad)!important;box-shadow:0 0 0 1px rgba(255,123,123,.5)}
.fa td input{width:100px}.fa td input.w60{width:64px}.fa .chip{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11.5px;font-weight:800;border:1px solid currentColor}
.fa .switch{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:10px}.fa .switch b{font-size:15px}.fa .switch small{display:block;color:var(--muted)}
.fa .tg{position:relative;width:54px;height:30px;flex:none;border-radius:999px;background:#3a4f60;border:1px solid var(--line);cursor:pointer}.fa .tg:after{content:'';position:absolute;left:3px;top:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:.2s}.fa .tg.on{background:#2fae74}.fa .tg.on:after{left:27px}
.fa .savebar{position:sticky;bottom:0;z-index:6;margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:linear-gradient(#1c4260,#163852);border:1px solid var(--g);border-radius:12px;padding:10px 14px;box-shadow:0 -6px 20px rgba(0,0,0,.35)}.fa .savebar input{flex:1;min-width:180px}.fa .savebar .dk{font-weight:800;color:var(--g)}
.fa .muted{color:var(--muted)}.fa .hint{color:var(--muted);font-size:12.5px;margin:4px 0 10px}.fa .pager{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:8px}
.fa .filters{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin:8px 0}.fa .filters label{display:flex;flex-direction:column;font-size:12px;color:var(--muted);gap:2px}
.fa .pcard{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}.fa .sub2{display:flex;gap:4px;flex-wrap:wrap;margin:10px 0}.fa .sub2 button{background:var(--panel);border:1px solid var(--line);color:var(--muted);border-radius:999px;padding:5px 12px;font:inherit;font-weight:700;cursor:pointer}.fa .sub2 button.on{color:#3d2500;background:var(--g);border-color:var(--g)}
.fa .pity{height:8px;border-radius:99px;background:#0b2133;overflow:hidden;margin-top:4px}.fa .pity i{display:block;height:100%;background:linear-gradient(90deg,#6cc4ff,#ff7eb6)}
.fa .row2{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:14px}`;
 const ensureCss=()=>{let s=document.getElementById('fa-css');if(!s){s=document.createElement('style');s.id='fa-css';document.head.appendChild(s)}s.textContent=css};
 const N=n=>A.fmtNum(n),clone=o=>JSON.parse(JSON.stringify(o==null?{}:o)),SEP='|';
 const tbl=(cols,rows,empty='沒有資料')=>`<table><tr>${cols.map(c=>`<th class="${c[2]||''}">${h(c[0])}</th>`).join('')}</tr>${rows.map(r=>`<tr>${cols.map(c=>`<td class="${c[2]||''}">${c[1](r)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${cols.length}" class="muted">${h(empty)}</td></tr>`}</table>`;
 const rar=r=>r==null?'':`<span class="chip" style="color:${RC[r]}">${RN[r]}</span>`;
 const VAR={gold:'<span class="chip" style="color:#ffd166">✨黃金</span>',albino:'<span class="chip" style="color:#d9ccff">🤍白化</span>'};
 const DEST={tank:'放回魚缸',slot:'其他魚缸',storage:'收藏庫',sell:'賣掉',release:'放生',basket:'放進魚簍',basket_open:'在魚簍（未結算）',admin_clear:'後台清除',auto_sell:'自動賣掉'};
 const destTxt=d=>!d?'—':d.startsWith('slot:')?'放到魚缸 '+h(d.slice(5)):h(DEST[d]||d);
 const STATUS={caught:'<span class="on">釣到</span>',lost:'<span class="muted">脫鉤</span>',expired:'<span class="off">逾時</span>',rejected:'<span class="off">過快被拒</span>',pending:'進行中'};
 const dayStr=(t=Date.now())=>new Date(t+8*3600e3).toISOString().slice(0,10);
 // 路徑：用 | 分隔（價格 key 本身有 .）
 const gp=(o,p)=>p.split(SEP).reduce((x,k)=>x==null?undefined:x[k],o);
 function sp(o,p,v){const ks=p.split(SEP);let x=o;const st=[];for(let i=0;i<ks.length-1;i++){if(x[ks[i]]==null||typeof x[ks[i]]!=='object')x[ks[i]]={};st.push([x,ks[i]]);x=x[ks[i]]}const last=ks[ks.length-1];if(v===undefined)delete x[last];else x[last]=v;
   for(let i=st.length-1;i>=0;i--){const [par,k]=st[i];const c=par[k];if(c&&typeof c==='object'&&!Array.isArray(c)&&!Object.keys(c).length)delete par[k];else break}}
 let ST=null; // {cfg, W, orig, tab, ...}
 const TABS=[['stats','📊 數據總覽'],['switch','⚙️ 開關與次數'],['sell','💰 賣魚價格'],['shop','🛒 商店價格'],['prob','🎲 機率與掉落'],['mis','📋 每日任務'],['tour','🏆 大賽'],['records','🎣 全站釣魚紀錄'],['player','🔍 玩家查詢'],['audit','📜 稽核紀錄']];
 const CFG_TABS=new Set(['switch','sell','shop','prob','mis']);
 const dirtyKeys=()=>{const a=ST.orig,b=ST.W;return [...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]))};
 const KN={enabled:'釣魚總開關',missionsEnabled:'每日任務開關',resetGems:'重置價格',resetGem:'重置價格（備用）',boxCasts:'每日次數',prices:'商店價格',packs:'每包次數',exRate:'活動餌掉落率',pityN:'保底竿數',albinoPct:'白化機率',goldPct:'黃金機率',giantPct:'巨大機率',treasurePct:'寶箱機率',bottlePct:'漂流瓶機率',chestGemChance:'寶箱出💎機率',chestGems:'寶箱💎',chestCoins:'寶箱🪙',bottleCoins:'漂流瓶🪙',sell:'賣魚公式',sellMult:'賣魚倍率',spots:'釣點',missions:'每日任務',tourRewards:'大賽預設獎勵',priceMult:'價格倍率',perfectMaxPerDay:'完美拋竿上限',alertCoinsDay:'金幣警示門檻',alertPlayerCoins:'玩家金幣警示'};
 // 欄位：值＝W 有設定就顯示，否則空白、placeholder 顯示預設（＝目前生效）
 function eff(path){const v=gp(ST.W,path);return v!==undefined?v:gp(ST.D,path)}
 function fld(path,label,opt={}){const t=opt.t||'int',v=gp(ST.W,path),d=gp(ST.D,path),show=x=>x==null?'':t==='pct'?+(x*100).toFixed(4):x;
   const inp=`<input inputmode="decimal" data-k="${h(path)}" data-t="${t}" ${opt.min!=null?`data-min="${opt.min}"`:''} ${opt.max!=null?`data-max="${opt.max}"`:''} value="${h(show(v))}" placeholder="${h(show(d))}" class="${v!==undefined?'ovr':''}">`;
   return opt.bare?inp:`<label class="fld"><span>${h(label)}${t==='pct'?' (%)':''}</span>${inp}<small>${opt.hint?h(opt.hint)+'　':''}預設 ${h(show(d))}${t==='pct'?'%':''}${opt.unit?' '+h(opt.unit):''}</small></label>`}
 const tg=(path,label,sub)=>{const on=eff(path)===true;return`<div class="switch"><div><b>${h(label)}</b><small>${sub||''}</small></div><div class="tg ${on?'on':''}" role="switch" aria-checked="${on}" data-tg="${h(path)}"></div></div>`};
 function parseIn(el){const t=el.dataset.t,raw=el.value.trim();if(raw==='')return {unset:true};let v=Number(raw.replace(/,/g,''));if(!Number.isFinite(v))return {err:1};if(t==='int'&&!Number.isInteger(v))return {err:1};if(t==='pct')v=+(v/100).toFixed(6);
   if(el.dataset.min!=null&&v<+el.dataset.min)return {err:1};if(el.dataset.max!=null&&v>+el.dataset.max)return {err:1};return {v}}
 function setField(path,res){const ks=path.split(SEP),last=ks[ks.length-1];
   if(/^\d+$/.test(last)){const pp=ks.slice(0,-1).join(SEP),arr=clone(gp(ST.W,pp)||gp(ST.D,pp)||[]),d=gp(ST.D,pp)||[];arr[+last]=res.unset?d[+last]:res.v;
     sp(ST.W,pp,JSON.stringify(arr)===JSON.stringify(d)?undefined:arr)}else sp(ST.W,path,res.unset?undefined:res.v)}
 // ---------------- 主畫面 ----------------
 window.Views=window.Views||{};
 window.Views.fishing=async function(main,params){ensureCss();
  const cfg=await A.get('/fishing/config');const keepTab=ST&&ST.tab;
  ST={cfg,W:clone(cfg.fishing),orig:clone(cfg.fishing),tab:(params&&params[0])||keepTab||'stats',D:buildDefaults(cfg),pq:ST&&ST.pq||'',pid:ST&&ST.pid||null,rec:{type:'casts',page:1}};
  A.setLeaveGuard&&A.setLeaveGuard(()=>dirtyKeys().length>0);
  main.innerHTML=`<div class="fa"><h2>🎣 釣魚模式後台 <span class="vtag" data-ver></span></h2><p class="sub">所有數值改完按下方「發布」就會建立新的設定版本，立即生效（玩家下一次操作就套用），不用重新部署。黃色框＝已自訂；空白＝使用預設。</p>
   <div class="tabs">${TABS.map(([k,n])=>`<button data-tab="${k}" class="${ST.tab===k?'on':''}">${n}</button>`).join('')}</div><div data-body></div><div data-save></div></div>`;
  main.onclick=onClick;main.onchange=onChange;main.oninput=onInput;main.onkeydown=e=>{if(e.key==='Enter'&&e.target.matches('[data-pq]'))doSearch()};
  ST.main=main;renderTab();renderSave()};
 function buildDefaults(c){const d=clone(c.defaults);d.prices={};d.packs={};d.exRate={};d.boxCasts={};d.spots={};
  for(const [slot,g] of Object.entries(c.catalog.gear))for(const [id,x] of Object.entries(g)){if(x.cur!=='free')d.prices[slot+'.'+id]=x.price;if(x.pack)d.packs['bait.'+id]=x.pack;if(x.ex)d.exRate[id]=x.ex.p;if(slot==='box')d.boxCasts[id]=x.casts}
  for(const [id,x] of Object.entries(c.catalog.chars))if(!['free','unlock'].includes(x.cur))d.prices['char.'+id]=x.price;
  for(const [id,s] of Object.entries(c.catalog.spots))d.spots[id]={lv:s.lv,unlockGem:s.unlockGem,w:s.w};
  d.priceMult=d.priceMult||{coin:1,gem:1};d.sell=Object.assign({},c.defaults.sell);if(d.alertCoinsDay==null)d.alertCoinsDay=300000;if(d.alertPlayerCoins==null)d.alertPlayerCoins=100000;return d}
 function q(sel){return ST.main.querySelector(sel)}
 function renderSave(){const el=q('[data-save]'),ver=q('[data-ver]');if(ver)ver.textContent=`設定 v${ST.cfg.version}`;if(!el)return;const ks=dirtyKeys();
  el.innerHTML=ks.length?`<div class="savebar"><span>✏️ 未發布的修改：<span class="dk">${ks.map(k=>h(KN[k]||k)).join('、')}</span></span><input data-note placeholder="修改說明（會寫進版本紀錄與稽核）" maxlength="80"><button class="btn" data-act="check">檢查</button><button class="btn primary" data-act="publish">🚀 發布新版本</button><button class="btn ghost" data-act="discard">放棄修改</button><div data-errs style="flex-basis:100%"></div></div>`:''}
 function renderTab(){q('.tabs').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.tab===ST.tab));const B=q('[data-body]');
  const f={stats:tStats,switch:tSwitch,sell:tSell,shop:tShop,prob:tProb,mis:tMis,tour:tTour,records:tRecords,player:tPlayer,audit:tAudit}[ST.tab];B.innerHTML='<div class="loading">載入中…</div>';
  Promise.resolve(f(B)).catch(e=>{B.innerHTML=`<div class="errors">載入失敗：${h(e.message)}</div>`})}
 // ---------------- 📊 數據 ----------------
 async function tStats(B){const day=ST.day||dayStr();const [s,sum,fl]=await Promise.all([A.get('/fishing/stats?day='+day),A.get('/fishing/summary'),A.get('/fishing/flags')]);
  const mx=Math.max(1,...s.series.map(x=>x.coins)),src=s.coinsBySource;
  B.innerHTML=`<section class="card"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>日期</b><input type="date" data-day value="${h(s.day)}" max="${h(s.today)}"><span class="muted">台北時間；狀態：${ST.cfg.effective.enabled?'<span class="on">開放中</span>':'<span class="off">關閉</span>'}</span></div>
   ${s.alerts.length?s.alerts.map(a=>`<div class="alert ${a.level}">⚠️ ${h(a.text)}</div>`).join(''):`<div class="alert ok">✅ 金幣發出正常（今日 🪙${N(s.coinsOut)}，前 7 日中位數 🪙${N(s.median7)}；警示門檻 🪙${N(s.thresholds.day)}）</div>`}
   <div class="kpis"><div class="kpi"><small>拋竿</small><b>${N(s.casts)}</b><em>${N(s.players)} 人</em></div><div class="kpi"><small>釣到魚</small><b>${N(s.catches)}</b><em>傳說+ ${N(s.legendary)}・變種 ${N(s.variants)}</em></div><div class="kpi"><small>賣魚</small><b>${N(s.sells)}</b><em>條</em></div>
   <div class="kpi"><small>重置次數</small><b>${N(s.resets)}</b><em>💎${N(s.resetGems)}</em></div><div class="kpi"><small>💎 花費（釣魚）</small><b>${N(s.gemsSpent)}</b></div><div class="kpi"><small>💎 發出（寶箱／任務／大賽）</small><b>${N(s.gemsOut)}</b></div><div class="kpi"><small>🪙 發出合計</small><b>${N(s.coinsOut)}</b></div></div>
   <div class="row2"><div><h3>🪙 金幣來源</h3>${tbl([['來源',r=>r[0]],['金幣',r=>N(r[1]),'num']],[['現場賣魚',src.sell],['魚簍結算',src.basket],['寶箱',src.chest],['漂流瓶',src.bottle],['每日任務',src.mission],['大賽',src.tour]])}</div>
   <div><h3>近 8 日金幣發出</h3><div class="bars">${s.series.map(x=>`<div class="${x.day===s.day?'today':''}" title="${h(x.day)}：🪙${N(x.coins)}／拋竿 ${N(x.casts)}"><span>${x.coins>=1000?Math.round(x.coins/1000)+'k':x.coins}</span><i style="height:${Math.round(x.coins/mx*90)}%"></i>${h(x.day.slice(5))}</div>`).join('')}</div></div></div>
   <div class="row2"><div><h3>🏅 金幣最多（當日）</h3>${tbl([['玩家',r=>plink(r)],['金幣',r=>N(r.coins),'num']],s.topCoins)}</div><div><h3>🐟 釣最多（當日）</h3>${tbl([['玩家',r=>plink(r)],['條數',r=>N(r.n),'num'],['總重 kg',r=>r.kg,'num'],['積分',r=>N(r.pts),'num']],s.topCatch)}</div></div></section>
   <section class="card"><h3>近 7 日</h3>${tbl([['日期',r=>h(r.day)],['玩家',r=>r.players,'num'],['拋竿',r=>r.casts,'num'],['釣到',r=>r.caught,'num'],['脫鉤',r=>r.lost,'num'],['逾時／拒絕',r=>r.bad,'num'],['成功率',r=>r.casts?Math.round(r.caught/r.casts*100)+'%':'-','num']],sum.byDay)}
   <div class="row2"><div><h3>稀有度</h3>${tbl([['稀有度',r=>rar(r.rarity)],['條數',r=>r.n,'num'],['總重 kg',r=>r.kg,'num']],sum.rarity)}</div><div><h3>去處</h3>${tbl([['去處',r=>destTxt(r.dest)],['條數',r=>r.n,'num']],sum.dest)}</div></div></section>
   <section class="card"><h3>⚠️ 異常名單（7 日成功率過高或收線過快）</h3>${tbl([['玩家',r=>plink({id:r.player_id,name:r.name})],['拋竿',r=>r.casts,'num'],['釣到',r=>r.caught,'num'],['成功率',r=>r.rate+'%','num'],['過快被拒',r=>r.rejected,'num'],['最短拉扯',r=>r.minFightMs!=null?(r.minFightMs/1000).toFixed(1)+'s':'-','num']],fl.rows,'沒有異常')}</section>`}
 const plink=r=>`<a href="javascript:void 0" data-openp="${Number(r.id)}">${h(r.name||'玩家')} <span class="muted">#${Number(r.id)}</span></a>`;
 // ---------------- ⚙️ 開關與次數 ----------------
 function tSwitch(B){const c=ST.cfg.catalog;
  B.innerHTML=`<section class="card"><h3>開關</h3>${tg('enabled','🎣 釣魚模式總開關','關閉後主遊戲的釣魚按鈕會隱藏、所有釣魚 API 回 403（玩家資料保留）')}${tg('missionsEnabled','📋 每日釣魚任務','關閉後主遊戲任務頁不顯示釣魚任務、也不能領獎')}</section>
  <section class="card"><h3>💎 重置次數價格（依玩家「目前所在的釣點」）</h3><p class="hint">次數用完後花 💎 重置回滿；價格看玩家當下所在的釣點（伺服器判斷，只認已解鎖的釣點）。</p><div class="fgrid">${Object.entries(c.spots).map(([id,s])=>fld('resetGems'+SEP+id,s.name,{min:0,max:5000,unit:'💎'})).join('')}</div></section>
  <section class="card"><h3>🧺 每日拋竿次數（看擁有最好的魚簍）</h3><div class="fgrid">${Object.entries(c.gear.box).map(([id,g])=>fld('boxCasts'+SEP+id,`${g.name}${g.legacy?'（舊）':''}`,{min:1,max:50,unit:'次／天',hint:g.cur==='free'?'免費':(g.cur==='gem'?'💎':'🪙')+N(g.price)})).join('')}</div><p class="hint">魚簍本身的價格在「🛒 商店價格」。</p></section>
  <section class="card"><h3>🗺️ 釣點解鎖</h3>${tbl([['釣點',r=>h(r[1].name)],['升級解鎖等級',r=>fld('spots'+SEP+r[0]+SEP+'lv','',{bare:1,min:1,max:200})],['💎 立即解鎖',r=>fld('spots'+SEP+r[0]+SEP+'unlockGem','',{bare:1,min:0,max:100000})]],Object.entries(c.spots))}</section>
  <section class="card"><h3>其他</h3><div class="fgrid">${fld('perfectMaxPerDay','完美拋竿每日上限',{min:0,max:1000,unit:'次'})}${fld('alertCoinsDay','單日金幣發出警示門檻',{min:0,unit:'🪙'})}${fld('alertPlayerCoins','單一玩家單日金幣警示',{min:0,unit:'🪙'})}</div></section>`}
 // ---------------- 💰 賣魚價格 ----------------
 function sellOf(S,sp,o){const b=sp.sellPrice>0?sp.sellPrice:sp.price*S.basePriceRate;let v=b*(sp.pet?S.petMult:S.mult)*Math.pow(Math.min(S.ratioMax,Math.max(S.ratioMin,o.ratio)),S.exp);if(o.v==='gold')v*=S.gold;else if(o.v==='albino')v*=S.albino;return Math.round(Math.min(S.max[sp.r],Math.max(S.min[sp.r],v)))}
 function tSell(B){const S=Object.assign({},ST.D.sell,ST.W.sell||{}),sb=ST.cfg.stageBonus??.5;
  const rows=Object.entries(ST.cfg.species).sort((a,b)=>a[1].r-b[1].r||a[1].price-b[1].price);
  B.innerHTML=`<section class="card"><h3>💰 現場賣魚公式</h3><p class="hint">賣價 = 基礎價 × S × clamp(尺寸比, 下限, 上限)<sup>指數</sup> × 變種倍率 → 夾在稀有度的最低／最高價之間 → 再乘服裝／釣手金幣加成。基礎價 = 魚種 sellPrice，沒有就用 price × 基礎價比例。</p>
   <div class="fgrid">${fld('sell'+SEP+'mult','S（一般魚）',{t:'num',min:.1,max:10})}${fld('sell'+SEP+'petMult','S（特殊寵物）',{t:'num',min:.1,max:10})}${fld('sell'+SEP+'gold','✨ 黃金倍率',{t:'num',min:1,max:20})}${fld('sell'+SEP+'albino','🤍 白化倍率',{t:'num',min:1,max:20})}
   ${fld('sell'+SEP+'ratioMin','尺寸比下限',{t:'num',min:.1,max:1})}${fld('sell'+SEP+'ratioMax','尺寸比上限',{t:'num',min:1,max:5})}${fld('sell'+SEP+'exp','尺寸指數',{t:'num',min:0,max:4})}${fld('sell'+SEP+'basePriceRate','基礎價比例（price ×）',{t:'num',min:.05,max:2})}${fld('sellMult','整體賣魚倍率',{t:'num',min:0,max:10})}</div>
   <h3>稀有度價格範圍</h3>${tbl([['稀有度',r=>rar(r)],['最低價 🪙',r=>fld('sell'+SEP+'min'+SEP+r,'',{bare:1,min:0,max:1e6})],['最高價 🪙',r=>fld('sell'+SEP+'max'+SEP+r,'',{bare:1,min:0,max:1e6})],['魚缸／收藏庫轉賣上限（幼／亞成／成年）',r=>[0,1,2].map(st=>N(Math.floor(S.max[r]*(1+st*sb)/(1+sb)))).join(' ／ ')]],[0,1,2,3])}
   <div class="switch" style="margin-top:10px"><div><b>釣到的魚放進魚缸後，轉賣也套用上限</b><small>只影響釣魚來的魚（帶「🎣 釣到」標記），商店買的魚不受影響；避免釣到高價魚放缸再賣的套利</small></div><div class="tg ${eff('sell'+SEP+'tankCap')!==false?'on':''}" data-tg="sell${SEP}tankCap"></div></div></section>
   <section class="card"><h3>試算（依目前畫面上的數值）</h3><div class="filters"><label>尺寸比<input data-prev="ratio" value="${ST.pr||1}" style="width:80px"></label><span class="muted">1 = 平均尺寸；最大約 1.7</span></div>
   <div style="max-height:520px;overflow:auto">${tbl([['魚種',r=>h(r[1].name)+(r[1].pet?' <span class="chip" style="color:#ff7eb6">寵物</span>':'')],['稀有度',r=>rar(r[1].r)],['基礎價',r=>N(r[1].sellPrice>0?r[1].sellPrice:r[1].price*S.basePriceRate),'num'],['一般',r=>N(sellOf(S,r[1],{ratio:+ST.pr||1})),'num'],['✨黃金',r=>N(sellOf(S,r[1],{ratio:+ST.pr||1,v:'gold'})),'num'],['🤍白化',r=>N(sellOf(S,r[1],{ratio:+ST.pr||1,v:'albino'})),'num'],['最大尺寸',r=>N(sellOf(S,r[1],{ratio:9})),'num']],rows)}</div></section>`}
 // ---------------- 🛒 商店價格 ----------------
 function tShop(B){const c=ST.cfg.catalog,cur=x=>x==='gem'?'💎':x==='coin'?'🪙':'';
  const slot=(k)=>{const items=Object.entries(c.gear[k]).filter(([,g])=>g.cur!=='free');if(!items.length)return'';
   return`<h3>${h(c.slotNames[k]||k)}</h3>${tbl([['道具',r=>h(r[1].name)+(r[1].legacy?' <span class="muted">（舊）</span>':'')+(r[1].ex?` <span class="chip" style="color:#ff7eb6">活動餌：${h(r[1].ex.name||'')}</span>`:'')],['幣別',r=>cur(r[1].cur)],['價格',r=>fld('prices'+SEP+k+'.'+r[0],'',{bare:1,min:0,max:1e7})],...(k==='bait'?[['每包次數',r=>r[1].pack?fld('packs'+SEP+'bait.'+r[0],'',{bare:1,min:1,max:100}):'—']]:[]),...(k==='box'?[['每日次數',r=>N(eff('boxCasts'+SEP+r[0]))]]:[])],items)}`};
  B.innerHTML=`<section class="card"><h3>價格倍率</h3><div class="fgrid">${fld('priceMult'+SEP+'coin','🪙 金幣道具倍率',{t:'num',min:0,max:10})}${fld('priceMult'+SEP+'gem','💎 鑽石道具倍率',{t:'num',min:0,max:10})}</div><p class="hint">個別價格有填的會優先於倍率。</p></section>
   <section class="card">${Object.keys(c.gear).map(slot).join('')}</section>
   <section class="card"><h3>🧑‍🎣 釣手</h3>${tbl([['釣手',r=>h(r[1].name)],['幣別',r=>cur(r[1].cur)],['價格',r=>fld('prices'+SEP+'char.'+r[0],'',{bare:1,min:0,max:1e7})]],Object.entries(c.chars).filter(([,x])=>!['free','unlock'].includes(x.cur)))}</section>`}
 // ---------------- 🎲 機率 ----------------
 function tProb(B){const c=ST.cfg.catalog,exb=Object.entries(c.gear.bait).filter(([,g])=>g.ex);
  const wsum=id=>{const w=eff('spots'+SEP+id+SEP+'w')||[0,0,0,0];return w};
  B.innerHTML=`<section class="card"><h3>變種與特殊出現機率（每竿）</h3><div class="fgrid">${fld('albinoPct','🤍 白化',{t:'num',min:0,max:50,unit:'%'})}${fld('goldPct','✨ 黃金',{t:'num',min:0,max:50,unit:'%'})}${fld('giantPct','巨大個體',{t:'num',min:0,max:50,unit:'%'})}${fld('treasurePct','寶箱',{t:'num',min:0,max:50,unit:'%'})}${fld('bottlePct','漂流瓶',{t:'num',min:0,max:50,unit:'%'})}${fld('chestGemChance','寶箱開出 💎 的機率',{t:'pct',min:0,max:100})}</div>
   <h3>寶箱／漂流瓶內容</h3>${tbl([['項目',r=>r[1]],['最少',r=>fld(r[0]+SEP+'0','',{bare:1,min:0})],['最多',r=>fld(r[0]+SEP+'1','',{bare:1,min:0})]],[['chestGems','寶箱 💎'],['chestCoins','寶箱 🪙'],['bottleCoins','漂流瓶 🪙']])}</section>
   <section class="card"><h3>🌙 活動餌</h3><div class="fgrid">${fld('pityN','保底竿數（連續 N 竿沒遇到 → 第 N 竿必中）',{min:10,max:1000,unit:'竿'})}</div>
   ${tbl([['活動餌',r=>h(r[1].name)],['專屬魚',r=>h(r[1].ex.name||r[1].ex.sp)],['每竿出現專屬魚機率 (%)',r=>fld('exRate'+SEP+r[0],'',{bare:1,t:'pct',min:0,max:100})]],exb)}</section>
   <section class="card"><h3>各釣點稀有度權重</h3><p class="hint">數字是相對權重（不用加總到 100），右邊是換算後的機率。</p>${tbl([['釣點',r=>h(r[1].name)],...[0,1,2,3].map(i=>[RN[i],r=>fld('spots'+SEP+r[0]+SEP+'w'+SEP+i,'',{bare:1,t:'num',min:0,max:1000}).replace('<input','<input class="w60"').replace('class="w60" ','class="w60 ')]),['機率',r=>{const w=wsum(r[0]),s=w.reduce((a,b)=>a+b,0)||1;return w.map((x,i)=>`<span style="color:${RC[i]}">${(x/s*100).toFixed(1)}%</span>`).join(' ／ ')}]],Object.entries(c.spots))}</section>`}
 // ---------------- 📋 每日任務 ----------------
 function tMis(B){const list=ST.W.missions||ST.D.missions,custom=!!ST.W.missions,K=ST.cfg.catalog.kinds;
  B.innerHTML=`<section class="card">${tg('missionsEnabled','📋 每日釣魚任務開關','顯示在主遊戲「每日任務」裡；進度由伺服器依當天拋竿／漁獲計算')}
   <h3>任務清單（最多 6 個）${custom?'':' <span class="muted" style="font-weight:500">— 目前使用預設</span>'}</h3>
   <table><tr><th>代號</th><th>圖示</th><th>名稱</th><th>條件</th><th>次數</th><th>🪙 金幣</th><th>💎</th><th></th></tr>${list.map((m,i)=>`<tr>
   <td><input data-mis="${i}" data-f="id" value="${h(m.id)}" style="width:90px" ${custom?'':'disabled'}></td><td><input data-mis="${i}" data-f="icon" value="${h(m.icon||'')}" style="width:46px" ${custom?'':'disabled'}></td><td><input data-mis="${i}" data-f="name" value="${h(m.name)}" style="width:150px" maxlength="30" ${custom?'':'disabled'}></td>
   <td><select data-mis="${i}" data-f="kind" ${custom?'':'disabled'}>${Object.entries(K).map(([k,n])=>`<option value="${k}" ${m.kind===k?'selected':''}>${h(n)}</option>`).join('')}</select></td>
   <td><input data-mis="${i}" data-f="n" value="${m.n}" class="w60" ${custom?'':'disabled'}></td><td><input data-mis="${i}" data-f="coins" value="${m.coins||0}" style="width:80px" ${custom?'':'disabled'}></td><td><input data-mis="${i}" data-f="gems" value="${m.gems||0}" class="w60" ${custom?'':'disabled'}></td>
   <td>${custom?`<button class="btn small ghost" data-misup="${i}" ${i?'':'disabled'}>↑</button><button class="btn small danger" data-misdel="${i}">刪除</button>`:''}</td></tr>`).join('')}</table>
   <div style="display:flex;gap:8px;margin-top:10px">${custom?`<button class="btn" data-act="misadd" ${list.length>=6?'disabled':''}>＋ 新增任務</button><button class="btn ghost" data-act="misdef">恢復預設</button>`:`<button class="btn primary" data-act="miscustom">✏️ 自訂任務</button>`}</div>
   <p class="hint">限制：次數 1～50、金幣 0～5000、💎 0～50。改完記得按下方「發布」。</p></section>`}
 // ---------------- 🏆 大賽 ----------------
 const rwTxt=rw=>(rw||[]).map(r=>`${r.from===r.to?`第 ${r.from} 名`:`第 ${r.from}～${r.to} 名`}：${r.gems?'💎'+N(r.gems):''}${r.gems&&r.coins?' + ':''}${r.coins?'🪙'+N(r.coins):''}`).join('<br>');
 const rwEditor=(name,rw)=>`<div data-rw="${name}">${rw.map(r=>rwRow(r)).join('')}</div><button type="button" class="btn small" data-rwadd="${name}">＋ 加一列</button>`;
 const rwRow=r=>`<div class="rwr" style="display:flex;gap:6px;align-items:center;margin:4px 0">第 <input class="w60" data-r="from" value="${r.from}"> ～ <input class="w60" data-r="to" value="${r.to}"> 名　💎 <input class="w60" data-r="gems" value="${r.gems||0}">　🪙 <input style="width:90px" data-r="coins" value="${r.coins||0}"> <button type="button" class="btn small ghost" data-rwdel>✕</button></div>`;
 const readRw=el=>[...el.querySelectorAll('.rwr')].map(x=>{const g=k=>Number(x.querySelector(`[data-r=${k}]`).value)||0;return{from:g('from'),to:g('to'),gems:g('gems'),coins:g('coins')}});
 const SPN=()=>Object.fromEntries(Object.entries(ST.cfg.catalog.spots).map(([k,v])=>[k,v.name]));
 async function tTour(B){const t=await A.get('/fishing/tournaments'),def=ST.W.tourRewards||ST.D.tourRewards,now=Date.now(),sn=SPN();
  const st=r=>r.status==='settled'?'<span class="muted">已結算</span>':r.status==='cancelled'?'<span class="off">已取消</span>':r.start_at>now?'排程中':r.end_at>now?'<span class="on">進行中</span>':'<b style="color:var(--g)">已結束・待結算</b>';
  B.innerHTML=`<section class="card"><h3>🏆 大賽列表</h3>${tbl([['#',r=>r.id],['名稱',r=>h(r.name)],['釣點',r=>h(sn[r.spot]||'全部')],['時間',r=>A.fmtTime(r.start_at)+'<br>～ '+A.fmtTime(r.end_at)],['獎勵',r=>rwTxt(JSON.parse(r.rewards||'[]'))],['參賽',r=>r.entries,'num'],['狀態',st],['',r=>`<button class="btn small" data-tv="${r.id}">排名</button> `+(r.status==='scheduled'?`<button class="btn small" data-te="${r.id}">編輯</button> ${r.start_at<=now&&r.end_at>now?`<button class="btn small" data-tend="${r.id}">提早結束</button> `:''}${r.end_at<=now?`<button class="btn small primary" data-tsettle="${r.id}">結算發獎</button> `:''}<button class="btn small danger" data-tcancel="${r.id}">取消</button>`:'')]],t.rows,'還沒有大賽')}</section>
   <section class="card"><h3>＋ 建立大賽</h3><form data-tform style="display:grid;gap:8px;max-width:620px"><label class="f">名稱<input name="name" maxlength="30" placeholder="例如：週末巨物賽" required></label>
   <div style="display:flex;gap:8px;flex-wrap:wrap"><label class="f">開始<input type="datetime-local" name="start" required></label><label class="f">結束<input type="datetime-local" name="end" required></label><label class="f">釣點<select name="spot"><option value="">全部釣點</option>${Object.entries(sn).map(([k,v])=>`<option value="${k}">${h(v)}</option>`).join('')}</select></label></div>
   <div><b>獎勵</b>（預設：第 1 名 💎300、第 2～3 名 💎120、第 4～10 名 🪙5000）${rwEditor('new',def)}</div><div><button class="btn primary">建立大賽</button></div></form></section>
   <section class="card"><h3>預設獎勵（建立大賽時自動帶入）</h3>${rwEditor('def',def)}<div style="margin-top:8px"><button class="btn" data-act="rwdef">套用為預設（之後按下方「發布」）</button></div></section>`}
 // ---------------- 🔍 玩家 ----------------
 async function tPlayer(B){B.innerHTML=`<section class="card"><div class="filters"><label>玩家 ID 或暱稱<input data-pq value="${h(ST.pq)}" placeholder="例如 1234 或 小魚" style="width:240px"></label><button class="btn primary" data-act="search">搜尋</button></div><div data-pres></div></section><div data-pdet></div>`;
  if(ST.pq)await doSearch(true);if(ST.pid)await openPlayer(ST.pid)}
 async function doSearch(quiet){const inp=q('[data-pq]');if(inp)ST.pq=inp.value.trim();const el=q('[data-pres]');if(!el)return;if(!ST.pq){el.innerHTML='';return}
  try{const r=await A.get('/fishing/players?q='+encodeURIComponent(ST.pq));el.innerHTML=tbl([['玩家',r=>`${h(r.name)} <span class="muted">#${r.id}</span>`],['暱稱',r=>h(r.nickname||'')],['釣魚',r=>r.fishing?'<span class="on">有</span>':'<span class="muted">沒玩過</span>'],['總拋竿',r=>N(r.casts),'num'],['',r=>`<button class="btn small primary" data-openp="${r.id}">查看紀錄</button>`]],r.rows,'找不到玩家');
   if(r.rows.length===1&&!quiet)openPlayer(r.rows[0].id)}catch(e){A.errToast(e)}}
 async function openPlayer(pid){ST.pid=pid;if(ST.tab!=='player'){ST.tab='player';renderTab();return}const el=q('[data-pdet]');if(!el)return;el.innerHTML='<div class="loading">載入中…</div>';
  const [d,s]=await Promise.all([A.get('/fishing/players/'+pid),A.get('/fishing/players/'+pid+'/summary')]);ST.pd=d;const sn=SPN(),pr=d.profile;
  el.innerHTML=`<section class="card"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:center"><h3 style="margin:0">🎣 ${h(d.player.name)} <span class="muted">#${d.player.id}</span> ${d.hasProfile?`<span class="chip" style="color:var(--g)">Lv.${pr.lv}</span>`:'<span class="muted">（還沒玩過釣魚）</span>'}</h3>
   <div><a class="btn small ghost" href="#player/${d.player.id}">主遊戲玩家頁 →</a> <button class="btn small primary" data-act="grant">🎁 補發道具</button></div></div>
   <div class="kpis"><div class="kpi"><small>總拋竿</small><b>${N(s.casts.n)}</b><em>釣到 ${N(s.casts.caught)}・脫鉤 ${N(s.casts.lost)}</em></div><div class="kpi"><small>釣到魚</small><b>${N(s.fish.n)}</b><em>變種 ${N(s.fish.var)}・${N(s.fish.kg)}kg</em></div>
   <div class="kpi"><small>🪙 賺到／花掉</small><b>${N(s.coinsEarned)}</b><em>／${N(s.coinsSpent)}</em></div><div class="kpi"><small>💎 花掉／拿到</small><b>${N(s.gemsSpent)}</b><em>／${N(s.gemsEarned)}</em></div>
   <div class="kpi"><small>重置</small><b>${N(s.resets.n)}</b><em>💎${N(s.resets.g)}</em></div><div class="kpi"><small>最稀有漁獲</small><b style="font-size:15px">${s.rarest?h(s.rarest.name)+' '+rar(s.rarest.rarity)+(s.rarest.variant?VAR[s.rarest.variant]:''):'—'}</b><em>${s.rarest?s.rarest.cm+'cm／'+s.rarest.kg+'kg':''}</em></div>
   <div class="kpi"><small>今日次數</small><b>${d.today.used}</b><em>／${d.maxCasts+d.today.extra}</em></div><div class="kpi"><small>後台補發</small><b>${N(s.grants)}</b><em>筆</em></div></div>
   <div class="row2"><div><h3>🌙 活動餌保底進度</h3>${s.pity.map(x=>`<div style="margin:6px 0"><b>${h(x.name)}</b> <span class="muted">→ ${h(x.fish||'')}・剩 ${x.left} 次</span><span style="float:right">${x.n}／${x.of}</span><div class="pity"><i style="width:${Math.min(100,x.n/x.of*100)}%"></i></div></div>`).join('')}</div>
   <div><h3>🧺 魚簍（未結算 ${d.basket.length} 條）${d.basket.length?` <button class="btn small danger" data-act="clearbasket">清除卡住的魚簍</button>`:''}</h3>${tbl([['魚',r=>h(r.name||r.sp)+' '+rar(r.r)+(r.variant?VAR[r.variant]:'')],['尺寸',r=>r.cm+'cm'],['釣點',r=>h(sn[r.spot]||r.spot)],['時間',r=>A.fmtTime(r.t)]],d.basket,'魚簍是空的')}
   <h3>裝備</h3><div class="muted" style="font-size:13px">${Object.entries(pr.eq||{}).map(([k,v])=>`${h(ST.cfg.catalog.slotNames[k]||k)}：${h((ST.cfg.catalog.gear[k]||{})[v]?.name||v)}`).join('・')}<br>魚餌庫存：${Object.entries(pr.baits||{}).filter(([,n])=>n>0).map(([k,n])=>`${h(ST.cfg.catalog.gear.bait[k]?.name||k)}×${n}`).join('、')||'無'}</div></div></div></section>
   <section class="card"><h3>📜 完整紀錄</h3><div class="sub2">${[['casts','🎣 拋竿與漁獲'],['resets','💎 重置購買'],['buys','🛒 商店購買'],['missions','📋 任務領獎'],['grants','🎁 後台補發']].map(([k,n])=>`<button data-rt="${k}" class="${ST.rec.type===k?'on':''}">${n}</button>`).join('')}</div>
   <div class="filters"><label>從<input type="date" data-rf="from" value="${h(ST.rec.from||'')}"></label><label>到<input type="date" data-rf="to" value="${h(ST.rec.to||'')}"></label>
   ${ST.rec.type==='casts'?`<label>釣點<select data-rf="spot"><option value="">全部</option>${Object.entries(sn).map(([k,v])=>`<option value="${k}" ${ST.rec.spot===k?'selected':''}>${h(v)}</option>`).join('')}</select></label><label>稀有度<select data-rf="rarity"><option value="">全部</option>${RN.map((n,i)=>`<option value="${i}" ${String(ST.rec.rarity)===String(i)?'selected':''}>${n}</option>`).join('')}</select></label><label>變種<select data-rf="variant"><option value="">全部</option><option value="any" ${ST.rec.variant==='any'?'selected':''}>任何變種</option><option value="gold" ${ST.rec.variant==='gold'?'selected':''}>✨黃金</option><option value="albino" ${ST.rec.variant==='albino'?'selected':''}>🤍白化</option></select></label><label>結果<select data-rf="status"><option value="">全部</option>${Object.entries({caught:'釣到',lost:'脫鉤',expired:'逾時',rejected:'過快被拒'}).map(([k,v])=>`<option value="${k}" ${ST.rec.status===k?'selected':''}>${v}</option>`).join('')}</select></label>`:''}
   <button class="btn small ghost" data-act="rfclear">清除篩選</button></div><div data-rec><div class="loading">載入中…</div></div></section>`;
  loadRec()}
 async function tRecords(B){ST.rec.type='casts';const R=ST.rec;B.innerHTML=`<h3>🎣 全站釣魚紀錄</h3><p class="hint">列出所有玩家的每次拋竿、魚獲及去處；日期依台灣時間，可逐頁查看全部歷史。</p><div class="filters"><label>玩家 ID<input type="number" min="1" data-rf="playerId" value="${h(R.playerId||'')}" placeholder="全部玩家"></label><label>從<input type="date" data-rf="from" value="${h(R.from||'')}"></label><label>到<input type="date" data-rf="to" value="${h(R.to||'')}"></label><label>結果<select data-rf="status"><option value="">全部</option>${Object.entries({caught:'釣到',lost:'脫鉤',expired:'逾時',rejected:'過快被拒',pending:'尚未結束'}).map(([v,n])=>`<option value="${v}" ${R.status===v?'selected':''}>${n}</option>`).join('')}</select></label></div><div data-rec></div>`;await loadRec()}
 async function loadRec(){const el=q('[data-rec]');if(!el)return;const R=ST.rec,qs=new URLSearchParams(Object.entries(R).filter(([,v])=>v!==''&&v!=null));
  const d=await A.get(ST.tab==='records'?`/fishing/records?${qs}`:`/fishing/players/${ST.pid}/records?${qs}`),sn=SPN(),G=ST.cfg.catalog.gear,gn=(s,id)=>(G[s]&&G[s][id]&&G[s][id].name)||id||'';
  const cols={casts:[['時間',r=>A.fmtTime(r.t)],['釣點',r=>h(sn[r.spot]||r.spot)],['裝備／餌',r=>`<span class="muted" style="font-size:12px">${r.gear?['rod','reel','line','hook'].map(k=>h(gn(k,r.gear[k]))).join('・'):'（舊紀錄）'}<br></span>🪱 ${h(gn('bait',r.bait))}${r.perfect?' <span class="chip" style="color:var(--g)">完美</span>':''}`],['結果',r=>STATUS[r.status]||h(r.status)],['漁獲',r=>r.kind==='fish'?`${h(r.name||r.sp)} ${rar(r.r)}${r.variant?' '+VAR[r.variant]:''}${r.giant?' <span class="chip">巨大</span>':''}`:r.kind?h(r.name||r.kind):'—'],['尺寸／重量',r=>r.kind==='fish'?`${r.cm}cm／${r.kg}kg`:'','num'],['去處',r=>r.status==='caught'?destTxt(r.dest)+(r.firstDest==='basket'&&r.dest!=='basket_open'?' <span class="muted">（經魚簍）</span>':''):'—'],['🪙／💎',r=>(r.coins?'🪙'+N(r.coins):'')+(r.gems?' 💎'+r.gems:''),'num']],
   resets:[['時間',r=>A.fmtTime(r.t)],['釣點',r=>h(sn[r.spot]||r.spot||'—')],['花費',r=>'💎'+N(r.gems),'num'],['重置為',r=>(r.max||'')+' 次','num']],
   buys:[['時間',r=>A.fmtTime(r.t)],['項目',r=>r.type==='fishing_buy_spot'?'解鎖釣點：'+h(sn[r.spot]||r.spot):r.type==='fishing_buy_char'?'釣手：'+h(r.id):h((ST.cfg.catalog.slotNames[r.slot]||r.slot)+'：'+gn(r.slot,r.id))],['花費',r=>(r.coins?'🪙'+N(r.coins):'')+(r.gems?'💎'+N(r.gems):''),'num']],
   missions:[['時間',r=>A.fmtTime(r.t)],['日期',r=>h(r.day||'')],['任務',r=>h(r.mission||'')],['獎勵',r=>(r.coins?'🪙'+N(r.coins):'')+(r.gems?' 💎'+r.gems:''),'num']],
   grants:[['時間',r=>A.fmtTime(r.t)],['管理員',r=>h(r.admin)],['項目',r=>h(r.label)],['數量',r=>N(r.qty),'num'],['原因',r=>h(r.reason)],['信箱',r=>r.mail_id?'已通知 #'+r.mail_id:'—']]}[d.type];
  if(ST.tab==='records')cols.unshift(['玩家',r=>`<button class="btn small ghost" data-openp="${r.playerId}">${h(r.playerName)} #${r.playerId}</button>`]);
  el.innerHTML=`<div class="muted" style="margin-bottom:4px">共 ${N(d.total)} 筆</div>${tbl(cols,d.rows,'沒有符合的紀錄')}<div class="pager"><button class="btn small" data-pg="${d.page-1}" ${d.page<=1?'disabled':''}>‹ 上一頁</button><span>${d.page}／${d.pages}</span><button class="btn small" data-pg="${d.page+1}" ${d.page>=d.pages?'disabled':''}>下一頁 ›</button></div>`}
 async function grantDlg(){const cat=await A.get('/fishing/grant-catalog'),d=ST.pd;
  const opts=cat.items.map(x=>`<option value="${x.kind}|${x.slot}|${x.id}" data-pack="${x.pack}">${h(x.slotName)}：${h(x.name)}${x.event?'（活動餌）':''}</option>`).join('')+cat.extra.map(x=>`<option value="${x.kind}||">${h(x.name)}</option>`).join('');
  const b=A.openModal(`<h2>🎁 補發道具給 ${h(d.player.name)} #${d.player.id}</h2><div style="display:grid;gap:10px;min-width:min(460px,80vw)"><label class="f">項目<select id="gItem">${opts}</select></label><label class="f"><span id="gQl">數量</span><input id="gQty" value="1" inputmode="numeric"></label>
   <label class="f">原因（必填，會寫進稽核與玩家信件）<input id="gWhy" maxlength="120" placeholder="例如：10/30 伺服器延遲補償"></label><div class="hint" id="gHint"></div>
   <label class="f">確認：請輸入「補發」<input id="gOk" placeholder="補發"></label><div class="errors" id="gErr" style="display:none"></div>
   <div class="btns"><button class="btn primary" id="gGo">確認補發並通知玩家</button><button class="btn ghost" data-close>取消</button></div></div>`);
  const sel=b.querySelector('#gItem'),qty=b.querySelector('#gQty'),hint=b.querySelector('#gHint'),ql=b.querySelector('#gQl');
  const upd=()=>{const [k]=sel.value.split('|');ql.textContent=k==='bait'?'使用次數':k==='gear'?'數量（裝備固定 1）':k==='casts'?'加幾次（今日）':'重置幾次';qty.disabled=k==='gear';if(k==='gear')qty.value=1;else if(k==='bait'&&qty.value==='1')qty.value=sel.selectedOptions[0].dataset.pack||5;
   hint.textContent=k==='gear'?'裝備會直接加進玩家的釣具（不會自動裝上）。':k==='bait'?'魚餌次數直接加到玩家的魚餌庫存。':k==='casts'?'只限今天（台北時間 00:00 重置）。':`等於今天立刻多 N × ${d.maxCasts} 次（目前每日 ${d.maxCasts} 次）。`};sel.onchange=upd;upd();
  b.querySelector('#gGo').onclick=async()=>{const [kind,slot,id]=sel.value.split('|'),err=b.querySelector('#gErr');err.style.display='none';
   try{const r=await A.post(`/fishing/players/${d.player.id}/grant`,{kind,slot:slot||undefined,id:id||undefined,qty:Number(qty.value),reason:b.querySelector('#gWhy').value,confirm:b.querySelector('#gOk').value.trim()});A.closeModal();A.toast(`已補發：${r.label}（已寄信通知）`);ST.rec={type:'grants',page:1};openPlayer(d.player.id)}
   catch(e){err.style.display='block';err.textContent=e.message}}}
 // ---------------- 📜 稽核 ----------------
 const ACT={'fishing.config.save':'發布釣魚設定','fishing.basket.clear':'清除魚簍','fishing.tournament.update':'編輯大賽','fishing.tournament.end':'提早結束大賽','fishing.tournament.create':'建立大賽','fishing.tournament.cancel':'取消大賽','fishing.tournament.settle':'大賽結算','fishing.grant':'補發道具','config.save':'發布遊戲參數'};
 async function tAudit(B){const r=await A.get('/fishing/audit');
  const sum=x=>{const d=x.detail||{};if(x.action==='fishing.config.save')return (d.keys||[]).map(k=>h(KN[k]||k)).join('、')+(d.note?`<br><span class="muted">${h(d.note)}</span>`:'');if(x.action==='fishing.grant')return `${h(d.kind)} ${h(d.item)} ×${d.qty}　<span class="muted">原因：${h(d.reason)}</span>`;if(x.action==='fishing.basket.clear')return `清掉 ${d.cleared} 條　<span class="muted">原因：${h(d.reason)}</span>`;return `<span class="muted">${h(JSON.stringify(d).slice(0,160))}</span>`};
  B.innerHTML=`<section class="card"><h3>📜 釣魚相關後台操作</h3>${tbl([['時間',x=>A.fmtTime(x.at)],['動作',x=>h(ACT[x.action]||x.action)],['對象',x=>h(x.target||'')],['內容',sum],['',x=>`<button class="btn small ghost" data-aud="${x.id}">明細</button>`]],r.rows,'還沒有紀錄')}</section>`;ST.aud=r.rows}
 // ---------------- 事件 ----------------
 async function onClick(e){const t=e.target.closest('button,[data-tg],[data-openp],a[data-openp]');if(!t||!ST.main.contains(t))return;const ds=t.dataset;
  try{
   if(ds.tab){if(ds.tab==='records')ST.rec={type:'casts',page:1};ST.tab=ds.tab;renderTab();return}
   if(ds.tg){const nv=!(eff(ds.tg)===true);
     if(ds.tg==='enabled'&&!nv&&!await A.confirmDlg('關閉釣魚模式','發布後所有玩家都不能釣魚（資料保留）。確定要關閉？','關閉',true))return;
     sp(ST.W,ds.tg,nv===gp(ST.D,ds.tg)&&gp(ST.orig,ds.tg)===undefined?undefined:nv);renderTab();renderSave();return}
   if(ds.openp){e.preventDefault();ST.rec={type:'casts',page:1};openPlayer(+ds.openp);return}
   if(ds.rt){ST.rec={type:ds.rt,page:1,from:ST.rec.from,to:ST.rec.to};openPlayer(ST.pid);return}
   if(ds.pg){ST.rec.page=+ds.pg;loadRec();return}
   if(ds.aud){const x=ST.aud.find(a=>a.id==ds.aud);A.openModal(`<h3>${h(ACT[x.action]||x.action)}</h3><pre style="white-space:pre-wrap;max-height:60vh;overflow:auto;font-size:12px">${h(JSON.stringify(x.detail,null,2))}</pre>`);return}
   if(ds.misdel!=null){ST.W.missions.splice(+ds.misdel,1);tMis(q('[data-body]'));renderSave();return}
   if(ds.misup!=null){const i=+ds.misup,m=ST.W.missions;[m[i-1],m[i]]=[m[i],m[i-1]];tMis(q('[data-body]'));renderSave();return}
   if(ds.rwadd){const el=q(`[data-rw="${ds.rwadd}"]`),rw=readRw(el),l=rw[rw.length-1]||{to:0};el.insertAdjacentHTML('beforeend',rwRow({from:l.to+1,to:l.to+1,gems:0,coins:0}));return}
   if('rwdel' in ds){t.closest('.rwr').remove();return}
   if(ds.tv){const d=await A.get('/fishing/tournaments/'+ds.tv);A.openModal(`<h3>${h(d.name)}</h3>`+tbl([['名次',r=>r.rank],['玩家',r=>h(r.name)],['積分',r=>N(r.score),'num'],['條數',r=>r.n,'num']],d.top||[],'還沒有人參賽'));return}
   if(ds.te)return editTour(+ds.te);
   if(ds.tend){if(!await A.confirmDlg('提早結束大賽','結束時間會改成現在，之後可按「結算發獎」。確定？','提早結束',true))return;await A.post('/fishing/tournaments/'+ds.tend+'/end',{});A.toast('已結束');tTour(q('[data-body]'));return}
   if(ds.tsettle){if(!await A.confirmDlg('結算發獎','會依名次把 💎／🪙 發到玩家帳號（重複按不會重發）。確定？','結算發獎'))return;const r=await A.post('/fishing/tournaments/'+ds.tsettle+'/settle',{});A.toast(`已發獎 ${r.paid} 人：💎${N(r.gems)}、🪙${N(r.coins)}`);tTour(q('[data-body]'));return}
   if(ds.tcancel){if(!await A.confirmDlg('取消大賽','取消後不會發獎。確定？','取消大賽',true))return;await A.post('/fishing/tournaments/'+ds.tcancel+'/cancel',{});A.toast('已取消');tTour(q('[data-body]'));return}
   const act=ds.act;if(!act)return;
   if(act==='search')return doSearch();
   if(act==='rfclear'){ST.rec={type:ST.rec.type,page:1};openPlayer(ST.pid);return}
   if(act==='grant')return grantDlg();
   if(act==='clearbasket'){const why=await A.promptDlg('清除卡住的魚簍',`會把 ${ST.pd.basket.length} 條未結算的魚標記為「後台清除」（不發金幣、不放進魚缸），玩家就能重新使用魚簍。請輸入原因：`,'','下一步',true);if(!why)return;
     if(!await A.confirmDlg('再確認一次',`確定清除 #${ST.pid} 的魚簍？原因：${why}`,'清除',true))return;const r=await A.post(`/fishing/players/${ST.pid}/basket/clear`,{confirm:'清除',reason:why});A.toast(`已清除 ${r.cleared} 條`);openPlayer(ST.pid);return}
   if(act==='miscustom'){ST.W.missions=clone(ST.D.missions);tMis(q('[data-body]'));renderSave();return}
   if(act==='misdef'){delete ST.W.missions;tMis(q('[data-body]'));renderSave();return}
   if(act==='misadd'){ST.W.missions.push({id:'m'+(ST.W.missions.length+1)+Date.now().toString(36).slice(-3),icon:'🎣',name:'新任務',kind:'cast',n:1,coins:100,gems:0});tMis(q('[data-body]'));renderSave();return}
   if(act==='rwdef'){ST.W.tourRewards=readRw(q('[data-rw="def"]'));renderSave();A.toast('已放進待發布的修改');return}
   if(act==='discard'){if(!await A.confirmDlg('放棄修改','還沒發布的修改會全部還原。確定？','放棄',true))return;ST.W=clone(ST.orig);renderTab();renderSave();return}
   if(act==='check'){const r=await A.post('/fishing/config/validate',{fishing:ST.W});q('[data-errs]').innerHTML=r.errors.length?A.errList(r.errors):'<div class="alert ok">✅ 檢查通過，可以發布</div>';return}
   if(act==='publish'){const ks=dirtyKeys(),note=(q('[data-note]')||{}).value||'';const v=await A.post('/fishing/config/validate',{fishing:ST.W});if(v.errors.length){q('[data-errs]').innerHTML=A.errList(v.errors);return}
     if(!await A.confirmDlg('發布釣魚設定',`會建立新的設定版本並立即生效：${ks.map(k=>KN[k]||k).join('、')}。確定發布？`,'發布'))return;
     try{const r=await A.put('/fishing/config',{fishing:ST.W,note,baseVersion:ST.cfg.version});A.toast(`已發布 v${r.version}`);ST.orig=clone(ST.W);A.setLeaveGuard&&A.setLeaveGuard(()=>false);window.Views.fishing(ST.main,[ST.tab])}
     catch(err){if(err.data&&err.data.errors)q('[data-errs]').innerHTML=A.errList(err.data.errors);A.errToast(err)}return}
  }catch(err){A.errToast(err)}}
 function onChange(e){const el=e.target;
  if(el.matches('[data-k]')){const r=parseIn(el);if(r.err){el.classList.add('bad');A.toast('數值格式或範圍不正確',true);return}el.classList.remove('bad');setField(el.dataset.k,r);el.classList.toggle('ovr',gp(ST.W,el.dataset.k)!==undefined||/\|\d+$/.test(el.dataset.k)&&gp(ST.W,el.dataset.k.replace(/\|\d+$/,''))!==undefined);renderSave();
   if(ST.tab==='sell'||ST.tab==='prob'){const y=scrollY;(ST.tab==='sell'?tSell:tProb)(q('[data-body]'));scrollTo(0,y)}return}
  if(el.matches('[data-mis]')){const m=ST.W.missions[+el.dataset.mis],f=el.dataset.f;m[f]=['n','coins','gems'].includes(f)?Number(el.value)||0:el.value.trim();if(f==='icon'&&!m.icon)delete m.icon;renderSave();return}
  if(el.matches('[data-day]')){ST.day=el.value;renderTab();return}
  if(el.matches('[data-rf]')){ST.rec[el.dataset.rf]=el.value;ST.rec.page=1;loadRec().catch(A.errToast);return}
  if(el.matches('[data-prev]')){ST.pr=el.value;const y=scrollY;tSell(q('[data-body]'));scrollTo(0,y)}}
 function onInput(e){const el=e.target;if(el.matches('[data-k]')){const r=parseIn(el);el.classList.toggle('bad',!!r.err)}}
 async function editTour(id){const rows=(await A.get('/fishing/tournaments')).rows,T=rows.find(r=>r.id===id),started=T.start_at<=Date.now(),sn=SPN();
  const b=A.openModal(`<h2>編輯大賽 #${id}</h2><div style="display:grid;gap:8px;min-width:min(560px,85vw)"><label class="f">名稱<input id="tN" value="${h(T.name)}" maxlength="30"></label>
   <div style="display:flex;gap:8px;flex-wrap:wrap"><label class="f">開始<input type="datetime-local" id="tS" value="${A.toLocalInput(T.start_at)}" ${started?'disabled':''}></label><label class="f">結束<input type="datetime-local" id="tE" value="${A.toLocalInput(T.end_at)}"></label><label class="f">釣點<select id="tP" ${started?'disabled':''}><option value="">全部釣點</option>${Object.entries(sn).map(([k,v])=>`<option value="${k}" ${T.spot===k?'selected':''}>${h(v)}</option>`).join('')}</select></label></div>
   ${started?'<div class="hint">大賽已開始：不能改開始時間與釣點。</div>':''}<div><b>獎勵</b>${rwEditor('edit',JSON.parse(T.rewards||'[]'))}</div><div class="errors" id="tErr" style="display:none"></div>
   <div class="btns"><button class="btn primary" id="tGo">儲存</button><button class="btn ghost" data-close>取消</button></div></div>`);
  b.onclick=e=>{const x=e.target;if(x.dataset.rwadd){const el=b.querySelector('[data-rw="edit"]'),rw=readRw(el),l=rw[rw.length-1]||{to:0};el.insertAdjacentHTML('beforeend',rwRow({from:l.to+1,to:l.to+1}))}else if('rwdel' in x.dataset)x.closest('.rwr').remove()};
  b.querySelector('#tGo').onclick=async()=>{const body={name:b.querySelector('#tN').value,endAt:A.fromLocalInput(b.querySelector('#tE').value),rewards:readRw(b.querySelector('[data-rw="edit"]'))};if(!started){body.startAt=A.fromLocalInput(b.querySelector('#tS').value);body.spot=b.querySelector('#tP').value||null}
   try{await A.put('/fishing/tournaments/'+id,body);A.closeModal();A.toast('已儲存');tTour(q('[data-body]'))}catch(e){const er=b.querySelector('#tErr');er.style.display='block';er.textContent=e.message}}}
 // 建立大賽
 document.addEventListener('submit',async e=>{const f=e.target.closest&&e.target.closest('[data-tform]');if(!f)return;e.preventDefault();const fd=new FormData(f);
  try{await A.post('/fishing/tournaments',{name:fd.get('name'),startAt:A.fromLocalInput(fd.get('start')),endAt:A.fromLocalInput(fd.get('end')),spot:fd.get('spot')||null,rewards:readRw(f.querySelector('[data-rw="new"]'))});A.toast('已建立大賽');tTour(q('[data-body]'))}catch(err){A.errToast(err)}});
})();
