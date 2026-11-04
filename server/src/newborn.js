'use strict';
const {HttpError}=require('./util');
const StorageCap=require('./storage-capacity');
const {capacityOf,usedSpaceOf,spOf}=require('./anticheat');
function deliver(db,pid,cfg,save,child){
 const s=spOf(cfg,child.sp);if(!s)throw new HttpError(422,'species_missing','寶寶魚種資料無法讀取');
 const own=save.gear?.own||{},gear=cfg.aquascape?.gear||{},habitat=s.habitat||{};
 const ocean=Object.keys(own).reduce((n,k)=>Math.max(n,gear[k]?.ocean||0),0);
 const fits=(save.fish||[]).length<500&&usedSpaceOf(cfg,[...(save.fish||[]),child])<=capacityOf(cfg,save.up?.cap||0,save)+1e-9&&(!habitat.gear||own[habitat.gear])&&(!habitat.ocean||ocean>=habitat.ocean)&&(s.minTankLevel||0)<=(save.up?.cap||0);
 let destination='tank';
 if(fits)save.fish.push(child);
 else{if(StorageCap.used(db,pid)+1>StorageCap.capacity(db,pid))throw new HttpError(409,'storage_full','魚缸與收藏庫都放不下寶寶，請先整理收藏庫（本次未扣款或使用繁殖次數）');db.prepare('INSERT INTO fish_storage(player_id,fish_id,data,stored_at) VALUES(?,?,?,?)').run(pid,child.id,JSON.stringify(child),Date.now());destination='storage'}
 save.found=save.found||{};save.found[child.sp]=1;return destination;
}
module.exports={deliver};
