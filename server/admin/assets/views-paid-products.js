(function(){
 const {h,fmtNum:f}=A;
 Views['paid-products']=async function(main){
  const st=Views['paid-products'].st||(Views['paid-products'].st={range:'30d',from:'',to:'',currency:'gems',query:''});
  main.innerHTML='<h1>📊 付費商品統計</h1><p class="muted">正在載入商品交易統計…</p>';
  const qs=new URLSearchParams({range:st.range,from:st.from,to:st.to}),d=await A.get('/paid-products?'+qs);
  if(!main.isConnected||location.hash.split('/')[0]!=='#paid-products')return;
  function render(){const b=d[st.currency],T=b.totals,unit=st.currency==='gems'?'💎':'NT$',list=b.products.filter(r=>(r.name+' '+r.category+' '+r.key).toLowerCase().includes(st.query.toLowerCase()));
   main.innerHTML=`<h1>📊 付費商品統計</h1><p class="sub">${h(d.range.fromDay)} ～ ${h(d.range.toDay)} · 台灣時間 · 期間內有交易的商品</p><div class="toolbar"><label>期間 <select id="ppRange">${[['today','今天'],['yesterday','昨天'],['7d','最近7天'],['30d','最近30天'],['month','本月'],['lastmonth','上個月'],['custom','自訂日期']].map(([v,n])=>`<option value="${v}" ${st.range===v?'selected':''}>${n}</option>`).join('')}</select></label>${st.range==='custom'?`<label>起日 <input type="date" id="ppFrom" value="${h(st.from||d.range.fromDay)}"></label><label>迄日 <input type="date" id="ppTo" value="${h(st.to||d.range.toDay)}"></label>`:''}<button class="btn" id="ppReload">更新統計</button></div>
    <div class="toolbar" role="group" aria-label="統計幣別"><button class="btn ${st.currency==='gems'?'primary':'ghost'}" data-pp-currency="gems">💎 鑽石商品消費</button><button class="btn ${st.currency==='twd'?'primary':'ghost'}" data-pp-currency="twd">💳 台幣商品收入</button></div>
    <p class="muted">${st.currency==='gems'?'包含限定魚、水草、造景、設備、魚蛋、繁殖與收藏庫等鑽石消費。鑽石可能來自儲值或遊戲獎勵，不換算成台幣營收。':'只計算金流已確認入帳的台幣商品，待付款、示範玩家、模擬交易及後台補入帳不計入。'}</p>
    <div class="kpis">${[['購買筆數',f(T.transactions)],['購買人數',f(T.buyers)],['商品數量／抽數',f(T.units)],[st.currency==='gems'?'鑽石總消耗':'商品收入',unit+f(T.gross)],['退款',unit+f(T.refunds)],[st.currency==='gems'?'扣除退款後消耗':'淨收入',unit+f(T.net)]].map(([n,v])=>`<div class="kpi"><div class="l">${n}</div><div class="v">${v}</div></div>`).join('')}</div>
    <label class="f">搜尋商品<input id="ppSearch" type="search" placeholder="魚蛋、月卡、設備、商品名稱…" value="${h(st.query)}"></label><p class="muted mini">十連抽算1筆、10抽；人數為不重複玩家。退款依退款日期計入，因此跨期退款可能產生負數淨額。</p>
    <style>@media(max-width:600px){#ppTable,#ppTable tbody{display:block;min-width:0!important}#ppTable thead{display:none}#ppTable tr{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:14px 0;border-bottom:1px solid #345064}#ppTable td{display:block;border:0;padding:0;min-width:0;overflow-wrap:anywhere}#ppTable td:first-child,#ppTable td:nth-child(2){grid-column:1/-1}#ppTable td[data-label]::before{content:attr(data-label);display:block;font-size:11px;color:#a7bdce;margin-bottom:3px}}</style><div class="card" style="overflow-x:auto"><table id="ppTable" style="min-width:650px;width:100%"><thead><tr><th>商品</th><th>分類</th><th>筆數</th><th>數量／抽數</th><th>人數</th><th>${st.currency==='gems'?'消耗鑽石':'收入'}</th><th>退款</th><th>淨額</th></tr></thead><tbody id="ppRows">${rows(list,unit)}</tbody></table></div><p class="muted mini">更新 ${A.fmtTime(d.generatedAt)} · ${b.products.length} 項有交易商品 · 已排除示範帳號</p>`;
   main.querySelector('#ppRange').onchange=e=>{st.range=e.target.value;Views['paid-products'](main)};
   main.querySelector('#ppReload').onclick=()=>{st.from=main.querySelector('#ppFrom')?.value||st.from;st.to=main.querySelector('#ppTo')?.value||st.to;Views['paid-products'](main)};
   main.querySelectorAll('[data-pp-currency]').forEach(x=>x.onclick=()=>{st.currency=x.dataset.ppCurrency;render()});
   main.querySelector('#ppSearch').oninput=e=>{st.query=e.target.value;main.querySelector('#ppRows').innerHTML=rows(b.products.filter(r=>(r.name+' '+r.category+' '+r.key).toLowerCase().includes(st.query.toLowerCase())),unit)};
  }
  function rows(list,unit){return list.length?list.map(r=>`<tr><td><b>${h(r.name)}</b></td><td>${h(r.category)}</td><td data-label="筆數">${f(r.transactions)}</td><td data-label="數量／抽數">${f(r.units)}</td><td data-label="人數">${f(r.buyers)}</td><td data-label="總額">${unit}${f(r.gross)}</td><td data-label="退款">${unit}${f(r.refunds)}</td><td data-label="淨額">${unit}${f(r.net)}</td></tr>`).join(''):'<tr><td colspan="8" class="muted">這段期間沒有符合條件的交易</td></tr>'}
  render();
 };
})();
