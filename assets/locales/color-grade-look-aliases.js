(function (root) {
  'use strict';
  // Canonical IDs and aliases are implementation data, never display copy or
  // persisted user LUT metadata. The parser can therefore preserve results
  // across a locale switch.
  root.ColorGradeLookAliases = Object.freeze([
    Object.freeze({
      id: 'look.warm-film',
      tags: Object.freeze(['warm', 'film']),
      aliases: Object.freeze(['warm film', 'vintage warm', '暖调胶片', '复古暖色']),
    }),
    Object.freeze({
      id: 'look.tokyo-night',
      tags: Object.freeze(['city', 'night', 'neon']),
      aliases: Object.freeze(['tokyo night', '东京夜景', '东京夜']),
    }),
    Object.freeze({
      id: 'look.teal-orange',
      tags: Object.freeze(['teal', 'orange']),
      aliases: Object.freeze(['teal & orange', 'teal and orange', '青橙', '青橙色']),
    }),
  ]);
})(window);
