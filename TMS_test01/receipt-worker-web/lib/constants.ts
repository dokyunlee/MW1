export const ALL_RECEIPT_COUNT = 50;
export const EXCLUDED_RECEIPT_NUMBERS = [1, 19, 23, 27, 33, 35, 38, 41, 46, 47] as const;
export const EXCLUDED_RECEIPT_IDS = EXCLUDED_RECEIPT_NUMBERS.map(
  (number) => `receipt_${String(number).padStart(2, '0')}`,
);
export const TOTAL_TASKS = ALL_RECEIPT_COUNT - EXCLUDED_RECEIPT_IDS.length;
export const NORMAL_ACCURACY_THRESHOLD = 0.9;
export const MINIMUM_CORRECT_FOR_NORMAL = Math.ceil(TOTAL_TASKS * NORMAL_ACCURACY_THRESHOLD);
export const EXPERIMENT_VERSION = 'receipt40_v1';
export const SESSION_STORAGE_KEY = 'receiptTaskSessionId';
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const TASK_TIME_LIMIT_SECONDS = 20 * 60;
