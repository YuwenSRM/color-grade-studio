(function () {
  'use strict';
  if (window.LandscapeI18n) return;
  const dictionary = window.LandscapeEnglish || {};
  const storageKey = 'landscape-language';
  const ignored = 'script,style,code,[translate="no"],[data-i18n-ignore],.language-toggle';
  const attributes = ['placeholder', 'title', 'aria-label', 'alt', 'label'];
  const original = new WeakMap();
  let originalTitle;
  const nativeAlert = window.alert.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  const keys = Object.keys(dictionary).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    keys
      .map((key) =>
        Array.from(key)
          .map((char) => ('\\^$.*+?()[]{}|'.includes(char) ? '\\' + char : char))
          .join('')
      )
      .join('|'),
    'g'
  );
  let language = 'zh';
  let observer;
  try {
    language = localStorage.getItem(storageKey) === 'en' ? 'en' : 'zh';
  } catch (_) {}

  function translate(value, target = language) {
    const source = String(value ?? '');
    if (target !== 'en') return source;
    // Account names are interpolated without translating their contents.
    const deletion = /^确认删除账号「([\s\S]*)」吗？$/.exec(source);
    if (deletion) return 'Delete account "' + deletion[1] + '"?';
    let result = source.replace(
      /已评分\s*(\d+)\s*·\s*近 7 天新增\s*(\d+)/g,
      (_, count, recent) => 'Rated ' + count + ' · Added in the last 7 days: ' + recent
    );
    result = result.replace(
      /已审核\s*(\d+)\s*·\s*通过\s*(\d+)/g,
      (_, count, approved) => 'Reviewed ' + count + ' · Approved ' + approved
    );
    result = result.replace(
      /显示\s*(\d+)\s*张(?:「([^」]+)」)?图片/g,
      (_, count, category) =>
        'Showing ' +
        count +
        (Number(count) === 1 ? ' image' : ' images') +
        (category ? ' in "' + category + '"' : '')
    );
    result = result.replace(
      /已保存\s*(\d+)\s*张图片到本地图库/g,
      (_, count) =>
        'Saved ' + count + (Number(count) === 1 ? ' image' : ' images') + ' to the local library'
    );
    // Replace in one pass so short keys cannot alter the output of longer keys.
    return result.replace(pattern, (key) => dictionary[key]).replace(/；/g, '; ');
  }

  function sourceValue(node, key, value) {
    let state = original.get(node);
    if (!state) original.set(node, (state = {}));
    if (!state[key] || value !== state[key].rendered) {
      state[key] = { source: value, rendered: value };
    }
    return state[key];
  }

  function translateTextNode(node) {
    if (
      !node.parentElement ||
      node.parentElement.closest(ignored) ||
      node.parentElement.closest('[data-i18n-source],[data-i18n-date]') ||
      !node.nodeValue.trim()
    )
      return;
    const state = sourceValue(node, 'text', node.nodeValue);
    state.rendered = translate(state.source);
    if (node.nodeValue !== state.rendered) node.nodeValue = state.rendered;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? '—'
      : new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).format(date);
  }

  function translateControl(control) {
    if (control.closest(ignored)) return;
    // Preserve business values when an option was authored without a value attribute.
    if (control.tagName === 'OPTION' && !control.hasAttribute('value'))
      control.value = control.textContent;
    for (const attribute of attributes) {
      if (!control.hasAttribute(attribute)) continue;
      const state = sourceValue(control, attribute, control.getAttribute(attribute));
      state.rendered = translate(state.source);
      if (control.getAttribute(attribute) !== state.rendered)
        control.setAttribute(attribute, state.rendered);
    }
    if (control.hasAttribute('data-i18n-date')) {
      const text = formatDate(control.dataset.i18nDate);
      if (control.textContent !== text) control.textContent = text;
    }
    if (control.hasAttribute('data-i18n-source')) {
      const text = translate(control.dataset.i18nSource);
      if (control.textContent !== text) control.textContent = text;
    }
  }

  function translateElement(element) {
    if (element.nodeType !== Node.ELEMENT_NODE || element.closest(ignored)) return;
    translateControl(element);
    element.querySelectorAll('*').forEach(translateControl);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) translateTextNode(walker.currentNode);
  }

  const observation = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...attributes, 'data-i18n-source', 'data-i18n-date'],
  };
  function processRecords(records) {
    // Disconnect during translation to avoid feedback from our own DOM writes.
    observer.disconnect();
    for (const record of records) {
      if (record.type === 'characterData') translateTextNode(record.target);
      else if (record.type === 'attributes') translateControl(record.target);
      else
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
          else translateElement(node);
        }
    }
    observer.observe(document.body, observation);
  }

  function applyLanguage() {
    observer?.disconnect();
    translateElement(document.body);
    document.title = translate(originalTitle);
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    const button = document.querySelector('.language-toggle');
    if (button) {
      button.textContent = language === 'zh' ? 'English' : '中文';
      button.setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换为中文');
    }
    window.dispatchEvent(new CustomEvent('landscape:languagechange', { detail: { language } }));
    observer?.observe(document.body, observation);
  }

  function setLanguage(next, persist = true) {
    language = next === 'en' ? 'en' : 'zh';
    if (persist)
      try {
        localStorage.setItem(storageKey, language);
      } catch (_) {}
    applyLanguage();
  }

  window.LandscapeI18n = {
    t: translate,
    formatDate,
    setLanguage,
    get language() {
      return language;
    },
    sourceText(element) {
      if (element.hasAttribute('data-i18n-source')) return element.dataset.i18nSource;
      return Array.from(element.childNodes)
        .map((node) =>
          node.nodeType === Node.TEXT_NODE
            ? sourceValue(node, 'text', node.nodeValue).source
            : node.textContent
        )
        .join('');
    },
  };
  window.alert = (message) => nativeAlert(translate(message));
  window.confirm = (message) => nativeConfirm(translate(message));
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey) setLanguage(event.newValue, false);
  });
  function init() {
    originalTitle = document.title;
    const button = document.createElement('button');
    button.className = 'language-toggle';
    button.type = 'button';
    button.onclick = () => setLanguage(language === 'zh' ? 'en' : 'zh');
    document.body.appendChild(button);
    observer = new MutationObserver(processRecords);
    applyLanguage();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
