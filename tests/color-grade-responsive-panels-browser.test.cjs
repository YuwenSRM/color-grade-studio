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
  throw new Error(`Timed out waiting for ${origin}${pathname}.`);
}

function stop(child) {
  if (child?.exitCode === null) child.kill();
}

async function paneState(page) {
  return page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
    const library = document.querySelector('#lutLibrary');
    const adjustments = document.querySelector('#adjustmentsPanel');
    return {
      canvas: rect('.canvas-panel'),
      libraryDisplay: getComputedStyle(library).display,
      adjustmentsDisplay: getComputedStyle(adjustments).display,
      libraryHidden: library.getAttribute('aria-hidden'),
      adjustmentsHidden: adjustments.getAttribute('aria-hidden'),
      librarySelected: document.querySelector('#showPresetPanel').getAttribute('aria-selected'),
      adjustmentsSelected: document
        .querySelector('#showAdjustmentsPanel')
        .getAttribute('aria-selected'),
      canvasDocumentTop:
        document.querySelector('.canvas-panel').getBoundingClientRect().top + window.scrollY,
      activeId: document.activeElement?.id,
    };
  });
}

test('source and standalone retain responsive panel state in both locales', async () => {
  assert.ok(fs.existsSync(chrome), 'Google Chrome is required for responsive panel checks');
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
      await test(`${name} medium drawer and narrow segmented panels`, async (t) => {
        await t.test('medium keeps the full canvas while switching panels', async () => {
          const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
          const page = await context.newPage();
          try {
            await page.goto(url, { waitUntil: 'networkidle' });
            await page.evaluate(() => window.ColorGradeI18n.setLocale('en-US'));
            const before = await paneState(page);
            assert.equal(before.librarySelected, 'true');
            assert.equal(before.adjustmentsSelected, 'false');
            assert.equal(before.libraryHidden, 'false');
            assert.equal(before.adjustmentsHidden, 'true');
            assert.equal(await page.locator('#showPresetPanel').getAttribute('role'), 'tab');
            assert.equal(await page.locator('#lutLibrary').getAttribute('role'), 'tabpanel');
            assert.equal(
              await page.locator('#adjustmentsPanel').getAttribute('aria-labelledby'),
              'showAdjustmentsPanel'
            );

            await page.locator('#showAdjustmentsPanel').click();
            const after = await paneState(page);
            assert.equal(
              after.canvas.width,
              before.canvas.width,
              'switching a drawer must not resize canvas'
            );
            assert.equal(
              after.canvasDocumentTop,
              before.canvasDocumentTop,
              'switching a drawer must not reflow canvas'
            );
            assert.equal(after.libraryDisplay, 'none');
            assert.notEqual(after.adjustmentsDisplay, 'none');
            assert.equal(after.libraryHidden, 'true');
            assert.equal(after.adjustmentsHidden, 'false');
            assert.equal(after.adjustmentsSelected, 'true');
            const drawer = await page.locator('#adjustmentsPanel').evaluate((panel) => ({
              maxHeight: getComputedStyle(panel).maxHeight,
              overflowY: getComputedStyle(panel).overflowY,
              scrollHeight: panel.scrollHeight,
              clientHeight: panel.clientHeight,
            }));
            assert.notEqual(drawer.maxHeight, 'none');
            assert.equal(drawer.overflowY, 'auto');
            assert.ok(
              drawer.scrollHeight > drawer.clientHeight,
              'medium Inspector must own its long control list'
            );
          } finally {
            await context.close();
          }
        });

        await t.test(
          'narrow switcher preserves details, values, focus, and English labels',
          async () => {
            const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
            const page = await context.newPage();
            try {
              await page.goto(url, { waitUntil: 'networkidle' });
              await page.locator('#showAdjustmentsPanel').click();
              assert.deepEqual(
                await page
                  .locator('#adjustmentsPanel > details')
                  .evaluateAll((details) => details.map((node) => node.open)),
                [false, true, false],
                'narrow screens start with the grading section expanded once'
              );

              await page.locator('#gradeBalance').evaluate((input) => {
                input.value = '17';
                input.dispatchEvent(new Event('input', { bubbles: true }));
              });
              await page.locator('.color-grading-group > summary').click();
              assert.equal(
                await page.locator('.color-grading-group').evaluate((node) => node.open),
                false
              );
              await page.locator('#showPresetPanel').click();
              await page.locator('#showAdjustmentsPanel').focus();
              await page.keyboard.press('Enter');
              await page.evaluate(() => window.ColorGradeI18n.setLocale('en-US'));

              const state = await paneState(page);
              assert.equal(state.adjustmentsSelected, 'true');
              assert.equal(state.activeId, 'showAdjustmentsPanel');
              assert.equal(
                await page.locator('.color-grading-group').evaluate((node) => node.open),
                false
              );
              assert.equal(await page.locator('#gradeBalance').inputValue(), '17');
              const layout = await page.evaluate(() => {
                const controls = document.querySelector('#adjustmentsPanel');
                const heading = document.querySelector('.color-grading-group > summary');
                const copy = heading.querySelector('.section-heading-copy');
                const reset = document.querySelector('[data-grade-reset="all"]');
                const scale = document.querySelector('.grade-balance-scale');
                const quickTitle = document.querySelector('#tonePalette').previousElementSibling;
                const quickHeading = quickTitle.querySelector('h2');
                const quickHelp = quickTitle.querySelector('small');
                const rect = (node) => node.getBoundingClientRect().toJSON();
                return {
                  position: getComputedStyle(controls).position,
                  overflowY: getComputedStyle(controls).overflowY,
                  copy: rect(copy),
                  reset: rect(reset),
                  scale: rect(scale),
                  scaleFits: scale.scrollWidth <= scale.clientWidth,
                  labelFits: [...scale.children].every(
                    (label) => label.scrollWidth <= label.clientWidth
                  ),
                  quickHeading: rect(quickHeading),
                  quickHelp: rect(quickHelp),
                  quickHeadingFits: quickHeading.scrollWidth <= quickHeading.clientWidth,
                  quickHelpFits: quickHelp.scrollWidth <= quickHelp.clientWidth,
                };
              });
              assert.equal(layout.position, 'static');
              assert.equal(layout.overflowY, 'visible');
              assert.ok(
                layout.copy.right <= layout.reset.left + 1,
                'heading and reset icon must not overlap'
              );
              assert.ok(
                layout.scaleFits && layout.labelFits,
                'English balance labels must not be clipped'
              );
              assert.ok(
                layout.quickHeadingFits &&
                  layout.quickHelp.top >= layout.quickHeading.bottom - 1 &&
                  layout.quickHelpFits,
                'Quick Look heading and help must occupy readable separate lines'
              );

              await page.locator('#showPresetPanel').focus();
              await page.keyboard.press('ArrowRight');
              assert.equal(
                await page.locator('#showAdjustmentsPanel').getAttribute('aria-selected'),
                'true'
              );
              assert.equal(
                await page.evaluate(() => document.activeElement.id),
                'showAdjustmentsPanel'
              );
              await page.evaluate(() => window.ColorGradeI18n.setLocale('zh-CN'));
              assert.equal(await page.locator('#showAdjustmentsPanel').textContent(), '调整');
            } finally {
              await context.close();
            }
          }
        );
      });
    }
  } finally {
    await browser.close();
    stop(source);
    stop(standalone);
  }
});
