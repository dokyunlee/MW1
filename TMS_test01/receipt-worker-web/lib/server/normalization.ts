export function normalizeText(value: string | number): string {
  return String(value).normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('en-US');
}

export function parseUnambiguousPrice(value: string | number): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const compact = value.normalize('NFKC').trim().replace(/\s+/g, '');
  const withoutCurrency = compact
    .replace(/^\$/u, '')
    .replace(/^usd/iu, '')
    .replace(/usd$/iu, '')
    .replace(/^₩/u, '')
    .replace(/원$/u, '')
    .replace(/,/g, '');

  if (!/^\d+(?:\.\d{1,2})?$/.test(withoutCurrency)) {
    return null;
  }

  const parsed = Number(withoutCurrency);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateAnswer(workerAnswer: string, correctAnswer: string | number): boolean {
  const correctPrice = parseUnambiguousPrice(correctAnswer);

  if (correctPrice !== null) {
    return parseUnambiguousPrice(workerAnswer) === correctPrice;
  }

  return normalizeText(workerAnswer) === normalizeText(correctAnswer);
}
