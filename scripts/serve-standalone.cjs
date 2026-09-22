'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'dist', 'standalone');
const port = Number(process.env.PORT || 4174);
const host = '127.0.0.1';
const mime = {
  '.cube': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function createServer(staticRoot) {
  return http.createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = new URL(request.url, `http://${host}`).pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(staticRoot, relative);
    if (
      !file.startsWith(`${staticRoot}${path.sep}`) &&
      file !== path.join(staticRoot, 'index.html')
    ) {
      response.writeHead(403).end();
      return;
    }
    fs.readFile(file, (error, body) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
        return;
      }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') response.end();
      else response.end(body);
    });
  });
}

function start({ staticRoot = root, listenPort = port } = {}) {
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
    throw new Error('PORT must be an integer from 1 through 65535.');
  }
  if (!fs.existsSync(path.join(staticRoot, 'index.html'))) {
    throw new Error('Standalone output is missing. Run npm run build:standalone first.');
  }
  const server = createServer(staticRoot);
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `Standalone Color Studio could not start: ${host}:${listenPort} is already in use. ` +
          'Close the other local server or start again with PORT=<unused-port>.'
      );
    } else {
      console.error(`Standalone Color Studio could not start: ${error.message}`);
    }
    process.exitCode = 1;
  });
  server.listen(listenPort, host, () => {
    console.log(`Standalone Color Studio: http://${host}:${listenPort}/`);
  });
  return server;
}

if (require.main === module) start();

module.exports = { createServer, start };
