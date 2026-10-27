'use strict';
const PRIZES=[100,50,30,20,10];
function monthKey(t){return new Date(t+8*3600000).toISOString().slice(0,7)}
function monthEnd(key){const [y,m]=key.split('-').map(Number);return Date.UTC(y,m,1)-8*3600000}
class MonthlyAwards{
 constructor(ctx){this.db=ctx.db;this.rewards=ctx.rewards;this.db.exec(`
 CREATE TABLE IF NOT EXISTS hero_monthly_awards(month TEXT PRIMARY KEY,settled_at INTEGER);
 CREATE TABLE IF NOT EXISTS hero_monthly_standings(month TEXT NOT NULL,player_id INTEGER NOT NULL,rating INTEGER NOT NULL,PRIMARY KEY(month,player_id));
 CREATE TABLE IF NOT EXISTS hero_monthly_prizes(month TEXT NOT NULL,position INTEGER NOT NULL,player_id INTEGER NOT NULL,rating INTEGER NOT NULL,gems INTEGER NOT NULL,reward_id INTEGER NOT NULL,PRIMARY KEY(month,position),UNIQUE(month,player_id));`);}
 capture(t=Date.now()){
  const month=monthKey(t);this.db.transaction(()=>{
   this.db.prepare('INSERT OR IGNORE INTO hero_monthly_awards(month) VALUES (?)').run(month);
   if(this.db.prepare('SELECT settled_at FROM hero_monthly_awards WHERE month=?').get(month).settled_at!==null)return;
   this.db.prepare('DELETE FROM hero_monthly_standings WHERE month=?').run(month);
   this.db.prepare(`INSERT INTO hero_monthly_standings(month,player_id,rating) SELECT ?,h.player_id,h.rating FROM heroes h JOIN players p ON p.id=h.player_id WHERE p.username IS NOT NULL AND p.banned_at IS NULL AND h.pvp_banned_at IS NULL AND (h.wins+h.losses+h.def_wins+h.def_losses)>0`).run(month);
  })();
 }
 tick(t=Date.now()){
  const current=monthKey(t);this.db.transaction(()=>{
   const due=this.db.prepare('SELECT month FROM hero_monthly_awards WHERE month<? AND settled_at IS NULL ORDER BY month').all(current);
   for(const {month} of due){
    const rows=this.db.prepare(`SELECT s.player_id,s.rating FROM hero_monthly_standings s JOIN players p ON p.id=s.player_id JOIN heroes h ON h.player_id=s.player_id WHERE s.month=? AND p.username IS NOT NULL AND p.banned_at IS NULL AND h.pvp_banned_at IS NULL ORDER BY s.rating DESC,s.player_id LIMIT 5`).all(month);
    rows.forEach((r,i)=>{const gems=PRIZES[i];const rw=this.rewards.create({title:`${month} 對戰月榜第 ${i+1} 名獎勵`,body:`恭喜你在 ${month} 對戰排行榜以 ${r.rating} 積分獲得第 ${i+1} 名！獎勵 ${gems} 鑽石，請點擊領取。名次依台灣時間月底排行榜結算。`,target:'player',playerId:r.player_id,gems});this.db.prepare('INSERT INTO hero_monthly_prizes(month,position,player_id,rating,gems,reward_id) VALUES (?,?,?,?,?,?)').run(month,i+1,r.player_id,r.rating,gems,rw.id)});
    this.db.prepare('UPDATE hero_monthly_awards SET settled_at=? WHERE month=?').run(t,month);
   }
   this.capture(t);
  })();
 }
 info(t=Date.now()){const month=monthKey(t);return{month,endsAt:monthEnd(month),timezone:'Asia/Taipei',prizes:PRIZES.map((gems,i)=>({position:i+1,gems}))}}
 start(){if(this.timer)return;this.tick();this.timer=setInterval(()=>{try{this.tick()}catch(e){console.error('[hero-monthly]',e.message)}},60000);this.timer.unref()}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null}
}
module.exports={MonthlyAwards,monthKey,monthEnd};
