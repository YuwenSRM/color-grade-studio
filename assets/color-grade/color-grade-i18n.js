(function (root) {
  'use strict';

  var LOCALE_KEY = 'color-grade-locale';
  var LEGACY_KEY = 'landscape-language';
  var BASE_LOCALE = 'zh-CN';
  var supported = Object.freeze({ 'zh-CN': true, 'en-US': true });
  var listeners = new Set();
  var locale = normalize(readStoredLocale());
  var development = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname || '');

  function normalize(value) {
    if (value === 'en' || value === 'en-US') return 'en-US';
    return supported[value] ? value : BASE_LOCALE;
  }

  function legacyLocale(value) {
    return normalize(value) === 'en-US' ? 'en' : 'zh';
  }

  function readStoredLocale() {
    try {
      var canonical = localStorage.getItem(LOCALE_KEY);
      if (canonical) return canonical;
      var migrated = normalize(localStorage.getItem(LEGACY_KEY));
      localStorage.setItem(LOCALE_KEY, migrated);
      return migrated;
    } catch (_) {
      return BASE_LOCALE;
    }
  }

  function lookup(targetLocale, key) {
    return String(key)
      .split('.')
      .reduce(function (value, segment) {
        return value && Object.prototype.hasOwnProperty.call(value, segment)
          ? value[segment]
          : undefined;
      }, root.ColorGradeLocales?.[targetLocale]);
  }

  function variableNames(template) {
    if (typeof template !== 'string') return [];
    return Array.from(template.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g), function (match) {
      return match[1];
    });
  }

  function format(template, variables, key) {
    if (typeof template === 'function') return template(variables || {});
    if (typeof template !== 'string') return undefined;
    var expected = variableNames(template);
    if (development) {
      expected.forEach(function (name) {
        if (!variables || !Object.prototype.hasOwnProperty.call(variables, name))
          throw new Error('Missing i18n variable "' + name + '" for ' + key);
      });
      Object.keys(variables || {}).forEach(function (name) {
        if (!expected.includes(name))
          throw new Error('Unexpected i18n variable "' + name + '" for ' + key);
      });
    }
    return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, function (_, name) {
      return variables?.[name] == null ? '{' + name + '}' : String(variables[name]);
    });
  }

  function t(key, variables) {
    var value = lookup(locale, key);
    if (value === undefined) {
      value = lookup(BASE_LOCALE, key);
      if (value === undefined) {
        var message = 'Missing ColorGradeI18n key: ' + key;
        if (development) throw new Error(message);
        console.warn(message);
        return key;
      }
      console.warn('Missing locale key ' + key + ' in ' + locale + '; using ' + BASE_LOCALE);
    }
    return format(value, variables, key);
  }

  function applyBindings(scope) {
    var container = scope || document;
    var nodes = [];
    if (container.nodeType === Node.ELEMENT_NODE && container.matches('[data-i18n]'))
      nodes.push(container);
    nodes.push.apply(nodes, container.querySelectorAll?.('[data-i18n]') || []);
    nodes.forEach(function (node) {
      node.textContent = t(node.dataset.i18n);
    });
    var attrNodes = [];
    if (container.nodeType === Node.ELEMENT_NODE && container.matches('[data-i18n-attr]'))
      attrNodes.push(container);
    attrNodes.push.apply(attrNodes, container.querySelectorAll?.('[data-i18n-attr]') || []);
    attrNodes.forEach(function (node) {
      node.dataset.i18nAttr.split(';').forEach(function (binding) {
        var pair = binding.trim().split(':');
        if (pair.length !== 2) throw new Error('Invalid data-i18n-attr binding: ' + binding);
        node.setAttribute(pair[0].trim(), t(pair[1].trim()));
      });
    });
    document.title = t(
      'cg.meta.title.' + (root.ColorGradeAppMode?.mode === 'standalone' ? 'standalone' : 'full')
    );
  }

  function notify() {
    document.documentElement.lang = locale;
    applyBindings(document);
    var detail = { locale: locale, legacyLanguage: legacyLocale(locale) };
    root.dispatchEvent(new CustomEvent('color-grade:localechange', { detail: detail }));
    listeners.forEach(function (listener) {
      listener(detail);
    });
  }

  function setLocale(next, persist) {
    var normalized = normalize(next);
    locale = normalized;
    if (persist !== false) {
      try {
        localStorage.setItem(LOCALE_KEY, normalized);
        localStorage.setItem(LEGACY_KEY, legacyLocale(normalized));
      } catch (_) {}
    }
    notify();
  }

  root.ColorGradeI18n = Object.freeze({
    t: t,
    has: function (key) {
      return lookup(locale, key) !== undefined;
    },
    setLocale: setLocale,
    getLocale: function () {
      return locale;
    },
    onLocaleChange: function (listener) {
      listeners.add(listener);
      return function () {
        listeners.delete(listener);
      };
    },
    applyBindings: applyBindings,
    formatNumber: function (value, options) {
      return new Intl.NumberFormat(locale, options).format(value);
    },
    formatFileSize: function (bytes) {
      var units = ['B', 'KB', 'MB', 'GB'];
      var index =
        bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0;
      return (
        new Intl.NumberFormat(locale, { maximumFractionDigits: index ? 1 : 0 }).format(
          bytes / Math.pow(1024, index)
        ) +
        ' ' +
        units[index]
      );
    },
    formatList: function (items, options) {
      return new Intl.ListFormat(locale, options).format(items);
    },
    formatDate: function (value, options) {
      return new Intl.DateTimeFormat(locale, options).format(new Date(value));
    },
  });

  root.addEventListener('storage', function (event) {
    if (event.key === LOCALE_KEY) setLocale(event.newValue, false);
    if (event.key === LEGACY_KEY && !event.storageArea?.getItem(LOCALE_KEY))
      setLocale(event.newValue, false);
  });

  function initialize() {
    document.documentElement.lang = locale;
    var toggle = document.createElement('button');
    toggle.className = 'language-toggle';
    toggle.type = 'button';
    toggle.dataset.i18n = 'cg.action.toggleLanguage';
    toggle.dataset.i18nAttr = 'aria-label:cg.a11y.toggleLanguage';
    toggle.addEventListener('click', function () {
      setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN');
    });
    document.body.appendChild(toggle);
    notify();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})(window);
