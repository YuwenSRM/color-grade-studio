(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LandscapeP2BuiltinFilters = api;
})(globalThis, function () {
  'use strict';

  const entries = [
    {
      id: 'p2-soft-portrait',
      name: '柔和肖像',
      source: 'p2-builtin',
      kind: 'lut',
      brand: '自研风格',
      author: 'Real Landscape',
      description: '自研风格模拟，不代表任何相机品牌或原厂色彩算法。',
      scenes: ['人像', '日常'],
      cameras: [],
      inputColorSpace: 'sRGB SDR',
      outputColorSpace: 'sRGB SDR',
      compatibilityStatus: 'applicable',
      admissionStatus: 'admitted',
      contentPath: 'assets/color-grade/p2-builtin-filters/soft-portrait.cube',
      contentSha256: '4eca2581a1d6179f109979e1044bf0118917ff8785588e80fecbeae7cbbcfe57',
      gridSize: 17,
    },
    {
      id: 'p2-clear-landscape',
      name: '清澈风景',
      source: 'p2-builtin',
      kind: 'lut',
      brand: '自研风格',
      author: 'Real Landscape',
      description: '自研风格模拟，不代表任何相机品牌或原厂色彩算法。',
      scenes: ['风景', '天空', '植被'],
      cameras: [],
      inputColorSpace: 'sRGB SDR',
      outputColorSpace: 'sRGB SDR',
      compatibilityStatus: 'applicable',
      admissionStatus: 'admitted',
      contentPath: 'assets/color-grade/p2-builtin-filters/clear-landscape.cube',
      contentSha256: '7e0bb97d2f54ad261ba46716e7a2c9625c3c696a5248cd4c31184e603a08e403',
      gridSize: 17,
    },
    {
      id: 'p2-gentle-highlight',
      name: '柔光层次',
      source: 'p2-builtin',
      kind: 'lut',
      brand: '自研风格',
      author: 'Real Landscape',
      description: '自研风格模拟，不代表任何相机品牌或原厂色彩算法。',
      scenes: ['静物', '高光', '城市'],
      cameras: [],
      inputColorSpace: 'sRGB SDR',
      outputColorSpace: 'sRGB SDR',
      compatibilityStatus: 'applicable',
      admissionStatus: 'admitted',
      contentPath: 'assets/color-grade/p2-builtin-filters/gentle-highlight.cube',
      contentSha256: '37677b1f37960f0fa1e6e48ef1ce06aa95d359b5b03eef594829c4e9e541e379',
      gridSize: 17,
    },
  ];

  return Object.freeze(
    entries.map((entry) =>
      Object.freeze({
        ...entry,
        scenes: Object.freeze(entry.scenes.slice()),
        cameras: Object.freeze([]),
      })
    )
  );
});
