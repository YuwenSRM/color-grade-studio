const fs = require('node:fs');
const path = require('node:path');
const runtimeManifest = require('./standalone-runtime-manifest.cjs');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist', 'standalone');
const allowedFiles = new Set(runtimeManifest.standaloneOutputFiles(root));
const forbiddenNames =
  /(^|\/)(?:\.env|data|uploads|image-library|node_modules)(?:\/|$)|(?:^|\/)(?:serve\.js|admin(?:-login)?\.html|audit\.html|login\.html|real-landscape\.html|api-client\.js|data-sync\.js)$/i;
const forbiddenCode = /LandscapeApi|\/api\/|uploadImage\(/;
const forbiddenRoute =
  /(?:^|['"`])(?:\.\.?\/)?(?:login|account)(?:\.html)?(?:[?#][^'"`]*)?(?=['"`])/i;
const forbiddenAccountUi = /\b(?:colorAccount|colorLogin)\b/;

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}

if (!fs.existsSync(dist))
  throw new Error('Standalone output is missing. Run npm run build:standalone first.');
const build = JSON.parse(fs.readFileSync(path.join(dist, 'BUILD.json'), 'utf8'));
const expectedBuild = runtimeManifest.createRuntimeBuild(root);
if (JSON.stringify(build) !== JSON.stringify(expectedBuild))
  throw new Error('Standalone BUILD.json is stale. Run npm run build:standalone again.');
const actual = files(dist).map((file) => path.relative(dist, file).replaceAll(path.sep, '/'));
const failures = actual.filter(
  (file) =>
    forbiddenNames.test(file) ||
    (!allowedFiles.has(file) && !/^assets\/index-[A-Za-z0-9_-]+\.css$/.test(file))
);
for (const relative of actual.filter((file) => /\.(?:js|html)$/i.test(file))) {
  const source = fs.readFileSync(path.join(dist, relative), 'utf8');
  if (forbiddenCode.test(source))
    failures.push(`${relative}: contains a full-project API reference`);
  if (forbiddenRoute.test(source))
    failures.push(`${relative}: contains a login or account route reference`);
  if (forbiddenAccountUi.test(source)) failures.push(`${relative}: contains full-mode account UI`);
}
if (failures.length)
  throw new Error(`Standalone distribution boundary failed:\n${failures.join('\n')}`);
console.log(
  JSON.stringify(
    {
      files: actual.length,
      bytes: actual.reduce((sum, file) => sum + fs.statSync(path.join(dist, file)).size, 0),
      status: 'allowed-only',
    },
    null,
    2
  )
);
