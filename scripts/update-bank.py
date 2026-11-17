#!/usr/bin/env python3
"""重產 @joelincc/tw-bank-codes 的銀行、分行對照表（src/banks.json、src/branches.json）。

來源：財金資訊公司「總分支機構位置」開放資料
  資料集 https://data.gov.tw/dataset/24323（政府資料開放授權條款第1版）
  檔案   https://www.fisc.com.tw/TC/OPENDATA/R2_Location.csv
總機構（分支機構代號空白那一列）：代碼 3 碼＋名稱 → banks.json。
分行：銀行 3 碼 → 分行 4 碼 → 分行名稱 → branches.json。

跟現有版本比對，算新增、裁撤、改名；內容沒變就不改資料檔（只更新 status.json 的「最後確認日」）；
有變才寫檔、升 patch 版號（升版後要另外建 GitHub Release 才會發到 npm）。

用法：
  python3 scripts/update-bank.py                 # 直接下載官方 CSV
  python3 scripts/update-bank.py --csv 檔案.csv   # 用已下載的檔
  python3 scripts/update-bank.py --diff-only OLD_branches.json --csv 新.csv  # 只算變動筆數
選項 --out-dir 給測試用（預設＝套件的 src）；--no-bump 不升版號。
結果摘要印成一行 JSON（最後一行），workflow 用它寫 commit 訊息。

下載被擋（HTTP 403 等）＝結束碼 3，只在 status.json 記 lastAttempt；不重試、不換身分硬闖。
"""
import argparse
import csv
import io
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

SRC = 'https://www.fisc.com.tw/TC/OPENDATA/R2_Location.csv'
DATASET = 'https://data.gov.tw/dataset/24323'
LICENSE = '政府資料開放授權條款第1版'
PUBLISHER = '財金資訊股份有限公司'
USER_AGENT = 'tw-bank-codes/0.1 (+https://github.com/joepspsps2/tw-bank-codes; monthly open-data refresh)'
HEADER = ['銀行代號/總機構代碼', '分支機構代號', '金融機構名稱']

PKG = Path(__file__).resolve().parent.parent
DEFAULT_OUT = PKG / 'src'
STATUS = PKG / 'status.json'
PACKAGE_JSON = PKG / 'package.json'

MIN_BANKS = 200
MIN_BRANCHES = 2000
MAX_REMOVED_RATIO = 0.10  # 一次少掉超過一成分行＝多半是官方檔出錯，不收，留給人看


def taipei_today() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=8)).date().isoformat()


def record_attempt(status_path: Path, result: str) -> None:
    """下載失敗也要留紀錄：status.json 的 lastAttempt（checkedOn 不動，看得出資料多久沒跟官方確認）。"""
    status = load_json(status_path) or {}
    status['lastAttempt'] = {'on': taipei_today(), 'result': result}
    status_path.write_text(json.dumps(status, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def download(status_path: Path) -> bytes:
    req = urllib.request.Request(SRC, headers={'User-Agent': USER_AGENT})
    try:
        return urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError as e:
        record_attempt(status_path, f'HTTP {e.code}')
        print(f'下載被拒：HTTP {e.code}（{SRC}）。不硬闖；改看 README「下載被擋時」。', file=sys.stderr)
        sys.exit(3)
    except urllib.error.URLError as e:
        record_attempt(status_path, f'連不上：{e.reason}')
        print(f'連不上財金網站：{e.reason}', file=sys.stderr)
        sys.exit(3)


def parse(raw: bytes) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    text = raw.decode('utf-8-sig')
    if text.lstrip().lower().startswith('<'):
        sys.exit('拿到的是網頁不是 CSV（多半是被擋的錯誤頁），不收')
    rows = list(csv.reader(io.StringIO(text)))
    if not rows or [c.strip() for c in rows[0][:3]] != HEADER:
        sys.exit(f'表頭變了，先人工看過：{rows[0] if rows else "（空檔）"}')
    banks: dict[str, str] = {}
    for r in rows[1:]:
        if len(r) < 3:
            continue
        code, branch, name = r[0].strip(), r[1].strip(), r[2].strip()
        if not branch and len(code) == 3 and code.isdigit() and name:
            banks[code] = name
    branches: dict[str, dict[str, str]] = {}
    for r in rows[1:]:
        if len(r) < 4:
            continue
        code, branch, bname = r[0].strip(), r[1].strip(), r[3].strip()
        if not branch or not bname or code not in banks:
            continue
        # 分支機構代號有的寫 7 碼（銀行 3 碼＋分行 4 碼），有的只寫 4 碼
        if len(branch) == 7 and branch.startswith(code):
            branch = branch[3:]
        if len(branch) != 4 or not branch.isdigit():
            continue
        branches.setdefault(code, {})[branch] = bname
    nb = sum(len(v) for v in branches.values())
    if nb < MIN_BRANCHES:
        sys.exit(f'分行只抓到 {nb} 個，太少，先人工看過（表頭：{rows[0]}）')
    if len(banks) < MIN_BANKS:
        sys.exit(f'只抓到 {len(banks)} 家，太少，先人工看過')
    return banks, branches


def flat(branches: dict[str, dict[str, str]]) -> dict[str, str]:
    return {f'{b}{c}': n for b, m in branches.items() for c, n in m.items()}


def diff(old: dict[str, str], new: dict[str, str]) -> dict:
    added = sorted(set(new) - set(old))
    removed = sorted(set(old) - set(new))
    renamed = sorted(k for k in set(old) & set(new) if old[k] != new[k])
    return {
        'added': len(added), 'removed': len(removed), 'renamed': len(renamed),
        'examples': {
            'added': [f'{k} {new[k]}' for k in added[:5]],
            'removed': [f'{k} {old[k]}' for k in removed[:5]],
            'renamed': [f'{k} {old[k]}→{new[k]}' for k in renamed[:5]],
        },
    }


def load_json(p: Path):
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return None


def bump_patch() -> str:
    pkg = json.loads(PACKAGE_JSON.read_text(encoding='utf-8'))
    major, minor, patch = (int(x) for x in pkg['version'].split('.'))
    pkg['version'] = f'{major}.{minor}.{patch + 1}'
    PACKAGE_JSON.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    lock_path = PKG / 'package-lock.json'
    lock = load_json(lock_path)
    if lock:  # 鎖檔裡也記了版號，要一起改，不然 npm ci 會抱怨對不上
        lock['version'] = pkg['version']
        lock.get('packages', {}).get('', {})['version'] = pkg['version']
        lock_path.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return pkg['version']


def meta(today: str) -> dict:
    return {'source': SRC, 'dataset': DATASET, 'publisher': PUBLISHER, 'license': LICENSE, 'dataDate': today}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv', type=Path)
    ap.add_argument('--out-dir', type=Path, default=DEFAULT_OUT)
    ap.add_argument('--diff-only', type=Path, metavar='OLD_BRANCHES_JSON')
    ap.add_argument('--no-bump', action='store_true')
    ap.add_argument('--status', type=Path, default=STATUS)
    args = ap.parse_args()

    raw = args.csv.read_bytes() if args.csv else download(args.status)
    banks, branches = parse(raw)
    today = taipei_today()

    if args.diff_only:
        old = load_json(args.diff_only) or {}
        print(json.dumps({'branches': diff(flat(old.get('branches', {})), flat(branches))}, ensure_ascii=False))
        return

    out_banks, out_branches = args.out_dir / 'banks.json', args.out_dir / 'branches.json'
    old_b = load_json(out_banks) or {}
    old_br = load_json(out_branches) or {}
    bank_diff = diff({x['code']: x['name'] for x in old_b.get('banks', [])}, banks)
    branch_diff = diff(flat(old_br.get('branches', {})), flat(branches))
    old_total = len(flat(old_br.get('branches', {})))
    if old_total and branch_diff['removed'] > old_total * MAX_REMOVED_RATIO:
        sys.exit(f'這次少了 {branch_diff["removed"]} 個分行（超過一成），先人工看過，不自動更新')

    changed = any(d[k] for d in (bank_diff, branch_diff) for k in ('added', 'removed', 'renamed'))
    version = None
    if changed:
        args.out_dir.mkdir(parents=True, exist_ok=True)
        m = meta(today)
        out_banks.write_text(json.dumps({**m, 'banks': [{'code': c, 'name': banks[c]} for c in sorted(banks)]},
                                        ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        out_branches.write_text(json.dumps({**m, 'branches': {c: dict(sorted(branches[c].items())) for c in sorted(branches)}},
                                           ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
        if not args.no_bump:
            version = bump_patch()

    data_date = today if changed else (old_br.get('dataDate') or today)
    status = {
        'checkedOn': today,  # 最後一次成功下載並比對官方檔的日子（超過 45 天沒更新＝該用瀏覽器手動下載一次）
        'dataDate': data_date,  # 資料內容最後一次有變的日子
        'banks': len(banks),
        'branches': sum(len(v) for v in branches.values()),
        'source': SRC,
        'lastAttempt': {'on': today, 'result': 'ok' if not args.csv else 'ok（手動提供 CSV）'},
    }
    args.status.write_text(json.dumps(status, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    summary = {'changed': changed, 'version': version, 'dataDate': data_date, 'checkedOn': today,
               'banks': bank_diff, 'branches': branch_diff}
    print(f'銀行 {len(banks)} 家、分行 {status["branches"]} 個；'
          f'分行 新增 {branch_diff["added"]}／裁撤 {branch_diff["removed"]}／改名 {branch_diff["renamed"]}'
          + (f'；升版 {version}' if version else ('；內容有變（未升版）' if changed else '；內容沒變')))
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    main()
