const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'data', 'uploads', 'image-library', 'dist'].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) check(file);
    else if (/\.(js|cjs)$/.test(file)) execFileSync(process.execPath, ['--check', file]);
  }
}
check(root);
console.log('All JavaScript files passed syntax checks.');
