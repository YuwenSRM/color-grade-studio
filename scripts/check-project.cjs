const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const { configuration, resolveSqlite } = require('./runtime-config.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const failures = [];
  const resources = new Set();
  const pages = fs.readdirSync(root).filter((file) => file.endsWith('.html'));
  for (const file of pages) {
    const document = new JSDOM(fs.readFileSync(path.join(root, file), 'utf8')).window.document;
    const ids = new Set();
    for (const node of document.querySelectorAll('[id]')) {
      if (ids.has(node.id)) failures.push(`${file}: duplicate id ${node.id}`);
      ids.add(node.id);
    }
    for (const node of document.querySelectorAll('script[src],link[href],a[href],img[src]')) {
      const value = node.getAttribute('src') || node.getAttribute('href');
      if (!value || /^(?:[a-z]+:|#|\/\/)/i.test(value)) continue;
      const relative = decodeURIComponent(value.split(/[?#]/)[0]).replace(/^\//, '');
      if (!relative) continue;
      if (!fs.existsSync(path.join(root, relative))) failures.push(`${file}: missing ${relative}`);
      if (node.tagName !== 'A') resources.add(relative);
    }
  }
  const sqlite = resolveSqlite(root);
  const db = path.join(root, 'data/landscape.db');
  const sql = (query) =>
    execFileSync(sqlite, ['-readonly', '-json', db, query], {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
    });
  const integrity = JSON.parse(sql('PRAGMA quick_check;'));
  if (integrity.some((row) => Object.values(row)[0] !== 'ok'))
    failures.push('Database quick_check failed');
  const images = JSON.parse(sql('SELECT id, source, stored_name, storage_path FROM images;'));
  for (const row of images) {
    const relative =
      row.source === 'folder-import'
        ? row.stored_name
        : row.storage_path || `uploads/${row.stored_name}`;
    if (!fs.existsSync(path.join(root, relative))) failures.push(`Image ${row.id}: file missing`);
  }
  const { port } = configuration(root);
  const origin = `http://127.0.0.1:${port}`;
  for (const route of [
    '/api/health',
    '/api/auth/session',
    ...pages.map((f) => '/' + f),
    ...Array.from(resources, (f) => '/' + f),
  ]) {
    try {
      const response = await fetch(origin + route, {
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
      await response.arrayBuffer();
      if (![200, 302].includes(response.status)) failures.push(`${route}: HTTP ${response.status}`);
    } catch (error) {
      failures.push(`${route}: ${error.message}`);
    }
  }
  console.log(
    JSON.stringify(
      {
        pages: pages.length,
        resources: resources.size,
        images: images.length,
        database: 'quick_check completed',
        failures,
      },
      null,
      2
    )
  );
  if (failures.length) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
