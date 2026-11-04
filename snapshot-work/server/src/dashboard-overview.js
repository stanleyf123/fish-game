'use strict';
const {resolveRange}=require('./payreport');
function overview(db,now=Date.now()){
 const R=resolveRange({range:'today'},now),a=R.from,b=R.to;
 const people=db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN username IS NOT NULL THEN 1 ELSE 0 END) members,SUM(CASE WHEN username IS NOT NULL AND bound_at>=? AND bound_at<? THEN 1 ELSE 0 END) newMembers FROM players WHERE is_demo=0`).get(a,b);
 const online=db.prepare('SELECT COUNT(DISTINCT s.player_id) n FROM game_sessions s JOIN players p ON p.id=s.player_id WHERE p.is_demo=0 AND p.banned_at IS NULL AND s.last_beat>=?').get(now-90000).n;
 const active=db.prepare('SELECT COUNT(DISTINCT d.player_id) n FROM daily_active d JOIN players p ON p.id=d.player_id WHERE p.is_demo=0 AND d.day=?').get(R.today).n;
 const money=db.prepare(`SELECT COALESCE(SUM(CASE WHEN COALESCE(o.paid_at,o.credited_at,o.created_at)>=? AND COALESCE(o.paid_at,o.credited_at,o.created_at)<? THEN o.amount ELSE 0 END),0) gross,COUNT(CASE WHEN COALESCE(o.paid_at,o.credited_at,o.created_at)>=? AND COALESCE(o.paid_at,o.credited_at,o.created_at)<? THEN 1 END) paidOrders,COALESCE(SUM(CASE WHEN o.status='refunded' AND o.refunded_at>=? AND o.refunded_at<? THEN o.amount ELSE 0 END),0) refunds FROM orders o JOIN players p ON p.id=o.player_id WHERE p.is_demo=0 AND o.provider IN ('ecpay','newebpay') AND o.currency='TWD' AND o.credited_at IS NOT NULL AND o.status IN ('paid','refunded') AND COALESCE(o.note,'') NOT LIKE '%[後台補入帳]%' AND ((COALESCE(o.paid_at,o.credited_at,o.created_at)>=? AND COALESCE(o.paid_at,o.credited_at,o.created_at)<?) OR (o.refunded_at>=? AND o.refunded_at<?))`).get(a,b,a,b,a,b,a,b,a,b);
 return {generatedAt:now,today:R.today,totalPlayers:people.total,members:people.members||0,guests:people.total-(people.members||0),newMembersToday:people.newMembers||0,onlineNow:online,activeToday:active,income:{...money,net:money.gross-money.refunds}};
}
module.exports={overview};
