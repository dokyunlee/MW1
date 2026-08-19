import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAnswer, parseUnambiguousPrice, validateAnswer } from '../lib/server/normalization';

test('English answers ignore letter case and all whitespace', () => {
  for (const input of ['ICE CREAM', 'ice cream', 'Ice Cream', 'icecream', 'ICECREAM', 'i c e c r e a m']) {
    assert.equal(normalizeAnswer(input), 'icecream', input);
    assert.equal(validateAnswer(input, 'Ice Cream'), true, input);
  }
});

test('Korean answers ignore all whitespace but do not use fuzzy matching', () => {
  for (const input of ['카페라떼', '카페 라떼', '카 페 라 떼']) {
    assert.equal(validateAnswer(input, '카페라떼'), true, input);
  }
  assert.equal(validateAnswer('카페라테', '카페라떼'), false);
});

test('unambiguous US price formats compare as the same value', () => {
  for (const input of ['$1,234.50', '1234.50', '$ 1,234.50', 'USD 1,234.50']) {
    assert.equal(parseUnambiguousPrice(input), 1234.5, input);
    assert.equal(validateAnswer(input, '$1,234.50'), true, input);
  }
});

test('ambiguous and fuzzy price strings are rejected', () => {
  assert.equal(parseUnambiguousPrice('about $12.99'), null);
  assert.equal(parseUnambiguousPrice('$12.99 approx.'), null);
  assert.equal(validateAnswer('about $12.99', '$12.99'), false);
});
