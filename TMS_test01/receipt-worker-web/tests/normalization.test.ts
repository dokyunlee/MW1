import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeText, parseUnambiguousPrice, validateAnswer } from '../lib/server/normalization';

test('menu answers ignore all whitespace and letter case', () => {
  assert.equal(normalizeText('  Bacon   Burger  '), 'baconburger');
  assert.equal(validateAnswer('BaconBurger', 'Bacon Burger'), true);
  assert.equal(validateAnswer('  bacon   burger ', 'Bacon Burger'), true);
  assert.equal(validateAnswer('Cheeseburger', 'Bacon Burger'), false);
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
