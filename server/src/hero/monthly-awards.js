'use strict';
const PRIZES=[100,50,30,20,10]; // legacy (<= 2026-10)
// PVPDOUBLE-V1: prizes depend on the month being settled (Taipei month key). Newest first; first entry with month>=from wins.
const PRIZE_SCHEDULE=[{from:'2026-11',prizes:[200,100,60,40,20]},{from:'0000-00',prizes:PRIZES}];
function prizesFor(month){const s=PRIZE_SCHEDULE.find(x=>String(month)>=x.from);return (s?s.prizes:PRIZES).slice()}
// PVPMONTHRESET-V1: from 2026-10 on, after a month's top-5 payout is recorded (same transaction), every hero's month stats are archived
// into hero_monthly_records and rating/peak reset to the start rating. Lifetime heroes.wins/losses/def_* stay untouched (avatar unlock
// "英雄魚勝利 N 場" uses lifetime wins); monthly W/L = lifetime − base_* offsets, and base_* are moved up to lifetime at each reset.
const RESET_FROM='2026-10';
const MW='(h.wins-h.base_wins)',ML='(h.losses-h.base_losses)',MDW='(h.def_wins-h.base_def_wins)',MDL='(h.def_losses-h.base_def_losses)';
const MBATTLES=`(${MW}+${ML}+${MDW}+${MDL})`;
function monthKey(t){return new Date(t+8*3600000).toISOString().slice(0,7)}
function monthEnd(key){const [y,m]=key.split('-').map(Number);return Date.UTC(y,m,1)-8*3600000}
function prevMonth(key){const [y,m]=key.split('-').map(Number);return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,'0')}`}
class MonthlyAwards{
 constructor(ctx,opts={}){this.db=ctx.db;this.rewards=ctx.rewards;this.startRating=opts.startRating||(()=>1000);this.db.exec(`
 CREATE TABLE IF NOT EXISTS hero_monthly_awards(month TEXT PRIMARY KEY,settled_at INTEGER);
 CREATE TABLE IF NOT EXISTS hero_monthly_standings(month TEXT NOT NULL,player_id INTEGER NOT NULL,rating INTEGER NOT NULL,PRIMARY KEY(month,player_id));
 CREATE TABLE IF NOT EXISTS hero_monthly_prizes(month TEXT NOT NULL,position INTEGER NOT NULL,player_id INTEGER NOT NULL,rating INTEGER NOT NULL,gems INTEGER NOT NULL,reward_id INTEGER NOT NULL,PRIMARY KEY(month,position),UNIQUE(month,player_id));
 CREATE TABLE IF NOT EXISTS hero_monthly_records(month TEXT NOT NULL,player_id INTEGER NOT NULL,position INTEGER,rating INTEGER NOT NULL,peak_rating INTEGER NOT NULL,wins INTEGER NOT NULL,losses INTEGER NOT NULL,def_wins INTEGER NOT NULL,def_losses INTEGER NOT NULL,battles INTEGER NOT NULL,lifetime_wins INTEGER NOT NULL,lifetime_losses INTEGER NOT NULL,lifetime_def_wins INTEGER NOT NULL,lifetime_def_losses INTEGER NOT NULL,season_battles INTEGER NOT NULL,level INTEGER,species TEXT,fish_name TEXT,nickname TEXT,eligible INTEGER NOT NULL DEFAULT 0,archived_at INTEGER NOT NULL,PRIMARY KEY(month,player_id));`);
  const cols=t=>this.db.prepare(`PRAGMA table_info(${t})`).all().map(c=>c.name);
  if(!cols('hero_monthly_awards').includes('reset_at'))this.db.exec('ALTER TABLE hero_monthly_awards ADD COLUMN reset_at INTEGER');
  const hc=cols('heroes');for(const c of ['base_wins','base_losses','base_def_wins','base_def_losses'])if(!hc.includes(c))this.db.exec(`ALTER TABLE heroes ADD COLUMN ${c} INTEGER NOT NULL DEFAULT 0`);
 }
 capture(t=Date.now()){
  const month=monthKey(t);this.db.transaction(()=>{
   this.db.prepare('INSERT OR IGNORE INTO hero_monthly_awards(month) VALUES (?)').run(month);
   if(this.db.prepare('SELECT settled_at FROM hero_monthly_awards WHERE month=?').get(month).settled_at!==null)return;
   this.db.prepare('DELETE FROM hero_monthly_standings WHERE month=?').run(month);
   this.db.prepare(`INSERT INTO hero_monthly_standings(month,player_id,rating) SELECT ?,h.player_id,h.rating FROM heroes h JOIN players p ON p.id=h.player_id WHERE p.username IS NOT NULL AND p.banned_at IS NULL AND h.pvp_banned_at IS NULL AND ${MBATTLES}>0`).run(month);
  })();
 }
 // Archive every hero's stats for `month`, then start the next month fresh. Only called after that month's payout row is settled.
 rollover(month,t){
  const sr=Number(this.startRating())||1000;
  this.db.prepare(`INSERT OR IGNORE INTO hero_monthly_records(month,player_id,position,rating,peak_rating,wins,losses,def_wins,def_losses,battles,lifetime_wins,lifetime_losses,lifetime_def_wins,lifetime_def_losses,season_battles,level,species,fish_name,nickname,eligible,archived_at)
   SELECT ?,h.player_id,CASE WHEN e.ok=1 THEN ROW_NUMBER() OVER (PARTITION BY e.ok ORDER BY h.rating DESC,h.player_id) END,h.rating,h.peak_rating,${MW},${ML},${MDW},${MDL},${MBATTLES},h.wins,h.losses,h.def_wins,h.def_losses,h.season_battles,h.level,h.species,h.fish_name,p.nickname,e.ok,?
   FROM heroes h JOIN players p ON p.id=h.player_id JOIN (SELECT h2.player_id pid,CASE WHEN p2.username IS NOT NULL AND p2.banned_at IS NULL AND h2.pvp_banned_at IS NULL AND (h2.wins-h2.base_wins+h2.losses-h2.base_losses+h2.def_wins-h2.base_def_wins+h2.def_losses-h2.base_def_losses)>0 THEN 1 ELSE 0 END ok FROM heroes h2 JOIN players p2 ON p2.id=h2.player_id) e ON e.pid=h.player_id`).run(month,t);
  const n=this.db.prepare('SELECT COUNT(*) n FROM hero_monthly_records WHERE month=?').get(month).n;
  this.db.prepare('UPDATE heroes SET rating=?,peak_rating=?,base_wins=wins,base_losses=losses,base_def_wins=def_wins,base_def_losses=def_losses').run(sr,sr);
  this.db.prepare('UPDATE hero_monthly_awards SET reset_at=? WHERE month=?').run(t,month);
  console.log(`[hero-monthly] ${month} archived ${n} heroes; ratings reset to ${sr}`);
 }
 tick(t=Date.now()){
  const current=monthKey(t);this.db.transaction(()=>{
   const due=this.db.prepare('SELECT month FROM hero_monthly_awards WHERE month<? AND settled_at IS NULL ORDER BY month').all(current);
   for(const {month} of due){
    const rows=this.db.prepare(`SELECT s.player_id,s.rating FROM hero_monthly_standings s JOIN players p ON p.id=s.player_id JOIN heroes h ON h.player_id=s.player_id WHERE s.month=? AND p.username IS NOT NULL AND p.banned_at IS NULL AND h.pvp_banned_at IS NULL ORDER BY s.rating DESC,s.player_id LIMIT 5`).all(month);
    const prizes=prizesFor(month);
    rows.forEach((r,i)=>{const gems=prizes[i];const rw=this.rewards.create({title:`${month} 對戰月榜第 ${i+1} 名獎勵`,body:`恭喜你在 ${month} 對戰排行榜以 ${r.rating} 積分獲得第 ${i+1} 名！獎勵 ${gems} 鑽石，請點擊領取。名次依台灣時間月底排行榜結算。`,target:'player',playerId:r.player_id,gems});this.db.prepare('INSERT INTO hero_monthly_prizes(month,position,player_id,rating,gems,reward_id) VALUES (?,?,?,?,?,?)').run(month,i+1,r.player_id,r.rating,gems,rw.id)});
    this.db.prepare('UPDATE hero_monthly_awards SET settled_at=? WHERE month=?').run(t,month);
   }
   // Reset strictly after payout is recorded (settled_at set), once per month (reset_at marker); only the latest finished month resets ratings.
   const toReset=this.db.prepare('SELECT month FROM hero_monthly_awards WHERE month<? AND month>=? AND settled_at IS NOT NULL AND reset_at IS NULL ORDER BY month').all(current,RESET_FROM);
   for(const {month} of toReset)this.rollover(month,t);
   this.capture(t);
  })();
 }
 lastMonth(pid,t=Date.now()){
  const month=prevMonth(monthKey(t));
  const st=this.db.prepare('SELECT settled_at,reset_at FROM hero_monthly_awards WHERE month=?').get(month);if(!st||!st.settled_at)return null;
  const winners=this.db.prepare('SELECT z.position,z.player_id playerId,z.rating,z.gems,p.nickname FROM hero_monthly_prizes z JOIN players p ON p.id=z.player_id WHERE z.month=? ORDER BY z.position').all(month).map(w=>({...w,nickname:w.nickname||'神秘魚主'}));
  let me=null;if(pid){const r=this.db.prepare('SELECT position,rating,peak_rating,wins,losses,def_wins,def_losses,battles FROM hero_monthly_records WHERE month=? AND player_id=?').get(month,pid);if(r&&r.battles>0)me={position:r.position,rating:r.rating,peak:r.peak_rating,wins:r.wins,losses:r.losses,defWins:r.def_wins,defLosses:r.def_losses,battles:r.battles}}
  return{month,winners,me,participants:this.db.prepare('SELECT COUNT(*) n FROM hero_monthly_records WHERE month=? AND eligible=1').get(month).n};
 }
 info(t=Date.now()){const month=monthKey(t),nm=monthKey(monthEnd(month)),cur=prizesFor(month),nx=prizesFor(nm),fmt=a=>a.map((gems,i)=>({position:i+1,gems}));
  const out={month,endsAt:monthEnd(month),timezone:'Asia/Taipei',prizes:fmt(cur),monthlyReset:true};if(nx.join()!==cur.join())out.next={month:nm,prizes:fmt(nx)};return out}
 start(){if(this.timer)return;this.tick();this.timer=setInterval(()=>{try{this.tick()}catch(e){console.error('[hero-monthly]',e.message)}},60000);this.timer.unref()}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null}
}
module.exports={MonthlyAwards,monthKey,monthEnd,prevMonth,prizesFor,PRIZE_SCHEDULE,RESET_FROM,MW,ML,MDW,MDL,MBATTLES};
