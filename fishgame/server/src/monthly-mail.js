'use strict';
// MONTHLY-FISH-MAIL-V1: one targeted informational letter per approved period.
const {PERIODS}=require('./monthly-fish');
function enroll(db,pid=null,now=Date.now()) {
 const p=PERIODS.find(p=>now>=p.startsAt&&now<p.endsAt);if(!p)return null;
 return db.transaction(()=>{
 const key='monthly-fish-mail:'+p.id;
 let r=db.prepare('SELECT id FROM rewards WHERE filter=? AND revoked=0').get(key);
 if(!r){const action={kind:'monthly-fish',periodId:p.id,image:p.image};r={id:Number(db.prepare(`INSERT INTO rewards(title,body,items,target,filter,created_at,expires_at) VALUES(?,?,?,'filter',?,?,?)`).run('🌀 月卡限定・颱風魚等你帶回家','謝謝你陪這片小海洋一起成長！本期月卡限定「颱風魚」，游動時還有小颱風特效。11/25 前持有效月卡，每個帳號可領取一隻，領取後永久收藏。已有月卡的你也能直接領魚！',JSON.stringify({action}),key,now,p.endsAt).lastInsertRowid)};}
 const sql=`INSERT OR IGNORE INTO reward_targets(reward_id,player_id) SELECT ?,p.id FROM players p WHERE p.banned_at IS NULL AND p.is_demo=0 ${pid==null?'':'AND p.id=?'} AND (SELECT COALESCE(SUM(play_ms),0) FROM player_daily d WHERE d.player_id=p.id)>3600000`;
 const out=db.prepare(sql).run(...(pid==null?[r.id]:[r.id,pid]));
 if(out.changes)db.prepare('UPDATE rewards SET recipients=(SELECT COUNT(*) FROM reward_targets WHERE reward_id=?) WHERE id=?').run(r.id,r.id);
 return {id:r.id,added:out.changes};
 }).immediate();
}
module.exports={enroll};
