import test from 'node:test';
import assert from 'node:assert/strict';
import { cursorMenu } from '../src/menu.js';

const keysUnique = items => { const keys = items.map(i => i.key); assert.equal(new Set(keys).size, keys.length); items.forEach(i => i.items && keysUnique(i.items)); };

test('full menu has unique single-letter keys at every level', () => {
  const menu = cursorMenu(() => true);
  assert.deepEqual(menu.items.map(i => i.key), ['s', 'l', 'f', 'o', 'm', 'p', 'a', 'r', 'q', 'z']);
  assert.deepEqual(menu.items.find(i => i.key === 'm'), { key: 'm', label: 'Default model…', command: { name: 'cloud', args: 'model' } });
  keysUnique(menu.items);
  assert.ok(JSON.stringify(menu).match(/"key":"[a-z]"/g).length > 15);
});

test('returns nothing when no Cursor command is loaded', () => {
  assert.equal(cursorMenu(() => false), undefined);
});
