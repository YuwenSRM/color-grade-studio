const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '..');

class LocalResources extends ResourceLoader {
  fetch(url) {
    const file = path.join(root, new URL(url).pathname);
    return fs.existsSync(file) ? Promise.resolve(fs.readFileSync(file)) : null;
  }
}
const stats = {
  total: 2,
  storedCount: 1,
  folderCount: 1,
  pending: 1,
  approved: 1,
  rejected: 0,
  averageQuality: 80,
  reviewedCount: 1,
  recent: 2,
  categories: [{ name: '山地', count: 2 }],
  sources: [{ name: 'folder-import', count: 1 }],
  statuses: [{ status: 'pending', count: 1 }],
};
const users = [
  {
    id: 'test-user',
    username: 'admin-test',
    role: 'admin',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-02T10:00:00Z',
  },
];
const images = [
  {
    id: 'image-test',
    filename: '森林与湖泊.png',
    title: '森林与湖泊',
    description: '待审核正文',
    category: '山地',
    source: 'folder-import',
    region: '',
    reviewStatus: 'pending',
    qualityScore: null,
    url: '/example.png',
    createdAt: '2026-09-01T10:00:00Z',
  },
  {
    id: 'image-approved',
    filename: 'graded.png',
    title: '雾中高原',
    description: '清晨的高原与薄雾。',
    category: '调色风景',
    source: 'color-grade',
    region: 'yunnan',
    reviewStatus: 'approved',
    qualityScore: 92,
    url: '/graded.png',
    createdAt: '2026-09-02T10:00:00Z',
  },
];

async function page(name, language = 'en') {
  const errors = [];
  let html = fs.readFileSync(path.join(root, name + '.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/' + name + '.html',
    runScripts: 'dangerously',
    resources: new LocalResources(),
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole().on('jsdomError', (error) => errors.push(error.message)),
    beforeParse(window) {
      window.localStorage.setItem('landscape-language', language);
      window.alert = (message) => {
        window.lastAlert = message;
      };
      window.confirm = () => false;
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.fetch = async (url, options = {}) => {
        const route = new URL(url, window.location.href).pathname;
        let body = {};
        let status = 200;
        if (route.endsWith('/session')) body = { authenticated: false };
        else if (route.endsWith('/stats')) body = stats;
        else if (route.endsWith('/users')) body = { users };
        else if (route.endsWith('/images')) body = { images };
        else if (route.endsWith('/login')) {
          status = 401;
          body = { error: '账号或密码错误。' };
        } else if (route.endsWith('/logout')) status = 204;
        else throw new Error('Unexpected test request: ' + route + ' ' + options.method);
        return { ok: status < 400, status, json: async () => body };
      };
    },
  });
  await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
  await settle();
  assert.deepEqual(errors, []);
  return dom;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 15));

test('admin translations, date locale, roles and edit dialog round-trip', async () => {
  const dom = await page('admin');
  try {
    const { document: doc, LandscapeI18n: i18n } = dom.window;
    assert.equal(doc.title, 'Admin Dashboard');
    assert.match(doc.querySelector('#reviewed').textContent, /Rated 1/);
    assert.match(doc.querySelector('#sources').textContent, /Local import/);
    const englishDate = doc.querySelector('[data-i18n-date]').textContent;
    doc.querySelector('#newUser').click();
    doc.querySelector('#userRole').value = 'guest';
    doc.querySelector('#userRole').dispatchEvent(new dom.window.Event('change'));
    await settle();
    assert.equal(doc.querySelector('.select-trigger-value').textContent, 'Guest (browse only)');
    i18n.setLanguage('zh');
    await settle();
    assert.equal(doc.querySelector('.select-trigger-value').textContent, '游客（仅浏览）');
    assert.equal(doc.querySelector('#userRole').value, 'guest');
    assert.notEqual(doc.querySelector('[data-i18n-date]').textContent, englishDate);
    doc.querySelector('#userCancel').click();
    doc.querySelector('[data-edit]').click();
    i18n.setLanguage('en');
    await settle();
    assert.equal(doc.querySelector('#userDialogTitle').textContent, 'Edit account');
    assert.match(doc.querySelector('#userHint').textContent, /Leave the password blank/);
    assert.equal(doc.querySelector('#userName').value, 'admin-test');
    await dom.window.load();
    await settle();
    assert.match(doc.querySelector('#reviewed').textContent, /Rated 1/);
  } finally {
    dom.window.close();
  }
});

test('login validation and server errors follow language without changing inputs', async () => {
  const dom = await page('login');
  try {
    const { document: doc, ColorGradeI18n: i18n } = dom.window;
    const submit = () =>
      doc.querySelector('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    submit();
    await settle();
    assert.equal(doc.querySelector('#toast').textContent, 'Please enter an account.');
    doc.querySelector('#username').value = 'test-only';
    doc.querySelector('#password').value = 'short';
    submit();
    await settle();
    assert.match(doc.querySelector('#toast').textContent, /at least 8/);
    doc.querySelector('#password').value = 'not-a-real-password';
    submit();
    await settle();
    assert.equal(doc.querySelector('#toast').textContent, 'Incorrect account or password.');
    i18n.setLanguage('zh');
    await settle();
    assert.equal(doc.querySelector('#toast').textContent, '账号或密码错误。');
    assert.equal(doc.querySelector('#password').value, 'not-a-real-password');
    assert.equal(doc.querySelector('button[type=submit]').disabled, false);
    await dom.window.LandscapeApi.adminLogout();
  } finally {
    dom.window.close();
  }
});

test('audit preserves filenames and review data while translating controls', async () => {
  const dom = await page('audit');
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelector('#rows b').textContent, '森林与湖泊');
    doc.querySelector('[data-id]').click();
    await settle();
    assert.equal(doc.querySelector('#dialogTitle').textContent, '森林与湖泊');
    assert.equal(doc.querySelector('#reviewStatus').value, 'pending');
    assert.equal(doc.querySelector('#dialogImage').alt, 'Image preview for review');
    assert.match(doc.querySelector('#rows').textContent, /Local import/);
  } finally {
    dom.window.close();
  }
});

test('dynamic text, attributes, paths, script contents and cross-tab language changes', async () => {
  const dom = await page('real-landscape');
  try {
    const { document: doc, LandscapeI18n: i18n } = dom.window;
    assert.equal(doc.querySelector('.title [translate=no]').textContent, '雾中高原');
    assert.match(doc.querySelector('.image-description').textContent, /清晨的高原/);
    assert.match(doc.querySelector('.tag').textContent, /Color graded/);
    const node = doc.createElement('button');
    node.textContent = '新增账号';
    node.title = '新增账号';
    doc.body.append(node);
    await settle();
    assert.equal(node.title, 'Add account');
    node.firstChild.nodeValue = '编辑账号';
    node.title = '编辑账号';
    await settle();
    assert.equal(node.textContent, 'Edit account');
    assert.equal(node.title, 'Edit account');
    dom.window.dispatchEvent(
      new dom.window.StorageEvent('storage', {
        key: 'landscape-language',
        newValue: 'zh',
      })
    );
    await settle();
    assert.equal(node.textContent, '编辑账号');
    assert.equal(node.title, '编辑账号');
    assert.equal(doc.querySelector('code').textContent, 'image-library/imports');
    assert.equal(i18n.t('确认删除账号「森林」吗？', 'en'), 'Delete account "森林"?');
    i18n.setLanguage('en');
    await dom.window.loadStoredImages();
    await settle();
    assert.match(doc.querySelector('#resultText').textContent, /Showing 2 images$/);
  } finally {
    dom.window.close();
  }
});

test('color editor toast is visible, localized and dismissible', async () => {
  const dom = await page('color-grade');
  try {
    const { document: doc, LandscapeI18n: i18n } = dom.window;
    const lock = doc.querySelector('#editorLock');
    lock.click();
    await settle();
    const toast = doc.querySelector('#editorToast');
    assert.equal(toast.classList.contains('show'), true);
    assert.equal(toast.getAttribute('aria-hidden'), 'false');
    assert.equal(toast.textContent, 'Import an image before using color controls');
    i18n.setLocale('zh-CN');
    await settle();
    assert.equal(toast.textContent, '请先导入图片后再使用调色功能');
    assert.equal(toast.getAttribute('aria-hidden'), 'false');
    await new Promise((resolve) => setTimeout(resolve, 3250));
    assert.equal(toast.classList.contains('show'), false);
    assert.equal(toast.getAttribute('aria-hidden'), 'true');
  } finally {
    dom.window.close();
  }
});

test('color editor download sizes and compact actions follow both languages', async () => {
  const dom = await page('color-grade');
  try {
    const { document: doc, ColorGradeI18n: i18n } = dom.window;
    const sizeSelect = doc.querySelector('#downloadSpec');
    assert.equal(sizeSelect.disabled, true);
    assert.equal(doc.querySelector('.download-select .select-trigger-value').textContent, 'High');
    assert.equal(doc.querySelector('#download').textContent, 'Download image');
    assert.equal(doc.querySelector('#uploadToLibrary').textContent, 'Upload');
    assert.equal(
      doc.querySelector('#downloadSpec option[value="original"]').textContent,
      'Original graded'
    );
    i18n.setLocale('zh-CN');
    await settle();
    assert.equal(doc.querySelector('.download-select .select-trigger-value').textContent, '高清');
    assert.equal(doc.querySelector('#download').textContent, '下载图像');
    assert.equal(doc.querySelector('#uploadToLibrary').textContent, '上传入库');
    assert.equal(
      doc.querySelector('#downloadSpec option[value="original"]').textContent,
      '原图（已调色）'
    );
    assert.equal(doc.querySelector('#apply').textContent, '应用方案');
    assert.equal(doc.querySelector('#reset').textContent, '重置调色');
  } finally {
    dom.window.close();
  }
});

test('color editor region filter localizes every option without changing values', async () => {
  const dom = await page('color-grade', 'zh');
  try {
    const { document: doc, ColorGradeI18n: i18n } = dom.window;
    const select = doc.querySelector('#filterRegion');
    const values = Array.from(select.options).map((option) => option.value);
    const chinese = Array.from(select.options).map((option) => option.textContent);
    const expectedChinese = [
      '全部地区',
      '云南高原',
      '广西喀斯特',
      '海南海岸',
      '阿尔卑斯山区',
      '自然还原',
      '伦敦阴雨',
      '东京夜景',
      '加州黄金时刻',
      '北欧冷调',
      '地中海海岸',
      '摩洛哥暖沙',
      '冰岛蓝调',
      '纽约街头',
      '赛博朋克夜色',
      '复古胶片',
      '黑色电影',
    ];
    assert.equal(select.options.length, 17);
    assert.deepEqual(chinese, expectedChinese);
    assert.ok(!chinese.includes('mediterranean'));
    i18n.setLocale('en-US');
    await settle();
    const english = Array.from(select.options).map((option) => option.textContent);
    const expectedEnglish = [
      'All regions',
      'Yunnan Plateau',
      'Guangxi Karst',
      'Hainan Coast',
      'Alps',
      'Natural restore',
      'London rain',
      'Tokyo night',
      'California golden hour',
      'Nordic cool',
      'Mediterranean coast',
      'Moroccan warm sand',
      'Iceland blue',
      'New York streets',
      'Cyberpunk night',
      'Analog film',
      'Film noir',
    ];
    assert.equal(select.value, 'all');
    assert.deepEqual(
      Array.from(select.options).map((option) => option.value),
      values
    );
    assert.deepEqual(english, expectedEnglish);
    assert.ok(!english.includes('mediterranean'));
    const menu = Array.from(doc.querySelectorAll('#filterRegion + .select-ui .select-option')).map(
      (option) => option.textContent
    );
    assert.ok(menu.includes('Mediterranean coast'));
    i18n.setLocale('zh-CN');
    await settle();
    assert.ok(
      Array.from(doc.querySelectorAll('#filterRegion + .select-ui .select-option')).some(
        (option) => option.textContent === '地中海海岸'
      )
    );
  } finally {
    dom.window.close();
  }
});

test('color editor saves and restores the region around a camera filter', async () => {
  const dom = await page('color-grade', 'zh');
  try {
    const { document: doc, Event, ColorGradeI18n: i18n } = dom.window;
    const region = doc.querySelector('#filterRegion');
    const camera = doc.querySelector('#filterCamera');
    const regionUi = doc.querySelector('#filterRegion + .select-ui');
    const regionTrigger = doc.querySelector('#filterRegion + .select-ui .select-trigger');

    region.value = 'guangxi';
    region.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(region.value, 'guangxi');
    assert.equal(region.disabled, false);

    camera.value = '富士';
    camera.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(region.value, 'all');
    assert.equal(region.disabled, true);
    assert.equal(regionUi.classList.contains('disabled'), true);
    assert.equal(regionTrigger.disabled, true);
    assert.equal(regionTrigger.textContent.trim(), '全部地区');
    assert.ok(
      Array.from(regionUi.querySelectorAll('.select-option')).every((option) => option.disabled)
    );

    i18n.setLocale('en-US');
    await settle();
    assert.equal(region.value, 'all');
    assert.equal(region.disabled, true);
    assert.equal(regionTrigger.textContent.trim(), 'All regions');
    i18n.setLocale('zh-CN');
    await settle();
    assert.equal(regionTrigger.textContent.trim(), '全部地区');

    const secondCamera = doc.createElement('option');
    secondCamera.value = '测试相机';
    secondCamera.textContent = '测试相机';
    camera.append(secondCamera);
    camera.value = '测试相机';
    camera.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(region.value, 'all');
    assert.equal(region.disabled, true);

    camera.value = 'all';
    camera.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(region.value, 'guangxi');
    assert.equal(region.disabled, false);
    assert.equal(regionUi.classList.contains('disabled'), false);
    assert.equal(regionTrigger.disabled, false);
    assert.equal(regionTrigger.textContent.trim(), '广西喀斯特');
    assert.ok(
      Array.from(regionUi.querySelectorAll('.select-option')).every((option) => !option.disabled)
    );

    doc.querySelector('#clearFilters').click();
    assert.equal(camera.value, 'all');
    assert.equal(region.value, 'all');
    assert.equal(region.disabled, false);
  } finally {
    dom.window.close();
  }
});

test('color editor exposes local learning presets under Nikon, Leica, and Hasselblad filters', async () => {
  const dom = await page('color-grade', 'zh');
  try {
    const { document: doc, Event, ColorGradeI18n: i18n } = dom.window;
    const camera = doc.querySelector('#filterCamera');
    const values = Array.from(camera.options).map((option) => option.value);
    assert.deepEqual(values, ['all', '富士', '尼康', '徕卡', '哈苏']);

    camera.value = '徕卡';
    camera.dispatchEvent(new Event('change', { bubbles: true }));
    assert.ok(doc.querySelectorAll('#variants .variant').length > 0);
    assert.ok(
      Array.from(doc.querySelectorAll('#variants .variant')).every((card) =>
        card.textContent.includes('徕卡')
      )
    );

    i18n.setLocale('en-US');
    await settle();
    assert.ok(
      Array.from(camera.options).some(
        (option) => option.value === '徕卡' && option.textContent === 'Leica'
      )
    );
  } finally {
    dom.window.close();
  }
});

test('color editor derives scene options from the active region and camera filters', async () => {
  const dom = await page('color-grade', 'zh');
  try {
    const { document: doc, Event, ColorGradeI18n: i18n } = dom.window;
    const scene = doc.querySelector('#filterScene');
    const region = doc.querySelector('#filterRegion');
    const camera = doc.querySelector('#filterCamera');
    const sceneValues = () => Array.from(scene.options).map((option) => option.value);
    const sceneMenuLabels = () =>
      Array.from(doc.querySelectorAll('#filterScene + .select-ui .select-option')).map(
        (option) => option.textContent
      );
    const allScenes = [
      'all',
      '风景',
      '海岸',
      '人像',
      '花卉',
      '纪实',
      '建筑',
      '阴天',
      '城市',
      '旅行',
      '电影',
      '黑白',
      '山地',
      '复古',
      '日常',
      '天空',
      '高光',
      '静物',
      '植被',
    ];

    assert.deepEqual(sceneValues(), allScenes);
    assert.deepEqual(
      sceneMenuLabels(),
      allScenes.map((value) => (value === 'all' ? '全部场景' : value))
    );
    assert.equal(sceneValues().includes('夜景'), false);

    scene.value = '建筑';
    scene.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(scene.value, '建筑');

    region.value = 'guangxi';
    region.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(scene.value, 'all');
    assert.deepEqual(sceneValues(), ['all']);
    assert.deepEqual(sceneMenuLabels(), ['全部场景']);

    const unsupportedCamera = doc.createElement('option');
    unsupportedCamera.value = '测试相机';
    unsupportedCamera.textContent = '测试相机';
    camera.append(unsupportedCamera);
    camera.value = '测试相机';
    camera.dispatchEvent(new Event('change', { bubbles: true }));
    assert.deepEqual(sceneValues(), ['all']);

    doc.querySelector('#clearFilters').click();
    assert.equal(scene.value, 'all');
    assert.deepEqual(sceneValues(), allScenes);

    i18n.setLocale('en-US');
    await settle();
    assert.ok(Array.from(scene.options).some((option) => option.textContent === 'Portrait'));
    assert.ok(Array.from(scene.options).some((option) => option.textContent === 'Vintage'));
    assert.ok(Array.from(scene.options).some((option) => option.textContent === 'Everyday'));
    assert.ok(Array.from(scene.options).some((option) => option.textContent === 'Vegetation'));
    assert.ok(sceneMenuLabels().includes('Portrait'));
    assert.ok(sceneMenuLabels().includes('Vintage'));
  } finally {
    dom.window.close();
  }
});
