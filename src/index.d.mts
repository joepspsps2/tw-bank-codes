export type BranchTable = Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface BankDataMeta {
  /** 資料內容最後一次有變、從官方抓下來的那天（台灣日期 YYYY-MM-DD） */
  readonly dataDate: string;
  readonly source: string;
  readonly dataset: string;
  readonly publisher: string;
  readonly license: string;
}

export declare const BANK_DATA_META: BankDataMeta;
export declare const TW_BANKS: ReadonlyArray<{ readonly code: string; readonly name: string }>;
export declare const TW_BRANCHES: BranchTable;

export declare function bankName(bankCode: string | null | undefined): string | null;
export declare function lookupBranch(
  table: BranchTable,
  bankCode: string | null | undefined,
  branchCode: string | null | undefined,
): string | null;
export declare function branchName(bankCode: string | null | undefined, branchCode: string | null | undefined): string | null;
export declare function hasBranchData(bankCode: string | null | undefined): boolean;
export declare function branchesOf(bankCode: string | null | undefined): Readonly<Record<string, string>>;
export declare function splitBranchCode(code: string | null | undefined): { bank: string; branch: string } | null;
