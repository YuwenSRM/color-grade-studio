(function (root, factory) {
  const api = factory(
    root.ColorGradeLut || (typeof require === 'function' ? require('./color-grade-lut.js') : null),
    root.crypto
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LandscapeLutLibrary = api;
})(globalThis, function (CubeLut, platformCrypto) {
  'use strict';

  const DB_NAME = 'real-landscape-filter-library';
  // v2 records the frozen P1 contract version in settings and makes the v1 -> v2
  // upgrade explicit. Filter records themselves remain schemaVersion 1.
  const DB_VERSION = 2;
  const MAX_FILTERS = 50;
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const BACKUP_FORMAT = 'real-landscape-filter-library';
  const BACKUP_VERSION = 1;
  const COLOR_SPACE_SRGB = 'sRGB SDR';
  const COLOR_SPACE_UNKNOWN = '未知';
  const neutralParameters = Object.freeze({ b: 1, c: 1, s: 1, w: 1, t: 0 });
  const parameterBounds = Object.freeze({
    b: [0.5, 1.5],
    c: [0, 1.5],
    s: [0, 1.5],
    w: [0.5, 1.5],
    t: [-60, 60],
  });
  const allowedScenes = 12;
  const textLimits = Object.freeze({
    name: 120,
    author: 120,
    brand: 80,
    sourceUrl: 500,
    licenseNote: 500,
    scene: 50,
  });

  class LutLibraryError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'LutLibraryError';
      this.code = code;
      this.details = Object.freeze({ ...details });
    }
  }

  function fail(code, message, details) {
    throw new LutLibraryError(code, message, details);
  }

  function hasOnlyKeys(value, keys) {
    return Object.keys(value).every((key) => keys.includes(key));
  }

  function cleanText(value, field, maximum, { optional = false } = {}) {
    if (value === undefined && optional) return '';
    if (typeof value !== 'string') fail('invalid-json-schema', `${field} 必须是文本。`);
    const text = value.trim();
    if ((!optional && !text) || text.length > maximum) {
      fail('invalid-json-schema', `${field} 不能为空且长度不能超过 ${maximum} 个字符。`);
    }
    return text;
  }

  function sanitizeScenes(value) {
    if (!Array.isArray(value) || value.length > allowedScenes) {
      fail('invalid-json-schema', `scenes 必须是最多 ${allowedScenes} 项的文本数组。`);
    }
    const scenes = value.map((scene) => cleanText(scene, '场景', textLimits.scene));
    if (new Set(scenes).size !== scenes.length) fail('invalid-json-schema', 'scenes 不能重复。');
    return scenes;
  }

  function sanitizeParameters(value) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !hasOnlyKeys(value, Object.keys(parameterBounds))
    ) {
      fail('invalid-json-schema', 'parameters 只能包含 b、c、s、w、t。');
    }
    const result = {};
    for (const [key, bounds] of Object.entries(parameterBounds)) {
      const number = value[key];
      if (!Number.isFinite(number) || number < bounds[0] || number > bounds[1]) {
        fail('invalid-json-schema', `${key} 必须在 ${bounds[0]} 到 ${bounds[1]} 之间。`);
      }
      result[key] = number;
    }
    return result;
  }

  function compatibility(inputColorSpace, outputColorSpace) {
    return inputColorSpace === COLOR_SPACE_SRGB && outputColorSpace === COLOR_SPACE_SRGB
      ? 'applicable'
      : 'unknown-color-space';
  }

  function validateParameterFilter(value) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !hasOnlyKeys(value, ['format', 'version', 'kind', 'name', 'parameters', 'metadata'])
    ) {
      fail('invalid-json-schema', '参数滤镜包含未支持的字段。');
    }
    if (
      value.format !== 'real-landscape-filter' ||
      value.version !== 1 ||
      value.kind !== 'parameters'
    ) {
      fail('invalid-json-schema', '仅支持 Real Landscape 参数滤镜 JSON v1。');
    }
    if (
      !value.metadata ||
      typeof value.metadata !== 'object' ||
      Array.isArray(value.metadata) ||
      !hasOnlyKeys(value.metadata, [
        'author',
        'sourceUrl',
        'scenes',
        'inputColorSpace',
        'outputColorSpace',
        'licenseNote',
        'brand',
      ])
    ) {
      fail('invalid-json-schema', 'metadata 包含未支持的字段。');
    }
    const metadata = value.metadata;
    const inputColorSpace = cleanText(metadata.inputColorSpace, 'inputColorSpace', 32);
    const outputColorSpace = cleanText(metadata.outputColorSpace, 'outputColorSpace', 32);
    if (
      ![COLOR_SPACE_SRGB, COLOR_SPACE_UNKNOWN].includes(inputColorSpace) ||
      ![COLOR_SPACE_SRGB, COLOR_SPACE_UNKNOWN].includes(outputColorSpace)
    ) {
      fail('invalid-json-schema', '色彩空间只能为 sRGB SDR 或 未知。');
    }
    return Object.freeze({
      name: cleanText(value.name, 'name', textLimits.name),
      parameters: sanitizeParameters(value.parameters),
      author: cleanText(metadata.author ?? '', 'author', textLimits.author, { optional: true }),
      sourceUrl: cleanText(metadata.sourceUrl ?? '', 'sourceUrl', textLimits.sourceUrl, {
        optional: true,
      }),
      licenseNote: cleanText(metadata.licenseNote ?? '', 'licenseNote', textLimits.licenseNote, {
        optional: true,
      }),
      brand: cleanText(metadata.brand ?? '自定义', 'brand', textLimits.brand),
      scenes: sanitizeScenes(metadata.scenes),
      inputColorSpace,
      outputColorSpace,
      compatibilityStatus: compatibility(inputColorSpace, outputColorSpace),
    });
  }

  function validateParameterFilterText(text) {
    if (typeof text !== 'string' || !text.trim()) fail('invalid-json', 'JSON 文件为空或无法读取。');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      fail('invalid-json', 'JSON 文件格式无效。');
    }
    return validateParameterFilter(parsed);
  }

  function utf8(text) {
    return new TextEncoder().encode(text);
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function sha256(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const cryptoApi = platformCrypto || globalThis.crypto;
    if (cryptoApi?.subtle) {
      const digest = await cryptoApi.subtle.digest('SHA-256', source);
      return bytesToHex(new Uint8Array(digest));
    }
    if (typeof require === 'function') {
      return require('node:crypto').createHash('sha256').update(Buffer.from(source)).digest('hex');
    }
    fail('crypto-unavailable', '浏览器不支持安全哈希，无法导入滤镜。');
  }

  function parameterHashPayload(record) {
    return {
      kind: 'parameters',
      name: cleanText(record.name, 'name', textLimits.name),
      parameters: sanitizeParameters(record.parameters),
      author: cleanText(record.author || '', 'author', textLimits.author, { optional: true }),
      sourceUrl: cleanText(record.sourceUrl || '', 'sourceUrl', textLimits.sourceUrl, {
        optional: true,
      }),
      licenseNote: cleanText(record.licenseNote || '', 'licenseNote', textLimits.licenseNote, {
        optional: true,
      }),
      brand: cleanText(record.brand || '自定义', 'brand', textLimits.brand),
      scenes: sanitizeScenes(record.scenes || []),
      inputColorSpace: cleanText(record.inputColorSpace, 'inputColorSpace', 32),
      outputColorSpace: cleanText(record.outputColorSpace, 'outputColorSpace', 32),
    };
  }

  async function parameterContentHash(record) {
    return sha256(utf8(JSON.stringify(parameterHashPayload(record))));
  }

  function randomId() {
    const cryptoApi = platformCrypto || globalThis.crypto;
    if (cryptoApi?.randomUUID) return `user-${cryptoApi.randomUUID()}`;
    const bytes = new Uint8Array(16);
    if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
    else
      for (let index = 0; index < bytes.length; index += 1)
        bytes[index] = Math.floor(Math.random() * 256);
    return `user-${bytesToHex(bytes)}`;
  }

  function basename(filename) {
    return (
      String(filename || '未命名滤镜')
        .replace(/\.[^.]+$/, '')
        .trim()
        .slice(0, textLimits.name) || '未命名滤镜'
    );
  }

  function cloneRecord(record) {
    const { blob, ...metadata } = record;
    return typeof structuredClone === 'function'
      ? structuredClone(metadata)
      : JSON.parse(JSON.stringify(metadata));
  }

  function normalizeRecord(record) {
    const now = new Date().toISOString();
    const kind = record.kind;
    if (!['lut', 'parameters'].includes(kind)) fail('invalid-record', '未知滤镜类型。');
    const inputColorSpace = record.inputColorSpace || COLOR_SPACE_UNKNOWN;
    const outputColorSpace = record.outputColorSpace || COLOR_SPACE_UNKNOWN;
    if (
      ![COLOR_SPACE_SRGB, COLOR_SPACE_UNKNOWN].includes(inputColorSpace) ||
      ![COLOR_SPACE_SRGB, COLOR_SPACE_UNKNOWN].includes(outputColorSpace)
    ) {
      fail('invalid-record', '色彩空间只能为 sRGB SDR 或 未知。');
    }
    const common = {
      id: cleanText(record.id || randomId(), 'id', 100),
      schemaVersion: 1,
      kind,
      contentHash: cleanText(record.contentHash, 'contentHash', 128),
      name: cleanText(record.name, 'name', textLimits.name),
      origin: 'user',
      brand: cleanText(record.brand || '自定义', 'brand', textLimits.brand),
      author: cleanText(record.author || '', 'author', textLimits.author, { optional: true }),
      sourceUrl: cleanText(record.sourceUrl || '', 'sourceUrl', textLimits.sourceUrl, {
        optional: true,
      }),
      licenseNote: cleanText(record.licenseNote || '', 'licenseNote', textLimits.licenseNote, {
        optional: true,
      }),
      scenes: sanitizeScenes(record.scenes || []),
      inputColorSpace,
      outputColorSpace,
      compatibilityStatus: compatibility(inputColorSpace, outputColorSpace),
      favorite: Boolean(record.favorite),
      thumbnailKey: null,
      createdAt: record.createdAt || now,
      updatedAt: now,
    };
    if (kind === 'lut') {
      if (
        !Number.isSafeInteger(record.gridSize) ||
        !Array.isArray(record.domainMin) ||
        !Array.isArray(record.domainMax)
      ) {
        fail('invalid-record', 'LUT 摘要无效。');
      }
      return {
        ...common,
        blobKey: record.blobKey || common.id,
        gridSize: record.gridSize,
        domainMin: Array.from(record.domainMin),
        domainMax: Array.from(record.domainMax),
        ordering: record.ordering || 'red-fastest',
        interpolation: record.interpolation || 'trilinear',
      };
    }
    return { ...common, parameters: sanitizeParameters(record.parameters) };
  }

  function requestAsPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error || new LutLibraryError('storage-failed', '本地滤镜库操作失败。'));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error || new LutLibraryError('storage-failed', '本地滤镜库保存失败。'));
      transaction.onerror = () =>
        reject(transaction.error || new LutLibraryError('storage-failed', '本地滤镜库保存失败。'));
    });
  }

  function migrateDatabase(database, transaction, oldVersion) {
    const filters = database.objectStoreNames.contains('filters')
      ? transaction.objectStore('filters')
      : database.createObjectStore('filters', { keyPath: 'id' });
    if (!filters.indexNames.contains('contentHash'))
      filters.createIndex('contentHash', 'contentHash', { unique: false });
    if (!database.objectStoreNames.contains('blobs'))
      database.createObjectStore('blobs', { keyPath: 'key' });
    const settings = database.objectStoreNames.contains('settings')
      ? transaction.objectStore('settings')
      : database.createObjectStore('settings', { keyPath: 'key' });
    if (oldVersion < 2)
      settings.put({ key: 'p1-contract-version', value: 1, updatedAt: new Date().toISOString() });
  }

  function openDatabase(indexedDB, { allowMemoryFallback = false } = {}) {
    if (!indexedDB) {
      if (allowMemoryFallback) return Promise.resolve(null);
      return Promise.reject(
        new LutLibraryError('storage-unavailable', '浏览器不支持本地持久化滤镜库。')
      );
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        migrateDatabase(request.result, request.transaction, event.oldVersion);
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
      request.onerror = () =>
        reject(request.error || new LutLibraryError('storage-unavailable', '无法打开本地滤镜库。'));
      request.onblocked = () =>
        reject(new LutLibraryError('storage-blocked', '请关闭其它页面后重试。'));
    });
  }

  class LutLibrary {
    constructor({
      indexedDB = globalThis.indexedDB,
      now = () => new Date().toISOString(),
      idFactory = randomId,
      lutValidator = null,
      parameterValidator = null,
      allowMemoryFallback = false,
    } = {}) {
      this.indexedDB = indexedDB;
      this.now = now;
      this.idFactory = idFactory;
      this.lutValidator = lutValidator;
      this.parameterValidator = parameterValidator;
      this.memory = new Map();
      this.memoryBlobs = new Map();
      this.databasePromise = openDatabase(indexedDB, { allowMemoryFallback });
    }

    async database() {
      return this.databasePromise;
    }

    async list() {
      const database = await this.database();
      if (!database)
        return [...this.memory.values()]
          .map(cloneRecord)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      const transaction = database.transaction('filters', 'readonly');
      const records = await requestAsPromise(transaction.objectStore('filters').getAll());
      return records
        .map(cloneRecord)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    async get(id) {
      const database = await this.database();
      if (!database) return this.memory.has(id) ? cloneRecord(this.memory.get(id)) : null;
      const transaction = database.transaction('filters', 'readonly');
      const record = await requestAsPromise(transaction.objectStore('filters').get(id));
      return record ? cloneRecord(record) : null;
    }

    async getBlob(id) {
      const filter = await this.get(id);
      if (!filter || filter.kind !== 'lut') return null;
      const database = await this.database();
      if (!database) return this.memoryBlobs.get(filter.blobKey) || null;
      const transaction = database.transaction('blobs', 'readonly');
      const entry = await requestAsPromise(transaction.objectStore('blobs').get(filter.blobKey));
      return entry?.blob || null;
    }

    async findByHash(hash) {
      const database = await this.database();
      if (!database)
        return (
          [...this.memory.values()].find(
            (record) => record.kind === 'lut' && record.contentHash === hash
          ) || null
        );
      const transaction = database.transaction('filters', 'readonly');
      const records = await requestAsPromise(
        transaction.objectStore('filters').index('contentHash').getAll(hash)
      );
      const record = records.find((item) => item.kind === 'lut');
      return record ? cloneRecord(record) : null;
    }

    async put(record, blob = null) {
      const normalized = normalizeRecord({ ...record, id: record.id || this.idFactory() });
      normalized.createdAt = record.createdAt || this.now();
      normalized.updatedAt = this.now();
      // Validate before opening a write transaction. Otherwise an update with a missing
      // source Blob can queue its metadata write before failing and leave the LUT unusable.
      if (normalized.kind === 'lut' && !(blob instanceof Blob))
        fail('invalid-blob', 'LUT 原文件无效。');
      const database = await this.database();
      if (!database) {
        this.memory.set(normalized.id, normalized);
        if (normalized.kind === 'lut') this.memoryBlobs.set(normalized.blobKey, blob);
        return cloneRecord(normalized);
      }
      const transaction = database.transaction(['filters', 'blobs'], 'readwrite');
      transaction.objectStore('filters').put(normalized);
      if (normalized.kind === 'lut') {
        transaction.objectStore('blobs').put({ key: normalized.blobKey, blob });
      }
      await transactionDone(transaction);
      return cloneRecord(normalized);
    }

    async importFile(file, metadata = {}, { signal } = {}) {
      if (signal?.aborted) fail('operation-aborted', '已取消导入。');
      if (!file || typeof file.arrayBuffer !== 'function' || typeof file.name !== 'string')
        fail('read-failed', '无法读取滤镜文件。');
      if (file.size > MAX_FILE_BYTES) fail('file-too-large', '单个滤镜文件不能超过 20 MiB。');
      const extension = file.name.split('.').pop().toLowerCase();
      if (!['cube', 'json'].includes(extension))
        fail('unsupported-file-extension', '仅支持 .cube 和 .json 滤镜文件。');
      if (signal?.aborted) fail('operation-aborted', '已取消导入。');
      if (extension === 'cube') {
        if (!CubeLut) fail('validator-unavailable', 'LUT 校验模块未加载。');
        const result = this.lutValidator
          ? await this.lutValidator(file, { signal })
          : await CubeLut.validateFile(file, { signal });
        if (!result.ok)
          fail(result.code || 'invalid-lut', result.message || 'LUT 文件无效。', result);
        const duplicate = await this.findByHash(result.lut.sha256);
        if (duplicate) return { status: 'duplicate', filter: duplicate };
        if ((await this.list()).length >= MAX_FILTERS)
          fail('library-full', `我的滤镜最多保存 ${MAX_FILTERS} 个条目。`);
        if (signal?.aborted) fail('operation-aborted', '已取消导入。');
        const inputColorSpace = metadata.inputColorSpace || COLOR_SPACE_UNKNOWN;
        const outputColorSpace = metadata.outputColorSpace || COLOR_SPACE_UNKNOWN;
        const id = this.idFactory();
        const blob =
          file instanceof Blob
            ? file
            : new Blob([await file.arrayBuffer()], { type: 'text/plain' });
        if (signal?.aborted) fail('operation-aborted', '已取消导入。');
        const filter = await this.put(
          {
            id,
            kind: 'lut',
            contentHash: result.lut.sha256,
            name: metadata.name || result.lut.title || basename(file.name),
            brand: metadata.brand || '自定义',
            author: metadata.author || '',
            sourceUrl: metadata.sourceUrl || '',
            licenseNote: metadata.licenseNote || '',
            scenes: metadata.scenes || [],
            inputColorSpace,
            outputColorSpace,
            gridSize: result.lut.gridSize,
            domainMin: result.lut.domainMin,
            domainMax: result.lut.domainMax,
            ordering: result.lut.ordering,
            interpolation: 'trilinear',
          },
          blob
        );
        return { status: 'imported', filter };
      }
      let decoded;
      try {
        if (this.parameterValidator) decoded = await this.parameterValidator(file, { signal });
        else decoded = validateParameterFilterText(await file.text());
      } catch (error) {
        if (error instanceof LutLibraryError) throw error;
        if (error?.code) throw error;
        fail('read-failed', '无法读取 JSON 文件。');
      }
      if (signal?.aborted) fail('operation-aborted', '已取消导入。');
      if ((await this.list()).length >= MAX_FILTERS)
        fail('library-full', `我的滤镜最多保存 ${MAX_FILTERS} 个条目。`);
      const record = {
        id: this.idFactory(),
        kind: 'parameters',
        ...decoded,
        ...metadata,
        name: metadata.name || decoded.name,
        brand: metadata.brand || decoded.brand,
        author: metadata.author ?? decoded.author,
        sourceUrl: metadata.sourceUrl ?? decoded.sourceUrl,
        licenseNote: metadata.licenseNote ?? decoded.licenseNote,
        scenes: metadata.scenes || decoded.scenes,
        inputColorSpace: metadata.inputColorSpace || decoded.inputColorSpace,
        outputColorSpace: metadata.outputColorSpace || decoded.outputColorSpace,
      };
      record.contentHash = await parameterContentHash(record);
      const filter = await this.put(record);
      return { status: 'imported', filter };
    }

    async importFiles(files, metadata = {}, { signal, onResult } = {}) {
      const entries = Array.from(files || []);
      if (entries.length > MAX_FILTERS)
        fail('too-many-files', `一次最多导入 ${MAX_FILTERS} 个文件。`);
      const results = [];
      for (const file of entries) {
        if (signal?.aborted) {
          const result = { file, status: 'cancelled' };
          results.push(result);
          onResult?.(result);
          break;
        }
        try {
          const result = { file, ...(await this.importFile(file, metadata, { signal })) };
          results.push(result);
          onResult?.(result);
        } catch (error) {
          const result = {
            file,
            status: error.code === 'operation-aborted' ? 'cancelled' : 'rejected',
            error,
          };
          results.push(result);
          onResult?.(result);
          if (result.status === 'cancelled') break;
        }
      }
      return results;
    }

    async update(id, changes) {
      const existing = await this.get(id);
      if (!existing) fail('not-found', '滤镜不存在。');
      const editable = [
        'name',
        'brand',
        'author',
        'sourceUrl',
        'licenseNote',
        'scenes',
        'inputColorSpace',
        'outputColorSpace',
        'favorite',
      ];
      if (!changes || typeof changes !== 'object' || !hasOnlyKeys(changes, editable))
        fail('invalid-update', '包含不能编辑的字段。');
      const next = { ...existing, ...changes, updatedAt: this.now() };
      if (next.kind === 'parameters') next.contentHash = await parameterContentHash(next);
      return this.put(next, existing.kind === 'lut' ? await this.getBlob(id) : null);
    }

    async remove(id) {
      const existing = await this.get(id);
      if (!existing) return false;
      const database = await this.database();
      if (!database) {
        this.memory.delete(id);
        if (existing.kind === 'lut') this.memoryBlobs.delete(existing.blobKey);
        return true;
      }
      const transaction = database.transaction(['filters', 'blobs'], 'readwrite');
      transaction.objectStore('filters').delete(id);
      if (existing.kind === 'lut') transaction.objectStore('blobs').delete(existing.blobKey);
      await transactionDone(transaction);
      return true;
    }

    async exportBackup() {
      const filters = await this.list();
      for (const filter of filters)
        if (filter.kind === 'parameters') filter.contentHash = await parameterContentHash(filter);
      const files = [
        {
          name: 'manifest.json',
          bytes: utf8(
            JSON.stringify({
              format: BACKUP_FORMAT,
              version: BACKUP_VERSION,
              exportedAt: this.now(),
              filters,
            })
          ),
        },
      ];
      for (const filter of filters) {
        if (filter.kind !== 'lut') continue;
        const blob = await this.getBlob(filter.id);
        if (!(blob instanceof Blob)) fail('backup-failed', `缺少 ${filter.name} 的 LUT 原文件。`);
        files.push({
          name: `blobs/${filter.id}.cube`,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        });
      }
      return new Blob([createStoredZip(files)], { type: 'application/zip' });
    }

    async parseBackup(file) {
      if (!(file instanceof Blob) && !(file instanceof ArrayBuffer) && !ArrayBuffer.isView(file))
        fail('invalid-backup', '备份包无效。');
      const bytes =
        file instanceof Blob
          ? new Uint8Array(await file.arrayBuffer())
          : new Uint8Array(file.buffer || file, file.byteOffset || 0, file.byteLength);
      const entries = readStoredZip(bytes);
      const manifestBytes = entries.get('manifest.json');
      if (!manifestBytes) fail('invalid-backup', '备份包缺少 manifest.json。');
      let manifest;
      try {
        manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
      } catch (_) {
        fail('invalid-backup', '备份清单格式无效。');
      }
      if (
        !manifest ||
        manifest.format !== BACKUP_FORMAT ||
        manifest.version !== BACKUP_VERSION ||
        !Array.isArray(manifest.filters)
      )
        fail('invalid-backup', '备份包版本不受支持。');
      if (manifest.filters.length > MAX_FILTERS)
        fail('invalid-backup', `备份包最多可包含 ${MAX_FILTERS} 个滤镜。`);
      const filters = [];
      const blobs = new Map();
      const ids = new Set();
      for (const raw of manifest.filters) {
        let record;
        try {
          record = normalizeRecord(raw);
        } catch (error) {
          if (error instanceof LutLibraryError)
            fail('invalid-backup', `备份包中的滤镜记录无效：${error.message}`);
          throw error;
        }
        if (ids.has(record.id)) fail('invalid-backup', '备份包存在重复滤镜 ID。');
        ids.add(record.id);
        if (record.kind === 'lut') {
          const bytesForLut = entries.get(`blobs/${record.id}.cube`);
          if (!bytesForLut || !CubeLut)
            fail('invalid-backup', `备份包缺少 ${record.name} 的 LUT 文件。`);
          const result = CubeLut.validateBytes(bytesForLut);
          if (!result.ok || result.lut.sha256 !== record.contentHash)
            fail('invalid-backup', `${record.name} 的 LUT 内容校验失败。`);
          blobs.set(record.id, new Blob([bytesForLut], { type: 'text/plain' }));
        } else {
          try {
            if (record.contentHash !== (await parameterContentHash(record)))
              fail('invalid-backup', `${record.name} 的参数滤镜内容校验失败。`);
          } catch (error) {
            if (error instanceof LutLibraryError && error.code !== 'invalid-backup')
              fail('invalid-backup', `${record.name} 的参数滤镜内容无效。`);
            throw error;
          }
        }
        filters.push(record);
      }
      return { filters, blobs };
    }

    async previewRestore(file, { mode = 'merge' } = {}) {
      if (!['merge', 'replace'].includes(mode)) fail('invalid-restore-mode', '恢复模式无效。');
      const parsed = await this.parseBackup(file);
      const current = await this.list();
      // A backup is content-addressed for both supported filter kinds.  IDs are
      // stable references, but must never let a merge overwrite a different
      // existing filter merely because two independently created libraries chose
      // the same ID.
      const knownHashes = new Set(
        mode === 'merge' ? current.map((filter) => filter.contentHash) : []
      );
      const knownIds = new Set(mode === 'merge' ? current.map((filter) => filter.id) : []);
      const candidates = [];
      const duplicates = [];
      const conflicts = [];
      for (const filter of parsed.filters) {
        if (knownHashes.has(filter.contentHash)) {
          duplicates.push({ id: filter.id, name: filter.name, reason: 'content-hash' });
          continue;
        }
        if (knownIds.has(filter.id)) {
          conflicts.push({ id: filter.id, name: filter.name, reason: 'id-conflict' });
          continue;
        }
        candidates.push(filter);
        knownHashes.add(filter.contentHash);
        knownIds.add(filter.id);
      }
      if (mode === 'merge' && current.length + candidates.length > MAX_FILTERS)
        fail('library-full', `恢复后不能超过 ${MAX_FILTERS} 个我的滤镜。`);
      return {
        mode,
        parsed,
        candidates,
        imported: candidates.length,
        skipped: duplicates.length + conflicts.length,
        duplicates,
        conflicts,
        total: parsed.filters.length,
        replaced: mode === 'replace' ? current.length : 0,
      };
    }

    async restoreBackup(file, { mode = 'merge' } = {}) {
      const preview = await this.previewRestore(file, { mode });
      const { parsed, candidates } = preview;
      const database = await this.database();
      if (!database) {
        if (mode === 'replace') {
          this.memory.clear();
          this.memoryBlobs.clear();
        }
        for (const filter of candidates) {
          this.memory.set(filter.id, filter);
          if (filter.kind === 'lut')
            this.memoryBlobs.set(filter.blobKey, parsed.blobs.get(filter.id));
        }
      } else {
        const transaction = database.transaction(['filters', 'blobs'], 'readwrite');
        const filtersStore = transaction.objectStore('filters');
        const blobsStore = transaction.objectStore('blobs');
        if (mode === 'replace') {
          filtersStore.clear();
          blobsStore.clear();
        }
        for (const filter of candidates) {
          filtersStore.put(filter);
          if (filter.kind === 'lut')
            blobsStore.put({ key: filter.blobKey, blob: parsed.blobs.get(filter.id) });
        }
        await transactionDone(transaction);
      }
      return {
        mode,
        imported: preview.imported,
        skipped: preview.skipped,
        total: preview.total,
      };
    }
  }

  // ZIP "store" entries keep backups portable without introducing a compression dependency.
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1)
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[index] = value >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }
  function write16(view, offset, value) {
    view.setUint16(offset, value, true);
  }
  function write32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }
  function createStoredZip(files) {
    const encoder = new TextEncoder();
    const prepared = files.map((file) => ({
      ...file,
      nameBytes: encoder.encode(file.name),
      crc: crc32(file.bytes),
    }));
    const localBytes = prepared.reduce(
      (sum, file) => sum + 30 + file.nameBytes.length + file.bytes.length,
      0
    );
    const centralBytes = prepared.reduce((sum, file) => sum + 46 + file.nameBytes.length, 0);
    const output = new Uint8Array(localBytes + centralBytes + 22);
    const view = new DataView(output.buffer);
    let offset = 0;
    for (const file of prepared) {
      file.offset = offset;
      write32(view, offset, 0x04034b50);
      write16(view, offset + 4, 20);
      write16(view, offset + 6, 0);
      write16(view, offset + 8, 0);
      write32(view, offset + 14, file.crc);
      write32(view, offset + 18, file.bytes.length);
      write32(view, offset + 22, file.bytes.length);
      write16(view, offset + 26, file.nameBytes.length);
      write16(view, offset + 28, 0);
      output.set(file.nameBytes, offset + 30);
      output.set(file.bytes, offset + 30 + file.nameBytes.length);
      offset += 30 + file.nameBytes.length + file.bytes.length;
    }
    const centralOffset = offset;
    for (const file of prepared) {
      write32(view, offset, 0x02014b50);
      write16(view, offset + 4, 20);
      write16(view, offset + 6, 20);
      write16(view, offset + 8, 0);
      write16(view, offset + 10, 0);
      write32(view, offset + 16, file.crc);
      write32(view, offset + 20, file.bytes.length);
      write32(view, offset + 24, file.bytes.length);
      write16(view, offset + 28, file.nameBytes.length);
      write16(view, offset + 30, 0);
      write16(view, offset + 32, 0);
      write16(view, offset + 34, 0);
      write16(view, offset + 36, 0);
      write32(view, offset + 38, 0);
      write32(view, offset + 42, file.offset);
      output.set(file.nameBytes, offset + 46);
      offset += 46 + file.nameBytes.length;
    }
    const centralLength = offset - centralOffset;
    write32(view, offset, 0x06054b50);
    write16(view, offset + 4, 0);
    write16(view, offset + 6, 0);
    write16(view, offset + 8, prepared.length);
    write16(view, offset + 10, prepared.length);
    write32(view, offset + 12, centralLength);
    write32(view, offset + 16, centralOffset);
    write16(view, offset + 20, 0);
    return output;
  }
  function readStoredZip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let offset = Math.max(0, bytes.length - 65557); offset <= bytes.length - 22; offset += 1)
      if (view.getUint32(offset, true) === 0x06054b50) end = offset;
    if (end < 0) fail('invalid-backup', '不是受支持的 ZIP 备份包。');
    const total = view.getUint16(end + 10, true);
    const centralOffset = view.getUint32(end + 16, true);
    if (total > MAX_FILTERS + 1 || centralOffset >= bytes.length)
      fail('invalid-backup', '备份包目录无效。');
    const entries = new Map();
    let offset = centralOffset;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (let index = 0; index < total; index += 1) {
      if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50)
        fail('invalid-backup', '备份包目录损坏。');
      const method = view.getUint16(offset + 10, true),
        crc = view.getUint32(offset + 16, true),
        size = view.getUint32(offset + 24, true),
        nameLength = view.getUint16(offset + 28, true),
        extraLength = view.getUint16(offset + 30, true),
        commentLength = view.getUint16(offset + 32, true),
        localOffset = view.getUint32(offset + 42, true);
      if (
        method !== 0 ||
        offset + 46 + nameLength + extraLength + commentLength > bytes.length ||
        localOffset + 30 > bytes.length ||
        view.getUint32(localOffset, true) !== 0x04034b50
      )
        fail('invalid-backup', '备份包仅支持未压缩的本产品 ZIP。');
      let name;
      try {
        name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
      } catch (_) {
        fail('invalid-backup', '备份包文件名编码无效。');
      }
      const localNameLength = view.getUint16(localOffset + 26, true),
        localExtraLength = view.getUint16(localOffset + 28, true),
        dataStart = localOffset + 30 + localNameLength + localExtraLength;
      if (
        !name ||
        name.includes('..') ||
        name.startsWith('/') ||
        entries.has(name) ||
        dataStart + size > bytes.length
      )
        fail('invalid-backup', '备份包包含不安全的文件名。');
      const data = bytes.slice(dataStart, dataStart + size);
      if (crc32(data) !== crc) fail('invalid-backup', `${name} 校验失败。`);
      entries.set(name, data);
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  return Object.freeze({
    LutLibrary,
    LutLibraryError,
    validateParameterFilter,
    validateParameterFilterText,
    parameterContentHash,
    migrateDatabase,
    createStoredZip,
    readStoredZip,
    neutralParameters,
    parameterBounds,
    MAX_FILTERS,
    MAX_FILE_BYTES,
    COLOR_SPACE_SRGB,
    COLOR_SPACE_UNKNOWN,
    BACKUP_FORMAT,
    BACKUP_VERSION,
    DB_VERSION,
  });
});
