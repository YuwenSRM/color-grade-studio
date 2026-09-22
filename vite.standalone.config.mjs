import { defineConfig } from 'vite';
import { copyFileSync, cpSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const runtimeManifest = require('./scripts/standalone-runtime-manifest.cjs');

const root = resolve(import.meta.dirname);
const output = resolve(root, 'dist/standalone');
const fullOnlyAccountMarkup = `      <div class="color-account" id="colorAccount" aria-live="polite">
        <span id="colorAccountText" data-i18n="cg.static.signedOut">未登录</span>
        <a id="colorLogin" href="login.html" data-i18n="cg.static.signInUpload">登录后上传成片</a>
      </div>
`;

function standaloneShell() {
  return {
    name: 'standalone-shell',
    transformIndexHtml(html) {
      const normalizedHtml = html.replace(/\r\n/g, '\n');
      if (!normalizedHtml.includes(fullOnlyAccountMarkup))
        throw new Error(
          'Standalone build expected the full-mode account markup in color-grade.html.'
        );
      return normalizedHtml
        .replace('    <script src="assets/shared/api-client.js"></script>\n', '')
        .replace('    <script src="assets/shared/data-sync.js"></script>\n', '')
        .replace('    <script src="assets/pages/color-grade-full-integration.js"></script>\n', '')
        .replace(fullOnlyAccountMarkup, '')
        .replace(
          '    <script src="assets/color-grade/color-grade-mode-full.js"></script>',
          '    <script src="assets/color-grade/color-grade-mode-standalone.js"></script>'
        )
        .replace(
          '</head>',
          `    <style>.crumb, .publish-fields, #uploadToLibrary, #uploadModal { display: none !important; }</style>\n  </head>`
        );
    },
    writeBundle() {
      for (const relative of runtimeManifest.runtimeFiles) {
        const target = resolve(output, relative);
        mkdirSync(resolve(target, '..'), { recursive: true });
        copyFileSync(resolve(root, relative), target);
      }
      for (const relative of runtimeManifest.runtimeDirectories)
        cpSync(resolve(root, relative), resolve(output, relative), { recursive: true });
      const generated = resolve(output, 'color-grade.html');
      const entry = resolve(output, 'index.html');
      renameSync(generated, entry);
      writeFileSync(
        resolve(output, 'BUILD.json'),
        `${JSON.stringify(runtimeManifest.createRuntimeBuild(root), null, 2)}\n`,
        'utf8'
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [standaloneShell()],
  build: {
    outDir: 'dist/standalone',
    emptyOutDir: true,
    copyPublicDir: false,
    rollupOptions: {
      input: { index: resolve(root, 'color-grade.html') },
    },
  },
});
