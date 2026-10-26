'use strict';
const {HttpError}=require('./util');
function unlinkIdentity(ctx,pid,provider,body={},audit){
 if(!['line','google'].includes(provider))throw new HttpError(400,'bad_provider','不支援的登入方式');
 if(Number(body.confirmPlayerId)!==pid||!Number.isFinite(Number(body.expectedCreatedAt)))throw new HttpError(400,'confirm_required','請確認玩家 ID 與目前綁定資料');
 const reason=String(body.reason||'').trim();if(reason.length<3||reason.length>500)throw new HttpError(400,'reason_required','請填寫3至500字的解除原因');
 return ctx.db.transaction(()=>{
  const db=ctx.db,p=ctx.players.get(pid);if(!p)throw new HttpError(404,'not_found','找不到玩家');
  const identity=db.prepare('SELECT * FROM player_identities WHERE player_id=? AND provider=?').get(pid,provider);
  if(!identity)throw new HttpError(404,'not_linked','這位玩家目前沒有綁定此登入方式');
  if(identity.created_at!==Number(body.expectedCreatedAt))throw new HttpError(409,'identity_changed','綁定已變動，請重新載入玩家資料');
  const remaining=db.prepare('SELECT provider FROM player_identities WHERE player_id=? AND provider<>?').all(pid,provider),lastMethod=!p.pass_hash&&!remaining.length;
  if(lastMethod&&body.allowLastMethod!==true)throw new HttpError(409,'last_method','這是唯一登入方式，請確認玩家要求釋放誤建帳號的綁定');
  // Release the synthetic OAuth username too, so a later LINE registration cannot collide.
  const renamed=p.username===provider+':'+identity.sub;
  if(renamed)db.prepare('UPDATE players SET username=? WHERE id=?').run('detached:'+pid+':'+require('crypto').randomUUID(),pid);
  db.prepare('DELETE FROM player_identities WHERE player_id=? AND provider=?').run(pid,provider);
  const sessionsRevoked=db.prepare('DELETE FROM player_tokens WHERE player_id=?').run(pid).changes;
  db.prepare('DELETE FROM oauth_states WHERE player_id=?').run(pid);
  const detail={provider,reason,lastMethod,remainingProviders:remaining.map(x=>x.provider),sessionsRevoked,previousUsername:p.username,identity};
  audit('player.identity_unlinked',String(pid),detail);
  ctx.players.logEvent(pid,'identity_unlinked',{provider,by:'admin',reason,lastMethod});
  return {ok:true,provider,lastMethod,sessionsRevoked,remainingProviders:detail.remainingProviders};
 })();
}
module.exports={unlinkIdentity};
