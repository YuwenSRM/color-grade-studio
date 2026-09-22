'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const runtimeManifest = require('./standalone-runtime-manifest.cjs');

const root = path.resolve(__dirname, '..');
const standalone = path.join(root, 'dist', 'standalone');
const candidate = path.join(root, 'dist', 'standalone-candidate');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function files(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const full = path.join(directory, entry.name);
      return entry.isDirectory() ? files(full) : [full];
    });
}

function write(relative, value) {
  const target = path.join(candidate, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${value}\n`, 'utf8');
}

function packageReadme() {
  return [
    '# Color Grade Studio standalone candidate',
    '',
    'This is an auditable local-web candidate for the frozen `legacy-v1` color-grade page.',
    '',
    '## Start locally',
    '',
    'On Windows, double-click `ColorGradeStudio.vbs`. The L1 launcher uses Windows PowerShell, validates the package manifest, serves only the `app/` resources over `127.0.0.1:4174`, and opens the default browser. Node.js is not needed. Run `ColorGradeStudio.cmd` for visible diagnostics, or `ColorGradeStudio.cmd --stop` to stop the local service. See `使用说明.md` for the short user guide.',
    '',
    'This L1 launcher is a PowerShell prototype, not a signed native executable or installer. It has not passed clean-machine, signing, Defender, or authorized-image performance gates. See `docs/release-notes.md` for the remaining release authority.',
    '',
    '## Local data and privacy',
    '',
    'Images stay in the browser process for the current session. User LUTs, favorites, theme, and language are stored in this browser origin local storage / IndexedDB. No account, telemetry, project API, upload endpoint, or third-party request is part of this package. Use **Back up my filters** in the UI before clearing browser site data; restore it with **Restore backup** in the same browser origin.',
    '',
    '## Audit',
    '',
    '`MANIFEST.json` is deterministic and lists a SHA-256 for every package file except the manifest itself. `SBOM.json` and `LICENSES/` identify shipped application assets and their licenses. Re-run `npm run package:standalone` from the source checkout to reproduce the candidate, then compare manifests.',
  ].join('\n');
}

function main() {
  if (!fs.existsSync(path.join(standalone, 'index.html'))) {
    throw new Error('Standalone output is missing. Run npm run build:standalone first.');
  }
  const buildPath = path.join(standalone, 'BUILD.json');
  if (!fs.existsSync(buildPath)) throw new Error('Standalone BUILD.json is missing.');
  const runtimeBuild = runtimeManifest.createRuntimeBuild(root);
  const built = JSON.parse(fs.readFileSync(buildPath, 'utf8'));
  if (JSON.stringify(built) !== JSON.stringify(runtimeBuild))
    throw new Error('Standalone output is stale. Run npm run build:standalone first.');
  const candidateSource = runtimeManifest.createCandidateSource(root, runtimeBuild.runtimeBuildId);
  fs.rmSync(candidate, { recursive: true, force: true });
  fs.mkdirSync(candidate, { recursive: true });
  fs.cpSync(standalone, path.join(candidate, 'app'), { recursive: true });
  for (const file of ['ColorGradeStudio.cmd', 'ColorGradeStudio.ps1', 'ColorGradeStudio.vbs']) {
    fs.copyFileSync(path.join(root, 'launcher', 'powershell', file), path.join(candidate, file));
  }
  write('README.md', packageReadme());
  write('使用说明.md', fs.readFileSync(path.join(root, 'docs', 'standalone.md'), 'utf8').trim());
  for (const [source, target] of [
    ['release-notes.md', 'docs/release-notes.md'],
    ['support.md', 'docs/support.md'],
    ['privacy.md', 'docs/privacy.md'],
    ['launcher.md', 'docs/launcher.md'],
  ]) {
    write(target, fs.readFileSync(path.join(root, 'docs', source), 'utf8').trim());
  }
  write(
    'LICENSES/application-assets.md',
    fs
      .readFileSync(
        path.join(root, 'assets', 'color-grade', 'p2-builtin-filters', 'LICENSE.md'),
        'utf8'
      )
      .trim()
  );

  const packageLock = fs.readFileSync(path.join(root, 'package-lock.json'));
  write(
    'SBOM.json',
    JSON.stringify(
      {
        schemaVersion: 1,
        format: 'standalone-candidate-sbom',
        package: { name: 'color-grade-studio', version: packageJson.version },
        components: [
          {
            name: 'Color Grade Studio runtime assets',
            version: packageJson.version,
            license: 'project-local',
          },
          {
            name: 'P2 built-in filter fixtures',
            version: 'p2',
            license: 'see LICENSES/application-assets.md',
          },
        ],
        buildInputs: [{ path: 'package-lock.json', sha256: hash(packageLock) }],
      },
      null,
      2
    )
  );

  const manifestFiles = files(candidate)
    .map((file) => ({
      path: path.relative(candidate, file).replaceAll(path.sep, '/'),
      bytes: fs.statSync(file).size,
      sha256: hash(fs.readFileSync(file)),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  write(
    'MANIFEST.json',
    JSON.stringify(
      {
        schemaVersion: 1,
        format: 'color-grade-studio-standalone-candidate',
        package: { name: 'color-grade-studio', version: packageJson.version },
        build: {
          runtimeBuildId: runtimeBuild.runtimeBuildId,
          candidateSourceId: candidateSource.candidateSourceId,
          nodeRequirement: packageJson.engines.node,
          packageLockSha256: hash(packageLock),
          standaloneConfigSha256: hash(
            fs.readFileSync(path.join(root, 'vite.standalone.config.mjs'))
          ),
          deterministic: true,
          timestamp: null,
        },
        files: manifestFiles,
      },
      null,
      2
    )
  );
  console.log(
    JSON.stringify({ candidate, files: manifestFiles.length, status: 'packaged' }, null, 2)
  );
}

main();
