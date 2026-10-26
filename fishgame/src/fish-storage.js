'use strict';
const {HttpError}=require('./util');
const StorageCap=require('./storage-capacity');
const {spOf,usedSpaceOf,capacityOf,isPremium}=require('./anticheat');
const fail=(code,message)=>{throw new HttpError(409,code,message)};
// Separate authoritative inventory: only active fish participate in the simulation.
class FishStorage {
 constructor(db,players,commerce,cfg){Object.assign(this,{db,players,commerce,cfg});db.exec(`CREATE TABLE IF NOT EXISTS fish_storage(player_id INTEGER NOT NULL REFERENCES players(id),fish_id TEXT NOT NULL,data TEXT NOT NULL,stored_at INTEGER NOT NULL,PRIMARY KEY(player_id,fish_id)); CREATE TABLE IF NOT EXISTS fish_storage_ops(player_id INTEGER NOT NULL REFERENCES players(id),idem_key TEXT NOT NULL,request TEXT NOT NULL,receipt TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(player_id,idem_key));`);StorageCap.migrate(db,cfg.active().config);players.fishStorage=this;}
 list(pid){return this.db.prepare('SELECT data FROM fish_storage WHERE player_id=? ORDER BY stored_at DESC,fish_id').all(pid).map(r=>JSON.parse(r.data));}
 state(pid){return {...this.players.getSave(pid),storedFish:this.list(pid),balance:this.commerce.balance(pid),...StorageCap.state(this.db,pid,this.cfg.active().config)};}
 capacity(pid,fish=[]){const cfg=this.cfg.active().config,n=StorageCap.capacity(this.db,pid);if(StorageCap.used(this.db,pid)+fish.length>n)fail('storage_full',`收藏庫已滿（上限 ${n} 隻），請整理或使用鑽石擴充`);}
 activeGuard(pid,fish){const ids=new Set(this.list(pid).map(f=>f.id));if((Array.isArray(fish)?fish:[]).some(f=>ids.has(f.id)))fail('fish_in_storage','這隻魚已在收藏庫，請重新載入最新魚缸');}
 run(pid,body){return this.db.transaction(()=>{
  const {action,id,species,ids,rev,storageCapacity:expectedCapacity,storageUnit,idempotencyKey:key}=body||{};
  if(!['store','store_many','place_many','sell_many','place','buy','sell','expand'].includes(action)||typeof key!=='string'||!/^fs_[a-zA-Z0-9_-]{12,60}$/.test(key))throw new HttpError(400,'invalid_request','操作格式錯誤');
  if(['store_many','place_many','sell_many'].includes(action)&&(!Array.isArray(ids)||!ids.length||ids.length>(action==='store_many'?500:2000)||ids.some(id=>typeof id!=='string'||!id||id.length>120)||new Set(ids).size!==ids.length))throw new HttpError(400,'invalid_ids','請選擇有效且不重複的魚隻（批次收藏最多500隻，其餘最多2000隻）');
  const request=JSON.stringify({action,id:id||null,species:species||null,...(['store_many','place_many','sell_many'].includes(action)?{ids:action==='store_many'?[...ids].sort():ids}:action==='expand'?{capacity:expectedCapacity,unit:storageUnit||null}:{})});
  const op=this.db.prepare('SELECT request,receipt FROM fish_storage_ops WHERE player_id=? AND idem_key=?').get(pid,key);
  if(op){if(op.request!==request)fail('idempotency_mismatch','請重新選擇操作');return {...this.state(pid),...JSON.parse(op.receipt),reused:true};}
  let row=this.players.getSave(pid);if(!row.save)fail('no_save','請先同步雲端存檔');
  if(row.rev!==rev)throw new HttpError(409,'conflict','魚缸已更新，請重試操作',{rev:row.rev,save:row.save});
  const cfg=this.cfg.active().config,t=Date.now();let save=row.save,f,amount=0;
  let moved=[],skipped=[],destination=null,placementReason=null;
  if(action==='expand'){
   if(storageUnit!=='count')fail('storage_unit_changed','收藏庫已改為隻數制，請重新整理後確認最新容量與費用');
   const n=StorageCap.capacity(this.db,pid);
   if(expectedCapacity!==n)fail('capacity_changed','收藏庫容量已更新，請重新確認擴充');
   if(n>=StorageCap.MAX)fail('storage_max','收藏庫已達最大容量');
   amount=StorageCap.PRICE;this.commerce.ledger(pid,-amount,'spend','storage-expand:'+key);
   this.db.prepare('INSERT INTO fish_storage_capacity(player_id,capacity) VALUES(?,?) ON CONFLICT(player_id) DO UPDATE SET capacity=excluded.capacity').run(pid,Math.min(StorageCap.MAX,n+StorageCap.STEP));
  }else if(action==='sell_many'){
   const byId=new Map(this.list(pid).map(f=>[f.id,f]));
   if(ids.some(id=>!byId.has(id)))fail('fish_missing','部分魚已不在收藏庫，請重新選擇（尚未出售）');
   const del=this.db.prepare('DELETE FROM fish_storage WHERE player_id=? AND fish_id=?');
   for(const id of ids){const f=byId.get(id),s=spOf(cfg,f.sp);const stage=f.growth>=cfg.stages[2].growth?2:f.growth>=cfg.stages[1].growth?1:0;const price=s?Math.floor((s.sell||s.price*cfg.sell.fallbackRateOfPrice)*(1+stage*cfg.sell.stageBonus)):NaN;
    const reason=f.gift?'贈送魚不可批次出售':!s?'魚種資料暫時無法讀取':!Number.isFinite(price)||price<=0?'此魚暫無出售價格':save.fish.some(q=>q.id===id)?'魚隻資料重複':null;
    if(reason){skipped.push({id,name:f.name,species:f.sp,reason});continue}amount+=price;moved.push(f);del.run(pid,id);
   }
   save.coins+=amount;if(amount)this.players.econ(t,amount,0,0,pid);
  }else if(action==='place_many'){
   const byId=new Map(this.list(pid).map(f=>[f.id,f]));
   if(ids.some(id=>!byId.has(id)))fail('fish_missing','部分魚已不在收藏庫，請重新選擇');
   const own=save.gear?.own||{},GE=cfg.aquascape?.gear||{},oc=Object.keys(own).reduce((m,k)=>Math.max(m,GE[k]?.ocean||0),0),del=this.db.prepare('DELETE FROM fish_storage WHERE player_id=? AND fish_id=?');
   for(const id of ids){const f=byId.get(id),s=spOf(cfg,f.sp),h=s?.habitat||{};const reason=!s?'魚種資料暫時無法讀取':save.fish.some(q=>q.id===id)?'魚隻資料重複':save.fish.length>=500?'魚缸已達500隻上限':h.gear&&!own[h.gear]?'缺少飼養設備':h.ocean&&oc<h.ocean?'海洋館等級不足':(s.minTankLevel||0)>(save.up.cap||0)?'魚缸等級不足':usedSpaceOf(cfg,[...save.fish,f])>capacityOf(cfg,save.up.cap||0,save)+1e-9?'魚缸空間不足':null;
    if(reason){skipped.push({id,name:f.name,species:f.sp,reason});continue}save.fish.push(f);moved.push(f);del.run(pid,id);
   }
  }else if(action==='store_many'){
   
   const byId=new Map(save.fish.map(f=>[f.id,f]));moved=ids.map(id=>byId.get(id));
   if(moved.some(f=>!f))fail('fish_missing','部分選取的魚已不在魚缸，請重新選擇');this.capacity(pid,moved);
   const blocked=moved.filter(f=>(f.health??100)<90||(f.finDmg||0)>0||(f.full??100)<cfg.hunger.hungryBelow);
   if(blocked.length)fail('care_required','「'+blocked.slice(0,3).map(f=>f.name||cfg.species[f.sp]?.name||'魚兒').join('、')+'」尚需照護；健康達 90、魚鰭無受損且不餓才能收藏。本次未收起任何魚。');
   const put=this.db.prepare('INSERT INTO fish_storage VALUES(?,?,?,?)');
   for(const f of moved)put.run(pid,f.id,JSON.stringify(f),t);
   const selected=new Set(ids);save.fish=save.fish.filter(f=>!selected.has(f.id));
  }else if(action==='store'){
   f=save.fish.find(q=>q.id===id);if(!f)fail('fish_missing','這隻魚已不在魚缸');this.capacity(pid,[f]);
   if((f.health??100)<90||(f.finDmg||0)>0||(f.full??100)<cfg.hunger.hungryBelow)fail('care_required','請先照顧好魚兒：健康恢復至 90、魚鰭沒有受損，而且不餓才能收起');
   save.fish=save.fish.filter(q=>q.id!==id);
   this.db.prepare('INSERT INTO fish_storage VALUES(?,?,?,?)').run(pid,f.id,JSON.stringify(f),t);
  }else if(action==='buy'){
   const s=cfg.species[species];if(!s||s.disabled||s.breedOnly||(isPremium(s)&&!(s.priceGems>0))||(!(s.price>0)&&!(s.priceGems>0)))fail('not_for_sale','這個魚種目前無法購買');
   const thresholds=cfg.mechanics?.progression?.foundThresholds||[0,2,5,9,14,20,27,35,44,55];let lv=1;thresholds.forEach((n,i)=>{if(Object.keys(save.found||{}).length>=n)lv=i+1});
   if(!isPremium(s)&&(s.unlockLevel||1)>lv)fail('locked','玩家等級尚未解鎖這個魚種');
   if(s.priceGems>0){const r=this.commerce.buySpecies(pid,species,key,{storage:true});if(!r.fish)fail('order_conflict','訂單已存在，請重新整理');f=r.fish;save=r.save;row={rev:r.rev};}
   else{amount=Math.ceil(s.price);if(save.coins<amount)throw new HttpError(402,'insufficient_coins','金幣不足');save.coins-=amount;this.players.writeSaveRow(pid,save,row.rev+1,t,false);const r=this.players.grantToSave(pid,{fish:[{species,count:1}]});f=r.addedFish[0];save=r.save;row={rev:r.rev};this.players.econ(t,0,amount,0,pid);}
   const own=save.gear?.own||{},GE=cfg.aquascape?.gear||{},h=s.habitat||{},ocean=Object.keys(own).reduce((m,k)=>Math.max(m,GE[k]?.ocean||0),0);
   placementReason=h.gear&&!own[h.gear]?'需要先準備「'+(GE[h.gear]?.name||h.gear)+'」':h.ocean&&ocean<h.ocean?'需要海洋館 Lv'+h.ocean:(s.minTankLevel||0)>(save.up.cap||0)?'需要魚缸 Lv'+s.minTankLevel:save.fish.length>500||usedSpaceOf(cfg,save.fish)>capacityOf(cfg,save.up.cap||0,save)+1e-9?'魚缸空間不足':null;
   destination=placementReason?'storage':'tank';
   if(destination==='storage'){this.capacity(pid,[f]);save.fish=save.fish.filter(q=>q.id!==f.id);this.db.prepare('INSERT INTO fish_storage VALUES(?,?,?,?)').run(pid,f.id,JSON.stringify(f),t);}
   save.nb=save.nb||{g:3,skip:1,claimed:1,legacy:1,d:{}};save.nb.d=save.nb.d||{};save.nb.d.buy=save.nb.d.buy||t;
  }else{
   const r=this.db.prepare('SELECT data FROM fish_storage WHERE player_id=? AND fish_id=?').get(pid,id);if(!r)fail('fish_missing','收藏庫找不到這隻魚');f=JSON.parse(r.data);const s=spOf(cfg,f.sp);if(!s)fail('species_missing','魚種資料暫時無法讀取');
   if(action==='place'){
    if(save.fish.length>=500)fail('tank_full','魚缸已達 500 隻上限');
    const own=save.gear?.own||{},GE=cfg.aquascape?.gear||{},h=s.habitat||{};
    if(h.gear&&!own[h.gear])fail('habitat_missing','需要先購買「'+(GE[h.gear]?.name||h.gear)+'」才能放入');
    const oc=Object.keys(own).reduce((m,k)=>Math.max(m,GE[k]?.ocean||0),0);
    if(h.ocean&&oc<h.ocean)fail('habitat_missing','需要海洋館 Lv'+h.ocean+' 才能放入');
    if((s.minTankLevel||0)>(save.up.cap||0))fail('tank_too_small','需要先擴建至魚缸 Lv'+s.minTankLevel);
    if(usedSpaceOf(cfg,[...save.fish,f])>capacityOf(cfg,save.up.cap||0,save)+1e-9)fail('tank_full','魚缸空間不足，請先收起其他魚或擴建');
    if(save.fish.some(q=>q.id===f.id))fail('duplicate_fish','這隻魚已在魚缸');
    save.fish.push(f);
   }else{const stage=f.growth>=cfg.stages[2].growth?2:f.growth>=cfg.stages[1].growth?1:0;amount=f.gift?0:Math.floor((s.sell||s.price*cfg.sell.fallbackRateOfPrice)*(1+stage*cfg.sell.stageBonus));save.coins+=amount;this.players.econ(t,amount,0,0,pid);}
   this.db.prepare('DELETE FROM fish_storage WHERE player_id=? AND fish_id=?').run(pid,id);
  }
  // Active simulation already caught up before this request; inventory time is frozen.
  save.last=t;this.players.writeSaveRow(pid,save,row.rev+1,t,true);
  const receipt=action==='expand'?{action,amount,capacity:StorageCap.capacity(this.db,pid)}:['store_many','place_many','sell_many'].includes(action)?{fishIds:moved.map(f=>f.id),count:moved.length,action,...(['place_many','sell_many'].includes(action)?{skipped}:{}),...(action==='sell_many'?{amount}:{})}:{fishId:f.id,action,amount,...(action==='buy'?{destination,placementReason}:{})};this.players.logEvent(pid,'fish_storage_'+action,action==='expand'?{capacity:receipt.capacity,gems:amount}:['store_many','place_many','sell_many'].includes(action)?{ids:receipt.fishIds,count:receipt.count,...(action==='sell_many'?{amount,skipped:skipped.length}:{})}:{id:f.id,sp:f.sp,amount});
  this.db.prepare('INSERT INTO fish_storage_ops VALUES(?,?,?,?,?)').run(pid,key,request,JSON.stringify(receipt),t);
  return {...this.state(pid),...receipt};
 })();}
}
module.exports={FishStorage};
