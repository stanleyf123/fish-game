'use strict';
const express=require('express');
const {HttpError}=require('./util');
const {usedSpaceOf,capacityOf}=require('./anticheat');
const PERIODS=[{id:'2026_typhoon',sp:'m_typhoon_202610',name:'颱風魚',startsAt:Date.parse('2026-10-24T00:00:00+08:00'),endsAt:Date.parse('2026-11-26T00:00:00+08:00'),image:'/art/monthly-fish/typhoon-fish-card-v1.webp'}];
function species(){return {name:'颱風魚',rarity:2,price:0,priceGems:100000,premium:true,disabled:true,sellPrice:5000,coin:6,breedOnly:false,speed:35,desc:'2026/11/25 前的月卡限定收藏。寶石藍魚身與銀白旋風尾鰭，領取後永久保留。',look:{body:'fish',tail:'flow',tailScale:1.3,fins:'flowing',pattern:'sheen',len:40,height:20,hue:215,sat:80,light:60,shimmer:true,shimmerHue:205},family:'monthly',familyName:'月卡限定',scientificName:'Typhoon Fish',temperament:'peaceful',aggression:0,sizeClass:'small',adultSizeCm:5,tankSpace:1,minTankLevel:0,schooling:false,waterType:'fresh',unlockLevel:1,longFins:true,monthlyExclusive:true};}
function mountMonthlyFish(app,ctx,{clock=Date.now,periods=PERIODS}={}){
 const {db,players,commerce,configStore}=ctx;
 db.exec('CREATE TABLE IF NOT EXISTS monthly_fish_claims(player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,period_id TEXT NOT NULL,species TEXT NOT NULL,reserved_at INTEGER NOT NULL,claimed_at INTEGER,fish_id TEXT,PRIMARY KEY(player_id,period_id))');
 const active=(pid,t)=>commerce.activeEntitlements(pid,t).some(e=>e.kind==='vip'&&e.starts_at<=t);
 function periodFor(pid,t){const pending=db.prepare('SELECT period_id FROM monthly_fish_claims WHERE player_id=? AND claimed_at IS NULL ORDER BY reserved_at LIMIT 1').get(pid);return (pending&&periods.find(p=>p.id===pending.period_id))||periods.find(p=>t>=p.startsAt&&t<p.endsAt)||periods[periods.length-1]}
 function state(pid){const t=clock(),p=periodFor(pid,t);if(!p)return{available:false};const row=db.prepare('SELECT * FROM monthly_fish_claims WHERE player_id=? AND period_id=?').get(pid,p.id),inPeriod=t>=p.startsAt&&t<p.endsAt,card=active(pid,t),reserved=!!row&&!row.claimed_at;return {available:!!configStore.active().config.species[p.sp],period:p,cardActive:card,inPeriod,claimed:!!row?.claimed_at,reserved,claimable:!row?.claimed_at&&(reserved||inPeriod&&card),serverTime:t};}
 function claim(pid,body={}){return db.transaction(()=>{
  const player=players.get(pid);if(!player?.username)throw new HttpError(403,'members_only','請先登入月卡會員帳號');
  const t=clock(),st=state(pid),p=st.period;if(!p||!st.available)throw new HttpError(503,'unavailable','限定魚暫時無法領取');
  if(body.periodId!==p.id)throw new HttpError(409,'period_changed','限定魚期別已更新，請重新開啟儲值頁');
  const old=db.prepare('SELECT * FROM monthly_fish_claims WHERE player_id=? AND period_id=?').get(pid,p.id);
  if(old?.claimed_at)return{ok:true,duplicate:true,state:st};
  if(!st.claimable)throw new HttpError(403,st.inPeriod?'card_required':'period_ended',st.inPeriod?'需要有效月卡才能領取':'本期領取已於 11/25 結束');
  const saveRow=db.prepare('SELECT data,rev FROM saves WHERE player_id=?').get(pid);if(!saveRow)throw new HttpError(409,'no_save','請先同步雲端魚缸再領取');
  if(!Number.isInteger(body.baseRev)||body.baseRev!==saveRow.rev)throw new HttpError(409,'save_conflict','魚缸已更新，請重新同步後再領取');
  const cfg=configStore.active().config,save=JSON.parse(saveRow.data),sp=cfg.species[p.sp],need=cfg.capacity.unit==='tankSpace'?(sp.tankSpace||1):1,used=usedSpaceOf(cfg,save.fish||[]),cap=capacityOf(cfg,save.up?.cap||0,save);
  db.prepare('INSERT OR IGNORE INTO monthly_fish_claims(player_id,period_id,species,reserved_at) VALUES(?,?,?,?)').run(pid,p.id,p.sp,t);
  if(used+need>cap+1e-9||(save.fish||[]).length>=500)return{ok:true,pending:true,message:'魚缸已滿，颱風魚已為你永久保留；騰出空間後再領取。',state:state(pid)};
  const out=players.grantToSave(pid,{fish:[{species:p.sp,count:1,growth:cfg.stages[2].growth}]});
  if(out.addedFish.length!==1)throw Error('Monthly fish grant failed');
  db.prepare('UPDATE monthly_fish_claims SET claimed_at=?,fish_id=? WHERE player_id=? AND period_id=?').run(t,out.addedFish[0].id,pid,p.id);
  players.logEvent(pid,'monthly_fish_claim',{period:p.id,species:p.sp,fishId:out.addedFish[0].id});
  return{ok:true,save:out.save,rev:out.rev,fish:out.addedFish[0],state:state(pid)};
 }).immediate();}
 const r=express.Router();r.use(express.json({limit:'1kb'}));r.use(players.auth());
 r.get('/',(req,res,next)=>{try{res.json(state(req.player.id))}catch(e){next(e)}});
 r.post('/claim',(req,res,next)=>{try{res.json(claim(req.player.id,req.body||{}))}catch(e){next(e)}});
 app.use('/api/monthly-fish',r);ctx.monthlyFish={state,claim};return ctx.monthlyFish;
}
module.exports={mountMonthlyFish,PERIODS,monthlySpecies:species};
