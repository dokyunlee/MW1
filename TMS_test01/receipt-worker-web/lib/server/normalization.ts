export function normalizeText(value: string | number): string {
  return String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ko-KR');
}

export function parseUnambiguousPrice(value: string | number): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const compact = value.normalize('NFKC').trim().replace(/\s+/g, '');
  const withoutCurrency = compact.replace(/^₩/, '').replace(/원$/, '').replace(/,/g, '');

  if (!/^\d+(?:\.0+)?$/.test(withoutCurrency)) {
    return null;
  }

  const parsed = Number(withoutCurrency);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function validateAnswer(workerAnswer: string, correctAnswer: string | number): boolean {
  const correctPrice = parseUnambiguousPrice(correctAnswer);

  if (typeof correctAnswer === 'number' && correctPrice !== null) {
    return parseUnambiguousPrice(workerAnswer) === correctPrice;
  }

  return normalizeText(workerAnswer) === normalizeText(correctAnswer);
}
