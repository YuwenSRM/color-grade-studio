(function (root) {
  'use strict';

  const fields = Object.freeze({
    exposure: ['exposure', '曝光'],
    contrast: ['contrast', '对比度'],
    highlights: ['highlights', 'highlight', '高光'],
    shadows: ['shadows', 'shadow', '阴影'],
    black: ['black point', 'blacks', 'black', '黑点'],
    saturation: ['saturation', 'sat', '饱和度'],
    vibrance: ['vibrance', '鲜艳度'],
    temperature: ['temperature', 'temp', '色温'],
    tint: ['tint', '色调'],
    clarity: ['clarity', '清晰度'],
  });
  const fallbackLooks = Object.freeze([
    {
      id: 'look.warm-film',
      tags: ['warm', 'film'],
      aliases: ['warm film', 'vintage warm', '暖调胶片', '复古暖色'],
    },
    {
      id: 'look.tokyo-night',
      tags: ['city', 'night', 'neon'],
      aliases: ['tokyo night', '东京夜景', '东京夜'],
    },
    {
      id: 'look.teal-orange',
      tags: ['teal', 'orange'],
      aliases: ['teal & orange', 'teal and orange', '青橙', '青橙色'],
    },
  ]);
  const looks = Object.freeze(
    Array.isArray(root.ColorGradeLookAliases) && root.ColorGradeLookAliases.length
      ? root.ColorGradeLookAliases
      : fallbackLooks
  );
  const unsupported =
    /(?:\b(?:ev|k)\b|％|%|\b(?:blue|red|green)\s+(?:sat|saturation|hsl)\b|蓝(?:色)?饱和度|hsl)/i;

  function normalize(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/[，、；]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }
  function escape(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  function fieldExpression() {
    return Object.entries(fields)
      .flatMap(([field, aliases]) => aliases.map((alias) => [field, alias]))
      .sort((left, right) => right[1].length - left[1].length);
  }
  const expressions = fieldExpression();
  const commandPattern = new RegExp(
    `(${expressions.map(([, alias]) => escape(alias)).join('|')})\\s*([+=-])\\s*(-?(?:\\d+(?:\\.\\d+)?|\\.\\d+))`,
    'gi'
  );
  const fieldForAlias = Object.fromEntries(
    expressions.map(([field, alias]) => [normalize(alias), field])
  );

  function parse(input, current = {}) {
    const source = String(input || '');
    const normalized = normalize(source);
    const result = {
      searchText: source.trim(),
      intentPatch: {},
      chips: [],
      looks: [],
      tags: [],
      suggestions: [],
      executable: false,
      unsupported: false,
    };
    looks.forEach((look) => {
      if (look.aliases.some((alias) => normalized.includes(normalize(alias)))) {
        result.looks.push(look.id);
        result.tags.push(...look.tags);
      }
    });
    result.tags = [...new Set(result.tags)];
    if (unsupported.test(normalized)) {
      result.unsupported = true;
      result.suggestions.push('native-adjustments');
      return result;
    }
    const running = { ...current };
    let matched = 0;
    let match;
    while ((match = commandPattern.exec(normalized)) && matched < 10) {
      const field = fieldForAlias[normalize(match[1])];
      const operator = match[2];
      const number = Number(match[3]);
      if (!field || !Number.isFinite(number) || Math.abs(number) > 1000) continue;
      const base = Number.isFinite(Number(running[field])) ? Number(running[field]) : 0;
      const raw = operator === '=' ? number : base + (operator === '+' ? number : -number);
      const value = Math.max(-100, Math.min(100, Math.round(raw)));
      running[field] = value;
      result.intentPatch[field] = value;
      result.chips.push({ field, value, operator, amount: Math.round(number), unit: 'native' });
      matched += 1;
    }
    result.executable = result.chips.length > 0;
    if (
      !result.executable &&
      /(?:exposure|contrast|temp|temperature|曝光|对比度|色温)/i.test(normalized)
    )
      result.suggestions.push('native-adjustments');
    return result;
  }

  root.ColorGradeIntent = Object.freeze({ parse, normalize, looks, fields });
})(window);
