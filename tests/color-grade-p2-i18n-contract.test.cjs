'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');

test('image import failures expose machine-safe codes instead of localized UI messages', async () => {
  const source = fs.readFileSync(path.join(root, 'assets/pages/color-grade-import.js'), 'utf8');
  const context = {
    window: {},
    DOMException,
    Image: class {},
    URL: { createObjectURL() {}, revokeObjectURL() {} },
  };
  vm.runInNewContext(source, context);
  await assert.rejects(
    context.window.LandscapeColorImport.load({ type: 'image/svg+xml', size: 1, slice() {} }),
    { code: 'IMAGE_UNSUPPORTED', message: 'IMAGE_UNSUPPORTED' }
  );
});

test('custom select uses roving focus, typeahead, selection, and Escape focus return', () => {
  const dom = new JSDOM(
    '<select id="select"><option value="all">All</option><option value="warm">Warm</option><option value="cool">Cool</option></select>',
    { runScripts: 'dangerously' }
  );
  dom.window.ColorGradeI18n = { getLocale: () => 'en-US', t: (key) => key };
  dom.window.eval(fs.readFileSync(path.join(root, 'assets/shared/custom-select.js'), 'utf8'));
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const trigger = dom.window.document.querySelector('.select-trigger');
  trigger.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
  );
  const menu = dom.window.document.querySelector('.select-menu');
  assert.equal(dom.window.document.activeElement.className, 'select-option');
  menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'w', bubbles: true }));
  assert.equal(dom.window.document.activeElement.textContent, 'Warm');
  menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(dom.window.document.querySelector('#select').value, 'warm');
  trigger.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
  );
  menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(dom.window.document.activeElement, trigger);
});

test('P1 protocol remains v1 message-compatible while UI sources map errors by code', () => {
  const client = fs.readFileSync(
    path.join(root, 'assets/color-grade/color-grade-p1-client.js'),
    'utf8'
  );
  const page = fs.readFileSync(path.join(root, 'assets/color-grade/workbench/catalog.js'), 'utf8');
  assert.match(client, /protocolVersion = 1/);
  assert.match(client, /message\.message/);
  assert.match(page, /const errorKeys/);
  assert.match(page, /errorKeys\[error\?\.code\]/);
  assert.doesNotMatch(page, /showEditorToast\(error\.message/);
});
