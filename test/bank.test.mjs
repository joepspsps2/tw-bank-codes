import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BANK_DATA_META, TW_BANKS, TW_BRANCHES, bankName, branchName, lookupBranch, hasBranchData, branchesOf, splitBranchCode,
} from '../src/index.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const BANK_DIR = join(PKG, 'src');
const SCRIPT = join(PKG, 'scripts', 'update-bank.py');

test('資料檔帶資料日期、官方出處、授權', () => {
  for (const f of ['banks.json', 'branches.json']) {
    const d = JSON.parse(readFileSync(join(BANK_DIR, f), 'utf8'));
    assert.match(d.dataDate, /^\d{4}-\d{2}-\d{2}$/, f);
    assert.equal(d.source, 'https://www.fisc.com.tw/TC/OPENDATA/R2_Location.csv');
    assert.equal(d.dataset, 'https://data.gov.tw/dataset/24323');
    assert.match(d.license, /政府資料開放授權條款/);
  }
  assert.match(BANK_DATA_META.dataDate, /^\d{4}-\d{2}-\d{2}$/);
});

test('筆數在合理範圍（跟產生器的下限一致）', () => {
  assert.ok(TW_BANKS.length >= 200, `銀行 ${TW_BANKS.length}`);
  const n = Object.values(TW_BRANCHES).reduce((s, m) => s + Object.keys(m).length, 0);
  assert.ok(n >= 2000, `分行 ${n}`);
  for (const [b, m] of Object.entries(TW_BRANCHES)) {
    assert.match(b, /^\d{3}$/);
    for (const c of Object.keys(m)) assert.match(c, /^\d{4}$/, `${b}${c}`);
  }
});

test('查銀行、查分行', () => {
  assert.equal(bankName('004'), '臺灣銀行');
  assert.equal(bankName(' 004 '), '臺灣銀行');
  assert.equal(bankName('999'), null);
  assert.equal(bankName(null), null);
  assert.equal(branchName('004', '0037'), '營業部');
  assert.equal(branchName('004', '9999'), null);
  assert.equal(branchName('', '0037'), null);
  assert.equal(branchName(undefined, undefined), null);
  assert.equal(lookupBranch({ '812': { '0019': '測試分行' } }, '812', '0019'), '測試分行');
  assert.equal(hasBranchData('004'), true);
  assert.equal(hasBranchData('999'), false);
  assert.equal(hasBranchData(''), false);
  assert.equal(branchesOf('004')['0037'], '營業部');
  assert.deepEqual(branchesOf('999'), {});
});

test('怪字不會查到物件內建的東西，資料表改不動', () => {
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(bankName(k), null);
    assert.equal(hasBranchData(k), false, k);
    assert.deepEqual(branchesOf(k), {}, k);
    assert.equal(branchName(k, 'toString'), null, k);
    assert.equal(branchName('004', k), null, k);
    assert.equal(lookupBranch({ '004': {} }, '004', k), null, k);
  }
  assert.equal(lookupBranch(null, '004', '0037'), null);
  assert.throws(() => { TW_BRANCHES['004']['0037'] = '被改了'; }, TypeError);
  assert.throws(() => { branchesOf('004')['9999'] = '亂加'; }, TypeError);
  assert.throws(() => { branchesOf('999').x = 1; }, TypeError);
  assert.equal(branchName('004', '0037'), '營業部');
});

test('拆 7 碼分行代碼', () => {
  assert.deepEqual(splitBranchCode('0040037'), { bank: '004', branch: '0037' });
  assert.deepEqual(splitBranchCode('004-0037'), { bank: '004', branch: '0037' });
  assert.deepEqual(splitBranchCode(' 004 0037 '), { bank: '004', branch: '0037' });
  assert.equal(splitBranchCode('004003'), null);
  assert.equal(splitBranchCode('00400371'), null);
  assert.equal(splitBranchCode('abc0037'), null);
  assert.equal(splitBranchCode(null), null);
});

test('原始碼不 import 任何外部套件、不碰 Node 專屬模組（Worker 能跑）', () => {
  const src = readFileSync(join(BANK_DIR, 'index.mjs'), 'utf8');
  const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./banks.json', './branches.json']);
});

// ── 產生器（Python）：用現有資料反推一份 CSV，再改幾筆看比對 ──

function toCsv(banks, branches) {
  const lines = ['銀行代號/總機構代碼,分支機構代號,金融機構名稱,分支機構名稱,地址'];
  for (const b of banks) {
    lines.push(`${b.code},,${b.name},,`);
    for (const [c, n] of Object.entries(branches[b.code] ?? {})) lines.push(`${b.code},${b.code}${c},${b.name},${n},某地址`);
  }
  return '﻿' + lines.join('\n') + '\n';
}

function workdir() {
  const dir = mkdtempSync(join(tmpdir(), 'tw-bank-codes-'));
  for (const f of readdirSync(BANK_DIR).filter((f) => f.endsWith('.json'))) copyFileSync(join(BANK_DIR, f), join(dir, f));
  return dir;
}

function run(dir, csv, extra = []) {
  const csvPath = join(dir, 'in.csv');
  writeFileSync(csvPath, csv);
  const r = spawnSync('python3', [SCRIPT, '--csv', csvPath, '--out-dir', dir, '--status', join(dir, 'status.json'), '--no-bump', ...extra], { encoding: 'utf8' });
  const last = r.stdout.trim().split('\n').at(-1);
  return { ...r, summary: r.status === 0 ? JSON.parse(last) : null };
}

const banks = JSON.parse(readFileSync(join(BANK_DIR, 'banks.json'), 'utf8')).banks;
const branches = JSON.parse(readFileSync(join(BANK_DIR, 'branches.json'), 'utf8')).branches;

test('產生器：官方檔跟現有一樣＝內容沒變、不改資料檔，只記最後確認日', () => {
  const dir = workdir();
  const before = readFileSync(join(dir, 'branches.json'), 'utf8');
  const r = run(dir, toCsv(banks, branches));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.summary.changed, false);
  assert.equal(readFileSync(join(dir, 'branches.json'), 'utf8'), before);
  const st = JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8'));
  assert.match(st.checkedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(st.lastAttempt.result.startsWith('ok'), true);
});

test('產生器：算出新增、裁撤、改名，並寫新資料', () => {
  const dir = workdir();
  const next = structuredClone(branches);
  next['004']['9998'] = '新開分行';
  delete next['004']['0037'];
  next['004']['0059'] = '改了名字';
  const r = run(dir, toCsv(banks, next));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.summary.changed, true);
  assert.equal(r.summary.branches.added, 1);
  assert.equal(r.summary.branches.removed, 1);
  assert.equal(r.summary.branches.renamed, 1);
  const out = JSON.parse(readFileSync(join(dir, 'branches.json'), 'utf8'));
  assert.equal(out.branches['004']['9998'], '新開分行');
  assert.equal(out.branches['004']['0037'], undefined);
  assert.match(out.license, /政府資料開放授權條款/);
});

test('產生器：一次少掉超過一成分行＝拒收', () => {
  const dir = workdir();
  const next = structuredClone(branches);
  for (const b of Object.keys(next).slice(0, 40)) delete next[b];
  const r = run(dir, toCsv(banks, next));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /超過一成/);
});

test('套件自己叫得到自己（exports 設定正確）', async () => {
  const m = await import('@joelincc/tw-bank-codes');
  assert.equal(m.bankName('700'), '中華郵政股份有限公司');
  const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
  const st = JSON.parse(readFileSync(join(PKG, 'status.json'), 'utf8'));
  assert.equal(st.dataDate, BANK_DATA_META.dataDate, 'status.json 的資料日期要跟資料檔一致');
  assert.equal(st.banks, TW_BANKS.length);
  assert.deepEqual(pkg.dependencies ?? {}, {});
});

test('產生器：拿到錯誤網頁（被擋）不收', () => {
  const dir = workdir();
  const r = run(dir, '<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD></HTML>');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /網頁不是 CSV/);
});
