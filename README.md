# @joelincc/tw-bank-codes

台灣銀行代碼（3 碼）與分行代碼（4 碼）對照表：給代碼，回銀行、分行的名字。

匯款單、薪資轉帳檔、收款對象表單上常只有「004-0037」這種數字。這個套件把它翻成「臺灣銀行 營業部」，也能反過來檢查使用者打的代碼存不存在。

- **資料有出處、有日期**：來自財金資訊公司的政府開放資料，每份資料檔都寫明下載日期，程式裡讀得到（`BANK_DATA_META.dataDate`）。
- **沒有外部依賴**：純函式、ESM。Node.js 22 以上、打包工具（Vite、esbuild…）、Cloudflare Workers 都能跑。
- **只查表**：不連網、不存檔、不驗證帳號。

## 安裝

```bash
npm install @joelincc/tw-bank-codes
```

## 用法

```js
import { bankName, branchName, hasBranchData, branchesOf, splitBranchCode, TW_BANKS, BANK_DATA_META } from '@joelincc/tw-bank-codes';

bankName('004');              // '臺灣銀行'
bankName('999');              // null（查不到）
branchName('004', '0037');    // '營業部'
branchName('004', '9999');    // null
hasBranchData('004');         // true：這家銀行有分行資料（沒有就別提示使用者「查不到分行」）
branchesOf('004');            // { '0037': '營業部', '0059': '公庫部', … }
splitBranchCode('004-0037');  // { bank: '004', branch: '0037' }；也收 '0040037'、'004 0037'
TW_BANKS;                     // [{ code: '000', name: '中央銀行國庫局' }, { code: '004', name: '臺灣銀行' }, …]
BANK_DATA_META.dataDate;      // '2026-11-12'
```

查不到一律回 `null`，不丟例外。`splitBranchCode` 只看格式（7 個數字），不保證代碼存在；要確認存在請接著呼叫 `branchName`。

不用 JavaScript 也可以直接讀資料檔（Python、試算表…）：

| 檔案 | 內容 |
|---|---|
| `@joelincc/tw-bank-codes/banks.json` | `banks: [{ code, name }]`，依代碼排序 |
| `@joelincc/tw-bank-codes/branches.json` | `branches: { 銀行3碼: { 分行4碼: 分行名稱 } }` |
| `@joelincc/tw-bank-codes/status.json` | 最後一次跟官方檔比對的日期、筆數、最後一次下載結果 |

## 資料出處與資料日期

| 資料 | 出處 | 授權 | 資料日期 | 筆數 |
|---|---|---|---|---|
| 銀行（總機構）代碼與名稱 `banks.json` | 財金資訊股份有限公司「總分支機構位置」[`R2_Location.csv`](https://www.fisc.com.tw/TC/OPENDATA/R2_Location.csv)（[政府資料開放平臺 24323](https://data.gov.tw/dataset/24323)） | [政府資料開放授權條款第1版](https://data.gov.tw/license) | 2026-11-12 | 296 家 |
| 分行代碼與名稱 `branches.json` | 同上 | 同上 | 2026-11-12 | 4,989 個分行 |

- 「資料日期」（`dataDate`）＝資料內容最後一次有變、從官方下載的那天。
- 收錄範圍照官方檔：本國銀行、外商銀行在臺分行、信用合作社、農漁會信用部、中華郵政（700）。
- 名稱照官方檔原樣，例如「臺灣銀行」不是「台灣銀行」、「中華郵政股份有限公司」不是「郵局」。要顯示簡稱請自己處理。
- 這是對照表，不是即時資料。分行新設、裁撤、改名後，要等下一次更新才會反映。金額大的匯款請以銀行官方資訊為準。

## 怎麼更新

- **每月自動比對**：[`.github/workflows/monthly.yml`](.github/workflows/monthly.yml) 每月 3 日跑 [`scripts/update-bank.py`](scripts/update-bank.py)，**只檢查、不寫回 main**（main 一律走 PR）。官方資料有變時那次執行會標紅，摘要寫新增、裁撤、改名各幾筆；沒變或被官方擋下載則是綠燈，結果寫在執行摘要。
- **更新資料**：在本機跑 `python3 scripts/update-bank.py`（下載被擋時見下一節），它會寫新資料、升版號、更新 [`status.json`](status.json) 的 `checkedOn`（最後確認日）；接著開 PR，檢查全過才合併。
- **防呆**：表頭變了、拿到的是網頁不是 CSV、筆數太少、一次少掉超過一成分行，都不收，留給人看。
- **發版**：資料的 PR 合併後建一個 GitHub Release，[`release.yml`](.github/workflows/release.yml) 經 repo 擁有者按核准才發到 npm（Trusted Publishing，不存 npm 密碼）。

### 下載被擋時

2026-11-12 實測：財金網站對程式下載回 **HTTP 403**（本機、GitHub Actions 都一樣）。我們不換身分、不繞路硬闖，所以每月排程目前只會在執行摘要記「被擋」，`checkedOn` 不動。

`checkedOn` 超過 45 天時，用一般瀏覽器從 [data.gov.tw 24323](https://data.gov.tw/dataset/24323) 下載 `R2_Location.csv`，再跑：

```bash
python3 scripts/update-bank.py --csv 下載的檔.csv
```

## 相關套件

- [`@joelincc/tw-bank-statement`](https://github.com/joepspsps2/tw-bank-statement)：讀台灣網銀匯出的交易明細（CSV、Big5、Excel），整理成統一格式。對帳單裡的轉帳對象常只有銀行代碼，兩個搭配用就能顯示銀行名稱。

## 回報錯誤

發現代碼對不上、名稱錯了，歡迎開 [issue](https://github.com/joepspsps2/tw-bank-codes/issues)。請附上銀行官網或財金公司的頁面，方便查證。資料檔由產生器從官方檔重產，請不要直接改 JSON 送 PR。

## English

Lookup tables for Taiwanese bank codes (3 digits) and branch codes (4 digits): `bankName('004')` → `'臺灣銀行'`, `branchName('004', '0037')` → `'營業部'`, plus `splitBranchCode('004-0037')` for the 7-digit combined form. Unknown codes return `null`. Names are in Traditional Chinese, exactly as published.

Data comes from the Financial Information Service Co. (FISC) open dataset “總分支機構位置” ([data.gov.tw/dataset/24323](https://data.gov.tw/dataset/24323)), released under Taiwan's Open Government Data License v1.0. Every data file carries its source and `dataDate` (currently 2026-11-12: 296 institutions, 4,989 branches), also exposed as `BANK_DATA_META`. Zero dependencies, pure ESM; runs on Node.js 22+, bundlers and Cloudflare Workers. A monthly workflow compares against the official file; the official site currently blocks automated downloads (HTTP 403), so updates may require a manual browser download — see `status.json` for the last successful check.

Works well with [`@joelincc/tw-bank-statement`](https://github.com/joepspsps2/tw-bank-statement), which parses Taiwanese online-banking statement exports.

## 授權

程式：MIT。資料：財金資訊股份有限公司提供，依[政府資料開放授權條款第1版](https://data.gov.tw/license)使用，轉用時請標示出處。
