const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname);
const { configuration, resolveSqlite } = require('./scripts/runtime-config.cjs');
const { port, host } = configuration(root);
const sqlite = resolveSqlite(root);
const dataDir = path.join(root, 'data');
const imageLibraryDir = path.join(root, 'image-library');
const originalImageDir = path.join(imageLibraryDir, 'originals');
// Keep the legacy upload directory readable for records created before the image library.
const uploadDir = path.join(root, 'uploads');
const manualImportDir = path.join(imageLibraryDir, 'imports');
const database = path.join(dataDir, 'landscape.db');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.json': 'application/json; charset=utf-8',
};

const catalog = {
  version: 1,
  regions: ['云南高原', '川西雪山', '桂林山水', '伦敦城市', '冰岛海岸'],
  presets: ['自然真实', '伦敦阴天', '赛博朋克', '胶片复古'],
};

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(imageLibraryDir, { recursive: true });
fs.mkdirSync(originalImageDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(manualImportDir, { recursive: true });

function runSql(sql, json = false) {
  const args = json ? ['-json', database, sql] : [database, sql];
  return execFileSync(sqlite, args, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
}

function sqlText(value) {
  return `CAST(X'${Buffer.from(String(value || ''), 'utf8').toString('hex')}' AS TEXT)`;
}

runSql(`CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  category TEXT NOT NULL,
  region TEXT,
  preset TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);`);

function ensureColumn(name, definition) {
  const columns = JSON.parse(runSql('PRAGMA table_info(images);', true) || '[]');
  if (!columns.some((column) => column.name === name))
    runSql(`ALTER TABLE images ADD COLUMN ${name} ${definition};`);
}
ensureColumn('review_status', "TEXT NOT NULL DEFAULT 'pending'");
ensureColumn('quality_score', 'INTEGER');
ensureColumn('reviewed_by', 'TEXT');
ensureColumn('reviewed_at', 'TEXT');
ensureColumn('review_note', 'TEXT');
ensureColumn('import_path', 'TEXT');
ensureColumn('storage_path', 'TEXT');
ensureColumn('title', 'TEXT');
ensureColumn('description', 'TEXT');

runSql(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`);

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}
function verifyPassword(password, user) {
  const candidate = Buffer.from(hashPassword(password, user.password_salt).hash, 'hex');
  const stored = Buffer.from(user.password_hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}
function userRows() {
  return JSON.parse(
    runSql(
      'SELECT id, username, role, created_at AS createdAt, updated_at AS updatedAt FROM users ORDER BY created_at ASC;',
      true
    ) || '[]'
  );
}
function userByUsername(username) {
  const value = sqlText(username);
  return (
    JSON.parse(
      runSql(
        `SELECT id, username, password_hash, password_salt, role, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE username=${value} LIMIT 1;`,
        true
      ) || '[]'
    )[0] || null
  );
}
function validUsername(username) {
  return /^[a-zA-Z0-9_.-]{3,40}$/.test(username);
}
function validPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}
// Roles are checked on the server so a browser-side button cannot grant extra access.
const roles = new Set(['guest', 'user', 'admin']);
function validRole(role) {
  return roles.has(role);
}
function createUser(username, password, role = 'admin') {
  if (!validUsername(username)) throw new Error('账号需为 3-40 位字母、数字或 . _ - 。');
  if (!validPassword(password)) throw new Error('密码至少需要 8 位字符。');
  if (!validRole(role)) throw new Error('账号角色无效。');
  const secret = hashPassword(password),
    now = new Date().toISOString(),
    id = crypto.randomUUID();
  runSql(
    `INSERT INTO users (id, username, password_hash, password_salt, role, created_at, updated_at) VALUES (${sqlText(id)}, ${sqlText(username)}, ${sqlText(secret.hash)}, ${sqlText(secret.salt)}, ${sqlText(role)}, ${sqlText(now)}, ${sqlText(now)});`
  );
  return id;
}
if (!userRows().length && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD)
  createUser(process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD);

const sessions = new Map();
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((item) => item.trim().split('=').map(decodeURIComponent))
      .filter(([key]) => key)
  );
}
function activeSession(req) {
  const token = parseCookies(req.headers.cookie).landscape_admin;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return { token, ...session };
}
function requireRole(req, res, allowedRoles) {
  const session = activeSession(req);
  if (!session) {
    sendJson(res, 401, { error: '请先登录后再进行此操作。' });
    return null;
  }
  if (!allowedRoles.includes(session.role)) {
    sendJson(res, 403, { error: '当前账号没有此操作权限。' });
    return null;
  }
  return session;
}
function requireAdmin(req, res) {
  return requireRole(req, res, ['admin']);
}
function writeSession(res, session, status = 200, body = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { ...session, expiresAt: Date.now() + sessionLifetimeMs });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Set-Cookie': `landscape_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetimeMs / 1000}`,
  });
  res.end(
    JSON.stringify({ authenticated: true, username: session.username, role: session.role, ...body })
  );
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 128 * 1024) {
        reject(new Error('请求内容过大。'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (_) {
        reject(new Error('请求格式无效。'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
function mimeForExtension(ext) {
  return (
    {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.avif': 'image/avif',
    }[ext] || 'application/octet-stream'
  );
}
function manualImports() {
  const files = [];
  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(absolute);
      const ext = path.extname(entry.name).toLowerCase();
      if (!imageExtensions.has(ext)) return;
      const stat = fs.statSync(absolute);
      const relative = path.relative(root, absolute).split(path.sep);
      files.push({
        id: `folder-${crypto.createHash('sha1').update(relative.join('/')).digest('hex').slice(0, 16)}`,
        filename: entry.name,
        mimeType: mimeForExtension(ext),
        sizeBytes: stat.size,
        category: '本地导入',
        region: '手动导入文件夹',
        source: 'folder-import',
        createdAt: stat.mtime.toISOString(),
        importPath: relative.join('/'),
        url: relative.map(encodeURIComponent).join('/'),
      });
    });
  }
  walk(manualImportDir);
  return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Keep manually copied files visible in the same database as web uploads without copying them again.
function syncFolderImports() {
  manualImports().forEach((image) => {
    runSql(
      `INSERT OR IGNORE INTO images (id, filename, stored_name, mime_type, size_bytes, category, region, preset, source, created_at, review_status, quality_score, reviewed_by, reviewed_at, review_note, import_path) VALUES (${sqlText(image.id)}, ${sqlText(image.filename)}, ${sqlText(image.importPath)}, ${sqlText(image.mimeType)}, ${image.sizeBytes}, ${sqlText(image.category)}, ${sqlText(image.region)}, NULL, 'folder-import', ${sqlText(image.createdAt)}, 'pending', NULL, NULL, NULL, '', ${sqlText(image.importPath)});`
    );
  });
}

function databaseImages() {
  syncFolderImports();
  return JSON.parse(
    runSql(
      `SELECT id, 
      filename, 
      stored_name AS storedName, 
      storage_path AS storagePath,
      mime_type AS mimeType, 
      size_bytes AS sizeBytes, 
      category, 
      region, 
      preset, 
      source, 
      created_at AS createdAt, 
      review_status AS reviewStatus, 
      quality_score AS qualityScore, 
      reviewed_by AS reviewedBy, 
      reviewed_at AS reviewedAt, 
      review_note AS reviewNote,
      title, description FROM images ORDER BY created_at DESC;`,
      true
    ) || '[]'
  ).map((row) => ({
    ...row,
    title: row.title || row.filename.replace(/\.[^.]+$/, ''),
    description: row.description || '',
    url:
      row.source === 'folder-import'
        ? row.storedName.split('/').map(encodeURIComponent).join('/')
        : row.storagePath || `uploads/${row.storedName}`,
  }));
}
function imageStats() {
  const stored = databaseImages();
  const folder = stored.filter((image) => image.source === 'folder-import');
  const all = stored;
  const categories = Object.entries(
    all.reduce((totals, image) => {
      const category = image.category || '未分类';
      totals[category] = (totals[category] || 0) + 1;
      return totals;
    }, {})
  )
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  const statuses = ['pending', 'approved', 'rejected'].map((status) => ({
    status,
    count: all.filter((image) => image.reviewStatus === status).length,
  }));
  const reviewed = stored.filter((image) => Number.isInteger(image.qualityScore));
  const sources = Object.entries(
    all.reduce((totals, image) => {
      const source = image.source || 'unknown';
      totals[source] = (totals[source] || 0) + 1;
      return totals;
    }, {})
  )
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  const recent = all.filter(
    (image) => Date.now() - new Date(image.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000
  ).length;
  return {
    total: all.length,
    storedCount: stored.length - folder.length,
    folderCount: folder.length,
    pending: statuses.find((entry) => entry.status === 'pending').count,
    approved: statuses.find((entry) => entry.status === 'approved').count,
    rejected: statuses.find((entry) => entry.status === 'rejected').count,
    reviewedCount: reviewed.length,
    averageQuality: reviewed.length
      ? Math.round(
          (reviewed.reduce((sum, image) => sum + image.qualityScore, 0) / reviewed.length) * 10
        ) / 10
      : null,
    recent,
    categories,
    statuses,
    sources,
  };
}

const providerStatus = () => ({
  unsplash: Boolean(process.env.UNSPLASH_ACCESS_KEY),
  vcg: Boolean(process.env.VCG_SEARCH_URL && process.env.VCG_API_TOKEN),
});

async function searchUnsplash(query, page) {
  const endpoint = new URL('https://api.unsplash.com/search/photos');
  endpoint.searchParams.set('query', query);
  endpoint.searchParams.set('page', String(page));
  endpoint.searchParams.set('per_page', '18');
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`,
      'Accept-Version': 'v1',
    },
  });
  if (!response.ok) throw new Error(`Unsplash API returned ${response.status}`);
  const payload = await response.json();
  return (payload.results || []).map((item) => ({
    id: `unsplash-${item.id}`,
    title: item.alt_description || item.description || query,
    category: '授权图源',
    imageUrl: item.urls.regular,
    previewUrl: item.urls.small || item.urls.regular,
    sourceUrl: item.links.html,
    provider: 'Unsplash',
    author: item.user?.name || '',
    license: 'Unsplash License',
  }));
}

async function searchVcg(query, page) {
  const endpoint = new URL(process.env.VCG_SEARCH_URL);
  endpoint.searchParams.set('query', query);
  endpoint.searchParams.set('page', String(page));
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${process.env.VCG_API_TOKEN}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`VCG partner API returned ${response.status}`);
  const payload = await response.json();
  const records = payload.items || payload.data?.items || payload.data || [];
  return records
    .map((item) => ({
      id: `vcg-${item.id || item.imageId}`,
      title: item.title || item.caption || query,
      category: '授权图源',
      imageUrl: item.previewUrl || item.imageUrl || item.url,
      previewUrl: item.thumbnailUrl || item.previewUrl || item.imageUrl || item.url,
      sourceUrl: item.detailUrl || item.url,
      provider: '视觉中国',
      author: item.author || item.creator || '',
      license: item.license || '授权内容',
    }))
    .filter((item) => item.previewUrl);
}

// The demo accepts one image field and a few text fields, so a small multipart parser is sufficient here.
function parseMultipart(buffer, boundary) {
  const parts = [];
  const delimiter = Buffer.from(`--${boundary}`);
  let start = buffer.indexOf(delimiter) + delimiter.length + 2;
  while (start > delimiter.length && start < buffer.length) {
    const end = buffer.indexOf(delimiter, start);
    if (end < 0) break;
    const section = buffer.slice(start, end - 2);
    const split = section.indexOf(Buffer.from('\r\n\r\n'));
    if (split >= 0) {
      const header = section.slice(0, split).toString('utf8');
      const content = section.slice(split + 4);
      const name = /name="([^"]+)"/.exec(header)?.[1];
      const filename = /filename="([^"]*)"/.exec(header)?.[1];
      const type = /Content-Type:\s*([^\r\n]+)/i.exec(header)?.[1] || 'application/octet-stream';
      if (name) parts.push({ name, filename, type, content });
    }
    start = end + delimiter.length + 2;
  }
  return parts;
}

http
  .createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
    const urlPath = requestUrl.pathname === '/' ? '/real-landscape.html' : requestUrl.pathname;
    if (urlPath === '/api/health') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return res.end(
        JSON.stringify({ ok: true, service: 'landscape-demo', timestamp: new Date().toISOString() })
      );
    }
    if (urlPath === '/api/catalog') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return res.end(JSON.stringify(catalog));
    }
    if (urlPath === '/api/auth/session' && req.method === 'GET') {
      const session = activeSession(req);
      return sendJson(res, 200, {
        authenticated: Boolean(session),
        username: session?.username || null,
        role: session?.role || null,
        configured: Boolean(userRows().length),
      });
    }
    if (urlPath === '/api/auth/login' && req.method === 'POST') {
      return readJson(req)
        .then(({ username, password }) => {
          const user = userByUsername(String(username || ''));
          if (!user || !verifyPassword(password, user))
            return sendJson(res, 401, { error: '账号或密码错误。' });
          return writeSession(res, {
            username: user.username,
            role: validRole(user.role) ? user.role : 'user',
          });
        })
        .catch((error) => sendJson(res, 400, { error: error.message }));
    }
    if (urlPath === '/api/auth/guest' && req.method === 'POST') {
      return writeSession(res, { username: '游客', role: 'guest' });
    }
    if (urlPath === '/api/auth/logout' && req.method === 'POST') {
      const session = activeSession(req);
      if (session) sessions.delete(session.token);
      res.writeHead(204, {
        'Set-Cookie': 'landscape_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
      });
      return res.end();
    }
    if (urlPath === '/api/stats' && req.method === 'GET') return sendJson(res, 200, imageStats());
    if (urlPath === '/api/admin/images' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      return sendJson(res, 200, { images: databaseImages(), stats: imageStats() });
    }
    if (urlPath === '/api/admin/stats' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      return sendJson(res, 200, imageStats());
    }
    if (urlPath === '/api/admin/users' && req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      return sendJson(res, 200, { users: userRows() });
    }
    if (urlPath === '/api/admin/users' && req.method === 'POST') {
      if (!requireAdmin(req, res)) return;
      return readJson(req)
        .then(({ username, password, role }) => {
          try {
            createUser(String(username || ''), password, validRole(role) ? role : 'user');
            return sendJson(res, 201, { users: userRows() });
          } catch (error) {
            return sendJson(res, /UNIQUE constraint/i.test(error.message) ? 409 : 400, {
              error: /UNIQUE constraint/i.test(error.message) ? '该账号已存在。' : error.message,
            });
          }
        })
        .catch((error) => sendJson(res, 400, { error: error.message }));
    }
    const userMatch = /^\/api\/admin\/users\/([0-9a-f-]+)$/i.exec(urlPath);
    if (userMatch && req.method === 'PATCH') {
      const session = requireAdmin(req, res);
      if (!session) return;
      return readJson(req)
        .then(({ password, role }) => {
          const target = userRows().find((entry) => entry.id === userMatch[1]);
          if (!target) return sendJson(res, 404, { error: '账号不存在。' });
          if (role !== undefined && !validRole(role))
            return sendJson(res, 400, { error: '账号角色无效。' });
          if (role && role !== target.role) {
            const adminCount = userRows().filter((entry) => entry.role === 'admin').length;
            if (target.username === session.username && role !== 'admin')
              return sendJson(res, 400, { error: '不能降低当前登录管理员的权限。' });
            if (target.role === 'admin' && role !== 'admin' && adminCount <= 1)
              return sendJson(res, 400, { error: '必须保留至少一个管理员账号。' });
            runSql(
              `UPDATE users SET role=${sqlText(role)}, updated_at=${sqlText(new Date().toISOString())} WHERE id=${sqlText(userMatch[1])};`
            );
          }
          if (password !== undefined && password !== '') {
            if (!validPassword(password))
              return sendJson(res, 400, { error: '密码至少需要 8 位字符。' });
            const secret = hashPassword(password),
              now = new Date().toISOString();
            runSql(
              `UPDATE users SET password_hash=${sqlText(secret.hash)}, password_salt=${sqlText(secret.salt)}, updated_at=${sqlText(now)} WHERE id=${sqlText(userMatch[1])};`
            );
          }
          const user = userRows().find((entry) => entry.id === userMatch[1]);
          return user
            ? sendJson(res, 200, { user })
            : sendJson(res, 404, { error: '账号不存在。' });
        })
        .catch((error) => sendJson(res, 400, { error: error.message }));
    }
    if (userMatch && req.method === 'DELETE') {
      const session = requireAdmin(req, res);
      if (!session) return;
      const target = userRows().find((entry) => entry.id === userMatch[1]);
      if (!target) return sendJson(res, 404, { error: '账号不存在。' });
      if (target.username === session.username)
        return sendJson(res, 400, { error: '不能删除当前登录账号。' });
      if (
        target.role === 'admin' &&
        userRows().filter((entry) => entry.role === 'admin').length <= 1
      )
        return sendJson(res, 400, { error: '必须保留至少一个管理员账号。' });
      runSql(`DELETE FROM users WHERE id=${sqlText(target.id)};`);
      return sendJson(res, 200, { users: userRows() });
    }
    // Database image IDs may be UUIDs or folder-import IDs such as "folder-...".
    const reviewMatch = /^\/api\/admin\/images\/([a-z0-9_-]+)\/review$/i.exec(urlPath);
    if (reviewMatch && req.method === 'PATCH') {
      const session = requireAdmin(req, res);
      if (!session) return;
      return readJson(req)
        .then(({ status, qualityScore, note }) => {
          if (!['pending', 'approved', 'rejected'].includes(status))
            return sendJson(res, 400, { error: '审核状态无效。' });
          const score = qualityScore === null || qualityScore === '' ? null : Number(qualityScore);
          if (score !== null && (!Number.isInteger(score) || score < 0 || score > 100))
            return sendJson(res, 400, { error: '质量分必须为 0 到 100 的整数。' });
          const reviewedAt = status === 'pending' ? null : new Date().toISOString();
          runSql(
            `UPDATE images SET review_status=${sqlText(status)}, quality_score=${score === null ? 'NULL' : score}, reviewed_by=${status === 'pending' ? 'NULL' : sqlText(session.username)}, reviewed_at=${reviewedAt ? sqlText(reviewedAt) : 'NULL'}, review_note=${sqlText(String(note || '').slice(0, 500))} WHERE id=${sqlText(reviewMatch[1])};`
          );
          const image = databaseImages().find((entry) => entry.id === reviewMatch[1]);
          if (!image) return sendJson(res, 404, { error: '图片不存在。' });
          return sendJson(res, 200, { image });
        })
        .catch((error) => sendJson(res, 400, { error: error.message }));
    }
    if (urlPath === '/api/providers' && req.method === 'GET') {
      return sendJson(res, 200, { providers: providerStatus() });
    }
    if (urlPath === '/api/provider-images' && req.method === 'GET') {
      const provider = requestUrl.searchParams.get('provider');
      const query = (requestUrl.searchParams.get('query') || '').trim();
      const page = Math.max(1, Number(requestUrl.searchParams.get('page') || 1));
      if (!query) return sendJson(res, 400, { error: 'A search query is required.' });
      if (!providerStatus()[provider])
        return sendJson(res, 409, {
          error: `${provider === 'vcg' ? '视觉中国合作 API' : 'Unsplash API'} 未配置授权凭据。`,
        });
      const search =
        provider === 'unsplash' ? searchUnsplash : provider === 'vcg' ? searchVcg : null;
      if (!search) return sendJson(res, 400, { error: 'Unsupported provider.' });
      return search(query, page)
        .then((images) => sendJson(res, 200, { provider, images }))
        .catch((error) =>
          sendJson(res, 502, { error: error.message || 'Provider search failed.' })
        );
    }
    if (urlPath === '/api/images' && req.method === 'GET') {
      return sendJson(res, 200, { images: databaseImages() });
    }
    if (urlPath === '/api/import-folder' && req.method === 'GET') {
      return sendJson(res, 200, { folder: 'image-library/imports', images: manualImports() });
    }
    if (urlPath === '/api/images' && req.method === 'POST') {
      if (!requireRole(req, res, ['user', 'admin'])) return;
      const type = req.headers['content-type'] || '';
      const boundary = /boundary=([^;]+)/i.exec(type)?.[1];
      if (!boundary) return sendJson(res, 400, { error: 'Expected multipart form data.' });
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) {
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          const parts = parseMultipart(Buffer.concat(chunks), boundary);
          const file = parts.find((part) => part.name === 'image' && part.filename);
          if (!file || !file.content.length || !file.type.startsWith('image/'))
            return sendJson(res, 400, { error: 'Please provide an image file.' });
          const field = (name) =>
            parts
              .find((part) => part.name === name)
              ?.content.toString('utf8')
              .trim() || '';
          const ext =
            {
              'image/jpeg': '.jpg',
              'image/png': '.png',
              'image/webp': '.webp',
              'image/gif': '.gif',
              'image/avif': '.avif',
            }[file.type] || '.img';
          const id = crypto.randomUUID();
          const storedName = `${id}${ext}`;
          const storagePath = path.posix.join('image-library', 'originals', storedName);
          fs.writeFileSync(path.join(originalImageDir, storedName), file.content);
          const image = {
            id,
            filename: path.basename(file.filename),
            storedName,
            storagePath,
            mimeType: file.type,
            sizeBytes: file.content.length,
            category: field('category') || '未分类',
            region: field('region'),
            preset: field('preset'),
            source: field('source') || 'real-landscape',
            title: String(
              field('title') || path.basename(file.filename, path.extname(file.filename))
            ).slice(0, 200),
            description: String(field('description')).slice(0, 5000),
            createdAt: new Date().toISOString(),
            reviewStatus: 'pending',
            qualityScore: null,
            reviewedBy: null,
            reviewedAt: null,
            reviewNote: '',
          };
          runSql(
            `INSERT INTO images (id, filename, stored_name, storage_path, mime_type, size_bytes, category, region, preset, source, created_at, review_status, quality_score, reviewed_by, reviewed_at, review_note, title, description) VALUES (${sqlText(image.id)}, ${sqlText(image.filename)}, ${sqlText(image.storedName)}, ${sqlText(image.storagePath)}, ${sqlText(image.mimeType)}, ${image.sizeBytes}, ${sqlText(image.category)}, ${sqlText(image.region)}, ${sqlText(image.preset)}, ${sqlText(image.source)}, ${sqlText(image.createdAt)}, 'pending', NULL, NULL, NULL, '', ${sqlText(image.title)}, ${sqlText(image.description)});`
          );
          return sendJson(res, 201, { image: { ...image, url: storagePath } });
        } catch (error) {
          return sendJson(res, 500, { error: 'Unable to save image.', detail: error.message });
        }
      });
      return;
    }
    let requestedPath;
    try {
      requestedPath = decodeURIComponent(urlPath);
    } catch (_) {
      res.writeHead(400);
      return res.end('Invalid path');
    }
    if (
      ['/audit.html', '/admin.html'].includes(requestedPath) &&
      activeSession(req)?.role !== 'admin'
    ) {
      res.writeHead(302, { Location: '/login.html' });
      return res.end();
    }
    const file = path.resolve(root, `.${requestedPath}`);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not found');
      }
      const contentType = mime[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
      });
      res.end(data);
    });
  })
  .listen(port, host, () => console.log(`Landscape demo: http://${host}:${port}`))
  .on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Try: set PORT=4174 && node serve.js`);
    } else {
      console.error(error.message);
    }
    process.exitCode = 1;
  });
