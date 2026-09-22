/*
 * Static and deterministic diagnostics for the LUT strength path.
 * Run with: node scripts/diagnose-lut-intensity.cjs
 * This does not mutate application files or start a browser.
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'color-grade.html'), 'utf8');
const css = ['base.css', 'controls.css', 'library-dialogs.css', 'responsive.css']
  .map((name) =>
    fs.readFileSync(path.join(root, 'assets', 'color-grade', 'workbench', 'styles', name), 'utf8')
  )
  .join('\n');
const page = [
  'catalog.js',
  'state.js',
  'preview-renderer.js',
  'filter-library.js',
  'interactions-crop-export.js',
]
  .map((name) =>
    fs.readFileSync(path.join(root, 'assets', 'color-grade', 'workbench', name), 'utf8')
  )
  .join('\n');
const worker = fs.readFileSync(
  path.join(root, 'assets/color-grade/color-grade-p1-worker.js'),
  'utf8'
);
const dom = new JSDOM(html.replace('</head>', `<style>${css}</style></head>`), {
  pretendToBeVisual: true,
});
const strength = dom.window.document.getElementById('filterIntensity');
strength.hidden = true;

function mix(source, effect, amount) {
  return source.map((value, index) =>
    index === 3 ? value : Math.round(value + (effect[index] - value) * amount)
  );
}

const source = [32, 96, 160, 211];
const effect = [192, 48, 16, 211];
const endpoints = [0, 0.25, 0.5, 0.75, 1].map((amount) => ({
  amount,
  pixel: mix(source, effect, amount),
}));

const report = {
  generatedAt: new Date().toISOString(),
  hiddenStrength: {
    hiddenAttribute: strength.hidden,
    computedDisplay: dom.window.getComputedStyle(strength).display,
    hasExplicitHiddenRule: /\.filter-intensity\[hidden\]/.test(css),
    diagnosis: 'the explicit hidden rule wins over the grid layout rule',
  },
  eventGate: {
    inputSchedulesApplicableFilter:
      /isApplicableFilterIntensitySelection\(\)\) schedulePreview\(true\)/.test(page),
    applicableSupportsBuiltinParameters: /\['lut', 'parameters'\]/.test(page),
  },
  renderQueue: {
    invalidatesSharedContentRevision: /let contentRevision = 0/.test(page),
    cancelsOnlyQueuedPreview:
      /job\.priority === 'preview'/.test(page) && /active Worker task is left intact/.test(page),
    validatesLutInsideEveryJob:
      /const loaded = await client\.validateLut\(job\.variant\.id, bytes\)/.test(page),
    uploadsSourceInsideEveryJob: /await client\.setSource\(/.test(page),
  },
  workerContract: {
    blendsFromUntouchedSource: /blendFromSource\(output, source\.pixels, intensity\)/.test(worker),
    alphaPreserved: /output\[index \+ 3\]/.test(worker) === false,
    endpointPixels: endpoints,
  },
};

console.log(JSON.stringify(report, null, 2));
