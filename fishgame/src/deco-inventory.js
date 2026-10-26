'use strict';
const {HttpError}=require('./util');
const { removeLegacy } = require('./legacy-deco');
const fail=(code,msg)=>{throw new HttpError(409,code,msg)};
class DecoInventory{
 constructor(db,players,commerce,cfg){Object.assign(this,{db,players,commerce,cfg});db.exec(`CREATE TABLE IF NOT EXISTS deco_storage(player_id INTEGER NOT NULL REFERENCES players(id),deco_id TEXT NOT NULL,bundle TEXT NOT NULL,stored_at INTEGER NOT NULL,PRIMARY KEY(player_id,deco_id));CREATE TABLE IF NOT EXISTS deco_sold(player_id INTEGER NOT NULL REFERENCES players(id),deco_id TEXT NOT NULL,PRIMARY KEY(player_id,deco_id));CREATE TABLE IF NOT EXISTS deco_inventory_ops(player_id INTEGER NOT NULL REFERENCES players(id),idem_key TEXT NOT NULL,request TEXT NOT NULL,receipt TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(player_id,idem_key));`);players.decoInventory=this}
 list(pid){return this.db.prepare('SELECT deco_id,bundle FROM deco_storage WHERE player_id=? ORDER BY stored_at,deco_id').all(pid).map(r=>({id:r.deco_id,...JSON.parse(r.bundle)}))}
 has(pid,k){return this.list(pid).some(b=>b.ids.includes(k))}
 reactivate(pid,k){this.db.prepare('DELETE FROM deco_sold WHERE player_id=? AND deco_id=?').run(pid,k)}
 guard(pid,save){if((save?.up?.deco||[]).some(k=>this.db.prepare('SELECT 1 FROM deco_sold WHERE player_id=? AND deco_id=?').get(pid,k)))fail('deco_sold','造景已出售，請從商店重新購買並載入最新魚缸');if((save?.up?.deco||[]).some(k=>this.has(pid,k)))fail('deco_stored','造景已收起，請載入最新魚缸；放回需從造景管理操作')}
 group(save,k){return [k,...(save.up?.deco||[]).filter(id=>id!==k&&save.up?.moss?.[id]?.host===k)]}
 price(k){const d=this.cfg.active().config.decorations[k];return d?Math.max(0,Math.floor(d.sellCoins??(d.priceGems>0?d.priceGems*10:(d.cost||0)*.5))):0}
 state(pid){return{...this.players.getSave(pid),balance:this.commerce.balance(pid),storedDeco:this.list(pid).map(b=>({...b,sellCoins:b.ids.reduce((n,k)=>n+this.price(k),0)})),decoSellPrices:Object.fromEntries(Object.keys(this.cfg.active().config.decorations||{}).map(k=>[k,this.price(k)]))}}
 run(pid,body){return this.db.transaction(()=>{const {action,id,rev,idempotencyKey:key}=body||{};if(!['store','place','sell','buy'].includes(action)||typeof id!=='string'||typeof key!=='string'||!/^di_[a-zA-Z0-9_-]{12,80}$/.test(key))throw new HttpError(400,'invalid_request','造景操作格式錯誤');const request=JSON.stringify({action,id}),op=this.db.prepare('SELECT request,receipt FROM deco_inventory_ops WHERE player_id=? AND idem_key=?').get(pid,key);if(op){if(op.request!==request)fail('idempotency_mismatch','請重新確認造景操作');return{...this.state(pid),...JSON.parse(op.receipt),reused:true}}
 const row=this.players.getSave(pid);if(!row.save)fail('no_save','請先同步魚缸');if(row.rev!==rev)throw new HttpError(409,'conflict','魚缸已更新，請重試',{rev:row.rev,save:row.save});const save=row.save,cfg=this.cfg.active().config,t=Date.now();if(!cfg.decorations[id])fail('item_missing','找不到這件造景');const stored=this.list(pid).find(b=>b.id===id),active=(save.up?.deco||[]).includes(id);let ids,amount=0;
 if(action==='buy'){
  const d=cfg.decorations[id];if(active||this.has(pid,id))fail('already_owned','你已擁有這件造景，請從造景管理放回');if(d.disabled||d.priceGems>0||!(d.cost>0))fail('not_for_sale','這件造景請使用商店顯示的購買方式');if(save.coins<d.cost)throw new HttpError(402,'insufficient_coins','金幣不足');save.coins-=d.cost;ids=[id];save.up.deco.push(id);this.reactivate(pid,id);this.players.econ(t,0,d.cost,0,pid);
 }else if(action==='place'){
  if(!stored)fail('not_stored','這件造景已不在收納庫');ids=stored.ids;if(ids.some(k=>save.up.deco.includes(k)||!cfg.decorations[k]))fail('already_active','組合物品已變更，請重新整理');save.up.deco.push(...ids);save.up.decoPos={...(save.up.decoPos||{}),...stored.decoPos};save.up.moss={...(save.up.moss||{}),...stored.moss};
  for(const k of ids){const m=save.up.moss[k];if(m?.host&&!save.up.deco.includes(m.host))save.up.moss[k]={...m,host:null,point:null,freeHost:null,fx:null,fy:null,independent:true}}
  save.up.decoZ=[...(save.up.decoZ||[]).filter(k=>!ids.includes(k)),...(stored.decoZ||ids)];this.db.prepare('DELETE FROM deco_storage WHERE player_id=? AND deco_id=?').run(pid,id);
 }else{
  if(!active&&!stored)fail('not_owned','你目前沒有這件造景');if(action==='store'&&!active)fail('already_stored','這件造景已收起');ids=active?this.group(save,id):stored.ids;
  if(active){const take=o=>Object.fromEntries(ids.filter(k=>o&&o[k]!=null).map(k=>[k,o[k]]));const bundle={ids,decoPos:take(save.up.decoPos),moss:take(save.up.moss),decoZ:(save.up.decoZ||ids).filter(k=>ids.includes(k))};
   save.up.deco=save.up.deco.filter(k=>!ids.includes(k));for(const map of [save.up.decoPos,save.up.moss])if(map)for(const k of ids)delete map[k];if(save.up.decoZ)save.up.decoZ=save.up.decoZ.filter(k=>!ids.includes(k));
   // Planted aquatic plants remain owned and on the substrate when their support is removed.
   for(const p of save.plants||[])if(ids.includes(p.host)){delete p.host;delete p.hx;delete p.hy}
   if(action==='store')this.db.prepare('INSERT INTO deco_storage VALUES(?,?,?,?)').run(pid,id,JSON.stringify(bundle),t);
  }
  if(action==='sell'){for(const k of ids)this.db.prepare('INSERT OR IGNORE INTO deco_sold VALUES(?,?)').run(pid,k);amount=ids.reduce((n,k)=>n+this.price(k),0);save.coins+=amount;this.players.econ(t,amount,0,0,pid);removeLegacy(save,ids);if(stored)this.db.prepare('DELETE FROM deco_storage WHERE player_id=? AND deco_id=?').run(pid,id)}
 }
 save.last=t;this.players.writeSaveRow(pid,save,row.rev+1,t,true);const receipt={action,id,ids,amount};this.players.logEvent(pid,'deco_'+action,receipt);this.db.prepare('INSERT INTO deco_inventory_ops VALUES(?,?,?,?,?)').run(pid,key,request,JSON.stringify(receipt),t);return{...this.state(pid),...receipt};})();}
}
module.exports={DecoInventory};
