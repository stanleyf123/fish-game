'use strict';
// 真實金流（現金儲值）判定：只有這些 provider 的訂單算「NT$ 儲值／付費」。
// 排除：gems（遊戲內寶石購買，currency=GEM）、admin（後台手動發放，金額 0）、mock／test／sandbox 等模擬金流。
// 例外：非正式環境且啟用模擬金流時（開發／測試），mock 視為現金以便測試營收流程。
const REAL_MONEY_PROVIDERS = Object.freeze(['ecpay', 'newebpay', 'stripe']);

function mockCountsAsMoney(env = {}) {
  if (env.NODE_ENV === 'production') return false;
  return env.PAYMENT_MOCK_ENABLED === '1' || (env.PAYMENT_MOCK_ENABLED == null && env.NODE_ENV !== 'production');
}
function realMoneyProviders(env) { return env && mockCountsAsMoney(env) ? [...REAL_MONEY_PROVIDERS, 'mock'] : [...REAL_MONEY_PROVIDERS]; }
// SQL 片段：provider 名稱是固定白名單（僅 [a-z0-9_]），可安全內嵌
function providerInSql(list, col = 'provider') {
  const safe = (list || REAL_MONEY_PROVIDERS).filter((p) => /^[a-z0-9_]+$/.test(p));
  return `${col} IN (${safe.map((p) => `'${p}'`).join(',') || "''"})`;
}
function isRealMoneyOrder(o, list = REAL_MONEY_PROVIDERS) { return !!o && list.includes(o.provider) && (o.currency || 'TWD') === 'TWD'; }

module.exports = { REAL_MONEY_PROVIDERS, realMoneyProviders, providerInSql, isRealMoneyOrder, mockCountsAsMoney };
