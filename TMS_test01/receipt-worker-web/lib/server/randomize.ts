import { randomInt } from 'node:crypto';

export function fisherYatesShuffle<T>(source: readonly T[]): T[] {
  const result = [...source];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}
