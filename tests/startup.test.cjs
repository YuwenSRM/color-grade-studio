const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { configuration, resolveSqlite } = require('../scripts/runtime-config.cjs');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '..');

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'landscape-start-test-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'assets/pages'), { recursive: true });
  for (const name of ['start-app.cjs', 'runtime-config.cjs'])
    fs.copyFileSync(path.join(root, 'scripts', name), path.join(dir, 'scripts', name));
  for (const name of ['login.html', 'assets/pages/login.js', 'assets/pages/login.css'])
    fs.writeFileSync(path.join(dir, name), 'fixture');
  const socket = http.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
  delete env.SQLITE_PATH;
  t.after(async () => {
    const pidFile = path.join(dir, 'pid');
    if (fs.existsSync(pidFile)) {
      try {
        process.kill(Number(fs.readFileSync(pidFile, 'utf8')));
      } catch (_) {}
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return {
    dir,
    port,
    env,
    run: (args = ['--no-open']) =>
      exec(process.execPath, [path.join(dir, 'scripts/start-app.cjs'), ...args], {
        cwd: os.tmpdir(),
        env,
        windowsHide: true,
        timeout: 40000,
      }),
  };
}

test('configuration reads .env first, preserves environment overrides and rejects invalid ports', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'landscape-config-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, '.env'), 'PORT=4321\nHOST=localhost\n');
  assert.deepEqual(configuration(dir, {}), { port: 4321, host: '127.0.0.1' });
  assert.equal(configuration(dir, { PORT: '4322' }).port, 4322);
  assert.throws(() => configuration(dir, { PORT: 'bad' }), /PORT/);
  assert.throws(() => resolveSqlite(dir, { SQLITE_PATH: 'missing.exe' }), /SQLite/);
});

test('launcher refuses an unrelated occupied port without spawning or stopping it', async (t) => {
  const f = await fixture(t);
  const other = http.createServer((req, res) => res.end('{}'));
  await new Promise((resolve) => other.listen(f.port, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => other.close(resolve)));
  await assert.rejects(f.run(), (error) => /occupied/.test(error.stderr));
  assert.equal(other.listening, true);
  assert.equal(fs.existsSync(path.join(f.dir, 'data/startup.lock')), false);
});

test('launcher opens the original login entry without a theme variant', async (t) => {
  const f = await fixture(t);
  const other = http.createServer((req, res) =>
    res.end(
      req.url === '/api/health' ? JSON.stringify({ ok: true, service: 'landscape-demo' }) : 'ready'
    )
  );
  await new Promise((resolve) => other.listen(f.port, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => other.close(resolve)));
  const result = await f.run(['--no-open']);
  assert.match(result.stdout, /login\.html/);
  assert.doesNotMatch(result.stdout, /[?&]ui=/);
});

test('launcher reports invalid configuration and a missing SQLite dependency', async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.dir, 'serve.js'), '');
  f.env.PORT = 'invalid';
  await assert.rejects(f.run(), (error) => /PORT/.test(error.stderr));
  f.env.PORT = String(f.port);
  f.env.SQLITE_PATH = path.join(f.dir, 'missing-sqlite.exe');
  await assert.rejects(f.run(), (error) => /SQLite/.test(error.stderr));
  assert.equal(fs.existsSync(path.join(f.dir, 'data/startup.lock')), false);
});

test('concurrent cold launches start one service; repeat launch reuses it', async (t) => {
  try {
    resolveSqlite(root);
  } catch (_) {
    t.skip('SQLite required for cold-start preflight');
    return;
  }
  const f = await fixture(t);
  fs.writeFileSync(
    path.join(f.dir, 'serve.js'),
    `
    const fs = require('node:fs');
    fs.appendFileSync('starts', '1');
    fs.writeFileSync('pid', String(process.pid));
    require('node:http').createServer((req, res) => {
      res.setHeader('Connection', 'close');
      res.end(req.url === '/api/health'
        ? JSON.stringify({ok: true, service: 'landscape-demo'}) : 'ready');
    }).listen(Number(process.env.PORT), '127.0.0.1');
  `
  );
  const results = await Promise.all([f.run(), f.run()]);
  results.forEach((result) => assert.match(result.stdout, /is ready/));
  assert.match((await f.run()).stdout, /is ready/);
  assert.equal(fs.readFileSync(path.join(f.dir, 'starts'), 'utf8'), '1');
  assert.equal(fs.existsSync(path.join(f.dir, 'data/startup.lock')), false);
});

test('failed server exits promptly, releases lock and writes diagnostic log', async (t) => {
  try {
    resolveSqlite(root);
  } catch (_) {
    t.skip('SQLite required for cold-start preflight');
    return;
  }
  const f = await fixture(t);
  fs.writeFileSync(
    path.join(f.dir, 'serve.js'),
    'console.error("fixture failure"); process.exit(2);'
  );
  await assert.rejects(f.run(), (error) => /exit 2/.test(error.stderr));
  assert.match(fs.readFileSync(path.join(f.dir, 'data/startup.log'), 'utf8'), /fixture failure/);
  assert.equal(fs.existsSync(path.join(f.dir, 'data/startup.lock')), false);
});

test('real service cold-starts with an isolated database and serves pages and auth checks', async (t) => {
  try {
    resolveSqlite(root);
  } catch (_) {
    t.skip('SQLite required');
    return;
  }
  const f = await fixture(t);
  fs.cpSync(path.join(root, 'assets'), path.join(f.dir, 'assets'), { recursive: true });
  for (const name of fs.readdirSync(root).filter((file) => file.endsWith('.html')))
    fs.copyFileSync(path.join(root, name), path.join(f.dir, name));
  fs.copyFileSync(path.join(root, 'serve.js'), path.join(f.dir, 'service.cjs'));
  fs.writeFileSync(
    path.join(f.dir, 'serve.js'),
    'require("node:fs").writeFileSync("pid", String(process.pid)); require("./service.cjs");'
  );
  delete f.env.ADMIN_USERNAME;
  delete f.env.ADMIN_PASSWORD;
  assert.match((await f.run()).stdout, /is ready/);
  for (const [route, status] of [
    ['/login.html', 200],
    ['/color-grade.html', 200],
    ['/real-landscape.html', 200],
    ['/assets/pages/color-grade.css', 200],
    ['/admin.html', 302],
    ['/api/admin/users', 401],
  ]) {
    const response = await fetch(`http://127.0.0.1:${f.port}${route}`, { redirect: 'manual' });
    await response.arrayBuffer();
    assert.equal(response.status, status, route);
  }
  const response = await fetch(`http://127.0.0.1:${f.port}/api/images`);
  assert.deepEqual((await response.json()).images, []);
  assert.equal(fs.existsSync(path.join(f.dir, 'data/landscape.db')), true);
});
