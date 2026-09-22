'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const photo = path.join(root, 'uploads', '5aaff1b3-19ab-4a7f-96cc-8b1d4710cbb6.png');
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

function startServer(port) {
  return spawn(process.execPath, ['serve.js'], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function waitForServer(origin) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${origin}.`);
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function installTrace(page) {
  await page.addInitScript(() => {
    window.__a1PreviewTrace = {
      inputs: [],
      commits: [],
      panelReads: 0,
      heightWrites: 0,
      mainImageDataAllocations: 0,
      sourceUploads: 0,
    };
    const trace = window.__a1PreviewTrace;
    const originalCreateImageData = CanvasRenderingContext2D.prototype.createImageData;
    CanvasRenderingContext2D.prototype.createImageData = function (...args) {
      if (this.canvas?.id === 'mainCanvas') trace.mainImageDataAllocations += 1;
      return originalCreateImageData.apply(this, args);
    };
    const NativeWorker = window.Worker;
    window.Worker = function (...args) {
      const worker = new NativeWorker(...args);
      const postMessage = worker.postMessage.bind(worker);
      worker.postMessage = (message, transfer) => {
        if (message?.type === 'set-source') trace.sourceUploads += 1;
        return postMessage(message, transfer);
      };
      return worker;
    };
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (...args) {
      if (this.classList?.contains('canvas-panel')) trace.panelReads += 1;
      return originalRect.apply(this, args);
    };
    const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (name, ...args) {
      if (name === '--workbench-panel-height') trace.heightWrites += 1;
      return originalSetProperty.call(this, name, ...args);
    };
    document.addEventListener(
      'input',
      (event) => {
        const id = event.target?.id;
        if (
          [
            'exposure',
            'contrast',
            'shadowHue',
            'shadowAmt',
            'gradeBalance',
            'filterIntensityInput',
          ].includes(id)
        ) {
          trace.inputs.push({ id, value: event.target.value, time: performance.now() });
        }
      },
      true
    );
    document.addEventListener('color-grade-preview-commit', (event) => {
      trace.commits.push(event.detail);
    });
  });
}

async function chooseParameterPreset(page) {
  await page.locator('#fileInput').setInputFiles(photo);
  await page.waitForFunction(
    () => document.querySelector('#stage').getAttribute('aria-busy') === 'false'
  );
  await page.locator('#filterSearch').fill('高原自然');
  await page.locator('#variants .variant').click();
  await page.waitForFunction(() => !document.querySelector('#filterIntensity').hidden);
  await page.waitForFunction(
    () =>
      document.querySelector('#stage').dataset.interactiveRenderer === 'webgl' &&
      document.querySelector('#mainCanvas').width === 560 &&
      document.querySelector('#filterIntensity').getAttribute('aria-busy') === 'false'
  );
  await page.locator('#filterIntensityInput').evaluate((input) => {
    input.value = '50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(
    () => document.querySelector('#stage').dataset.interactiveRenderer === 'webgl'
  );
}

async function dispatchInput(page, id, value) {
  const priorCommitCount = await page.evaluate(() => window.__a1PreviewTrace.commits.length);
  await page.locator(`#${id}`).evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await page.waitForFunction(
    (count) => window.__a1PreviewTrace.commits.slice(count).some((commit) => commit.limit === 560),
    priorCommitCount
  );
}

test('A1 traces latest visible revisions for every adjustment control without drag-time layout or 1100px work', async (t) => {
  if (!require('node:fs').existsSync(chrome)) t.skip('Google Chrome is not installed.');
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    await waitForServer(origin);
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    try {
      await installTrace(page);
      await page.goto(`${origin}/color-grade.html`, { waitUntil: 'networkidle' });
      await chooseParameterPreset(page);
      const rafIntervals = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const samples = [];
            let previous = performance.now();
            const sample = (now) => {
              samples.push(now - previous);
              previous = now;
              if (samples.length === 12) resolve(samples.slice(1));
              else requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          })
      );
      await page.evaluate(() => {
        Object.assign(window.__a1PreviewTrace, {
          inputs: [],
          commits: [],
          panelReads: 0,
          heightWrites: 0,
          mainImageDataAllocations: 0,
          sourceUploads: 0,
        });
      });

      // A previous settled preview may have left the Worker on its 1100px
      // source. Warm the interactive S560 source once, then measure only the
      // sustained adjustment path.
      await dispatchInput(page, 'exposure', 16);
      await page.evaluate(() => {
        window.__a1PreviewTrace.sourceUploads = 0;
        window.__a1PreviewTrace.mainImageDataAllocations = 0;
      });
      for (const [id, value] of [
        ['contrast', -21],
        ['shadowHue', 238],
        ['shadowAmt', 31],
        ['gradeBalance', -19],
        ['filterIntensityInput', 63],
      ]) {
        await dispatchInput(page, id, value);
      }

      // Several mutations before the next animation frame are one submission,
      // and the commit carries the newest revision rather than an earlier value.
      const beforeBatch = await page.evaluate(() => window.__a1PreviewTrace.commits.length);
      await page.evaluate(() => {
        for (const [id, value] of [
          ['exposure', 24],
          ['contrast', 12],
          ['shadowAmt', 47],
        ]) {
          const input = document.querySelector(`#${id}`);
          input.value = String(value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await page.waitForFunction(
        (count) =>
          window.__a1PreviewTrace.commits.slice(count).some((commit) => commit.limit === 560),
        beforeBatch
      );
      await page.waitForTimeout(50);

      const trace = await page.evaluate(() => ({
        ...window.__a1PreviewTrace,
        width: document.querySelector('#mainCanvas').width,
        renderer: document.querySelector('#stage').dataset.interactiveRenderer,
        values: Object.fromEntries(
          [
            'exposure',
            'contrast',
            'shadowHue',
            'shadowAmt',
            'gradeBalance',
            'filterIntensityInput',
          ].map((id) => [id, document.querySelector(`#${id}`).value])
        ),
      }));
      const batchCommits = trace.commits
        .slice(beforeBatch)
        .filter((commit) => commit.limit === 560);
      assert.equal(batchCommits.length, 1, 'same-frame adjustment input commits exactly once');
      assert.equal(trace.width, 560, 'drag-time preview keeps the interaction resolution');
      assert.equal(
        trace.renderer,
        'webgl',
        'the parameter interaction trace uses the uniform-only WebGL preview path'
      );
      assert.equal(trace.panelReads, 0, 'dragging does not remeasure the A0 source panel');
      assert.equal(trace.heightWrites, 0, 'dragging does not rewrite the A0 shared height');
      assert.equal(
        trace.mainImageDataAllocations,
        0,
        'stable 560px drags reuse the main canvas ImageData staging buffer'
      );
      assert.equal(
        trace.sourceUploads,
        0,
        'latest interactive revisions reuse the Worker S560 source instead of reuploading it'
      );
      assert.equal(
        trace.commits.some((commit) => commit.limit === 1100),
        false,
        'input events alone must not start a high-quality preview'
      );

      const inputIds = new Set(trace.inputs.map((input) => input.id));
      for (const id of [
        'exposure',
        'contrast',
        'shadowHue',
        'shadowAmt',
        'gradeBalance',
        'filterIntensityInput',
      ]) {
        assert.ok(inputIds.has(id), `missing trace input for #${id}`);
      }
      const latencies = trace.inputs.map((input) => {
        const commit = trace.commits.find(
          (candidate) => candidate.time >= input.time && candidate.limit === 560
        );
        assert.ok(commit, `missing visible commit for #${input.id}`);
        assert.ok(Number.isInteger(commit.gradingRevision), 'commit records the grading revision');
        assert.ok(Number.isInteger(commit.contentRevision), 'commit records the content revision');
        return commit.time - input.time;
      });
      // Keep the cadence-relative guardrail, but also enforce the product
      // contract independently so a degraded event loop cannot widen it.
      const frameBudget = percentile(rafIntervals, 0.95) * 16;
      const p95Latency = percentile(latencies, 0.95);
      assert.ok(
        p95Latency <= 50,
        `p95 ${p95Latency.toFixed(2)}ms exceeds the 50ms interaction contract`
      );
      assert.ok(
        p95Latency <= frameBudget,
        `p95 ${p95Latency.toFixed(2)}ms exceeds sixteen observed animation frames (${frameBudget.toFixed(2)}ms)`
      );
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
    if (server.exitCode === null) server.kill();
  }
});
