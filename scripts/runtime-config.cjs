const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function loadEnv(root, env = process.env) {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && env[match[1]] === undefined)
      env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

function configuration(root, env = process.env) {
  loadEnv(root, env);
  const port = Number(env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be an integer between 1 and 65535.');
  const host = env.HOST || '127.0.0.1';
  // The desktop launcher intentionally supports loopback deployment only.
  if (!['127.0.0.1', 'localhost'].includes(host))
    throw new Error('Local deployment requires HOST=127.0.0.1 or localhost.');
  return { port, host: '127.0.0.1' };
}

function resolveSqlite(root, env = process.env) {
  const candidates = env.SQLITE_PATH
    ? [path.resolve(root, env.SQLITE_PATH)]
    : [path.join(root, 'tools', 'sqlite3.exe'), 'sqlite3'];
  for (const executable of candidates) {
    try {
      execFileSync(executable, ['-version'], { timeout: 5000, stdio: 'pipe', windowsHide: true });
      return executable;
    } catch (_) {}
  }
  throw new Error(
    'SQLite could not run. Set SQLITE_PATH in .env, add sqlite3 to PATH, or place it in tools/sqlite3.exe.'
  );
}

module.exports = { loadEnv, configuration, resolveSqlite };
