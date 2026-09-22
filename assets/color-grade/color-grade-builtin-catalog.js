(function (root) {
  'use strict';

  // Display metadata for shipped presets lives outside user LUT records. The id is
  // deliberately the only join key; IndexedDB user records remain untouched.
  function entry(id, type) {
    return Object.freeze({
      id: String(id),
      type: type || 'profile',
      labelKey: 'cg.catalog.builtin.name',
      descriptionKey: 'cg.catalog.builtin.description',
      tags: Object.freeze([]),
      aliases: Object.freeze({ zh: Object.freeze([]), en: Object.freeze([]) }),
    });
  }

  root.ColorGradeBuiltinCatalog = Object.freeze({
    forPreset: function (preset) {
      var metadata = entry(preset.id, preset.kind === 'lut' ? 'lut' : 'profile');
      return Object.freeze({
        ...metadata,
        // Source labels are catalog data, never persisted into a user LUT record.
        labelVariables: Object.freeze({ name: preset.name }),
        descriptionVariables: Object.freeze({ description: preset.description || '' }),
        tags: Object.freeze([preset.region, ...(preset.scenes || [])].filter(Boolean)),
        aliases: Object.freeze({
          zh: Object.freeze([preset.name, preset.regionLabel].filter(Boolean)),
          en: Object.freeze([preset.name, preset.region].filter(Boolean)),
        }),
      });
    },
    forLut: function (filter) {
      return Object.freeze({
        ...entry(filter.id, 'lut'),
        labelVariables: Object.freeze({ name: filter.name }),
        descriptionVariables: Object.freeze({ description: filter.description || '' }),
        tags: Object.freeze([...(filter.scenes || [])]),
        aliases: Object.freeze({
          zh: Object.freeze([filter.name]),
          en: Object.freeze([filter.name]),
        }),
      });
    },
  });
})(window);
