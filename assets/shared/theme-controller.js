(function () {
  'use strict';
  var STORAGE_KEY = 'landscape-theme';
  function setTheme(theme) {
    var isDark = theme === 'dark';
    document.body.classList.toggle('dark', isDark);
    document.documentElement.classList.toggle('dark', isDark);
    var day = document.getElementById('dayTheme');
    var night = document.getElementById('nightTheme');
    if (day) day.classList.toggle('active', !isDark);
    if (night) night.classList.toggle('active', isDark);
    try {
      localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light');
    } catch (_) {}
  }
  function init() {
    var saved = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch (_) {}
    setTheme(saved === 'dark' ? 'dark' : 'light');
    var day = document.getElementById('dayTheme');
    var night = document.getElementById('nightTheme');
    if (day)
      day.addEventListener('click', function () {
        setTheme('light');
      });
    if (night)
      night.addEventListener('click', function () {
        setTheme('dark');
      });
  }
  window.LandscapeTheme = { init: init, setTheme: setTheme };
})();
