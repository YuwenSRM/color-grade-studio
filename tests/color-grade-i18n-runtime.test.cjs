'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'color-grade.html'), 'utf8');

function boot(storage = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/color-grade.html',
  });
  Object.entries(storage).forEach(([key, value]) => dom.window.localStorage.setItem(key, value));
  for (const relative of [
    'assets/locales/color-grade-zh-CN.js',
    'assets/locales/color-grade-en-US.js',
    'assets/locales/color-grade-look-aliases.js',
    'assets/color-grade/color-grade-mode-full.js',
    'assets/color-grade/color-grade-i18n.js',
  ])
    dom.window.eval(fs.readFileSync(path.join(root, relative), 'utf8'));
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return dom;
}

test('color-grade uses only the scoped keyed i18n runtime', () => {
  assert.match(html, /assets\/color-grade\/color-grade-i18n\.js/);
  assert.doesNotMatch(html, /assets\/(?:i18n\.js|locales\/en\.js)/);
  assert.doesNotMatch(html, /data-i18n-source/);
  assert.doesNotMatch(
    fs.readFileSync(path.join(root, 'assets', 'shared', 'custom-select.js'), 'utf8'),
    /LandscapeI18n/
  );
});

test('scoped runtime migrates legacy storage, mirrors changes, and translates static bindings', () => {
  const dom = boot({ 'landscape-language': 'en' });
  const { document, localStorage, ColorGradeI18n } = dom.window;
  assert.equal(ColorGradeI18n.getLocale(), 'en-US');
  assert.equal(localStorage.getItem('color-grade-locale'), 'en-US');
  assert.equal(document.documentElement.lang, 'en-US');
  assert.equal(document.querySelector('#showPresetPanel').textContent, 'LUT Library');
  assert.equal(
    document.querySelector('#filterSearch').placeholder,
    'Warm film, Tokyo night, Teal & Orange, Exposure +20'
  );
  ColorGradeI18n.setLocale('zh-CN');
  assert.equal(localStorage.getItem('landscape-language'), 'zh');
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.equal(document.querySelector('#showPresetPanel').textContent, 'LUT 库');
});
