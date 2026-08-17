import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeText, parseUnambiguousPrice, validateAnswer } from '../lib/server/normalization';

test('menu answers normalize outer and repeated whitespace', () => {
  assert.equal(normalizeText('  육회   비빔밥  '), '육회 비빔밥');
  assert.equal(validateAnswer('  순대  ', '순대'), true);
  assert.equal(validateAnswer('순댓국', '순대'), false);
});

test('unambiguous Korean price formats compare as the same value', () => {
  for (const input of ['4,000', '4000', '4000원', '₩4,000', ' ₩ 4,000 원 ']) {
    assert.equal(parseUnambiguousPrice(input), 4000, input);
    assert.equal(validateAnswer(input, 4000), true, input);
  }
});

test('ambiguous and fuzzy price strings are rejected', () => {
  assert.equal(parseUnambiguousPrice('약 4,000원'), null);
  assert.equal(parseUnambiguousPrice('4000원 정도'), null);
  assert.equal(validateAnswer('4천원', 4000), false);
});
