'use strict';
const {resolveRange}=require('./payreport');
const names={species:'限定魚',med:'藥品',speed:'加速',weekly:'本週限定',bg:'背景',cos:'外觀',social:'好友互動',breed:'繁殖',gear:'設備',plant:'水草',cutting:'水草',hero:'英雄魚',deco:'造景',skin:'英雄造型',storage:'收藏庫',egg:'魚蛋'};
const direct={ 'breed-extra':['繁殖・加購次數','繁殖'],'breed-bloodline':['繁殖・雙親血統','繁殖'],'breed-refund':['繁殖退鑽','繁殖'],xbreed:['借魚繁殖','繁殖'],fv2gift:['好友贈禮','好友互動'],'storage-expand':['收藏庫擴充','收藏庫']};
function report(db,q={},now=Date.now()){
 const range=resolveRange(q,now),from=range.from,to=range.to;
 function bucket(){return {map:new Map(),buyers:new Set(),transactions:0,units:0,gross:0,refunds:0}}
 const twd=bucket(),gems=bucket();
 function add(b,key,name,category,pid,amount,units,refund=false){let r=b.map.get(key);if(!r){r={key,name,category,transactions:0,units:0,gross:0,refunds:0,people:new Set()};b.map.set(key,r)}if(refund){r.refunds+=amount;b.refunds+=amount;return}r.transactions++;r.units+=units;r.gross+=amount;r.people.add(pid);b.transactions++;b.units+=units;b.gross+=amount;b.buyers.add(pid)}
 const real="p.is_demo=0 AND COALESCE(o.note,'') NOT LIKE '%[後台補入帳]%'";
 const paid=db.prepare(`SELECT o.* FROM orders o JOIN players p ON p.id=o.player_id WHERE ${real} AND o.currency='TWD' AND o.provider IN ('ecpay','newebpay','stripe') AND o.credited_at IS NOT NULL AND o.status IN ('paid','refunded') AND ((COALESCE(o.paid_at,o.credited_at,o.created_at)>=? AND COALESCE(o.paid_at,o.credited_at,o.created_at)<?) OR (o.refunded_at>=? AND o.refunded_at<?))`).all(from,to,from,to);
 for(const o of paid){const t=o.paid_at||o.credited_at||o.created_at;if(t>=from&&t<to)add(twd,o.sku,o.product_name,'儲值／台幣商品',o.player_id,o.amount,1);if(o.status==='refunded'&&o.refunded_at>=from&&o.refunded_at<to)add(twd,o.sku,o.product_name,'儲值／台幣商品',o.player_id,o.amount,0,true)}
 const led=db.prepare(`SELECT l.*,o.sku,o.product_name,o.currency,o.provider,e.count egg_count FROM gem_ledger l JOIN players p ON p.id=l.player_id LEFT JOIN orders o ON l.ref='order:'||o.id AND o.player_id=l.player_id LEFT JOIN diamond_egg_draws e ON l.reason='diamond_egg' AND e.idem_key=l.ref AND e.player_id=l.player_id WHERE p.is_demo=0 AND l.created_at>=? AND l.created_at<? AND ((l.delta<0 AND l.reason IN ('spend','diamond_egg')) OR (l.delta>0 AND l.reason='refund' AND (o.provider='gems' OR l.ref LIKE 'breed-refund:%')))`).all(from,to);
 for(const l of led){let key,name,category,units=1;
  if(l.reason==='diamond_egg'){units=l.egg_count||Math.max(1,Math.round(-l.delta/30));key='egg:'+units;name=units===10?'鑽石魚蛋・十連抽':'鑽石魚蛋・單抽';category='魚蛋'}
  else if(l.sku){key=l.sku;name=l.product_name;category=names[key.split(':')[0]]||'其他商品'}
  else{const prefix=String(l.ref||'').split(':')[0],d=direct[prefix];key='service:'+(prefix||l.reason);name=d?.[0]||'其他鑽石消費';category=d?.[1]||'其他服務'}
  add(gems,key,name,category,l.player_id,Math.abs(l.delta),units,l.delta>0);
 }
 function finish(b){return {totals:{transactions:b.transactions,units:b.units,buyers:b.buyers.size,gross:b.gross,refunds:b.refunds,net:b.gross-b.refunds},products:[...b.map.values()].map(({people,...r})=>({...r,buyers:people.size,net:r.gross-r.refunds})).sort((a,b)=>b.net-a.net||a.key.localeCompare(b.key))}}
 return {range:{fromDay:range.fromDay,toDay:range.toDay},generatedAt:now,twd:finish(twd),gems:finish(gems)};
}
module.exports={report};
