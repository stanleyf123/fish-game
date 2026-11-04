'use strict';
// ISOLATED CANDIDATE ONLY: not mounted by the production app; migration is explicit.
const express = require('express');
const {HttpError,bad,RateLimiter,sha256} = require('./util');
const {cleanMessage,softBadWord,profanityHits} = require('./beach');
const fs = require('fs'), path = require('path');
// Exact existing beach LINKY policy (not exported by beach.js); no public beach storage/moderation side effects.
const LINKY = /(https?:|www\.|\.(com|net|org|tw|cc|io|me|xyz|top|ly)\b|line\s*id|加line|加賴|@\w{3,}|\d{7,}|t\.me|discord\.gg)/i;
const id = v => { const n=Number(v); if(!Number.isSafeInteger(n)||n<=0) throw bad('bad_request','資料不正確'); return n; };
const keys = (body,allowed) => { if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k))) throw bad('bad_request','資料不正確'); };
const denied = () => new HttpError(404,'not_found','找不到這段留言');
class TankMessages {
  constructor(ctx,options={}) { this.ctx=ctx;this.db=ctx.db;this.enabled=options.enabled===true;this.now=options.now||(()=>Date.now());this.maxPerMinute=options.maxPerMinute||6;this.maxPerDay=options.maxPerDay||100; }
  actor(me){ if(!this.ctx.social.member(me))throw new HttpError(403,'members_only','請先登入會員'); }
  expected(me,b){ if(b.expectedActorId!==me)throw new HttpError(409,'actor_changed','帳號已切換，請重新開啟留言'); }
  thread(me,raw) {
    const ownerId=id(raw.ownerId),visitorId=id(raw.visitorId);
    if(ownerId===visitorId)throw bad('bad_request','請選擇好友');
    if(me!==ownerId&&me!==visitorId)throw denied();
    if(!this.ctx.social.member(ownerId)||!this.ctx.social.member(visitorId))throw denied();
    if(this.ctx.social.rel(ownerId,visitorId)!=='friend')throw new HttpError(403,'friends_only','只有目前的好友可以使用魚缸留言');
    const pref=this.db.prepare('SELECT enabled FROM tm249_preferences WHERE owner_id=?').get(ownerId);
    const blocked=this.db.prepare('SELECT 1 FROM tm249_blocks WHERE owner_id=? AND visitor_id=?').get(ownerId,visitorId);
    const writeBlockedReason=this.ctx.social.hidden(ownerId)?'visits_closed':blocked?'visitor_blocked':pref&& !pref.enabled?'messages_closed':null;
    return {ownerId,visitorId,actorId:me,visibility:'participants_only',maxLength:120,canWrite:!writeBlockedReason,writeBlockedReason};
  }
  row(me,r){return{id:r.id,authorId:r.author_id,text:r.deleted_at?null:r.message,createdAt:r.created_at,deleted:!!r.deleted_at,canDelete:r.author_id===me&&!r.deleted_at,canReport:r.author_id!==me&&!r.deleted_at};}
  get(me,q){const t=this.thread(me,q);const before=q.before==null?Number.MAX_SAFE_INTEGER:id(q.before);const rows=this.db.prepare('SELECT * FROM tm249_messages WHERE owner_id=? AND visitor_id=? AND id<? ORDER BY id DESC LIMIT 51').all(t.ownerId,t.visitorId,before);const more=rows.length>50;if(more)rows.pop();return{...t,messages:rows.slice().reverse().map(r=>this.row(me,r)),nextBefore:more?rows[rows.length-1].id:null};}
  list(me,q){const before=q.before==null?Number.MAX_SAFE_INTEGER:id(q.before);const rows=this.db.prepare('SELECT owner_id,visitor_id,MAX(id) last_id,MAX(created_at) updated_at FROM tm249_messages WHERE (owner_id=? OR visitor_id=?) GROUP BY owner_id,visitor_id HAVING MAX(id)<? ORDER BY last_id DESC LIMIT 51').all(me,me,before);const threads=[];for(const r of rows.slice(0,50)){try{const t=this.thread(me,{ownerId:r.owner_id,visitorId:r.visitor_id});threads.push({ownerId:t.ownerId,visitorId:t.visitorId,updatedAt:r.updated_at,canWrite:t.canWrite,writeBlockedReason:t.writeBlockedReason});}catch(e){if(e.status!==403&&e.status!==404)throw e;}}return{actorId:me,visibility:'participants_only',threads,nextBefore:rows.length>50?rows[49].last_id:null};}
  text(raw){if(typeof raw!=='string')throw bad('bad_request','請輸入文字');const text=cleanMessage(raw,120);if(!text)throw bad('empty_message','請先寫一句話');if(LINKY.test(text.normalize('NFKC')))throw bad('no_links','留言請勿包含網址或聯絡方式');if(softBadWord(text)||(this.ctx.beach?this.ctx.beach.profHits(text):profanityHits(text)).length)throw bad('inappropriate','請換個友善的說法');return text;}
  send(me,b){keys(b,['ownerId','visitorId','message','requestId','expectedActorId']);this.expected(me,b);const t=this.thread(me,b);if(typeof b.requestId!=='string'||!/^tm_[a-zA-Z0-9_-]{12,80}$/.test(b.requestId))throw bad('bad_request','請重新送出留言');const text=this.text(b.message),digest=sha256(JSON.stringify([t.ownerId,t.visitorId,text]));return this.db.transaction(()=>{
      const old=this.db.prepare('SELECT * FROM tm249_messages WHERE author_id=? AND request_id=?').get(me,b.requestId);
      if(old){if(old.payload_hash!==digest)throw new HttpError(409,'idempotency_conflict','這次送出的內容已改變，請重新送出');return{message:this.row(me,old),replayed:true};}
      if(!t.canWrite)throw new HttpError(403,t.writeBlockedReason,'目前無法新增留言');
      const now=this.now(),recent=this.db.prepare('SELECT COUNT(*) n,MIN(created_at) oldest FROM tm249_messages WHERE author_id=? AND created_at>?').get(me,now-60000);if(recent.n>=this.maxPerMinute)throw new HttpError(429,'rate_limited','請稍等再留言',{retryAfter:Math.max(1,Math.ceil((recent.oldest+60000-now)/1000))});
      const day=this.db.prepare('SELECT COUNT(*) n,MIN(created_at) oldest FROM tm249_messages WHERE author_id=? AND created_at>?').get(me,now-86400000);if(day.n>=this.maxPerDay)throw new HttpError(429,'rate_limited','今天先休息一下，稍後再來留言',{retryAfter:Math.max(1,Math.ceil((day.oldest+86400000-now)/1000))});
      const mid=Number(this.db.prepare('INSERT INTO tm249_messages(owner_id,visitor_id,author_id,message,request_id,payload_hash,created_at) VALUES(?,?,?,?,?,?,?)').run(t.ownerId,t.visitorId,me,text,b.requestId,digest,now).lastInsertRowid);return{message:this.row(me,this.db.prepare('SELECT * FROM tm249_messages WHERE id=?').get(mid)),replayed:false};
    })();}
  message(me,mid){const r=this.db.prepare('SELECT * FROM tm249_messages WHERE id=?').get(id(mid));if(!r)throw denied();this.thread(me,{ownerId:r.owner_id,visitorId:r.visitor_id});return r;}
  remove(me,mid,b){keys(b,['expectedActorId']);this.expected(me,b);const r=this.message(me,mid);if(r.author_id!==me)throw denied();this.db.prepare('UPDATE tm249_messages SET message=NULL,deleted_at=COALESCE(deleted_at,?) WHERE id=?').run(this.now(),r.id);return{ok:true};}
  report(me,mid,b){keys(b,['expectedActorId','reason']);this.expected(me,b);const r=this.message(me,mid);if(r.author_id===me||r.deleted_at)throw denied();if(!['abuse','spam','other'].includes(b.reason))throw bad('bad_request','請選擇檢舉原因');this.db.prepare('INSERT OR IGNORE INTO tm249_reports(message_id,reporter_id,reason,created_at) VALUES(?,?,?,?)').run(r.id,me,b.reason,this.now());return{ok:true};}
  preferences(me){const r=this.db.prepare('SELECT enabled FROM tm249_preferences WHERE owner_id=?').get(me);return{enabled:!r||!!r.enabled,blockedVisitorIds:this.db.prepare('SELECT visitor_id FROM tm249_blocks WHERE owner_id=? ORDER BY visitor_id').all(me).map(r=>r.visitor_id)};}
  preference(me,b){keys(b,['expectedActorId','enabled']);this.expected(me,b);if(typeof b.enabled!=='boolean')throw bad('bad_request','設定不正確');this.db.prepare('INSERT INTO tm249_preferences(owner_id,enabled) VALUES(?,?) ON CONFLICT(owner_id) DO UPDATE SET enabled=excluded.enabled').run(me,Number(b.enabled));return this.preferences(me);}
  block(me,b){keys(b,['expectedActorId','visitorId','blocked']);this.expected(me,b);if(typeof b.blocked!=='boolean')throw bad('bad_request','設定不正確');this.thread(me,{ownerId:me,visitorId:b.visitorId});if(b.blocked)this.db.prepare('INSERT OR IGNORE INTO tm249_blocks(owner_id,visitor_id) VALUES(?,?)').run(me,id(b.visitorId));else this.db.prepare('DELETE FROM tm249_blocks WHERE owner_id=? AND visitor_id=?').run(me,id(b.visitorId));return this.preferences(me);}
}
function migrateCandidate(db){db.exec(fs.readFileSync(path.join(__dirname,'tank-messages249-candidate.sql'),'utf8'));}
function mount(app,ctx,options={}){
 const s=new TankMessages(ctx,options);ctx.tankMessages249=s;const r=express.Router(),read=new RateLimiter({windowMs:60000,max:90}),act=new RateLimiter({windowMs:60000,max:30});
 r.use(express.json({limit:'4kb'}));r.use(ctx.players.auth());r.use((req,res,next)=>{res.set('Cache-Control','no-store, private');res.set('Vary','Authorization');try{if(!s.enabled||!ctx.social.S.enabled)throw new HttpError(403,'messages_off','魚缸留言暫停開放');s.actor(req.player.id);next();}catch(e){next(e);}});
 const wrap=(fn,write=false)=>(req,res,next)=>{try{const c=(write?act:read).check(req.player.id);if(!c.ok)throw new HttpError(429,'rate_limited','操作太頻繁',{retryAfter:c.retryAfter});res.json(fn(req.player.id,req));}catch(e){if(e.extra&&e.extra.retryAfter)res.set('Retry-After',String(e.extra.retryAfter));next(e);}};
 r.get('/thread',wrap((me,req)=>s.get(me,req.query)));r.get('/threads',wrap((me,req)=>s.list(me,req.query)));r.post('/thread',wrap((me,req)=>s.send(me,req.body),true));r.post('/messages/:id/delete',wrap((me,req)=>s.remove(me,req.params.id,req.body),true));r.post('/messages/:id/report',wrap((me,req)=>s.report(me,req.params.id,req.body),true));r.get('/preferences',wrap(me=>s.preferences(me)));r.post('/preferences',wrap((me,req)=>s.preference(me,req.body),true));r.post('/blocks',wrap((me,req)=>s.block(me,req.body),true));app.use('/api/social/tank-messages',r);return s;
}
module.exports={TankMessages,migrateCandidate,mount};
