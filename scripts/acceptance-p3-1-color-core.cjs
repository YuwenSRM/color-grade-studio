const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const result = spawnSync(process.execPath, ['--test', 'tests/p3-1-color-core.test.cjs'], {
  cwd: root,
  stdio: 'inherit',
});
process.exitCode = result.status === 0 ? 0 : result.status || 1;
