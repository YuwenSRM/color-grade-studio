const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ColorGradeLut = require('../assets/color-grade/color-grade-lut.js');

const DEFAULT_CATALOG = path.resolve(
  __dirname,
  '..',
  'docs',
  'reference',
  'lut-content-catalog.json'
);
const REQUIRED_CHECKS = [
  'grayscale',
  'skin-tone',
  'sky-vegetation',
  'saturated-color',
  'highlight-rolloff',
];
const FORBIDDEN_BRAND_CLAIMS = /官方|原版|official|original/i;

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function safeRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.includes('..')
  );
}

function readVerifiedFile(root, relativePath, expectedHash, label, errors) {
  if (!safeRelativePath(relativePath)) {
    errors.push(`${label}: path must be a safe repository-relative path`);
    return null;
  }
  const absolute = path.resolve(root, relativePath);
  if (!absolute.startsWith(`${root}${path.sep}`) || !fs.existsSync(absolute)) {
    errors.push(`${label}: file does not exist: ${relativePath}`);
    return null;
  }
  const bytes = fs.readFileSync(absolute);
  const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (expectedHash && actualHash !== expectedHash)
    errors.push(`${label}: SHA-256 does not match ${relativePath}`);
  return { absolute, bytes, actualHash };
}

function validateReviewEvidence(entry, root, errors) {
  const label = entry.internalId;
  const verification = entry.visualVerification || {};
  const manifestPath = verification.evidenceManifestPath;
  const manifestHash = verification.evidenceManifestSha256;
  const manifestFile = readVerifiedFile(
    root,
    manifestPath,
    manifestHash,
    `${label}: visual evidence manifest`,
    errors
  );
  if (!manifestFile) return;
  let manifest;
  try {
    manifest = JSON.parse(manifestFile.bytes.toString('utf8'));
  } catch (_error) {
    errors.push(`${label}: visual evidence manifest must be valid JSON`);
    return;
  }
  if (manifest.assetType !== 'synthetic-color-review-image' || manifest.colorSpace !== 'sRGB SDR')
    errors.push(`${label}: visual evidence manifest has an unsupported asset contract`);
  const source = manifest.source;
  const output = Array.isArray(manifest.outputs)
    ? manifest.outputs.find((candidate) => candidate.id === entry.evidenceOutputId)
    : null;
  for (const [stage, artifact] of [
    ['input', source],
    ['preview', output?.preview],
    ['export', output?.export],
  ]) {
    if (!isObject(artifact) || !isSha256(artifact.sha256)) {
      errors.push(`${label}: visual evidence ${stage} artifact is incomplete`);
      continue;
    }
    readVerifiedFile(
      root,
      artifact.path,
      artifact.sha256,
      `${label}: visual evidence ${stage}`,
      errors
    );
  }
}

function validateCatalog(catalog, { root = path.resolve(__dirname, '..') } = {}) {
  const errors = [];
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  if (!isObject(catalog)) errors.push('catalog must be an object');
  if (catalog?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!['preparation', 'active', 'completed-local-research'].includes(catalog?.catalogStatus))
    errors.push('catalogStatus must be preparation, active or completed-local-research');
  if (!isObject(catalog?.admissionRules)) errors.push('admissionRules is required');
  if (!entries.length) errors.push('entries must contain at least one validation record');

  const ids = new Set();
  for (const entry of entries) {
    const label = entry?.internalId || '<missing internalId>';
    if (!isObject(entry)) {
      errors.push(`${label}: entry must be an object`);
      continue;
    }
    if (!entry.internalId || ids.has(entry.internalId))
      errors.push(`${label}: internalId must be unique and non-empty`);
    ids.add(entry.internalId);
    for (const field of [
      'displayName',
      'kind',
      'category',
      'origin',
      'admissionStatus',
      'author',
      'sourceUrl',
      'sourceRef',
      'distributionScope',
    ]) {
      if (typeof entry[field] !== 'string') errors.push(`${label}: ${field} must be text`);
    }
    if (!['self-developed', 'licensed'].includes(entry.origin))
      errors.push(`${label}: origin must be self-developed or licensed`);
    if (!['validation-only', 'admitted', 'blocked'].includes(entry.admissionStatus))
      errors.push(`${label}: admissionStatus is invalid`);
    if (entry.origin === 'self-developed' && FORBIDDEN_BRAND_CLAIMS.test(entry.displayName || ''))
      errors.push(`${label}: self-developed content must not claim official/original status`);
    if (entry.origin === 'self-developed' && entry.styleSimulation !== true)
      errors.push(`${label}: self-developed content must set styleSimulation=true`);
    if (!isObject(entry.license)) errors.push(`${label}: license is required`);
    if (!isObject(entry.content)) errors.push(`${label}: content is required`);
    if (!isObject(entry.color)) errors.push(`${label}: color is required`);
    if (!Array.isArray(entry.testPhotos)) errors.push(`${label}: testPhotos must be an array`);
    if (!isObject(entry.visualVerification) || !isObject(entry.visualVerification.checks)) {
      errors.push(`${label}: visualVerification.checks is required`);
    } else {
      for (const check of REQUIRED_CHECKS) {
        const result = entry.visualVerification.checks[check];
        if (!isObject(result) || !['pending', 'approved', 'rejected'].includes(result.status))
          errors.push(
            `${label}: visual check ${check} must have a pending/approved/rejected status`
          );
        for (const field of ['input', 'preview', 'export', 'conclusion']) {
          if (typeof result?.[field] !== 'string')
            errors.push(`${label}: visual check ${check}.${field} must be text`);
        }
      }
    }
    if (!isObject(entry.packagePolicy)) errors.push(`${label}: packagePolicy is required`);
    if (entry.packagePolicy?.includeInRelease && !entry.packagePolicy?.includeInBuiltin)
      errors.push(`${label}: release content must also be included in the builtin package`);

    const content = entry.content || {};
    if (!safeRelativePath(content.path))
      errors.push(`${label}: content.path must be a safe repository-relative path`);
    if (!isSha256(content.sha256))
      errors.push(`${label}: content.sha256 must be a lowercase SHA-256`);
    const contentFile = readVerifiedFile(
      root,
      content.path,
      isSha256(content.sha256) ? content.sha256 : null,
      `${label}: content`,
      errors
    );
    if (contentFile) {
      if (content.bytes !== contentFile.bytes.length)
        errors.push(`${label}: content.bytes does not match ${content.path}`);
      const parsed = ColorGradeLut.validateBytes(contentFile.bytes);
      if (!parsed.ok) errors.push(`${label}: content is not a supported 3D CUBE: ${parsed.code}`);
      else {
        const lut = parsed.lut;
        if (content.gridSize !== lut.gridSize)
          errors.push(`${label}: content.gridSize does not match CUBE`);
        if (JSON.stringify(content.domainMin) !== JSON.stringify(lut.domainMin))
          errors.push(`${label}: content.domainMin does not match CUBE`);
        if (JSON.stringify(content.domainMax) !== JSON.stringify(lut.domainMax))
          errors.push(`${label}: content.domainMax does not match CUBE`);
        if (content.ordering !== lut.ordering)
          errors.push(`${label}: content.ordering does not match CUBE`);
      }
    }
    if (entry.color?.inputColorSpace !== 'sRGB SDR' || entry.color?.outputColorSpace !== 'sRGB SDR')
      errors.push(`${label}: P2-1 preparation records must declare sRGB SDR input and output`);
    if (entry.license?.originalFileHash && !isSha256(entry.license.originalFileHash))
      errors.push(`${label}: license.originalFileHash must be a lowercase SHA-256`);
    if (entry.license?.originalFileHash && entry.license.originalFileHash !== content.sha256)
      errors.push(
        `${label}: license.originalFileHash must match content.sha256 for a project-generated sample`
      );

    if (
      entry.origin === 'self-developed' &&
      (entry.admissionStatus === 'admitted' || entry.packagePolicy?.includeInRelease)
    ) {
      if (
        entry.license?.status !== 'project-owned' ||
        !entry.license?.version ||
        entry.license?.allowRedistribution !== true ||
        !entry.license?.originalLicensePath
      )
        errors.push(
          `${label}: self-developed builtin content needs a project-owned license path, version and redistribution permission`
        );
      else
        readVerifiedFile(
          root,
          entry.license.originalLicensePath,
          null,
          `${label}: self-developed license`,
          errors
        );
    }

    const release = Boolean(entry.packagePolicy?.includeInRelease);
    if (release || entry.admissionStatus === 'admitted') {
      if (!entry.packagePolicy?.includeInBuiltin || !entry.packagePolicy?.includeInRelease)
        errors.push(`${label}: admitted content must enable both packagePolicy flags`);
      const authorizedAsset = entry.testPhotos?.find(
        (asset) =>
          isObject(asset) && asset.authorized === true && asset.ownership === 'project-generated'
      );
      if (!authorizedAsset)
        errors.push(`${label}: admitted content needs at least one authorized test image`);
      else {
        if (!isSha256(authorizedAsset.sha256))
          errors.push(`${label}: authorized test image needs a SHA-256`);
        else
          readVerifiedFile(
            root,
            authorizedAsset.path,
            authorizedAsset.sha256,
            `${label}: authorized test image`,
            errors
          );
      }
      if (entry.visualVerification?.status !== 'approved')
        errors.push(`${label}: admitted content needs approved visualVerification status`);
      for (const check of REQUIRED_CHECKS) {
        const review = entry.visualVerification?.checks?.[check];
        if (review?.status !== 'approved')
          errors.push(`${label}: admitted content needs an approved ${check} check`);
        else {
          for (const stage of ['input', 'preview', 'export']) {
            if (!safeRelativePath(review[stage]))
              errors.push(`${label}: ${check}.${stage} must reference a repository file`);
          }
        }
      }
      validateReviewEvidence(entry, root, errors);
      if (entry.origin === 'licensed') {
        if (!entry.sourceUrl) errors.push(`${label}: licensed content needs sourceUrl`);
        if (
          !entry.license?.originalLicensePath ||
          !entry.license?.version ||
          entry.license?.allowRedistribution !== true
        )
          errors.push(
            `${label}: licensed content needs license version, original license path and redistribution permission`
          );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      entries: entries.length,
      admitted: entries.filter((entry) => entry.admissionStatus === 'admitted').length,
      validationOnly: entries.filter((entry) => entry.admissionStatus === 'validation-only').length,
      releaseEnabled: entries.filter((entry) => entry.packagePolicy?.includeInRelease).length,
    },
  };
}

if (require.main === module) {
  const catalogPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_CATALOG;
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  } catch (error) {
    console.error(`Unable to read ${catalogPath}: ${error.message}`);
    process.exitCode = 1;
  }
  if (catalog) {
    const result = validateCatalog(catalog, { root: path.resolve(__dirname, '..') });
    console.log(
      JSON.stringify({ catalog: path.relative(process.cwd(), catalogPath), ...result }, null, 2)
    );
    if (!result.ok) process.exitCode = 1;
  }
}

module.exports = { REQUIRED_CHECKS, validateCatalog };
