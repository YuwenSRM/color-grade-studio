(function () {
  'use strict';
  var channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel('landscape-data-sync') : null;
  window.landscapeDataSync = channel;

  // The protected pages require the Node service for cookie-based sessions.
  // Opening an HTML file directly would otherwise surface the opaque fetch error.
  if (
    location.protocol === 'file:' &&
    window.LandscapeApi &&
    typeof window.LandscapeApi.adminLogin === 'function'
  ) {
    window.LandscapeApi.adminLogin = async function () {
      throw new Error(
        '请通过 http://127.0.0.1:4173/admin-login.html 打开登录页，不能直接打开本地 HTML 文件。'
      );
    };
  }

  function refreshCurrentPage() {
    if (document.hidden) return;
    if (
      location.pathname.endsWith('real-landscape.html') &&
      typeof window.loadStoredImages === 'function'
    )
      window.loadStoredImages().catch(console.error);
    if (
      (location.pathname.endsWith('admin.html') || location.pathname.endsWith('audit.html')) &&
      typeof window.load === 'function'
    )
      window.load().catch(console.error);
  }

  if (channel)
    channel.onmessage = function () {
      refreshCurrentPage();
    };

  if (window.LandscapeApi && typeof window.LandscapeApi.reviewImage === 'function') {
    var reviewImage = window.LandscapeApi.reviewImage;
    window.LandscapeApi.reviewImage = async function () {
      var result = await reviewImage.apply(this, arguments);
      if (channel) channel.postMessage({ type: 'review-updated' });
      return result;
    };
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refreshCurrentPage();
  });
  window.setInterval(refreshCurrentPage, 15000);
})();
