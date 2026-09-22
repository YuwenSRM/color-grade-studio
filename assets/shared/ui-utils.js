(function () {
  'use strict';
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
  window.LandscapeUI = {
    escapeHtml: (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => entities[char]),
    sourceName: (value) =>
      ({
        'folder-import': '本地导入',
        'real-landscape': '网页入库',
        'color-grade': '调色成片',
      })[value] || value,
    categoryName: (value) =>
      ({
        'color-graded': '调色风景',
        调色风景: '调色风景',
      })[value] || value,
    regionName: (value) =>
      ({
        yunnan: '云南高原',
        guangxi: '广西喀斯特',
        hainan: '海南海岸',
        alps: '阿尔卑斯山区',
        default: '自然还原',
        london: '伦敦阴雨',
        tokyo: '东京夜景',
        california: '加州黄金时刻',
        nordic: '北欧冷调',
        mediterranean: '地中海海岸',
        morocco: '摩洛哥暖沙',
        iceland: '冰岛蓝调',
        newyork: '纽约街头',
        cyberpunk: '赛博朋克夜色',
        analog: '复古胶片',
        noir: '黑色电影',
      })[value] || value,
  };
})();
