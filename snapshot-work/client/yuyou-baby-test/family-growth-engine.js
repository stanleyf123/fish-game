import * as base from './companion-growth-engine.js?v=215a';
import {FAMILIES} from './family-growth-data.js?v=216a';
export {FAMILIES} from './family-growth-data.js?v=216a';
export {FOODS, WAYS, ELEMENTS, ELEMENT_IDS, STAGES, scores, dominant, temperament, practiceRules, timingPosition, judgeTiming, feed, care, practice, rest, rename} from './companion-growth-engine.js?v=215a';
export const STORAGE_KEY='feedfishs.yuyou-baby.family-growth.v3';
export const PREVIOUS_KEY=base.STORAGE_KEY;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k),clone=x=>JSON.parse(JSON.stringify(x));
const known=f=>typeof f==='string'&&own(FAMILIES,f);
const integer=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000;
export function familyFormFor(family,pet){
  if(!known(family))throw Error('INVALID_FAMILY');
  if(!Number.isInteger(pet.stage)||pet.stage<0||pet.stage>2)throw Error('UNAVAILABLE_FORM');
  if(!pet.stage)return {...FAMILIES[family].juvenile};
  const forms=FAMILIES[family].forms;
  if(!own(forms,pet.branch)||!forms[pet.branch][pet.stage-1])throw Error('UNAVAILABLE_FORM');
  return {...forms[pet.branch][pet.stage-1]};
}
export function validBook(book){
  try{
    if(!book||book.schema!==3||!integer(book.rev)||!known(book.active)||!book.pets||Array.isArray(book.pets)||!own(book.pets,'hornling')||!own(book.pets,book.active))return false;
    const ids=Object.keys(book.pets);if(!ids.length||ids.length>Object.keys(FAMILIES).length||ids.some(f=>!known(f)))return false;
    return ids.every(f=>base.validProfile(book.pets[f])&&(!book.pets[f].stage||FAMILIES[f].elements.includes(book.pets[f].branch)))&&new Set(ids.map(f=>book.pets[f].id)).size===ids.length;
  }catch{return false;}
}
export function parseBook(raw){try{const b=JSON.parse(raw);return validBook(b)?b:null;}catch{return null;}}
export function createBook(id,existingHornling=null){
  if(existingHornling!==null&&!base.validProfile(existingHornling))throw Error('INVALID_IMPORT');
  const book={schema:3,rev:0,active:'hornling',pets:{hornling:existingHornling?clone(existingHornling):base.createProfile(id)}};
  if(!validBook(book))throw Error('INVALID_BOOK');return book;
}
export function activePet(book){if(!validBook(book))throw Error('INVALID_BOOK');return book.pets[book.active];}
export function selectFamily(book,family,newId){
  if(!validBook(book))throw Error('INVALID_BOOK');if(!known(family))throw Error('INVALID_FAMILY');
  const next=clone(book);if(!own(next.pets,family)){
    if(typeof newId!=='string')throw Error('NEW_ID_REQUIRED');
    const pet=base.createProfile(newId);pet.name=FAMILIES[family].defaultName;next.pets[family]=pet;
  }
  if(next.active!==family){next.active=family;next.rev++;}
  if(!validBook(next))throw Error('INVALID_BOOK');return next;
}
export function familyEvolutionChecks(family,pet){
  if(!known(family))throw Error('INVALID_FAMILY');
  const checks=base.evolutionChecks(pet);
  if(FAMILIES[family].elements.length<base.ELEMENT_IDS.length&&pet.stage===0){
    const available=FAMILIES[family].elements.includes(base.dominant(pet.totals).element);
    checks.push({id:'available',label:'這次已開放的成長路線',value:available?1:0,goal:1,done:available});
  }
  return checks;
}
export function familyCanEvolve(family,pet){return pet.stage<2&&familyEvolutionChecks(family,pet).every(c=>c.done);}
export function evolveForFamily(family,pet){
  if(!familyCanEvolve(family,pet))throw Error('NOT_READY');
  const next=base.evolve(pet);
  next.journal[0].text='你的'+next.name+'長成了'+familyFormFor(family,next).name+'，還是同一位夥伴。';
  if(!base.validProfile(next))throw Error('INVALID_PROFILE');return next;
}
export function updateActive(book,fn){
  if(!validBook(book))throw Error('INVALID_BOOK');
  const next=clone(book),previous=next.pets[next.active],pet=fn(clone(previous));
  if(!base.validProfile(pet)||pet.id!==previous.id||pet.rev<previous.rev)throw Error('INVALID_PROFILE');
  next.pets[next.active]=pet;next.rev++;
  if(!validBook(next))throw Error('INVALID_BOOK');return next;
}
export function importPrevious(raw){const pet=base.parseProfile(raw);return pet?createBook('unused-import-id',pet):null;}
export function importWater(raw){const pet=base.importWaterProfile(raw);return pet?createBook('unused-import-id',pet):null;}
