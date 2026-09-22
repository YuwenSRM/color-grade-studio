const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const net = require('node:net');
const { configuration, resolveSqlite } = require('./runtime-config.cjs');

const root = path.resolve(__dirname, '..');
let origin;
const logPath = path.join(root, 'data', 'startup.log');
const lockPath = path.join(root, 'data', 'startup.lock');

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

async function acquireLock() {
  const deadline = Date.now() + 35000;
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const pid = Number(fs.readFileSync(lockPath, 'utf8'));
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > 2000 && !isAlive(pid)) fs.unlinkSync(lockPath);
      } catch (readError) {
        if (readError.code !== 'ENOENT') throw readError;
      }
      await delay(250);
    }
  }
  throw new Error('Another launcher is still starting the service. Check data/startup.log.');
}

function portOccupied(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (error) => (error.code === 'EADDRINUSE' ? resolve(true) : reject(error)));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(false)));
  });
}

async function isReady() {
  try {
    const response = await fetch(`${origin}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body.ok === true && body.service === 'landscape-demo';
  } catch (_) {
    return false;
  }
}

async function main() {
  const { port } = configuration(root);
  origin = `http://127.0.0.1:${port}`;
  const pageUrl = `${origin}/login.html`;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  await acquireLock();
  try {
    if (!(await isReady())) {
      if (await portOccupied(port))
        throw new Error(
          `Port ${port} is occupied by an unready or different service. Set PORT in .env to a free port; no process was stopped.`
        );
      for (const file of [
        'serve.js',
        'login.html',
        'assets/pages/login.js',
        'assets/pages/login.css',
      ]) {
        fs.accessSync(path.join(root, file), fs.constants.R_OK);
      }
      resolveSqlite(root);
      // Rotate only between server runs so an active log handle is never moved.
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > 5 * 1024 * 1024) {
        fs.renameSync(logPath, `${logPath}.${Date.now()}.bak`);
      }
      fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] Starting on ${origin}\n`);
      const log = fs.openSync(logPath, 'a');
      let server;
      try {
        // Keep the service alive after the launcher window closes.
        server = spawn(process.execPath, [path.join(root, 'serve.js')], {
          cwd: root,
          env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
          detached: true,
          windowsHide: true,
          stdio: ['ignore', log, log],
        });
      } finally {
        fs.closeSync(log);
      }
      let startupError;
      server.on('error', (error) => {
        startupError = error;
      });
      server.unref();
      const deadline = Date.now() + 30000;
      let ready = false;
      while (Date.now() < deadline) {
        if (startupError) throw startupError;
        if (await isReady()) {
          ready = true;
          break;
        }
        if (server.exitCode !== null) break;
        await delay(250);
      }
      if (!ready) {
        // Only stop the child created by this launcher, never another port owner.
        if (server.exitCode === null) server.kill();
        throw new Error(
          `The server did not become ready (exit ${server.exitCode ?? 'timeout'}). Check ${logPath}`
        );
      }
    }
    for (const route of ['/login.html', '/assets/pages/login.css', '/assets/pages/login.js']) {
      const response = await fetch(origin + route, { signal: AbortSignal.timeout(3000) });
      await response.arrayBuffer();
      if (!response.ok)
        throw new Error(`Startup resource failed: ${route} (HTTP ${response.status}).`);
    }
  } finally {
    fs.unlinkSync(lockPath);
  }
  console.log(`Real Landscape is ready: ${pageUrl}`);
  // Used by local diagnostics without opening another browser window.
  if (process.argv.includes('--no-open')) return;
  try {
    await promisify(execFile)(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${pageUrl}'`],
      { windowsHide: true, timeout: 10000 }
    );
  } catch (_) {
    console.warn(`The service is ready, but the browser could not open. Open ${pageUrl}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
