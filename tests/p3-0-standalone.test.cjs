const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const forbiddenRoute =
  /(?:^|['"`])(?:\.\.?\/)?(?:login|account)(?:\.html)?(?:[?#][^'"`]*)?(?=['"`])/i;

test('full source keeps its account entry outside the standalone build', () => {
  const html = fs.readFileSync(path.join(root, 'color-grade.html'), 'utf8');
  const document = new JSDOM(html).window.document;
  assert.ok(document.querySelector('#colorAccount'));
  assert.equal(document.querySelector('#colorLogin')?.getAttribute('href'), 'login.html');
});

test('P3-0 Colour reference fixture is pinned, licensed, and development-only', () => {
  const fixtureRoot = path.join(root, 'tests', 'fixtures', 'reference', 'colour');
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'));
  const entry = manifest.entries[0];
  const bytes = fs.readFileSync(path.join(fixtureRoot, entry.path));
  assert.equal(manifest.upstreamCommit, '5259f87c012e42b570778007f3d2560c15549518');
  assert.match(manifest.license, /BSD-3-Clause/);
  assert.match(manifest.purpose, /never copied into the standalone distribution/i);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  assert.equal(bytes.length, entry.bytes);
  assert.ok(fs.existsSync(path.join(fixtureRoot, 'LICENSE.txt')));
});

test('P3-0 standalone output contains only the local editor shell and allowed runtime assets', (t) => {
  const dist = path.join(root, 'dist', 'standalone');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    t.skip('standalone output is built by npm run test:p3-0');
    return;
  }
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const document = new JSDOM(html).window.document;
  assert.equal(document.title, '景观数据集 - 调色工作台');
  assert.equal(document.querySelector('script[src="assets/shared/api-client.js"]'), null);
  assert.equal(document.querySelector('script[src="assets/shared/data-sync.js"]'), null);
  assert.match(html, /color-grade-mode-standalone\.js/);
  assert.equal(
    document.querySelector('script[src="assets/pages/color-grade-full-integration.js"]'),
    null
  );
  assert.equal(document.querySelector('#colorAccount'), null);
  assert.equal(document.querySelector('#colorLogin'), null);
  assert.doesNotMatch(
    html,
    forbiddenRoute,
    'standalone HTML must not expose login or account routes'
  );
  const workbenchSources = [
    'catalog.js',
    'state.js',
    'preview-renderer.js',
    'filter-library.js',
    'interactions-crop-export.js',
  ].map((name) =>
    fs.readFileSync(path.join(dist, 'assets', 'color-grade', 'workbench', name), 'utf8')
  );
  assert.doesNotMatch(workbenchSources.join('\n'), /LandscapeApi|uploadImage\(/);
  for (const relative of fs
    .readdirSync(path.join(dist, 'assets', 'pages'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join('assets', 'pages', entry.name))) {
    const source = fs.readFileSync(path.join(dist, relative), 'utf8');
    assert.doesNotMatch(
      source,
      forbiddenRoute,
      `${relative} must not expose login or account routes`
    );
    assert.doesNotMatch(
      source,
      /\b(?:colorAccount|colorLogin)\b/,
      `${relative} must not expose account UI`
    );
  }
  assert.equal(fs.existsSync(path.join(dist, 'tests')), false);
  assert.equal(fs.existsSync(path.join(dist, 'data')), false);
  assert.equal(fs.existsSync(path.join(dist, 'uploads')), false);
  assert.equal(fs.existsSync(path.join(dist, 'image-library')), false);
});
