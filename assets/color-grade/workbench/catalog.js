const regionConfig = {
  yunnan: {
    text: '高原通透空气、冷阴影与自然偏暖的日照。',
    profiles: [
      ['高原自然', { b: 1.03, c: 1.08, s: 1.02, w: 1.03, t: -3 }],
      ['晨雾柔光', { b: 1.08, c: 0.88, s: 0.82, w: 1.04, t: -10 }],
      ['日照通透', { b: 1.04, c: 1.12, s: 1.12, w: 1.05, t: -5 }],
      ['纪实胶片', { b: 0.98, c: 0.96, s: 0.86, w: 1.02, t: 5 }],
    ],
  },
  guangxi: {
    text: '湿润植被、青绿水色和柔和的阴天层次。',
    profiles: [
      ['喀斯特青绿', { b: 1.02, c: 0.95, s: 1.1, w: 0.98, t: -8 }],
      ['雨后湿润', { b: 0.98, c: 0.9, s: 0.93, w: 0.98, t: -13 }],
      ['山水淡彩', { b: 1.08, c: 0.84, s: 0.73, w: 1.03, t: -6 }],
      ['傍晚暖雾', { b: 1.03, c: 0.92, s: 0.91, w: 1.08, t: 9 }],
    ],
  },
  hainan: {
    text: '海岸通透高光、青蓝色海水与温暖的热带日光。',
    profiles: [
      ['海岸清透', { b: 1.06, c: 1.06, s: 1.16, w: 1.04, t: -10 }],
      ['热带日光', { b: 1.08, c: 1.04, s: 1.08, w: 1.12, t: 7 }],
      ['阴天海色', { b: 1.0, c: 0.9, s: 0.85, w: 0.97, t: -13 }],
      ['日落金滩', { b: 1.04, c: 1.0, s: 1.0, w: 1.17, t: 18 }],
    ],
  },
  alps: {
    text: '清冽雪线、深蓝阴影和克制的高山色彩。',
    profiles: [
      ['雪线清冽', { b: 1.04, c: 1.11, s: 0.92, w: 0.97, t: -14 }],
      ['蓝调山谷', { b: 0.96, c: 1.04, s: 0.86, w: 0.93, t: -22 }],
      ['金色山光', { b: 1.06, c: 1.07, s: 1.02, w: 1.12, t: 10 }],
      ['高山纪实', { b: 1.0, c: 1.0, s: 0.82, w: 1.0, t: -5 }],
    ],
  },
  default: {
    text: '平衡曝光、对比度与饱和度，优先恢复自然观感。',
    profiles: [
      ['自然还原', { b: 1.02, c: 1.01, s: 0.98, w: 1.0, t: 0 }],
      ['清晰通透', { b: 1.03, c: 1.1, s: 1.03, w: 1.0, t: -3 }],
      ['柔和低对比', { b: 1.05, c: 0.87, s: 0.82, w: 1.02, t: 3 }],
      ['暖调纪实', { b: 1.01, c: 0.98, s: 0.88, w: 1.08, t: 10 }],
    ],
  },
  london: {
    text: '伦敦阴雨的低饱和天空、冷灰阴影与克制暖光。',
    profiles: [
      ['雨雾街头', { b: 0.96, c: 0.88, s: 0.67, w: 0.97, t: -11 }],
      ['泰晤士灰蓝', { b: 1.0, c: 0.94, s: 0.72, w: 0.95, t: -16 }],
      ['砖墙暖灯', { b: 0.98, c: 1.02, s: 0.78, w: 1.08, t: 7 }],
      ['英伦胶片', { b: 0.95, c: 0.91, s: 0.64, w: 1.01, t: -4 }],
    ],
  },
  tokyo: {
    text: '东京夜景的蓝青阴影、霓虹高光和清晰都市对比。',
    profiles: [
      ['涩谷霓虹', { b: 1.03, c: 1.16, s: 1.22, w: 0.96, t: -18 }],
      ['雨夜反光', { b: 0.95, c: 1.08, s: 1.06, w: 0.94, t: -22 }],
      ['晨光涩谷', { b: 1.07, c: 1.05, s: 0.95, w: 1.08, t: 8 }],
      ['胶片街拍', { b: 0.98, c: 1.0, s: 0.84, w: 1.03, t: 4 }],
    ],
  },
  california: {
    text: '加州黄金时刻以通透暖光、深蓝阴影和适度对比为主。',
    profiles: [
      ['太平洋金光', { b: 1.08, c: 1.1, s: 1.08, w: 1.16, t: 10 }],
      ['沙漠日落', { b: 1.04, c: 1.14, s: 1.15, w: 1.19, t: 14 }],
      ['海岸薄雾', { b: 1.02, c: 0.9, s: 0.82, w: 1.04, t: -5 }],
      ['西海岸胶片', { b: 1.0, c: 0.98, s: 0.88, w: 1.12, t: 6 }],
    ],
  },
  nordic: {
    text: '北欧冷冽漫射光、干净阴影与低饱和自然色。',
    profiles: [
      ['峡湾冷光', { b: 1.03, c: 1.04, s: 0.78, w: 0.93, t: -18 }],
      ['雪原晴日', { b: 1.07, c: 1.1, s: 0.75, w: 0.91, t: -22 }],
      ['暮色蓝调', { b: 0.92, c: 1.03, s: 0.72, w: 0.88, t: -28 }],
      ['极简纪实', { b: 1.01, c: 0.94, s: 0.68, w: 0.97, t: -10 }],
    ],
  },
  mediterranean: {
    text: '地中海的钴蓝海面、石灰墙高光和明亮日照。',
    profiles: [
      ['爱琴海蓝', { b: 1.08, c: 1.09, s: 1.22, w: 1.05, t: -11 }],
      ['白墙日光', { b: 1.12, c: 0.98, s: 0.95, w: 1.1, t: 4 }],
      ['橄榄午后', { b: 1.04, c: 1.04, s: 1.05, w: 1.12, t: 8 }],
      ['海岛明信片', { b: 1.06, c: 1.12, s: 1.18, w: 1.08, t: -5 }],
    ],
  },
  morocco: {
    text: '摩洛哥风格强调赭石、暖阳、深蓝阴影与干燥空气。',
    profiles: [
      ['马拉喀什暖沙', { b: 1.04, c: 1.11, s: 1.08, w: 1.2, t: 16 }],
      ['蓝城阴影', { b: 1.0, c: 1.06, s: 1.12, w: 0.96, t: -18 }],
      ['撒哈拉黄昏', { b: 1.01, c: 1.08, s: 1.02, w: 1.25, t: 21 }],
      ['市集胶片', { b: 0.97, c: 0.97, s: 0.88, w: 1.13, t: 9 }],
    ],
  },
  iceland: {
    text: '冰岛的低太阳、火山黑、冰蓝阴影和高动态范围。',
    profiles: [
      ['冰川蓝白', { b: 1.05, c: 1.13, s: 0.79, w: 0.91, t: -25 }],
      ['火山黑沙', { b: 0.94, c: 1.18, s: 0.73, w: 0.95, t: -14 }],
      ['极光微光', { b: 0.93, c: 1.06, s: 1.05, w: 0.89, t: -26 }],
      ['北境阴云', { b: 0.97, c: 0.96, s: 0.68, w: 0.92, t: -19 }],
    ],
  },
  newyork: {
    text: '纽约街头的硬朗反差、偏冷城市阴影与钨丝暖灯。',
    profiles: [
      ['曼哈顿硬光', { b: 1.02, c: 1.16, s: 0.92, w: 0.98, t: -7 }],
      ['布鲁克林胶片', { b: 0.96, c: 1.04, s: 0.8, w: 1.07, t: 6 }],
      ['雨夜出租车', { b: 0.97, c: 1.13, s: 1.06, w: 1.04, t: -4 }],
      ['中央公园秋色', { b: 1.04, c: 1.05, s: 1.1, w: 1.14, t: 10 }],
    ],
  },
  cyberpunk: {
    text: '创意赛博朋克风格：高饱和蓝紫阴影与洋红高光，不代表真实地区。',
    profiles: [
      ['霓虹紫蓝', { b: 1.0, c: 1.24, s: 1.38, w: 0.92, t: -32 }],
      ['雨夜洋红', { b: 0.94, c: 1.15, s: 1.31, w: 1.05, t: 24 }],
      ['青蓝街区', { b: 0.98, c: 1.18, s: 1.29, w: 0.91, t: -26 }],
      ['红蓝对撞', { b: 1.01, c: 1.22, s: 1.34, w: 1.1, t: 17 }],
    ],
  },
  analog: {
    text: '复古胶片风格：柔和反差、偏暖肤色与受控饱和度。',
    profiles: [
      ['柯达暖黄', { b: 1.03, c: 0.91, s: 0.87, w: 1.14, t: 8 }],
      ['富士绿调', { b: 1.0, c: 0.94, s: 0.82, w: 0.98, t: -6 }],
      ['褪色印刷', { b: 1.06, c: 0.82, s: 0.62, w: 1.06, t: 4 }],
      ['颗粒纪实', { b: 0.97, c: 1.0, s: 0.78, w: 1.03, t: 1 }],
    ],
  },
  noir: {
    text: '黑色电影创意风格：黑白高反差与偏冷的银盐质感。',
    profiles: [
      ['银盐黑白', { b: 1.01, c: 1.35, s: 0, w: 0.98, t: 0 }],
      ['雨巷黑白', { b: 0.94, c: 1.2, s: 0, w: 0.94, t: 0 }],
      ['暖灰电影', { b: 0.98, c: 1.17, s: 0.18, w: 1.12, t: 8 }],
      ['冷调暗角', { b: 0.91, c: 1.24, s: 0.16, w: 0.89, t: -18 }],
    ],
  },
};
const regionMetadata = Object.freeze({
  yunnan: { label: '云南高原', group: '自然与中国' },
  guangxi: { label: '广西喀斯特', group: '自然与中国' },
  hainan: { label: '海南海岸', group: '自然与中国' },
  alps: { label: '阿尔卑斯山区', group: '自然与中国' },
  default: { label: '自然还原', group: '自然与中国' },
  london: { label: '伦敦阴雨', group: '全球地区' },
  tokyo: { label: '东京夜景', group: '全球地区' },
  california: { label: '加州黄金时刻', group: '全球地区' },
  nordic: { label: '北欧冷调', group: '全球地区' },
  mediterranean: { label: '地中海海岸', group: '全球地区' },
  morocco: { label: '摩洛哥暖沙', group: '全球地区' },
  iceland: { label: '冰岛蓝调', group: '全球地区' },
  newyork: { label: '纽约街头', group: '全球地区' },
  cyberpunk: { label: '赛博朋克夜色', group: '创意风格' },
  analog: { label: '复古胶片', group: '创意风格' },
  noir: { label: '黑色电影', group: '创意风格' },
});
function regionLabelSource(id) {
  return regionMetadata[id]?.label || id;
}
function regionSearchText(id) {
  const source = regionLabelSource(id);
  return `${id} ${source} ${window.LandscapeEnglish?.[source] || ''}`;
}
const i18n = window.ColorGradeI18n;
function t(key, variables) {
  return i18n.t(key, variables);
}
function localizedSource(source) {
  return window.ColorGradeI18n?.has(source) ? t(source) : source;
}
const errorKeys = Object.freeze({
  IMAGE_UNSUPPORTED: 'cg.error.imageUnsupported',
  IMAGE_FILE_TOO_LARGE: 'cg.error.imageFileTooLarge',
  IMAGE_DIMENSIONS_INVALID: 'cg.error.imageDimensions',
  IMAGE_DECODE_FAILED: 'cg.error.imageDecode',
  unsupported: 'cg.error.imageUnsupported',
  'file-too-large': 'cg.error.fileTooLarge',
  'image-file-too-large': 'cg.error.imageFileTooLarge',
  dimensions: 'cg.error.imageDimensions',
  decode: 'cg.error.imageDecode',
  'worker-unavailable': 'cg.error.workerUnavailable',
  'worker-failed': 'cg.error.workerFailed',
  'protocol-mismatch': 'cg.error.workerProtocol',
  'invalid-lut': 'cg.error.lutInvalid',
  'lut-not-loaded': 'cg.error.lutNotLoaded',
  'lut-unavailable': 'cg.error.lutUnavailable',
  'lut-read-failed': 'cg.error.lutReadFailed',
  'validator-unavailable': 'cg.error.workerUnavailable',
  'storage-unavailable': 'cg.error.libraryUnavailable',
  'library-full': 'cg.error.libraryFull',
  'unsupported-file-extension': 'cg.error.fileUnsupported',
  'invalid-backup': 'cg.error.backupInvalid',
  'operation-aborted': 'cg.error.exportCancelled',
  'invalid-png': 'cg.error.haldInvalid',
  'unsupported-png': 'cg.error.haldInvalid',
  'incompatible-color-space': 'cg.error.haldInvalid',
  'unsupported-domain': 'cg.error.haldInvalid',
  'operation-superseded': 'cg.error.operationSuperseded',
  'render-superseded': 'cg.error.operationSuperseded',
  'export-failed': 'cg.error.exportFailed',
  'thumbnail-worker-unavailable': 'cg.error.thumbnailWorkerUnavailable',
  'read-failed': 'cg.error.lutReadFailed',
  'too-many-files': 'cg.error.libraryFull',
  'backup-failed': 'cg.error.backupInvalid',
  'invalid-hald-layout': 'cg.error.haldInvalid',
  'invalid-level': 'cg.error.haldInvalid',
  'invalid-png': 'cg.error.haldInvalid',
  'unsupported-png': 'cg.error.haldInvalid',
  'invalid-sample-count': 'cg.error.haldInvalid',
});
function errorText(error, fallbackKey = 'cg.error.generic') {
  return t(errorKeys[error?.code] || fallbackKey);
}
function errorKey(error, fallbackKey = 'cg.error.generic') {
  return errorKeys[error?.code] || fallbackKey;
}
function codedError(code, details) {
  const error = new Error(code);
  error.code = code;
  error.details = details || {};
  return error;
}
function setLocalizedText(element, key, variables) {
  element.dataset.i18nDynamicKey = key;
  element.dataset.i18nDynamicVariables = JSON.stringify(variables || {});
  element.textContent = t(key, variables);
}
function setLocalizedAttribute(element, name, key, variables) {
  const bindings = JSON.parse(element.dataset.i18nDynamicAttributes || '{}');
  bindings[name] = { key, variables: variables || {} };
  element.dataset.i18nDynamicAttributes = JSON.stringify(bindings);
  element.setAttribute(name, t(key, variables));
}
const $ = (x) => document.getElementById(x),
  main = $('mainCanvas'),
  interactiveCanvas = $('interactiveCanvas'),
  stage = $('stage');
const appMode = window.ColorGradeAppMode?.mode;
if (!['full', 'standalone'].includes(appMode)) throw new Error('Color-grade app mode is required.');
const standaloneMode = appMode === 'standalone';
const fujiPresets = [
  ['Provia', 'provia', ['富士'], ['风景'], { b: 1.02, c: 1.02, s: 1.02, w: 1, t: 0 }],
  ['Velvia', 'velvia', ['富士'], ['风景', '海岸'], { b: 1.05, c: 1.12, s: 1.2, w: 1.06, t: 5 }],
  ['Astia', 'astia', ['富士'], ['人像', '花卉'], { b: 1.04, c: 0.92, s: 0.9, w: 1.04, t: 2 }],
  [
    'Pro Neg. Hi',
    'pro-neg-hi',
    ['富士'],
    ['人像', '纪实'],
    { b: 1.02, c: 1.06, s: 0.92, w: 1.02, t: 1 },
  ],
  [
    'Pro Neg. Std',
    'pro-neg-std',
    ['富士'],
    ['人像', '纪实'],
    { b: 1.01, c: 0.9, s: 0.86, w: 1.01, t: 0 },
  ],
  [
    'Classic Chrome',
    'classic-chrome',
    ['富士'],
    ['建筑', '阴天', '纪实'],
    { b: 0.98, c: 1.08, s: 0.78, w: 0.97, t: -4 },
  ],
  [
    'Classic Negative',
    'classic-negative',
    ['富士'],
    ['城市', '纪实'],
    { b: 1.01, c: 1.14, s: 0.94, w: 1.03, t: 3 },
  ],
  [
    'Nostalgic Neg',
    'nostalgic-neg',
    ['富士'],
    ['旅行', '风景'],
    { b: 1.03, c: 0.98, s: 0.96, w: 1.1, t: 7 },
  ],
  ['Eterna', 'eterna', ['富士'], ['电影', '阴天'], { b: 0.98, c: 0.88, s: 0.72, w: 0.99, t: -2 }],
  ['Acros', 'acros', ['富士'], ['黑白', '山地'], { b: 1.0, c: 1.18, s: 0, w: 1, t: 0 }],
  ['Monochrome', 'monochrome', ['富士'], ['黑白', '城市'], { b: 1.0, c: 1.1, s: 0, w: 1, t: 0 }],
  ['Sepia', 'sepia', ['富士'], ['复古', '人像'], { b: 1.0, c: 0.96, s: 0.12, w: 1.12, t: 6 }],
];
// These are project-authored parameter studies. They are not bundled camera LUTs or
// reproductions of any manufacturer's color science.
const learningCameraPresets = [
  [
    '自然人像',
    'nikon-natural-portrait',
    ['尼康'],
    ['人像', '日常'],
    { b: 1.03, c: 0.94, s: 0.9, w: 1.06, t: 3 },
  ],
  [
    '通透风景',
    'nikon-clear-landscape',
    ['尼康'],
    ['风景', '天空'],
    { b: 1.02, c: 1.08, s: 1.04, w: 0.99, t: -3 },
  ],
  [
    '纪实反差',
    'nikon-documentary-contrast',
    ['尼康'],
    ['纪实', '城市'],
    { b: 0.99, c: 1.1, s: 0.86, w: 1.01, t: -1 },
  ],
  [
    '柔和高光',
    'nikon-soft-highlights',
    ['尼康'],
    ['人像', '高光'],
    { b: 1.07, c: 0.88, s: 0.82, w: 1.04, t: 4 },
  ],
  [
    '街头低饱和',
    'leica-street-muted',
    ['徕卡'],
    ['城市', '纪实'],
    { b: 0.98, c: 1.12, s: 0.72, w: 1.03, t: 2 },
  ],
  [
    '暖调人文',
    'leica-warm-documentary',
    ['徕卡'],
    ['人像', '旅行'],
    { b: 1.01, c: 1.02, s: 0.84, w: 1.1, t: 8 },
  ],
  [
    '黑白层次',
    'leica-monochrome-tones',
    ['徕卡'],
    ['黑白', '建筑'],
    { b: 1, c: 1.2, s: 0, w: 1, t: 0 },
  ],
  [
    '阴天街景',
    'leica-overcast-street',
    ['徕卡'],
    ['阴天', '城市'],
    { b: 0.96, c: 0.98, s: 0.68, w: 0.97, t: -6 },
  ],
  [
    '自然肤色',
    'hasselblad-natural-skin',
    ['哈苏'],
    ['人像', '静物'],
    { b: 1.04, c: 0.91, s: 0.82, w: 1.03, t: 3 },
  ],
  [
    '宁静风景',
    'hasselblad-calm-landscape',
    ['哈苏'],
    ['风景', '植被'],
    { b: 1.03, c: 0.97, s: 0.88, w: 0.99, t: -4 },
  ],
  [
    '柔光静物',
    'hasselblad-soft-still-life',
    ['哈苏'],
    ['静物', '高光'],
    { b: 1.08, c: 0.86, s: 0.76, w: 1.05, t: 5 },
  ],
  [
    '低饱和色彩',
    'hasselblad-muted-color',
    ['哈苏'],
    ['花卉', '日常'],
    { b: 1.01, c: 1.0, s: 0.7, w: 1.01, t: -1 },
  ],
];
const favoriteStorageKey = 'real-landscape-fuji-favorites';
const simulationLabels = {
  provia: 'Provia',
  velvia: 'Velvia',
  astia: 'Astia',
  'classic-chrome': 'Classic Chrome',
  'classic-negative': 'Classic Negative',
  'nostalgic-neg': 'Nostalgic Neg',
  eterna: 'Eterna',
  acros: 'Acros',
  monochrome: 'Monochrome',
  'pro-neg-hi': 'Pro Neg. Hi',
  'pro-neg-std': 'Pro Neg. Std',
  sepia: 'Sepia',
};
// Unified preset catalog: regional styles, legacy Fuji simulations, and local learning studies.
const presetCatalog = Object.entries(regionConfig)
  .flatMap(([region, cfg]) =>
    cfg.profiles.map(([name, parameters], index) => ({
      id: `region-${region}-${index}`,
      name,
      source: 'region',
      region,
      regionLabel: regionLabelSource(region),
      description: cfg.text,
      scenes: [],
      cameras: [],
      simulation: '',
      parameters,
    }))
  )
  .concat(
    fujiPresets.map(([name, simulation, cameras, scenes, parameters]) => ({
      id: `fuji-${simulation}`,
      name,
      source: 'film',
      region: '',
      simulation,
      cameras,
      scenes,
      parameters,
    }))
  )
  .concat(
    learningCameraPresets.map(([name, simulation, cameras, scenes, parameters]) => ({
      id: `learning-${simulation}`,
      name,
      source: 'film',
      region: '',
      simulation,
      cameras,
      scenes,
      parameters,
      learningStudy: true,
      brand: cameras[0],
      description: '本地学习用风格预设，不代表原厂 LUT 或相机色彩算法。',
    }))
  );
let fujiFavorites = new Set();
try {
  fujiFavorites = new Set(JSON.parse(localStorage.getItem(favoriteStorageKey) || '[]'));
} catch (_) {}
const filterState = {
  search: '',
  source: 'all',
  camera: 'all',
  scene: 'all',
  favorites: false,
  region: 'all',
};
let regionBeforeCameraFilter = 'all';
let cameraFilterActive = false;
let filterModalReturnFocus = null;
let deleteFilterPending = false;
let basePreset = null,
  workingAdjustments = {},
  lastApplied = null,
  isDirty = false,
  neutralBaseActive = false;
const neutralProfile = Object.freeze({ b: 1, c: 1, s: 1, w: 1, t: 0 });
LandscapeTheme.init();
