import {STORAGE_KEY, PREVIOUS_KEY, createBook, parseBook, validBook, importPrevious, importWater} from './family-growth-engine.js?v=216a';
const WATER_KEY='feedfishs.yuyou-baby.water-growth.v1';
export function openBook(storage,id){
  let raw=null;
  try{raw=storage.getItem(STORAGE_KEY);}catch{return {book:createBook(id),raw,available:false,notice:''};}
  const saved=parseBook(raw);if(saved)return {book:saved,raw,available:true,notice:''};
  let notice='',book=null;
  if(raw!==null){
    try{
      let key=STORAGE_KEY+'.unreadable',existing=storage.getItem(key);
      if(existing!==null&&existing!==raw)key+='.'+id;
      const target=storage.getItem(key);if(target!==null&&target!==raw)throw Error('BACKUP_CONFLICT');
      if(target===null)storage.setItem(key,raw);
      notice='家族試作的紀錄暫時無法讀取，原文已保留備份；原犄角頁的紀錄沒有改動。';
    }catch{return {book:createBook(id),raw,available:false,notice:'這份試作紀錄暫時無法讀取，原文仍保留；進度先留在畫面。'};}
  }else{
    try{
      const previous=storage.getItem(PREVIOUS_KEY);
      if(previous!==null){book=importPrevious(previous);notice=book?'原犄角夥伴已複製接入家族版，原紀錄仍保留。':'原犄角紀錄暫時無法匯入，原文仍保留。';}
      else{const water=storage.getItem(WATER_KEY);if(water!==null){book=importWater(water);notice=book?'原水系夥伴已複製接入家族版，原紀錄仍保留。':'原水系紀錄暫時無法匯入，原文仍保留。';}}
    }catch{/* A fresh independent sample can still open without readable old keys. */}
  }
  if(!book)book=createBook(id);
  const nextRaw=JSON.stringify(book);
  try{storage.setItem(STORAGE_KEY,nextRaw);return {book,raw:nextRaw,available:true,notice};}
  catch{return {book,raw,available:false,notice};}
}
export function writeBook(storage,expectedRaw,book){
  if(!validBook(book))return {status:'invalid'};
  try{
    const current=storage.getItem(STORAGE_KEY);
    if(current!==expectedRaw)return {status:'conflict',raw:current,book:parseBook(current)};
    const raw=JSON.stringify(book);storage.setItem(STORAGE_KEY,raw);return {status:'saved',raw};
  }catch{return {status:'unavailable'};}
}
