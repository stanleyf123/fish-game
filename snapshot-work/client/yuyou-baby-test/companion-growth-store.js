import {STORAGE_KEY, LEGACY_WATER_KEY, createProfile, parseProfile, validProfile, importWaterProfile} from './companion-growth-engine.js?v=215a';

// Imports the previous water sample read-only, once. Other pet/adventure keys are never touched.
export function openProfile(storage, id) {
  let raw = null;
  try { raw = storage.getItem(STORAGE_KEY); }
  catch { return {profile: createProfile(id), raw, available: false, notice: ''}; }
  const saved = parseProfile(raw);
  if (saved) return {profile: saved, raw, available: true, notice: ''};
  let notice = '';
  if (raw !== null) {
    try {
      let backup = STORAGE_KEY + '.unreadable';
      const existing = storage.getItem(backup);
      if (existing !== null && existing !== raw) backup += '.' + id;
      const target = storage.getItem(backup);
      if (target !== null && target !== raw) throw Error('BACKUP_CONFLICT');
      if (target === null) storage.setItem(backup, raw);
      notice = '舊的試玩紀錄格式無法讀取，原文已保留備份；先陪新夥伴開始。';
    } catch {
      return {profile: createProfile(id), raw, available: false, notice: '這份試玩紀錄暫時無法讀取，原始資料仍保留；這次進度先留在畫面。'};
    }
  }
  let profile = null;
  if (raw === null) {
    try {
      const legacy = storage.getItem(LEGACY_WATER_KEY);
      if (legacy !== null) {
        profile = importWaterProfile(legacy);
        notice = profile ? '原本水系試玩的夥伴已接到七屬性養成，原紀錄仍保留。' : '舊水系紀錄暫時無法匯入，原文仍保留；先開始新的七屬性試玩。';
      }
    } catch { /* A readable new store can still open without legacy import. */ }
  }
  if (!profile) profile = createProfile(id);
  const nextRaw = JSON.stringify(profile);
  try { storage.setItem(STORAGE_KEY, nextRaw); return {profile, raw: nextRaw, available: true, notice}; }
  catch { return {profile, raw, available: false, notice}; }
}

export function writeProfile(storage, expectedRaw, profile) {
  if (!validProfile(profile)) return {status: 'invalid'};
  try {
    const current = storage.getItem(STORAGE_KEY);
    if (current !== expectedRaw) return {status: 'conflict', raw: current, profile: parseProfile(current)};
    const raw = JSON.stringify(profile);
    storage.setItem(STORAGE_KEY, raw);
    return {status: 'saved', raw};
  } catch { return {status: 'unavailable'}; }
}
