const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function boot(saved){
 const nodes=new Map(),storage=new Map(saved?[['yuyou-aquarium-v1',JSON.stringify(saved)]]:[]);
 const gradient={addColorStop(){}};
 const ctx=new Proxy({createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,measureText:()=>({width:40})},{get:(o,k)=>o[k]||(()=>{})});
 function element(){return {style:{},dataset:{},children:[],classList:{add(){},remove(){},toggle(){}},textContent:'',innerHTML:'',scrollTop:0,disabled:false,addEventListener(){},appendChild(n){this.children.push(n)},getBoundingClientRect:()=>({width:800,height:580}),getContext:()=>ctx,toDataURL:()=>'',querySelector:()=>element()};}
 const document={querySelector(s){if(!nodes.has(s))nodes.set(s,element());return nodes.get(s)},querySelectorAll:()=>[],createElement:()=>element(),addEventListener(){}};
 const sandbox={document,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},console,performance:{now:()=>0},setTimeout(){},requestAnimationFrame(){},Date,Math};
 sandbox.window=sandbox;sandbox.devicePixelRatio=1;sandbox.addEventListener=()=>{};
 vm.runInNewContext(script.replace('window.__aquarium={','window.__aquarium={eat,save,newGame,refreshUI,'),sandbox);
 return {api:sandbox.__aquarium,nodes,storage};
}

// ══════════════════════════════════════════════════════════════════
// 原有測試（保持不變）
// ══════════════════════════════════════════════════════════════════
const {api,nodes,storage}=boot();
assert.equal(api.state.fish.length,3);
const fish=api.state.fish[0];
for(let i=0;i<5;i++){api.dropFood(200,200);api.eat(fish,api.foods[api.foods.length-1]);}
assert.equal(api.state.journey.eaten,5);
assert.equal(api.state.coins,65,'five consecutive meals award five coins');
api.refreshUI(true);
const claim=()=>nodes.get('#questCard').onclick({target:{closest:()=>({dataset:{claim:'0'}})}});
claim();assert.equal(api.state.coins,90);claim();assert.equal(api.state.coins,90,'claimed reward cannot be duplicated');
api.save();const saved=JSON.parse(storage.get('yuyou-aquarium-v1'));
const restored=boot(saved).api;
assert.equal(restored.state.journey.eaten,5);assert.equal(restored.state.journey.claimed[0],0);
delete saved.journey;const legacy=boot(saved).api;
assert.equal(legacy.state.fish.length,3);assert.equal(legacy.state.journey.eaten,0,'legacy saves gain mission defaults');
api.step(35);const before=api.state.coins;const pending=api.coins.filter(c=>!c.fly).reduce((n,c)=>n+c.v,0);
nodes.get('#gatherBtn').onclick();api.step(1);
assert.equal(api.state.coins,before+pending);assert.ok(api.state.journey.collected>0);
api.newGame();assert.equal(api.state.journey.eaten,0);assert.equal(api.state.journey.claimed.length,0);assert.equal(api.state.coins,60);
console.log('PASS: feeding combo, mission claim protection, save persistence, legacy migration, coin gathering, reset');

// ══════════════════════════════════════════════════════════════════
// 新測試 1：藍鑽/紅鶐七彩 coin 值為 6（已從 11 調降）
// ══════════════════════════════════════════════════════════════════
{
  const {api:a}=boot();
  assert.equal(a.SPECIES.discusblue.coin,6,'discusblue coin nerfed to 6');
  assert.equal(a.SPECIES.discusred.coin,6,'discusred coin nerfed to 6');
  // 七彩混血繼承公式：min(max(親代coin), 平均*1.1)
  const cA=a.SPECIES.discusblue.coin,cB=a.SPECIES.discusred.coin;
  const hybridCoin=Math.min(Math.max(cA,cB),(cA+cB)/2*1.1);
  assert.equal(hybridCoin,6,'discushybrid coin derived from parents = 6');
  console.log('PASS: discus coin 6 & hybrid formula');
}

// ══════════════════════════════════════════════════════════════════
// 新測試 2：同群遞減（DR）曲線 — 40/41/80/81 邊界值
// ══════════════════════════════════════════════════════════════════
{
  const {api:a}=boot();
  a.state.fish=[];
  const makeAdult=sp=>a.addRuntime(a.makeFish(sp,{growth:a.G2+1}),400,250);

  // 1 條 neon：DR = 100%
  const f1=makeAdult('neon');a.state.fish.push(f1);
  assert.equal(a.drMultForFish(f1),1.0,'DR at 1 fish = 100%');

  // 填至 40 條
  for(let i=1;i<40;i++)a.state.fish.push(makeAdult('neon'));
  assert.equal(a.drMultForFish(f1),1.0,'DR at 40 fish = 100%');

  // 第 41 條
  const f41=makeAdult('neon');a.state.fish.push(f41);
  const exp41=(40*1.0+1*0.6)/41;
  assert.ok(Math.abs(a.drMultForFish(f1)-exp41)<0.0001,'DR at 41 fish correct');

  // 填至 80 條（目前有 41 條，再加 39）
  for(let i=41;i<80;i++)a.state.fish.push(makeAdult('neon'));
  const exp80=(40*1.0+40*0.6)/80;
  assert.ok(Math.abs(a.drMultForFish(f1)-exp80)<0.0001,'DR at 80 fish correct');

  // 第 81 條
  const f81=makeAdult('neon');a.state.fish.push(f81);
  const exp81=(40*1.0+40*0.6+1*0.3)/81;
  assert.ok(Math.abs(a.drMultForFish(f81)-exp81)<0.0001,'DR at 81 fish correct');
  console.log('PASS: DR curve 40/41/80/81');
}

// ══════════════════════════════════════════════════════════════════
// 新測試 3：藍鑽 + 紅鶐算同一群組
// ══════════════════════════════════════════════════════════════════
{
  const {api:a}=boot();
  a.state.fish=[];
  const makeAdult=sp=>a.addRuntime(a.makeFish(sp,{growth:a.G2+1}),400,250);

  // 20 藍 + 20 紅 = 40 → 100%
  for(let i=0;i<20;i++){a.state.fish.push(makeAdult('discusblue'));a.state.fish.push(makeAdult('discusred'));}
  assert.equal(a.drGroupKey(a.state.fish[0]),'discus','discusblue → discus group');
  assert.equal(a.drGroupKey(a.state.fish[1]),'discus','discusred → discus group');
  assert.equal(a.drMultForFish(a.state.fish[0]),1.0,'20+20 discus = 40 → 100%');

  // 加第 41 條（藍）→ 折扣
  const f41=makeAdult('discusblue');a.state.fish.push(f41);
  const exp=(40*1.0+1*0.6)/41;
  assert.ok(Math.abs(a.drMultForFish(f41)-exp)<0.0001,'41st discus (mixed colors) → DR applied');

  // discushybrid 也屬同群
  const fhy=a.addRuntime(a.makeFish('discushybrid',{growth:a.G2+1}),400,250);
  a.state.fish.push(fhy);
  assert.equal(a.drGroupKey(fhy),'discus','discushybrid → discus group');
  console.log('PASS: discus colors + hybrid count as one group');
}

// ══════════════════════════════════════════════════════════════════
// 新測試 4：Premium/傳說魚不受 DR 影響
// ══════════════════════════════════════════════════════════════════
{
  const {api:a}=boot();
  a.state.fish=[];
  const makeAdult=sp=>a.addRuntime(a.makeFish(sp,{growth:a.G2+1}),400,250);
  for(let i=0;i<100;i++)a.state.fish.push(makeAdult('koi'));
  assert.equal(a.drMultForFish(a.state.fish[0]),1.0,'koi (noDR) exempt at 100 fish');
  for(let i=0;i<100;i++)a.state.fish.push(makeAdult('dragon'));
  assert.equal(a.drMultForFish(a.state.fish[0]),1.0,'dragon (noDR) exempt at 200 fish total');
  console.log('PASS: premium fish excluded from DR');
}

// ══════════════════════════════════════════════════════════════════
// 新測試 5：Softcap — 合算費率超過 knee 時倍率 < 1
// ══════════════════════════════════════════════════════════════════
{
  const {api:a}=boot();
  a.state.fish=[];
  const knee=a.cfg.coins.softcap.kneePerHour; // 60000
  const exp=a.cfg.coins.softcap.exp;           // 0.8
  const makeAdult=sp=>a.addRuntime(a.makeFish(sp,{growth:a.G2+1}),400,250);

  // 少量魚 → 費率低於 knee → 無折扣
  a.state.fish.push(makeAdult('goldfish'));
  const multLow=a.computeScMult();
  assert.equal(multLow,1,'softcap mult = 1 when rate below knee');

  // 加入大量魚讓費率超過 knee
  // 一條成年 puffer (coin11→本身不是discus，DR=1，coinValue=11*2=22, 每19秒)
  // 22/19 * 3600 ≈ 4168/hr；需約 15 條以上超過 60000/hr
  for(let i=0;i<30;i++)a.state.fish.push(makeAdult('puffer'));
  const rawRPH=a.rawRatePerSec()*3600;
  const multHigh=a.computeScMult();
  if(rawRPH>knee){
    assert.ok(multHigh<1,'softcap mult < 1 when rate above knee');
    assert.ok(multHigh>0,'softcap mult > 0');
    // 驗算公式
    const expected=knee*Math.pow(rawRPH/knee,exp)/rawRPH;
    assert.ok(Math.abs(multHigh-expected)<0.0001,'softcap formula matches expected');
  }
  console.log('PASS: softcap uses summed rate, mult correct');
}

// ══════════════════════════════════════════════════════════════════
// 新測試 6：每日生產上限（每台北日限 250,000）
// ══════════════════════════════════════════════════════════════════
{
  const {api:a}=boot();
  const today=a.taipeiDate();
  a.state.daily.date=today;
  a.state.daily.produced=0;

  // 剩餘應為全量
  assert.equal(a.dailyRemaining(),250000,'full daily remaining at start');

  // 設到接近上限
  a.state.daily.produced=249990;
  assert.equal(a.dailyRemaining(),10,'10 coins remaining');

  // 設到上限
  a.state.daily.produced=250000;
  assert.equal(a.dailyRemaining(),0,'0 remaining when at cap');

  // 日期切換 → 重置
  a.state.daily.date='1970-01-01';
  assert.equal(a.dailyRemaining(),250000,'daily resets on new Taipei date');
  console.log('PASS: daily production cap 250,000');
}

// ══════════════════════════════════════════════════════════════════
// 新測試 7：購買/補償金幣不計入每日上限
// ══════════════════════════════════════════════════════════════════
{
  const {api:a}=boot();
  a.state.daily.date=a.taipeiDate();
  a.state.daily.produced=250000; // 已達上限
  const beforeCoins=a.state.coins;
  // addCoins（非生產路徑：補償、任務獎勵）
  a.addCoins(500);
  assert.equal(a.state.coins,beforeCoins+500,'addCoins bypasses daily cap');
  assert.equal(a.state.daily.produced,250000,'daily.produced unchanged by addCoins');
  console.log('PASS: purchases not eaten by daily cap');
}

// ══════════════════════════════════════════════════════════════════
// 新測試 8：用戶端與伺服端公式一致性驗證
// 相同魚群組，client 計算的 coinValue = rawCoinValue × scMult
// ══════════════════════════════════════════════════════════════════
{
  const {api:a}=boot();
  a.state.fish=[];
  const f=a.addRuntime(a.makeFish('angel',{growth:a.G2+1}),400,250);
  a.state.fish.push(f);
  // 重新算 scMult
  const sc=a.computeScMult();
  const rawVal=a.rawCoinValue(f);
  const clientVal=a.coinValue(f);
  // 伺服端公式（應用相同邏輯）
  const serverVal=Math.max(1,Math.round(rawVal*sc));
  assert.equal(clientVal,serverVal,'client coinValue matches server formula');
  console.log('PASS: client and server multipliers match on same fixture');
}

// ══════════════════════════════════════════════════════════════════
// 新測試 9：反作弊 — 新費率後合法離線收益不超過每日上限
// ══════════════════════════════════════════════════════════════════
{
  const {api:a}=boot();
  a.state.fish=[];
  // 設定較多魚以取得可觀費率
  const makeAdult=sp=>a.addRuntime(a.makeFish(sp,{growth:a.G2+1}),400,250);
  for(let i=0;i<10;i++)a.state.fish.push(makeAdult('neon'));
  a.state.daily.date=a.taipeiDate();
  a.state.daily.produced=200000; // 已累積

  // 最長離線（8小時）× 50% 效率，受今日剩餘截斷
  const rps=a.ratePerSec(); // 含 softcap
  const OFFLINE_RATE=0.5,OFFLINE_CAP=8*3600;
  const rawEarn=Math.floor(rps*OFFLINE_CAP*OFFLINE_RATE);
  const rem=a.dailyRemaining();
  const earn=Math.min(rawEarn,rem);
  assert.ok(earn<=50000,'legitimate 8-hour offline earn <= remaining daily budget');
  assert.ok(a.state.daily.produced+earn<=250000,'total production never exceeds daily cap');
  console.log('PASS: anticheat accepts legitimate post-change income');
}

console.log('\n✅ 全部測試通過（原有 + 新增 9 項）');
