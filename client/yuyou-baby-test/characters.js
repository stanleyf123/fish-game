const characters=[
  {
    "id": "hornling",
    "name": "犄角",
    "family": "角獸",
    "tag": "雙角・重拳",
    "feature": "厚彎雙角 × 巨掌短尾",
    "description": "雙角向後彎起，粗壯前臂與短腿撐起三角身形。牠總是先站穩，再用巨掌替同伴開路。",
    "skill": "角勢衝撞"
  },
  {
    "id": "wingrover",
    "name": "羽巡",
    "family": "翼獸",
    "tag": "寬翼・空行",
    "feature": "完整雙翼 × 三瓣羽尾",
    "description": "四足與寬翼分工，能在地面奔跑，也能借風滑翔。扇形羽尾控制轉向，羽冠會隨心情豎起。",
    "skill": "旋羽連擊"
  },
  {
    "id": "finrover",
    "name": "鰭游",
    "family": "鰭獸",
    "tag": "鰭尾・遊走",
    "feature": "扇狀外鰓 × 寬槳長尾",
    "description": "修長身體貼近地面，蹼足與槳尾推動身體。頭側的鰓鬚感知細微振動，背鰭穩住急轉。",
    "skill": "迴鰭拍擊"
  },
  {
    "id": "whorlshell",
    "name": "盤螺",
    "family": "殼獸",
    "tag": "旋殼・雙鉗",
    "feature": "大旋螺殼 × 異形雙鉗",
    "description": "厚重旋殼裡藏著靈活的身體，寬鉗負責擋擊，細長彎鉗找到縫隙。眼柄會比牠先探出來。",
    "skill": "旋殼反擊"
  },
  {
    "id": "silkcocoon",
    "name": "絲繭",
    "family": "繭獸",
    "tag": "絲鬚・節拍",
    "feature": "羽狀觸鬚 × 六足繭身",
    "description": "六隻短足支撐分節繭身，柔軟絲鬃收放自如。背上小翼尚未展開，觸鬚已能捕捉對手的節奏。",
    "skill": "纏絲牽制"
  },
  {
    "id": "riftclaw",
    "name": "裂爪",
    "family": "刃獸",
    "tag": "多肢・追獵",
    "feature": "雙弧骨刃 × 四足鉤尾",
    "description": "四足輪流支撐轉向，另兩隻前肢長成外展骨刃。鉤尾維持平衡，讓追擊能在瞬間改變方向。",
    "skill": "雙弧裂擊"
  },
  {
    "id": "ridgeball",
    "name": "脊團",
    "family": "甲獸",
    "tag": "疊甲・穩守",
    "feature": "疊片甲背 × 環節粗尾",
    "description": "低矮寬身覆滿天然疊甲，粗尾能捲向身側護住軟處。看起來慢，起步卻很有力量。",
    "skill": "團甲衝鋒"
  },
  {
    "id": "longtassel",
    "name": "長纓",
    "family": "纓獸",
    "tag": "長身・迴旋",
    "feature": "S形長軀 × 雙鬚纓尾",
    "description": "長軀盤出開放的曲線，兩隻前肢協助攀附。鬚纓與尾纓傳遞平衡，牠總能從意料外的角度繞回來。",
    "skill": "繞纓絞襲"
  },
  {
    "id": "foldear",
    "name": "折耳",
    "family": "躍獸",
    "tag": "長耳・躍行",
    "feature": "一立一折雙耳 × 菱扇尾尖",
    "description": "一隻耳朵高高立起，另一隻自然折下。強壯後腿蓄住彈力，菱形尾扇在落地前調整姿態。",
    "skill": "折返躍擊"
  },
  {
    "id": "hoverloop",
    "name": "浮環",
    "family": "環獸",
    "tag": "中空・漂行",
    "feature": "中空環軀 × 四條垂足",
    "description": "環形身體中央真正中空，側面觸手與四條垂足協調方向。表情藏在環的上緣，靠近才發現牠正看著你。",
    "skill": "環震推流"
  }
];
const $=s=>document.querySelector(s),img=c=>'art/elements209/'+c.id+'.webp?v=209a';let selected=0;const dialog=$('#detail');
$('#roster').innerHTML=characters.map((c,i)=>`<button class="character" data-character="${i}"><span class="card-top"><span class="number">${String(i+1).padStart(2,'0')}</span><span class="family">${c.family} / ${c.tag}</span></span><div class="art-frame"><img src="${img(c)}" alt="${c.name}完整全身造型" width="640" height="640"></div><div class="card-copy"><span class="character-name">${c.name}</span><span class="feature">${c.feature}</span></div><span class="base-skill">招牌 · ${c.skill}</span><span class="inspect">查看全身 <span>↗</span></span></button>`).join('');
function renderDetail(){const c=characters[selected];$('#detailBody').innerHTML=`<div class="detail-art"><img src="${img(c)}" alt="${c.name}完整全身造型" width="640" height="640"></div><div class="detail-copy"><p class="eyebrow">${c.family} / ${c.tag}</p><h2>${c.name}</h2><p class="anatomy">${c.feature}</p><p class="description">${c.description}</p><div class="signature"><small>招牌技能</small><strong>${c.skill}</strong></div><div class="evolution-paths"><small>每隻都有七條屬性進化方向</small><div>${['金','木','水','火','土','光','暗'].map(x=>`<span>${x}</span>`).join('')}</div><p>這是基礎形態。屬性進化美術與玩法接續製作。</p></div></div>`;$('#detailIndex').textContent=String(selected+1).padStart(2,'0')+' / 10';}
function openDetail(index){selected=index;renderDetail();dialog.showModal();$('#closeDetail').focus();}
$('#roster').addEventListener('click',e=>{const b=e.target.closest('[data-character]');if(b)openDetail(+b.dataset.character)});$('#closeDetail').onclick=()=>dialog.close();$('#previous').onclick=()=>{selected=(selected+9)%10;renderDetail()};$('#next').onclick=()=>{selected=(selected+1)%10;renderDetail()};dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});document.addEventListener('keydown',e=>{if(!dialog.open)return;if(e.key==='ArrowLeft')$('#previous').click();if(e.key==='ArrowRight')$('#next').click()});document.querySelector('.view-tools').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.view){document.body.dataset.view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))}else{document.body.classList.toggle('silhouette');b.setAttribute('aria-pressed',String(document.body.classList.contains('silhouette')))}});
