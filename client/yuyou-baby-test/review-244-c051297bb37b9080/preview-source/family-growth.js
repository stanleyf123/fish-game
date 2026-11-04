import {STORAGE_KEY, FAMILIES, FOODS, WAYS, STAGES, ELEMENTS, ELEMENT_IDS, familyFormFor, familyEvolutionChecks, familyCanEvolve, evolveForFamily, activePet, selectFamily, updateActive, parseBook, validBook, scores, dominant, temperament, practiceRules, timingPosition, judgeTiming, feed, care, practice, rest, rename} from './family-growth-engine.js?v=222a';
import {openBook, writeBook} from './family-growth-store.js?v=222a';

const $ = s => document.querySelector(s);
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
let storage;
try { storage = localStorage; } catch { storage = null; }
const newId=()=>globalThis.crypto?.randomUUID?.() || 'family-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
const opened = openBook(storage,newId());
let book=opened.book,state=activePet(book),lastRaw=opened.raw,storageAvailable=opened.available,renderedFamily=null;
const formFor=s=>familyFormFor(book.active,s),evolutionChecks=s=>familyEvolutionChecks(book.active,s),canEvolve=s=>familyCanEvolve(book.active,s),evolve=s=>evolveForFamily(book.active,s);
let food = 'dew', way = 'patient', session = null, raf = 0;
function saveLabel() {
  $('#saveStatus').textContent = storageAvailable ? '進度已保存在此瀏覽器' : '目前無法儲存；進度暫留本畫面，請先別關閉';
}
function commitBook(fn,response){
  try{
    const next=fn(book);if(!validBook(next))throw Error('INVALID_BOOK');
    if(storageAvailable){
      const saved=writeBook(storage,lastRaw,next);
      if(saved.status==='conflict'){
        if(saved.book){book=saved.book;state=activePet(book);lastRaw=saved.raw;render();}
        $('#response').textContent=saved.book?'另一分頁剛更新了夥伴，已同步；再選一次想做的事。':'家族紀錄在另一分頁變更了，請重新開啟這份試玩頁。';return false;
      }
      if(saved.status==='saved')lastRaw=saved.raw;else storageAvailable=false;
    }
    book=next;state=activePet(book);render();
    $('#response').textContent=typeof response==='function'?response(state):response||state.journal[0]?.text||'一起開始新的日常。';return true;
  }catch(error){
    $('#response').textContent=({ALREADY_FED:'這回合已經吃過，先陪牠玩或歇息吧。',FEED_FIRST:'先一起吃一份點心。',CARE_FIRST:'先靠近摸摸牠，再一起練習。',ALREADY_CARED:'已留下這回合的陪伴。',ALREADY_PRACTICED:'這回合已練習過了，下回合再來。',NOT_READY:'再累積一些一起生活的日常，成長線索都在下方。'})[error.message]||'這次動作沒有完成，所有夥伴的進度仍保留著。';return false;
  }
}
function commit(fn,response){return commitBook(b=>updateActive(b,fn),response);}
function renderFamilyChoices(){
  $('#familyScope').textContent=FAMILIES[book.active].name+' · '+FAMILIES[book.active].note;
  $('#familyChoices').innerHTML=Object.entries(FAMILIES).map(([id,f])=>{const pet=book.pets[id],form=pet?familyFormFor(id,pet):familyFormFor(id,{stage:0});return `<button class="family-choice" data-family="${id}" aria-pressed="${book.active===id}"><img src="${form.art}" width="640" height="640" alt="${f.name}完整造型"><span><strong>${f.name}${pet?' · '+escape(pet.name):''}</strong><small>${f.note}</small><b>${book.active===id?'正在陪牠':pet?'回到 '+escape(pet.name)+' 的日常':'開始陪牠長大'}</b></span></button>`}).join('');
}
function renderForms(){
  const family=FAMILIES[book.active];$('#collectionTitle').textContent=family.name+'的成長路線';
  $('#forms').innerHTML=`<div class="common-base"><button class="form-preview" data-preview="0"><img src="${formFor({stage:0}).art}" width="640" height="640" alt="可愛幼年" loading="lazy"><strong>幼年</strong><small>${family.name}</small></button><p>${family.elements.length===7?'七種屬性，由長期餵養慢慢累積。':family.name+'這次先開'+family.elements.map(e=>ELEMENTS[e].name).join('、')+'系三階。其他屬性還在製作。'}<br>點圖看造型，預覽不會改變成長。</p></div><div class="branch-grid">${family.elements.map(element=>`<div class="branch-card" data-element="${element}"><h3>${ELEMENTS[element].name}系</h3><div class="stage-pair">${[1,2].map(stage=>{const f=formFor({stage,branch:element});return `<button class="form-preview" data-preview="${stage}" data-preview-element="${element}"><img src="${f.art}" width="640" height="640" alt="${f.title}完整造型" loading="lazy"><strong>${f.title}</strong><small>${f.name}</small></button>`}).join('')}</div></div>`).join('')}</div>`;
}
function react(symbol = '♡', evolving = false) {
  const scene = $('#petScene');
  $('#reaction').textContent = symbol;
  scene.classList.remove('react', 'evolving');
  void scene.offsetWidth;
  scene.classList.add(evolving ? 'evolving' : 'react');
}
function render() {
  renderFamilyChoices();if(renderedFamily!==book.active){renderForms();renderedFamily=book.active;}
  document.title='悠游寶貝 · '+FAMILIES[book.active].name+'家族成長試作';
  const form = formFor(state), role = temperament(state), c = state.cycle;
  document.body.dataset.element = state.branch || dominant(state.totals).element || 'neutral';
  $('#stageBadge').textContent = form.title + ' · ' + form.name;
  $('#roundLabel').textContent = '第 ' + state.round + ' 個日常';
  const pet = $('#petArt');
  if (pet.dataset.form !== form.art) {
    pet.dataset.form = form.art; pet.hidden = false; pet.src = form.art;
  }
  pet.alt = state.name + '，' + form.title + '的完整全身造型';
  $('#petName').textContent = state.name;
  $('#petLine').textContent = form.line;
  $('#heartCount').textContent = state.totals.heart;
  $('#temperament').textContent = role.name;
  $('#growthTitle').textContent = state.stage === 0 ? '慢慢長出自己的屬性模樣。' : state.stage === 1 ? '再一起生活一段，走向完全體。' : '長大了，還是你的' + state.name + '。';
  $('#growthHint').textContent = state.stage === 0 ? (FAMILIES[book.active].elements.length<7?FAMILIES[book.active].name+'這次先開'+FAMILIES[book.active].elements.map(e=>ELEMENTS[e].name).join('、')+'系，其他屬性還在製作。':'跟著長期配餐、陪伴和練習累積。') + (dominant(state.totals).element ? '目前飲食較偏' + ELEMENTS[dominant(state.totals).element].name + '，還可以慢慢調整。' : '食材會留下七種不同傾向。') : state.stage === 1 ? '已長成' + ELEMENTS[state.branch].name + '系成熟體。繼續累積同系餐點、陪伴與練習，再升為同系完全體。' : '三階成長已完成，名字、親密和一起度過的日常都留下來了。';
  const checks = evolutionChecks(state);
  $('#requirements').innerHTML = checks.length ? checks.map(c => `<div class="requirement ${c.done ? 'done' : ''} ${c.id === 'today' ? 'today' : ''}"><div class="requirement-line"><span>${c.done ? '✓ ' : ''}${c.label}</span><b>${c.id === 'today' ? c.done ? '已陪伴' : '還等著你' : Math.floor(c.value) + (c.unit || '') + ' / ' + c.goal + (c.unit || '')}</b></div>${c.id === 'today' ? '' : `<div class="bar"><span data-width="${Math.min(100, c.value / c.goal * 100)}"></span></div>`}</div>`).join('') : `<p class="completion-copy">吃過 ${state.totals.meals} 餐 · 陪伴 ${state.totals.care} 次 · 一起練習 ${state.totals.practice} 次</p>`;
  const evolveButton = $('#evolveButton'); evolveButton.disabled = !canEvolve(state);
  const nextElement = state.branch || dominant(state.totals).element;
  evolveButton.textContent = state.stage === 2 ? '完全體 · 一起繼續生活' : canEvolve(state) ? '迎接' + ELEMENTS[nextElement].name + '系' + (state.stage === 0 ? '成熟體' : '完全體') : '再累積一些日常';
  const values = scores(state.totals), sum = Object.values(values).reduce((a, b) => a + b, 0);
  $('#tendencyBars').innerHTML = Object.entries(Object.fromEntries(ELEMENT_IDS.map(id => [id, ELEMENTS[id].name]))).map(([element, label]) => {
    const percent = sum ? values[element] / sum * 100 : 0;
    return `<div class="tendency-item" data-element="${element}"><span>${label}</span><div class="bar"><span data-width="${percent}"></span></div><b>${Math.round(percent)}%</b></div>`;
  }).join('');
  document.querySelectorAll('[data-width]').forEach(el => { el.style.width = el.dataset.width + '%'; });
  $('#mealTotal').textContent = '累積 ' + state.totals.meals + ' 餐';
  $('#practicePerk').textContent = state.stage ? role.note + '。' + (state.stage === 2 ? '完全體的基礎好拍範圍也更寬。' : '成熟後的基礎好拍範圍已變寬。') : '性格慢慢累積，成熟後會在節拍練習展現小小專長。';
  $('#routineStatus').textContent = !c.fed ? '等著點心' : !c.cared ? '想要一點陪伴' : !c.practiced ? '可以練習或先歇息' : '今天也留下了回憶';
  document.querySelectorAll('[data-food]').forEach(b => { b.disabled = c.fed; b.setAttribute('aria-checked', String(b.dataset.food === food)); });
  document.querySelectorAll('[data-way]').forEach(b => { b.disabled = c.fed; b.setAttribute('aria-checked', String(b.dataset.way === way)); });
  $('#feedButton').disabled = c.fed; $('#feedButton').textContent = c.fed ? '今天的點心吃完了' : '送上今天的點心';
  $('#careButton').disabled = !c.fed || c.cared;
  $('#practiceButton').disabled = !c.cared || c.practiced;
  $('#restButton').disabled = !c.fed;
  $('#practiceResult').textContent = c.practiced ? '本回合留下 ' + Math.ceil(c.score / 2) + ' 顆星。準備好就一起休息吧。' : '';
  $('#journal').innerHTML = state.journal.length ? state.journal.slice(0, 4).map(e => `<li><small>第 ${e.round} 回合</small>${escape(e.text)}</li>`).join('') : '<li>還沒有故事。從今天的一份點心開始。</li>';
  saveLabel();
}
$('#foods').innerHTML = Object.entries(FOODS).map(([id, f]) => `<button class="choice" data-food="${id}" role="radio" aria-checked="${id === food}"><span class="food-icon" aria-hidden="true">${f.icon}</span><strong>${f.name}</strong><small>${f.note}</small></button>`).join('');
$('#ways').innerHTML = Object.entries(WAYS).map(([id, w]) => `<button class="choice" data-way="${id}" role="radio" aria-checked="${id === way}"><strong>${w.name}</strong><small>${w.note}</small></button>`).join('');
$('#familyChoices').addEventListener('click',e=>{const b=e.target.closest('[data-family]');if(!b||b.dataset.family===book.active)return;if($('#practiceDialog').open)$('#practiceDialog').close();if(commitBook(old=>selectFamily(old,b.dataset.family,newId()),()=> '正在陪'+state.name+'。其他夥伴的日常都保留著。')){food='dew';way='patient';render();}});
$('#foods').addEventListener('click', e => { const b = e.target.closest('[data-food]'); if (b && !state.cycle.fed) { food = b.dataset.food; render(); } });
$('#ways').addEventListener('click', e => { const b = e.target.closest('[data-way]'); if (b && !state.cycle.fed) { way = b.dataset.way; render(); } });
$('#feedButton').onclick = () => { if (commit(s => feed(s, food, way), '吃下' + FOODS[food].name + '，' + state.name + '滿足地晃了晃身子。這一餐也留在累積傾向裡。')) react('◉'); };
$('#careButton').onclick = () => { if (commit(care)) react(); };
$('#restButton').onclick = () => { if (commit(rest)) { $('#response').textContent = '好好睡過一覺，' + state.name + '又帶著期待靠近你。'; } };
$('#evolveButton').onclick = () => { if (commit(evolve)) react('✦', true); };

$('#renameButton').onclick = () => { $('#nameInput').value = state.name; $('#renameDialog').showModal(); $('#nameInput').focus(); };
$('#cancelRename').onclick = () => $('#renameDialog').close();
$('#renameForm').onsubmit = e => { e.preventDefault(); if (commit(s => rename(s, $('#nameInput').value))) $('#renameDialog').close(); };
$('#forms').addEventListener('click', e => {
  const b = e.target.closest('[data-preview]'); if (!b) return;
  const f = formFor({stage:+b.dataset.preview,branch:b.dataset.previewElement}); $('#artTitle').textContent = f.title + ' · ' + f.name; $('#artLine').textContent = f.line;
  $('#previewArt').src = f.art; $('#previewArt').alt = f.title + '的完整全身造型'; $('#artDialog').showModal();
});
$('#closeArt').onclick = () => $('#artDialog').close();
$('#petArt').onerror = () => { $('#petArt').hidden = true; $('#response').textContent = '這個造型暫時沒載入成功，養成進度仍保留；重新開啟頁面再看看。'; };

function stopFrames() { if (raf) cancelAnimationFrame(raf); raf = 0; if (session) session.last = null; }
function beatFrame(now) {
  if (!session || session.done || !$('#practiceDialog').open || document.hidden) { stopFrames(); return; }
  const delta = session.last === null ? 0 : Math.min(.05, (now - session.last) / 1000);
  session.last = now; session.elapsed += delta;
  session.position = timingPosition(session.elapsed, session.rules.speed);
  $('#beatMarker').style.left = session.position * 100 + '%';
  raf = requestAnimationFrame(beatFrame);
}
function renderMarks() {
  $('#practiceMarks').innerHTML = [0, 1, 2].map(i => `<span class="beat-dot">${session.marks[i] === undefined ? i + 1 : session.marks[i] === 2 ? '★' : session.marks[i] === 1 ? '☆' : '·'}</span>`).join('');
}
$('#practiceButton').onclick = () => {
  if (!state.cycle.cared || state.cycle.practiced) return;
  session = {marks: [], rules: practiceRules(state), elapsed: 0, last: null, lastHit: -1000, position: 0, done: false};
  $('#beatZone').style.left = (50 - session.rules.width * 50) + '%'; $('#beatZone').style.width = session.rules.width * 100 + '%';
  $('#hitBeat').disabled = false; $('#hitBeat').textContent = '接住這一拍'; $('#beatMessage').textContent = '慢慢來，跟著水波。';
  $('#practiceHelp').textContent = state.stage ? temperament(state).note + '。' : '三次都是練習，失手也不會失去進度。';
  renderMarks(); $('#practiceDialog').showModal(); raf = requestAnimationFrame(beatFrame);
};
function hitBeat() {
  if (!session || session.done || document.hidden || performance.now() - session.lastHit < 350) return;
  session.lastHit = performance.now(); const mark = judgeTiming(session.position, session.rules.width); session.marks.push(mark);
  $('#beatMessage').textContent = ['沒關係，下一拍再試。', '接住了，好拍。', '正中節奏，漂亮！'][mark]; renderMarks();
  if (session.marks.length === 3) {
    session.done = true; stopFrames(); $('#hitBeat').disabled = true;
    if (commit(s => practice(s, session.marks))) {
      $('#hitBeat').textContent = '三拍完成'; $('#beatMessage').textContent = '留下 ' + Math.ceil(state.cycle.score / 2) + ' 顆星和一次練習。進度已記住。'; react('♪');
    } else $('#beatMessage').textContent = '紀錄剛更新了，先關閉練習再看看。';
  } else session.elapsed += .47;
}
$('#hitBeat').onclick = hitBeat;
$('#closePractice').onclick = () => $('#practiceDialog').close();
$('#practiceDialog').addEventListener('close', () => { stopFrames(); session = null; });
document.addEventListener('keydown', e => { if ($('#practiceDialog').open && e.code === 'Space') { e.preventDefault(); if (!e.repeat) hitBeat(); } });
document.addEventListener('visibilitychange', () => { stopFrames(); if (!document.hidden && session && !session.done) raf = requestAnimationFrame(beatFrame); });
window.addEventListener('pagehide', stopFrames);
window.addEventListener('storage', e => {
  if (e.key !== STORAGE_KEY || e.newValue === lastRaw) return;
  const newer = parseBook(e.newValue); if (!newer) return;
  if ($('#practiceDialog').open) $('#practiceDialog').close();
  book = newer; state = activePet(book); lastRaw = e.newValue; render(); $('#response').textContent = '另一分頁的日常已同步到這裡。';
});
render(); if (opened.notice) $('#response').textContent = opened.notice;
