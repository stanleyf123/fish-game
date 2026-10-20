const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function boot(saved){
 const nodes=new Map(),storage=new Map(saved?[['yuyou-aquarium-v1',JSON.stringify(saved)]]:[]);
 const gradient={addColorStop(){}};
 const ctx=new Proxy({createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,measureText:()=>({width:40})},{get:(o,k)=>o[k]||(()=>{})});
 function element(){return {style:{},dataset:{},children:[],classList:{add(){},remove(){},toggle(){}},textContent:'',innerHTML:'',scrollTop:0,disabled:false,addEventListener(){},appendChild(n){this.children.push(n)},getBoundingClientRect:()=>({width:800,height:580}),getContext:()=>ctx,toDataURL:()=>'',querySelector:()=>element()};}
 const document={querySelector(s){if(!nodes.has(s))nodes.set(s,element());return nodes.get(s)},querySelectorAll:()=>[],createElement:()=>element(),addEventListener(){}};
 const sandbox={document,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},console,performance:{now:()=>0},setTimeout(){},requestAnimationFrame(){},Date,Math};
 sandbox.window=sandbox;sandbox.devicePixelRatio=1;sandbox.addEventListener=()=>{};
 vm.runInNewContext(script.replace('window.__aquarium={','window.__aquarium={eat,save,newGame,refreshUI,'),sandbox);
 return {api:sandbox.__aquarium,nodes,storage};
}
const {api,nodes,storage}=boot();
assert.equal(api.state.fish.length,3);
const fish=api.state.fish[0];
for(let i=0;i<5;i++){api.dropFood(200,200);api.eat(fish,api.foods[api.foods.length-1]);}
assert.equal(api.state.journey.eaten,5);
assert.equal(api.state.coins,65,'five consecutive meals award five coins');
api.refreshUI(true);
const claim=()=>nodes.get('#questCard').onclick({target:{closest:()=>({dataset:{claim:'0'}})}});
claim();assert.equal(api.state.coins,90);claim();assert.equal(api.state.coins,90,'claimed reward cannot be duplicated');
api.save();const saved=JSON.parse(storage.get('yuyou-aquarium-v1'));
const restored=boot(saved).api;
assert.equal(restored.state.journey.eaten,5);assert.equal(restored.state.journey.claimed[0],0);
delete saved.journey;const legacy=boot(saved).api;
assert.equal(legacy.state.fish.length,3);assert.equal(legacy.state.journey.eaten,0,'legacy saves gain mission defaults');
api.step(35);const before=api.state.coins;const pending=api.coins.filter(c=>!c.fly).reduce((n,c)=>n+c.v,0);
nodes.get('#gatherBtn').onclick();api.step(1);
assert.equal(api.state.coins,before+pending);assert.ok(api.state.journey.collected>0);
api.newGame();assert.equal(api.state.journey.eaten,0);assert.equal(api.state.journey.claimed.length,0);assert.equal(api.state.coins,60);
console.log('PASS: feeding combo, mission claim protection, save persistence, legacy migration, coin gathering, reset');
