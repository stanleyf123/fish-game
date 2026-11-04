import {ELEMENT_IDS,formFor} from './companion-growth-engine.js?v=215a';
const hornForms=Object.freeze(Object.fromEntries(ELEMENT_IDS.map(branch=>[branch,Object.freeze([1,2].map(stage=>Object.freeze(formFor({stage,branch}))))])));
const labels={metal:'金',wood:'木',water:'水',fire:'火',earth:'土',light:'光',dark:'暗'};
const wingForm=(branch,stage,name,line)=>Object.freeze({id:stage,title:labels[branch]+'系'+(stage==='mature'?'成熟':'完全'),name,line,art:branch==='water'?'art/growth216/wingrover-'+stage+'216.webp':'art/growth216/wingrover-'+branch+'-'+stage+'216'+(stage==='complete'&&['fire','earth'].includes(branch)?'-v2':'')+'.webp'});
const wingBranch=(branch,names,lines)=>Object.freeze(['mature','complete'].map((stage,i)=>wingForm(branch,stage,names[i],lines[i])));
export const FAMILIES=Object.freeze({
  hornling:Object.freeze({name:'犄角',defaultName:'泡泡',note:'七屬性三階已可培育',elements:Object.freeze([...ELEMENT_IDS]),juvenile:Object.freeze(formFor({stage:0})),forms:hornForms}),
  wingrover:Object.freeze({name:'羽巡',defaultName:'羽羽',note:'七屬性三階已可培育',elements:Object.freeze([...ELEMENT_IDS]),juvenile:Object.freeze({id:'juvenile',name:'羽巡',title:'幼年',line:'張開小小的翼，想和你一起看看世界。',art:'art/growth216/wingrover-juvenile216.webp'}),forms:Object.freeze({
    metal:wingBranch('metal',['鈴羽','鎏翼'],['羽片慢慢變得堅韌，想替你守住每個小日常。','把羽翼養成穩穩的翼掌，陪你一起向前開路。']),
    wood:wingBranch('wood',['芽翎','翠帷'],['輕輕踩過枝葉，和你一起練習長大的步伐。','葉翼展開成柔軟的傘，也記得最初的小小陪伴。']),
    water:wingBranch('water',['汐羽','瀚翔'],['踏過水面的每一步，都想和你一起練習。','把陪伴養成雙翼，向著更遠的天空出發。']),
    fire:wingBranch('fire',['暖翎','炎馳'],['今天也精神滿滿，想拉著你一起練一小段路。','長腿帶著輕快步伐，連貫的焰尾穩穩陪牠轉彎。']),
    earth:wingBranch('earth',['砂羽','壤掌'],['矮矮的步伐也很踏實，喜歡在你身邊慢慢探索。','厚厚翼掌長成挖掘的本領，卻還是那個愛靠近你的夥伴。']),
    light:wingBranch('light',['曦翎','晨曜'],['小小地懸起身子，想把第一道晨光分享給你。','雙翼輕懸向上，漂亮的尾羽替每一次轉身留住平衡。']),
    dark:wingBranch('dark',['暮羽','幽巡'],['伏低身子輕輕靠近，只是想和你玩一場躲貓貓。','長身與柔軟尾舵滑過暮色，回頭仍是熟悉的笑容。'])
  })})
});
