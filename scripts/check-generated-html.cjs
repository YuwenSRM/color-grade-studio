const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const templateDirectory = path.join(root, 'src', 'templates', 'color-grade');
const output = path.join(root, 'color-grade.html');
const contractFile = path.join(templateDirectory, 'id-contract.json');
const templateFiles = [
  'head.html',
  'header.html',
  'canvas-panel.html',
  'adjustments-panel.html',
  'lut-library.html',
  'dialogs.html',
  'scripts.html',
];
const gradeTones = [
  { tone: 'shadow', Tone: 'Shadow', color: '#2e6aa1', hue: 210, saturation: 55, hidden: '' },
  {
    tone: 'mid',
    Tone: 'Mid',
    color: '#6ca56e',
    hue: 122,
    saturation: 24,
    hidden: '                hidden\n',
  },
  {
    tone: 'high',
    Tone: 'High',
    color: '#e3a149',
    hue: 35,
    saturation: 73,
    hidden: '                hidden\n',
  },
];

function renderGradeTones() {
  const template = fs.readFileSync(path.join(templateDirectory, 'grade-tone.html'), 'utf8');
  return gradeTones
    .map((tone) =>
      template.replace(/\{\{(tone|Tone|color|hue|saturation|hidden)\}\}/g, (_, key) => tone[key])
    )
    .join('');
}

function fail(message) {
  console.error(`HTML check failed: ${message}`);
  process.exitCode = 1;
}

const expected = templateFiles
  .map((file) =>
    fs
      .readFileSync(path.join(templateDirectory, file), 'utf8')
      .replace('{{GRADE_TONES}}', renderGradeTones().trimEnd())
  )
  .join('');
const generated = fs.readFileSync(output, 'utf8');
if (generated !== expected) fail('color-grade.html is stale. Run npm run build:html.');

const document = new JSDOM(generated).window.document;
const ids = Array.from(document.querySelectorAll('[id]'), (node) => node.id);
const uniqueIds = new Set(ids);
if (uniqueIds.size !== ids.length) {
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  fail(`duplicate id ${duplicate}`);
}

const expectedIds = JSON.parse(fs.readFileSync(contractFile, 'utf8'));
const missingIds = expectedIds.filter((id) => !uniqueIds.has(id));
const unexpectedIds = ids.filter((id) => !expectedIds.includes(id));
if (missingIds.length) fail(`missing ids: ${missingIds.join(', ')}`);
if (unexpectedIds.length) fail(`untracked ids: ${unexpectedIds.join(', ')}`);

const scripts = Array.from(document.querySelectorAll('script[src]'), (node) =>
  node.getAttribute('src')
);
const expectedScripts = [
  'assets/locales/color-grade-zh-CN.js',
  'assets/locales/color-grade-en-US.js',
  'assets/locales/color-grade-look-aliases.js',
  'assets/color-grade/color-grade-intent.js',
  'assets/color-grade/color-grade-mode-full.js',
  'assets/color-grade/color-grade-i18n.js',
  'assets/shared/theme-controller.js',
  'assets/shared/api-client.js',
  'assets/shared/ui-utils.js',
  'assets/shared/custom-select.js',
  'assets/color-grade/color-grade-renderer.js',
  'assets/color-grade/color-grade-webgl-preview.js',
  'assets/color-grade/color-grade-lut.js',
  'assets/color-grade/color-grade-lut-renderer.js',
  'assets/color-grade/color-grade-lut-library.js',
  'assets/color-grade/color-grade-hald.js',
  'assets/color-grade/color-grade-3dl.js',
  'assets/color-grade/p2-builtin-filters.js',
  'assets/color-grade/color-grade-builtin-catalog.js',
  'assets/color-grade/color-grade-p1-client.js',
  'assets/pages/color-grade-import.js',
  'assets/color-grade/workbench/catalog.js',
  'assets/color-grade/workbench/state.js',
  'assets/color-grade/workbench/preview-renderer.js',
  'assets/color-grade/workbench/filter-library.js',
  'assets/color-grade/workbench/interactions-crop-export.js',
  'assets/pages/color-grade.js',
  'assets/pages/color-grade-full-integration.js',
  'assets/shared/data-sync.js',
];
if (scripts.join('\n') !== expectedScripts.join('\n')) fail('script loading order changed');

for (const node of document.querySelectorAll('script[src], link[rel="stylesheet"][href]')) {
  const resource = node.getAttribute('src') || node.getAttribute('href');
  if (!fs.existsSync(path.join(root, resource))) fail(`missing resource ${resource}`);
}

const account = document.querySelector('#colorAccount #colorLogin[href="login.html"]');
if (!account) fail('full build is missing its login entry');

if (!process.exitCode)
  console.log(`HTML contract passed (${ids.length} unique ids, ${scripts.length} scripts).`);
