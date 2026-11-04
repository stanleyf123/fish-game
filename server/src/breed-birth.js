'use strict';
const {HttpError,randToken}=require('./util');
const {spOf,isPremium}=require('./anticheat');
const Hybrid=require('./hybrid');
const {deliver}=require('./newborn');
function migrateBirth(db){db.exec('CREATE TABLE IF NOT EXISTS breed_births(player_id INTEGER NOT NULL,idem_key TEXT NOT NULL,request TEXT NOT NULL,child TEXT NOT NULL,destination TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(player_id,idem_key))')}
function quote(ctx,bl,pid,parents){if(!Array.isArray(parents)||parents.length!==2||parents[0]===parents[1])throw new HttpError(400,'bad_request','請選擇兩條不同的親魚');const row=ctx.players.getSave(pid),fish=row.save?.fish||[],p=parents.map(id=>fish.find(f=>f.id===id));if(p.some(f=>!f))throw new HttpError(409,'fish_missing','親魚已不在魚缸');const cfg=ctx.configStore.active().config;if(p.some(f=>Hybrid.generation(f.sp)>=Hybrid.MAX_GENERATION))throw new HttpError(422,'generation_limit','第六代已達繁殖上限，不能再作為親魚，本次未扣鑽');if(p[0].sp!==p[1].sp&&!Hybrid.cross(cfg,p[0].sp,p[1].sp,Math.random).sp)throw new HttpError(422,'lineage_limit','這組血統資料過長，本次未扣鑽');const fee=Hybrid.breedFee(cfg,p[0].sp,p[1].sp),today=bl.today(pid);if(today.ownNext==null)throw new HttpError(429,'breed_limit','今天繁殖次數已用完',{today});return{...fee,baseGems:fee.gems,extraGems:today.ownNext||0,totalGems:fee.gems+(today.ownNext||0),today,balance:ctx.commerce.balance(pid),parents:p.map(f=>({id:f.id,species:f.sp,name:spOf(cfg,f.sp)?.name||f.sp,gems:fee.parents.find(p=>p.species===f.sp)?.gems||0}))}}
function birth(ctx,bl,pid,body){return ctx.db.transaction(()=>{
 const {idempotencyKey:key,parents,result,rev,acceptedGems}=body||{};
 if(typeof key!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(key)||!Array.isArray(parents)||parents.length!==2||parents[0]===parents[1]||!result||typeof result.sp!=='string')throw new HttpError(400,'bad_request','繁殖資料不完整');
 const request=JSON.stringify({parents,result}),old=ctx.db.prepare('SELECT * FROM breed_births WHERE player_id=? AND idem_key=?').get(pid,key);
 if(old){if(old.request!==request)throw new HttpError(409,'idempotency_mismatch','上一筆繁殖結果正在確認，請重新開啟收藏庫查看');return{...ctx.players.getSave(pid),child:JSON.parse(old.child),destination:old.destination,kind:result.kind,reused:true,balance:ctx.commerce.balance(pid),today:bl.today(pid)}}
 const row=ctx.players.getSave(pid),cfg=ctx.configStore.active().config,save=row.save,t=Date.now();if(!save||row.rev!==rev)throw new HttpError(409,'conflict','魚缸資料已更新，請重試（尚未扣款）');
 const [a,b]=parents.map(id=>save.fish.find(f=>f.id===id));if(!a||!b)throw new HttpError(409,'fish_missing','配對的魚已不在魚缸');
 const pa=spOf(cfg,a.sp),pb=spOf(cfg,b.sp),s=spOf(cfg,result.sp);if(!pa||!pb||!s)throw new HttpError(422,'species_missing','找不到繁殖魚種');
 const elapsed=Math.max(0,(t-(save.last||t))/1000);
 for(const f of [a,b])if((f.growth||0)<cfg.stages[1].growth||(f.health??100)<cfg.health.sickBelow||(f.cd||0)>elapsed+1)throw new HttpError(409,'parent_not_ready','親魚尚未長大、需要照護或仍在繁殖冷卻中');
 const premium=isPremium(pa)||isPremium(pb);if(premium&&cfg.premium?.breedable===false)throw new HttpError(409,'premium_no_breed','限定魚目前未開放繁殖');
 const expected=Hybrid.cross(cfg,a.sp,b.sp,Math.random);const allowed=new Set([a.sp,b.sp]);if(expected.sp)allowed.add(expected.sp);

 if(!premium)for(const p of cfg.breeding.mutation?.pools||[])for(const k of p.species||[])allowed.add(k);
 if(!allowed.has(result.sp)||(isPremium(s)&&a.sp!==b.sp))throw new HttpError(422,'invalid_offspring','繁殖魚種不符合親魚組合');
 const premiumCd=(cfg.premium?.breedCooldownSec||14400)*1000;if(isPremium(s)&&t-(save.pbreed?.[result.sp]||0)<premiumCd)throw new HttpError(409,'premium_cooldown','這個限定魚種仍在繁殖冷卻中');
 const offer=quote(ctx,bl,pid,parents);if(offer.totalGems>0&&acceptedGems!==offer.totalGems)throw new HttpError(409,'breed_price_changed','請先確認最新繁殖費用（本次未扣鑽）',{offer});if(offer.totalGems>offer.balance)throw new HttpError(402,'insufficient_gems','寶石不足，繁殖需要 💎'+offer.totalGems,{need:offer.totalGems,balance:offer.balance});
 if(a.sp!==b.sp&&(result.kind!=='hybrid'||!Hybrid.isHybrid(result.sp)))throw new HttpError(422,'hybrid_required','跨種雜交只會產生雙親的混種魚');
 const lineage={at:t,parents:[a,b].map(f=>({id:f.id,sp:f.sp,name:f.name||spOf(cfg,f.sp)?.name||'',ownerId:pid}))};
 const child={lineage,id:'b'+randToken(9).replace(/[-_]/g,'x'),sp:result.sp,name:cfg.names[Math.floor(Math.random()*cfg.names.length)],hue:result.kind==='hybrid'?s.look?.hue||0:((+a.hue||s.look?.hue||0)+(+b.hue||s.look?.hue||0))/2,size:Math.max(.85,Math.min(1.15,((a.size||1)+(b.size||1))/2+(Math.random()-.5)*.1)),growth:0,health:100,full:cfg.hunger.offspringFullness,cd:0,coinT:10,seed:Math.floor(Math.random()*1e5),px:.5,py:.5,dir:1};
 const destination=deliver(ctx.db,pid,cfg,save,child),r=bl.record(pid,'own',{idem:key});if(offer.baseGems>0){ctx.commerce.ledger(pid,-offer.baseGems,'spend','breed-bloodline:'+key);ctx.db.prepare('UPDATE breed_uses SET gems=gems+? WHERE id=?').run(offer.baseGems,r.row.id)}r.gems+=offer.baseGems;r.balance=ctx.commerce.balance(pid);
 a.cd=b.cd=premium?Math.max(cfg.breeding.cooldownSec,premiumCd/1000):cfg.breeding.cooldownSec;
 if(isPremium(s)){save.pbreed=save.pbreed||{};save.pbreed[result.sp]=t}
 save.last=t;ctx.players.writeSaveRow(pid,save,row.rev+1,t,true);
 ctx.db.prepare('UPDATE breed_uses SET child_id=?,consumed_at=? WHERE id=?').run(child.id,t,r.row.id);
 ctx.db.prepare('INSERT INTO breed_births VALUES(?,?,?,?,?,?)').run(pid,key,request,JSON.stringify(child),destination,t);
 ctx.players.logEvent(pid,'breed_birth',{parents,sp:child.sp,child:child.id,destination,gems:r.gems});
 return{...ctx.players.getSave(pid),child,kind:result.kind,destination,gems:r.gems,balance:ctx.commerce.balance(pid),today:bl.today(pid)};
})()}
function lineage(ctx,pid,id){
 if(typeof id!=='string'||id.length>40)throw new HttpError(400,'bad_request','魚隻資料不完整');
 const fishFor=(owner,fid)=>{const active=ctx.players.getSave(owner).save?.fish?.find(f=>f.id===fid);if(active)return active;const row=ctx.db.prepare('SELECT data FROM fish_storage WHERE player_id=? AND fish_id=?').get(owner,fid);return row?JSON.parse(row.data):null};
 const f=fishFor(pid,id);if(f?.lineage)return{lineage:f.lineage};
 const row=ctx.db.prepare("SELECT request,created_at FROM breed_births WHERE player_id=? AND json_extract(child,'$.id')=?").get(pid,id);
 if(row){const r=JSON.parse(row.request);return{lineage:{at:row.created_at,historical:true,parents:r.parents.map(fid=>{const p=fishFor(pid,fid);return{id:fid,sp:p?.sp||null,name:p?.name||'',ownerId:pid}})}}}
 const social=ctx.db.prepare('SELECT * FROM social_breeds WHERE requester_id=? AND child_id=?').get(pid,id);
 if(social)return{lineage:{at:social.created_at,historical:true,parents:[[social.owner_id,social.owner_fish,social.owner_sp],[pid,social.my_fish,social.my_sp]].map(([owner,fid,sp])=>({id:fid,sp,name:fishFor(owner,fid)?.name||'',ownerId:owner}))}};
 return{lineage:null};
}
module.exports={birth,migrateBirth,quote,lineage};
