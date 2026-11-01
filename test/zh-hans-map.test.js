const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('繁体系列名归一化为简体', () => {
  const mapFile = path.join(__dirname, '..', 'public', 'js', 'zh-hans-map.js');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(mapFile, 'utf8'), context);

  const map = context.window.ZH_HANS_CHARS;
  assert.ok(map && typeof map === 'object');

  const convert = value => Array.from(String(value || ''))
    .map(ch => map[ch] || ch)
    .join('');

  assert.equal(convert('藥師少女的獨語'), '药师少女的独语');
  assert.equal(convert('全知讀者視角'), '全知读者视角');
  assert.equal(convert('測試系列'), '测试系列');
});
