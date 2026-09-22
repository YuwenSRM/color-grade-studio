'use strict';

// Produces local dimension-controlled derivatives from an authorized source photo for P1 testing.
// The generated files live in the system temp directory and are never added to the project.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const source = process.argv[2] && path.resolve(process.argv[2]);
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function main() {
  if (!source || !fs.existsSync(source))
    throw new Error('Pass an existing authorized source photo path.');
  if (!fs.existsSync(chrome)) throw new Error(`Chrome was not found at ${chrome}.`);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'real-landscape-p1-'));
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<input id="source" type="file" accept="image/*" />');
    await page.locator('#source').setInputFiles(source);
    const fixtures = [];
    for (const [label, width, height] of [
      ['12MP', 4000, 3000],
      ['24MP', 6000, 4000],
    ]) {
      const output = path.join(directory, `p1-${label.toLowerCase()}.jpg`);
      const download = page.waitForEvent('download');
      await page.evaluate(
        async ({ width, height, label }) => {
          const file = document.querySelector('#source').files[0];
          const image = await createImageBitmap(file);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(image, 0, 0, width, height);
          image.close();
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.96));
          if (!blob) throw new Error('Canvas JPEG encoding failed.');
          const anchor = document.createElement('a');
          anchor.href = URL.createObjectURL(blob);
          anchor.download = `p1-${label.toLowerCase()}.jpg`;
          anchor.click();
        },
        { width, height, label }
      );
      await (await download).saveAs(output);
      fixtures.push({
        label,
        file: output,
        width,
        height,
        pixels: width * height,
        sha256: hash(output),
      });
    }
    const manifest = {
      createdAt: new Date().toISOString(),
      source: { file: source, sha256: hash(source) },
      colorSpace:
        'Canvas sRGB output; verify source authorization and record its original color metadata.',
      fixtures,
    };
    fs.writeFileSync(
      path.join(directory, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n'
    );
    console.log(JSON.stringify({ directory, manifest }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
