(function () {
  'use strict';
  async function request(url, options = {}, fallback = '服务器返回了无效响应，请重试。') {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: { Accept: 'application/json', ...options.headers },
      });
    } catch (_) {
      throw new Error('网络连接失败，请检查本地服务后重试。');
    }
    if (response.status === 204) return {};
    let body;
    try {
      body = await response.json();
    } catch (_) {
      const error = new Error(fallback + ' (HTTP ' + response.status + ')');
      error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(body.error || fallback);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function json(method, payload) {
    return {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    };
  }

  const userUrl = (id) => 'api/admin/users/' + encodeURIComponent(id);
  window.LandscapeApi = {
    health: () => request('/api/health'),
    catalog: () => request('/api/catalog', {}, '无法读取分类目录。'),
    images: () => request('api/images', {}, '本地图片库暂不可用'),
    importFolderImages: () => request('api/import-folder', {}, '无法读取导入文件夹。'),
    stats: () => request('api/stats', {}, '无法读取统计数据。'),
    adminSession: () => request('api/auth/session'),
    adminLogin: (username, password) =>
      request('api/auth/login', json('POST', { username, password }), '登录失败，请重试。'),
    guestLogin: () => request('api/auth/guest', { method: 'POST' }, '无法进入游客浏览模式'),
    adminLogout: () => request('api/auth/logout', { method: 'POST' }, '退出失败，请重试。'),
    adminImages: () => request('api/admin/images', {}, '无法读取后台数据。'),
    adminStats: () => request('api/admin/stats', {}, '无法读取后台数据。'),
    adminUsers: () => request('api/admin/users', {}, '无法读取账号数据。'),
    createAdminUser: (payload) =>
      request('api/admin/users', json('POST', payload), '无法创建账号。'),
    updateAdminUser: (id, payload) =>
      request(userUrl(id), json('PATCH', payload), '无法更新账号。'),
    deleteAdminUser: (id) => request(userUrl(id), { method: 'DELETE' }, '无法删除账号。'),
    reviewImage: (id, payload) =>
      request(
        'api/admin/images/' + encodeURIComponent(id) + '/review',
        json('PATCH', payload),
        '保存审核结果失败'
      ),
    providers: () => request('api/providers', {}, '无法读取图源状态。'),
    searchProvider: (provider, query) =>
      request(
        'api/provider-images?' + new URLSearchParams({ provider, query }),
        {},
        '图源搜索失败。'
      ),
    uploadImage(file, metadata) {
      const form = new FormData();
      form.append('image', file, file.name || 'landscape.png');
      Object.entries(metadata || {}).forEach(([key, value]) => form.append(key, value ?? ''));
      return request('api/images', { method: 'POST', body: form }, '上传失败，请重试。');
    },
  };
})();
