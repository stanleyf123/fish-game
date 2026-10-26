'use strict';
// SPONSOR-V1: cosmetic-only support, isolated from gem top-ups and game saves.
const express = require('express');
const {HttpError} = require('./util');
const TIERS = [
 {id:'reef',name:'珊瑚之友',priceTwd:500,sp:'p_lanternfish',badge:'🪸'},
 {id:'tide',name:'潮汐之友',priceTwd:1000,sp:'p_coralseahorse',badge:'🐚'},
 {id:'ocean',name:'深海守護者',priceTwd:3000,sp:'p_moonray',badge:'🌊'},
 {id:'aurora',name:'極光守護者',priceTwd:5000,sp:'p_sapphirearowana',badge:'🌌'},
 {id:'eternal',name:'星海守護者',priceTwd:10000,sp:'p_crystaldragon',badge:'✨'}
];
function sponsorCfg(cfg){cfg=cfg&&typeof cfg==='object'?cfg:{};const c=cfg&&cfg.sponsor||{};return {enabled:c.enabled===true,tiers:(Array.isArray(c.tiers)?c.tiers:TIERS).filter(t=>t&&/^[a-z][a-z0-9_]{0,23}$/.test(t.id)&&Number.isInteger(t.priceTwd)&&t.priceTwd>=1&&t.priceTwd<=100000&&cfg.species&&cfg.species[t.sp]).map((t,i)=>({...t,level:i+1})).sort((a,b)=>a.priceTwd-b.priceTwd).map((t,i)=>({...t,level:i+1}))};}
function paidTotal(db,pid){return db.prepare("SELECT COALESCE(SUM(amount),0) n FROM orders WHERE player_id=? AND status='paid' AND currency='TWD' AND provider IN ('ecpay','newebpay') AND credited_at IS NOT NULL AND json_valid(grants) AND json_extract(grants,'$.sponsor') IS NOT NULL").get(pid).n||0;}
function progress(db,pid,cfg){const c=sponsorCfg(cfg),total=paidTotal(db,pid),tier=c.tiers.filter(t=>total>=t.priceTwd).pop()||null;return {total,tier,unlocked:c.tiers.filter(t=>total>=t.priceTwd).map(t=>t.id)};}
function mountSponsor(app,ctx){
 const {db,players}=ctx;
 db.exec('CREATE TABLE IF NOT EXISTS sponsor_preferences (player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE, public_name INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)');
 // Additive migration; existing visibility choices remain unchanged.
 if(!db.prepare('PRAGMA table_info(sponsor_preferences)').all().some(c=>c.name==='fish_sp'))db.exec('ALTER TABLE sponsor_preferences ADD COLUMN fish_sp TEXT');
 if(!db.prepare('PRAGMA table_info(sponsor_preferences)').all().some(c=>c.name==='display_name'))db.exec('ALTER TABLE sponsor_preferences ADD COLUMN display_name TEXT');
 const config=()=>ctx.configStore.active().config;
 // SPONSOR-CHOICES-V2: existing illustrated species; cosmetic wall only.
 const extraFish={reef:['p_prismguppy','p_auroratetra','p_starbetta','p_nebulapearl'],tide:['p_dragonseahorse','p_iceangel','p_sakuraranchu','p_crystaldiscus'],ocean:['p_galaxykoi','p_phoenixangel','p_crimsonray','p_rainboweel'],aurora:['p_goldarowana','p_sakurakoi','p_thunderflowerhorn','p_auroraray'],eternal:['p_phoenixbetta','p_galaxyarapaima','p_imperialkoi','p_abyssleviathan']};
 function choices(){const cfg=config(),c=sponsorCfg(cfg);return [...['goldfish','guppy','neon','clown'].map(sp=>({sp,minTwd:1})),...c.tiers.flatMap(t=>[t.sp,...(extraFish[t.id]||[])].map(sp=>({sp,minTwd:t.priceTwd})))].filter(x=>cfg.species?.[x.sp]&&!cfg.species[x.sp].disabled&&!cfg.species[x.sp].monthlyExclusive&&cfg.species[x.sp].family!=='monthly').filter((v,i,a)=>a.findIndex(x=>x.sp===v.sp)===i)}

 function selected(pref,total){const opts=choices().filter(x=>total>=x.minTwd);return opts.find(x=>x.sp===(pref&&pref.fish_sp))?.sp||opts[0]?.sp||null}

 const state=pid=>{const c=sponsorCfg(config()),p=progress(db,pid,config()),pref=db.prepare('SELECT public_name,fish_sp,display_name FROM sponsor_preferences WHERE player_id=?').get(pid);return {enabled:c.enabled,tiers:c.tiers,...p,publicName:!!(pref&&pref.public_name),displayName:pref?.display_name||playersName(pid),fishSp:selected(pref,p.total),fishChoices:choices().map(x=>({...x,unlocked:p.total>=x.minTwd})),wall:wall()}};
 function playersName(pid){return db.prepare('SELECT nickname FROM players WHERE id=?').get(pid)?.nickname||'魚友'}
 function wall(){const tiers=sponsorCfg(config()).tiers;return db.prepare(`SELECT p.id,p.nickname,s.display_name,s.fish_sp,SUM(o.amount) total FROM sponsor_preferences s JOIN players p ON p.id=s.player_id JOIN orders o ON o.player_id=p.id WHERE s.public_name=1 AND p.banned_at IS NULL AND o.status='paid' AND o.currency='TWD' AND o.provider IN ('ecpay','newebpay') AND o.credited_at IS NOT NULL AND json_valid(o.grants) AND json_extract(o.grants,'$.sponsor') IS NOT NULL GROUP BY p.id HAVING SUM(o.amount)>0 ORDER BY p.id`).all().map(p=>{const t=tiers.filter(t=>p.total>=t.priceTwd).pop();return {id:p.id,name:p.display_name||p.nickname||'魚友',total:Number(p.total),tier:t?.id||null,tierName:t?.name||'海洋夥伴',badge:t?.badge||'💙',sp:selected(p,p.total)}}).filter(p=>p.sp);}
 const r=express.Router();r.use(express.json({limit:'1kb'}));const auth=players.auth();
 const wrap=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req)).then(x=>res.json(x)).catch(next);
 r.get('/',auth,wrap(req=>state(req.player.id)));
 r.post('/visibility',auth,wrap(req=>{if(!req.player.username)throw new HttpError(403,'members_only','請先登入會員');if(req.body.publicName===true&&paidTotal(db,req.player.id)<=0)throw new HttpError(403,'support_required','完成贊助後即可加入守護者魚缸');if(typeof req.body.publicName!=='boolean')throw new HttpError(400,'invalid_visibility','請選擇是否出現在感謝名單');db.prepare('INSERT INTO sponsor_preferences(player_id,public_name,updated_at) VALUES(?,?,?) ON CONFLICT(player_id) DO UPDATE SET public_name=excluded.public_name,updated_at=excluded.updated_at').run(req.player.id,req.body.publicName?1:0,Date.now());return state(req.player.id)}));
 r.post('/fish',auth,wrap(req=>{if(!req.player.username)throw new HttpError(403,'members_only','請先登入會員');const p=progress(db,req.player.id,config()),opt=choices().find(x=>x.sp===req.body.sp);if(!opt||p.total<opt.minTwd)throw new HttpError(403,'fish_locked','這隻魚尚未解鎖，請選擇符合累積贊助金額的魚種');db.prepare('INSERT INTO sponsor_preferences(player_id,public_name,fish_sp,updated_at) VALUES(?,0,?,?) ON CONFLICT(player_id) DO UPDATE SET fish_sp=excluded.fish_sp,updated_at=excluded.updated_at').run(req.player.id,opt.sp,Date.now());return state(req.player.id)}));
 r.post('/profile',auth,wrap(req=>{if(!req.player.username)throw new HttpError(403,'members_only','請先登入會員');if(paidTotal(db,req.player.id)<=0)throw new HttpError(403,'support_required','完成贊助後即可加入守護者魚缸');const name=typeof req.body.name==='string'?req.body.name.trim():'';if(!name||Array.from(name).length>20||/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(name))throw new HttpError(400,'invalid_name','請填寫 1～20 個字的顯示名稱');db.prepare('INSERT INTO sponsor_preferences(player_id,public_name,display_name,updated_at) VALUES(?,1,?,?) ON CONFLICT(player_id) DO UPDATE SET public_name=1,display_name=excluded.display_name,updated_at=excluded.updated_at').run(req.player.id,name,Date.now());return state(req.player.id)}));
 app.use('/api/sponsor',r);ctx.sponsor={state,progress:pid=>progress(db,pid,config())};return ctx.sponsor;
}
module.exports={sponsorCfg,progress,paidTotal,mountSponsor,SPONSOR_TIERS:TIERS};
