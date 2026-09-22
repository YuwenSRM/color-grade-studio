(function () {
  'use strict';

  function translate(key, fallback) {
    if (!key) return fallback;
    return window.ColorGradeI18n ? window.ColorGradeI18n.t(key) : fallback;
  }

  function locale() {
    return window.ColorGradeI18n?.getLocale() || document.documentElement.lang || 'zh-CN';
  }

  function createOption(option, menu, select, closeMenu) {
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'select-option';
    item.dataset.optionIndex = option.index;
    item.dataset.i18nKey = option.dataset.i18n || '';
    item.textContent = translate(item.dataset.i18nKey, option.textContent);
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(option.selected));
    item.tabIndex = -1;
    item.disabled = option.disabled;
    item.addEventListener('click', function () {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      closeMenu();
    });
    menu.appendChild(item);
  }

  function enhance(select, index) {
    if (select.dataset.enhanced) return;
    select.dataset.enhanced = 'true';
    select.classList.add('native-select-hidden');

    var wrapper = document.createElement('div');
    wrapper.className = 'select-ui';
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'select-menu-' + index);
    var value = document.createElement('span');
    value.className = 'select-trigger-value';
    var arrow = document.createElement('span');
    arrow.className = 'select-trigger-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    trigger.append(value, arrow);
    var menu = document.createElement('div');
    menu.className = 'select-menu';
    menu.id = 'select-menu-' + index;
    menu.setAttribute('role', 'listbox');

    function update() {
      var selected = select.options[select.selectedIndex];
      value.dataset.i18nKey = selected?.dataset.i18n || '';
      value.textContent = translate(value.dataset.i18nKey, selected?.textContent || '');
      menu.querySelectorAll('.select-option').forEach(function (item) {
        item.setAttribute(
          'aria-selected',
          String(Number(item.dataset.optionIndex) === select.selectedIndex)
        );
      });
    }
    function enabledOptions() {
      return Array.from(menu.querySelectorAll('.select-option:not(:disabled)'));
    }
    function focusOption(option) {
      enabledOptions().forEach(function (item) {
        item.tabIndex = item === option ? 0 : -1;
      });
      option?.focus();
      if (typeof option?.scrollIntoView === 'function') option.scrollIntoView({ block: 'nearest' });
    }
    function choose(option) {
      if (!option || option.disabled) return;
      select.value = select.options[Number(option.dataset.optionIndex)].value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      closeMenu(true);
    }
    function syncDisabled() {
      trigger.disabled = select.disabled;
      wrapper.classList.toggle('disabled', select.disabled);
      menu.querySelectorAll('.select-option').forEach(function (item) {
        item.disabled =
          select.disabled || select.options[Number(item.dataset.optionIndex)].disabled;
      });
      if (select.disabled) closeMenu();
    }
    function closeMenu(returnFocus) {
      wrapper.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      if (returnFocus) trigger.focus();
    }
    function openMenu() {
      update();
      document.querySelectorAll('.select-ui.open').forEach(function (node) {
        if (node !== wrapper) node.classList.remove('open');
      });
      wrapper.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      var active = menu.querySelector('[aria-selected="true"]');
      focusOption(active || enabledOptions()[0]);
    }

    function rebuildOptions() {
      menu.replaceChildren();
      Array.from(select.children).forEach(function (node) {
        if (node.tagName === 'OPTGROUP') {
          var label = document.createElement('div');
          label.className = 'select-group-label';
          label.textContent = node.label;
          menu.appendChild(label);
          Array.from(node.children).forEach(function (option) {
            createOption(option, menu, select, closeMenu);
          });
        } else if (node.tagName === 'OPTION') {
          createOption(node, menu, select, closeMenu);
        }
      });
      update();
      syncDisabled();
    }

    trigger.addEventListener('click', function () {
      wrapper.classList.contains('open') ? closeMenu() : openMenu();
    });
    trigger.addEventListener('keydown', function (event) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        openMenu();
      } else if (event.key === 'Escape') closeMenu(false);
    });
    menu.addEventListener('keydown', function (event) {
      var options = enabledOptions();
      var active = document.activeElement;
      var position = Math.max(0, options.indexOf(active));
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Home' ||
        event.key === 'End'
      ) {
        event.preventDefault();
        var next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? options.length - 1
              : (position + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        focusOption(options[next]);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose(active);
      } else if (event.key === 'Tab') {
        closeMenu(false);
      } else if (event.key.length === 1 && /\S/.test(event.key)) {
        var query = event.key.toLocaleLowerCase(locale());
        var match = options.find(function (item) {
          return item.textContent.trim().toLocaleLowerCase(locale()).startsWith(query);
        });
        if (match) {
          event.preventDefault();
          focusOption(match);
        }
      }
    });
    select.addEventListener('change', update);
    window.addEventListener('color-grade:localechange', rebuildOptions);
    window.addEventListener('landscape:languagechange', rebuildOptions);
    select.addEventListener('customselect:state', syncDisabled);
    select.addEventListener('customselect:refresh', rebuildOptions);
    wrapper.append(trigger, menu);
    select.parentNode.insertBefore(wrapper, select.nextSibling);
    rebuildOptions();
  }

  document.addEventListener('click', function (event) {
    document.querySelectorAll('.select-ui.open').forEach(function (wrapper) {
      if (!wrapper.contains(event.target)) wrapper.classList.remove('open');
    });
  });
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('select').forEach(enhance);
  });
})();
