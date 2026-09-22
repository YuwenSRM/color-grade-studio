'use strict';

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
  throw new Error(`Timed out waiting for ${origin}.`);
}

async function inspectorState(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('#adjustmentsPanel');
    const group = document.querySelector('.color-grading-group');
    const heading = group.querySelector('summary');
    const headingCopy = heading.querySelector('.section-heading-copy');
    const reset = heading.querySelector('[data-grade-reset="all"]');
    const balance = group.querySelector('.grade-balance');
    const scale = group.querySelector('.grade-balance-scale');
    const actions = document.querySelector('.inspector-actions');
    const rect = (node) => node.getBoundingClientRect().toJSON();
    const style = getComputedStyle(panel);
    return {
      panel: rect(panel),
      group: rect(group),
      heading: rect(heading),
      headingCopy: rect(headingCopy),
      reset: rect(reset),
      balance: rect(balance),
      scale: rect(scale),
      actions: rect(actions),
      gradingPaddingBottom: getComputedStyle(group.querySelector('.grading-workspace'))
        .paddingBottom,
      panelHeight: panel.getBoundingClientRect().height,
      panelClientHeight: panel.clientHeight,
      panelScrollHeight: panel.scrollHeight,
      canvasHeight: document.querySelector('.canvas-panel').getBoundingClientRect().height,
      position: style.position,
      overflowY: style.overflowY,
      applyKey: document.querySelector('#apply').dataset.i18n,
      resetKey: document.querySelector('#reset').dataset.i18n,
      applyText: document.querySelector('#apply').textContent.trim(),
      resetText: document.querySelector('#reset').textContent.trim(),
      groupInPanel: panel.contains(group),
      actionsInPanel: panel.contains(actions),
      scaleFits: scale.scrollWidth <= scale.clientWidth,
      scaleLabelsFit: [...scale.children].every((label) => label.scrollWidth <= label.clientWidth),
      pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    };
  });
}

test('source and standalone desktop Inspector retain layout and localized controls in both themes', async () => {
  assert.ok(fs.existsSync(chrome), 'Chrome is required for Inspector layout checks');
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
    for (const [name, url] of [
      ['source', `${sourceOrigin}/color-grade.html`],
      ['standalone', `${standaloneOrigin}/`],
    ]) {
      for (const dark of [false, true]) {
        for (const width of [1440, 1100]) {
          const context = await browser.newContext({ viewport: { width, height: 960 } });
          const page = await context.newPage();
          try {
            await page.addInitScript((isDark) => {
              localStorage.setItem('landscape-theme', isDark ? 'dark' : 'light');
            }, dark);
            await page.goto(url, { waitUntil: 'networkidle' });
            if (width <= 1099) await page.locator('#showAdjustmentsPanel').click();
            await page.waitForFunction(() => {
              const panel = document.querySelector('#adjustmentsPanel');
              return panel && getComputedStyle(panel).display !== 'none';
            });
            await page.waitForFunction(() => {
              const canvas = document.querySelector('.canvas-panel').getBoundingClientRect();
              const panel = document.querySelector('#adjustmentsPanel').getBoundingClientRect();
              return (
                document
                  .querySelector('.workbench')
                  .style.getPropertyValue('--workbench-panel-height') &&
                Math.abs(canvas.height - panel.height) <= 2
              );
            });

            let state = await inspectorState(page);
            const contextName = `${name} ${dark ? 'dark' : 'light'} ${width}px`;
            assert.equal(
              state.position,
              'sticky',
              `${contextName} Inspector must stay in the workspace`
            );
            assert.equal(
              state.overflowY,
              'auto',
              `${contextName} Inspector must own vertical scrolling`
            );
            assert.ok(
              Math.abs(state.panelHeight - state.canvasHeight) <= 2,
              `${contextName} Inspector must share the preview workspace height`
            );
            assert.ok(
              state.panelScrollHeight > state.panelClientHeight,
              `${contextName} Inspector content must scroll independently`
            );
            assert.ok(
              state.groupInPanel,
              `${contextName} color grading must remain in the Inspector`
            );
            assert.ok(
              state.actionsInPanel,
              `${contextName} save/reset must remain in the Inspector`
            );
            assert.equal(state.applyKey, 'cg.static.saveAdjustments');
            assert.equal(state.resetKey, 'cg.static.resetAdjustments');

            assert.ok(
              state.headingCopy.right <= state.reset.left + 1,
              `${contextName} heading copy and reset icon must not overlap`
            );
            assert.ok(
              state.scaleFits && state.scaleLabelsFit,
              `${contextName} balance scale labels must fit`
            );
            assert.equal(
              state.gradingPaddingBottom,
              '14px',
              `${contextName} grading workspace must not reserve excess space below global balance`
            );
            assert.ok(state.pageFits, `${contextName} must not create horizontal page overflow`);

            await page.evaluate(() => {
              const panel = document.querySelector('#adjustmentsPanel');
              const group = document.querySelector('.color-grading-group');
              panel.scrollTop = group.offsetTop - 4;
            });
            await page.waitForTimeout(50);
            state = await inspectorState(page);
            assert.ok(
              state.heading.top >= state.panel.top - 1 && state.heading.top <= state.panel.top + 20,
              `${contextName} grading heading must stick within its Inspector`
            );
            assert.ok(
              state.balance.bottom <= state.actions.top + 2,
              `${contextName} sticky balance must not cover the action bar`
            );

            await page.evaluate(() => {
              const panel = document.querySelector('#adjustmentsPanel');
              panel.scrollTop = panel.scrollHeight;
            });
            await page.waitForTimeout(50);
            state = await inspectorState(page);
            assert.ok(
              state.actions.bottom <= state.panel.bottom + 1,
              `${contextName} action bar must remain inside the Inspector boundary`
            );
            assert.ok(
              state.actions.bottom >= state.panel.bottom - 30,
              `${contextName} action bar must remain pinned to the Inspector bottom`
            );

            for (const [locale, expected, scale] of [
              [
                'en-US',
                ['Save adjustments', 'Reset adjustments'],
                ['Shadows', 'Neutral', 'Highlights'],
              ],
              ['zh-CN', ['保存调整', '还原调整'], ['阴影', '中性', '高光']],
            ]) {
              await page.evaluate((next) => window.ColorGradeI18n.setLocale(next), locale);
              state = await inspectorState(page);
              assert.deepEqual(
                [state.applyText, state.resetText],
                expected,
                `${contextName} ${locale}`
              );
              assert.deepEqual(
                await page.locator('.grade-balance-scale span').allTextContents(),
                scale,
                `${contextName} ${locale} balance scale`
              );
              assert.ok(
                state.scaleFits && state.scaleLabelsFit,
                `${contextName} ${locale} scale must fit`
              );
            }
          } finally {
            await context.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
    if (source.exitCode === null) source.kill();
    if (standalone.exitCode === null) standalone.kill();
  }
});
