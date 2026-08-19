import { EXCLUDED_RECEIPT_IDS } from '@/lib/constants';

const excludedReceiptIds = new Set(EXCLUDED_RECEIPT_IDS);

export function isEligibleReceiptId(receiptId: string): boolean {
  return !excludedReceiptIds.has(receiptId);
}

export function getEligibleReceipts<T extends { receiptId: string }>(receipts: readonly T[]): T[] {
  return receipts.filter((receipt) => isEligibleReceiptId(receipt.receiptId));
}
