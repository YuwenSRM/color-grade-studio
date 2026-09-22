'use strict';

// This test consumes the already-built standalone artifact.  It deliberately
// keeps full-mode title differences explicit while requiring shared i18n and
// intent behavior to remain identical.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function start(script, port) {
  return spawn(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function waitFor(origin, pathname, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${origin} exited before it became ready.`);
    try {
      if ((await fetch(`${origin}${pathname}`)).ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${origin}${pathname}.`);
}

function stop(child) {
  if (child?.exitCode === null) child.kill();
}

async function capture(page) {
  await page.waitForFunction(() => document.querySelectorAll('.variant').length > 0, undefined, {
    timeout: 10000,
  });
  await page.locator('#filterSource').evaluate((input) => {
    input.value = 'builtin';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('#moreFilters').evaluate((node) => {
    node.open = true;
  });
  await page.locator('#filterSearch').fill('Exposure +20');
  await page.waitForFunction(() => document.querySelectorAll('.intent-chip').length === 1);
  await page.locator('#libraryMenuToggle').click();
  await page.waitForFunction(() => !document.querySelector('#libraryMenu').hidden);
  await page.evaluate(() =>
    window.ColorGradeWorkbench.showEditorToast('cg.error.libraryUnavailable')
  );
  await page.evaluate(() => {
    const balance = document.querySelector('#gradeBalance');
    balance.disabled = false;
    document.querySelector('[data-grade-reset="all"]').disabled = false;
    document.querySelector('.controls').classList.remove('is-locked');
  });
  const balance = page.locator('#gradeBalance');
  await balance.focus();
  await balance.press('ArrowRight');
  const arrowValue = await balance.inputValue();
  await balance.press('PageUp');
  const pageUpValue = await balance.inputValue();
  await balance.press('PageDown');
  const pageDownValue = await balance.inputValue();
  await balance.press('Home');
  const homeValue = await balance.inputValue();
  await balance.press('End');
  const endValue = await balance.inputValue();
  await page.locator('[data-grade-reset="all"]').click();
  const resetPreservedDetails = await page
    .locator('.color-grading-group')
    .evaluate((node) => node.open);
  async function snapshot(locale) {
    await page.evaluate((next) => window.ColorGradeI18n.setLocale(next), locale);
    await page.waitForFunction((next) => document.documentElement.lang === next, locale);
    return page.evaluate(() => {
      const { t } = window.ColorGradeI18n;
      const mismatches = [];
      document.querySelectorAll('[data-i18n]').forEach((node) => {
        if (['paletteValue', 'toneValue', 'colorValue'].includes(node.id)) return;
        const expected = t(node.dataset.i18n);
        if (node.textContent !== expected) mismatches.push(`text ${node.dataset.i18n}`);
      });
      document.querySelectorAll('[data-i18n-attr]').forEach((node) => {
        node.dataset.i18nAttr.split(';').forEach((binding) => {
          const [attribute, key] = binding
            .trim()
            .split(':')
            .map((part) => part.trim());
          if (node.getAttribute(attribute) !== t(key)) mismatches.push(`attr ${attribute}:${key}`);
        });
      });
      return {
        locale: window.ColorGradeI18n.getLocale(),
        language: document.documentElement.lang,
        title: document.title,
        library: document.querySelector('#showPresetPanel').textContent.trim(),
        placeholder: document.querySelector('#filterSearch').placeholder,
        input: document.querySelector('#filterSearch').value,
        chip: document.querySelector('.intent-chip')?.textContent.trim(),
        toast: document.querySelector('#editorToast').textContent.trim(),
        toneValue: document.querySelector('#toneValue').textContent,
        colorValue: document.querySelector('#colorValue').textContent,
        source: document.querySelector('#filterSource').value,
        moreFiltersOpen: document.querySelector('#moreFilters').open,
        libraryMenuOpen: !document.querySelector('#libraryMenu').hidden,
        buttonText: document.querySelector('#previewIntent').textContent.trim(),
        ariaValueNow: document.querySelector('#filterIntensityInput').getAttribute('aria-valuenow'),
        ariaValueText: document
          .querySelector('#filterIntensityInput')
          .getAttribute('aria-valuetext'),
        grading: {
          resetText: document.querySelector('[data-grade-reset="all"]').textContent.trim(),
          resetLabel: document.querySelector('[data-grade-reset="all"]').getAttribute('aria-label'),
          balanceValue: document.querySelector('#gradeBalance').value,
          balanceOutput: document.querySelector('#gradeBalanceV').textContent,
          balanceAriaNow: document.querySelector('#gradeBalance').getAttribute('aria-valuenow'),
          balanceAriaText: document.querySelector('#gradeBalance').getAttribute('aria-valuetext'),
          scale: [...document.querySelectorAll('.grade-balance-scale span')].map(
            (node) => node.textContent
          ),
        },
        mismatches,
      };
    });
  }
  return {
    keyboard: {
      arrowValue,
      pageUpValue,
      pageDownValue,
      homeValue,
      endValue,
      resetPreservedDetails,
    },
    english: await snapshot('en-US'),
    chinese: await snapshot('zh-CN'),
  };
}

test('source and standalone preserve keyed English UI, dynamic intent text, and open state', async () => {
  assert.ok(fs.existsSync(chrome), 'Google Chrome is required for release parity checks');
  const [sourcePort, standalonePort] = await Promise.all([freePort(), freePort()]);
  const sourceOrigin = `http://127.0.0.1:${sourcePort}`;
  const standaloneOrigin = `http://127.0.0.1:${standalonePort}`;
  const source = start('serve.js', sourcePort);
  const standalone = start('scripts/serve-standalone.cjs', standalonePort);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    await Promise.all([
      waitFor(sourceOrigin, '/color-grade.html', source),
      waitFor(standaloneOrigin, '/', standalone),
    ]);
    const results = {};
    for (const [name, url, title] of [
      ['source', `${sourceOrigin}/color-grade.html`, 'Landscape Dataset - AI Color Studio'],
      ['standalone', `${standaloneOrigin}/`, 'Local Color Studio'],
    ]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
      const page = await context.newPage();
      const diagnostics = [];
      page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
      page.on('response', (response) => {
        if (response.status() >= 400) diagnostics.push(`${response.status()} ${response.url()}`);
      });
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        results[name] = await capture(page);
      } catch (error) {
        error.message = `${name}: ${error.message}\n${diagnostics.join('\n')}`;
        throw error;
      } finally {
        await context.close();
      }
      assert.equal(
        results[name].english.title,
        title,
        `${name} must use its explicit app mode title`
      );
    }
    for (const result of Object.values(results)) {
      assert.deepEqual(result.keyboard, {
        arrowValue: '1',
        pageUpValue: '11',
        pageDownValue: '1',
        homeValue: '-100',
        endValue: '100',
        resetPreservedDetails: true,
      });
      assert.deepEqual(result.english, {
        locale: 'en-US',
        language: 'en-US',
        title: result.english.title,
        library: 'LUT Library',
        placeholder: 'Warm film, Tokyo night, Teal & Orange, Exposure +20',
        input: 'Exposure +20',
        chip: 'Exposure +20',
        toast: 'The local LUT library is unavailable.',
        toneValue: 'Standard · Balanced\nExposure 0 · Contrast 0 · Saturation 0 · Vibrance 0',
        colorValue: 'Neutral · Balanced\nTemperature 0 · Tint 0',
        source: 'builtin',
        moreFiltersOpen: true,
        libraryMenuOpen: true,
        buttonText: 'Preview',
        ariaValueNow: '100',
        ariaValueText: 'LUT intensity 100%',
        grading: {
          resetText: '↺',
          resetLabel: 'Reset color grading',
          balanceValue: '0',
          balanceOutput: '0',
          balanceAriaNow: '0',
          balanceAriaText: 'Global balance, shadows to highlights, 0',
          scale: ['Shadows', 'Neutral', 'Highlights'],
        },
        mismatches: [],
      });
      assert.deepEqual(result.chinese, {
        locale: 'zh-CN',
        language: 'zh-CN',
        title: result.chinese.title,
        library: 'LUT 库',
        placeholder: '暖调胶片、Tokyo night、Teal & Orange、曝光 +20',
        input: 'Exposure +20',
        chip: '曝光 +20',
        toast: '本地 LUT 库不可用。',
        toneValue: '标准 · 平衡\n曝光 0 · 对比度 0 · 饱和度 0 · 鲜艳度 0',
        colorValue: '中性 · 平衡\n色温 0 · 色调 0',
        source: 'builtin',
        moreFiltersOpen: true,
        libraryMenuOpen: true,
        buttonText: '预览',
        ariaValueNow: '100',
        ariaValueText: '滤镜强度 100%',
        grading: {
          resetText: '↺',
          resetLabel: '重置色彩分级',
          balanceValue: '0',
          balanceOutput: '0',
          balanceAriaNow: '0',
          balanceAriaText: '全局平衡，阴影至高光，0',
          scale: ['阴影', '中性', '高光'],
        },
        mismatches: [],
      });
    }
    assert.equal(results.source.chinese.title, '景观数据集 - AI 调色工作台');
    assert.equal(results.standalone.chinese.title, '本地调色工作台');
    const { title: sourceTitle, ...sourceShared } = results.source.english;
    const { title: standaloneTitle, ...standaloneShared } = results.standalone.english;
    assert.notEqual(sourceTitle, standaloneTitle, 'mode titles must be intentional');
    assert.deepEqual(
      standaloneShared,
      sourceShared,
      'shared source/standalone language behavior diverged'
    );
  } finally {
    await browser.close();
    stop(source);
    stop(standalone);
  }
});
