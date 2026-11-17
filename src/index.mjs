/**
 * @joelincc/tw-bank-codes — 台灣金融機構代碼（銀行 3 碼）與分行代碼（4 碼）對照。
 * Taiwan bank codes (3 digits) and branch codes (4 digits) → names.
 *
 * 資料：財金資訊公司「總分支機構位置」開放資料（https://data.gov.tw/dataset/24323，政府資料開放授權條款第1版），
 * 由 scripts/update-bank.py 產生 banks.json、branches.json；每份都帶 dataDate（資料日期）與出處。
 * 純函式、零依賴、ESM，Node.js 22+、打包工具、Cloudflare Workers 都能跑。
 */
import banksData from './banks.json' with { type: 'json' };
import branchesData from './branches.json' with { type: 'json' };

/** 資料出處與日期（dataDate＝資料內容最後一次有變、從官方抓下來的那天，台灣日期） */
export const BANK_DATA_META = Object.freeze({
  dataDate: branchesData.dataDate,
  source: branchesData.source,
  dataset: branchesData.dataset,
  publisher: branchesData.publisher,
  license: branchesData.license,
});

/** 總機構清單（依代碼排序） */
export const TW_BANKS = Object.freeze(banksData.banks.map((b) => Object.freeze({ code: b.code, name: b.name })));

const BANK_NAMES = new Map(TW_BANKS.map((b) => [b.code, b.name]));

/** 銀行 3 碼 → 分行 4 碼 → 分行名稱（唯讀） */
export const TW_BRANCHES = Object.freeze(
  Object.fromEntries(Object.entries(branchesData.branches).map(([b, m]) => [b, Object.freeze({ ...m })])),
);

const EMPTY = Object.freeze({});

function clean(v) {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

/** 只認物件自己的欄位：打 "__proto__"、"constructor" 這種字不會查到內建的東西 */
function own(obj, key) {
  return obj != null && Object.hasOwn(obj, key) ? obj[key] : undefined;
}

/** 查銀行（總機構）名稱；查不到回 null */
export function bankName(bankCode) {
  return BANK_NAMES.get(clean(bankCode)) ?? null;
}

/** 在指定的對照表裡查分行名稱（測試或使用端自備表時用）；查不到回 null */
export function lookupBranch(table, bankCode, branchCode) {
  const b = clean(bankCode);
  const c = clean(branchCode);
  if (!b || !c) return null;
  const name = own(own(table, b), c);
  return typeof name === 'string' ? name : null;
}

/** 查分行名稱；查不到（代碼打錯、資料還沒收）回 null */
export function branchName(bankCode, branchCode) {
  return lookupBranch(TW_BRANCHES, bankCode, branchCode);
}

/** 某家銀行有沒有分行資料（沒有就不要提示「查不到」，免得誤報） */
export function hasBranchData(bankCode) {
  return own(TW_BRANCHES, clean(bankCode)) !== undefined;
}

/** 某家銀行的全部分行（唯讀；給表單在瀏覽器裡即時顯示分行名稱） */
export function branchesOf(bankCode) {
  return own(TW_BRANCHES, clean(bankCode)) ?? EMPTY;
}

/**
 * 拆 7 碼的「銀行＋分行」代碼（例：0040037、004-0037、004 0037）→ { bank, branch }；格式不對回 null。
 * 只看格式，不保證代碼存在；要確認存在用 branchName()。
 */
export function splitBranchCode(code) {
  const digits = clean(code).replace(/[\s-]/g, '');
  if (!/^\d{7}$/.test(digits)) return null;
  return { bank: digits.slice(0, 3), branch: digits.slice(3) };
}
