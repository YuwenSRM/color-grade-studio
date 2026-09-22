LandscapeTheme.init();
const $ = (id) => document.getElementById(id);
const roleName = { guest: '游客', user: '普通用户', admin: '管理员' };
const { escapeHtml, sourceName, categoryName } = LandscapeUI;
let editingUser = null;

function formatDate(date) {
  return LandscapeI18n.formatDate(date);
}

function renderBars(id, items) {
  const max = Math.max(1, ...items.map((item) => item.count));
  const statusName = { pending: '待审核', approved: '已通过', rejected: '已驳回' };
  $(id).innerHTML = items.length
    ? items
        .map(
          (item) => `
                  <div class="bar-row">
                    <span>${escapeHtml(categoryName(sourceName(item.name)) || statusName[item.status])}</span>
                    <div class="bar-track"><div class="bar" style="width:${(item.count / max) * 100}%"></div></div>
                    <b>${item.count}</b>
                  </div>`
        )
        .join('')
    : '<div class="notice">暂无数据</div>';
}

function renderUsers(users) {
  $('userRows').innerHTML = users
    .map(
      (user) => `
              <tr>
                <td><b translate="no">${escapeHtml(user.username)}</b></td>
                <td>${roleName[user.role] || user.role}</td>
                <td data-i18n-date="${escapeHtml(user.createdAt)}">${formatDate(user.createdAt)}</td>
                <td data-i18n-date="${escapeHtml(user.updatedAt)}">${formatDate(user.updatedAt)}</td>
                <td>
                  <button class="action" data-edit="${user.id}">编辑</button>
                  <button class="action" data-delete="${user.id}" data-name="${escapeHtml(user.username)}">删除</button>
                </td>
              </tr>`
    )
    .join('');

  document.querySelectorAll('[data-edit]').forEach((button) => {
    button.onclick = () => openUser(users.find((user) => user.id === button.dataset.edit));
  });
  document.querySelectorAll('[data-delete]').forEach((button) => {
    button.onclick = async () => {
      if (!confirm(`确认删除账号「${button.dataset.name}」吗？`)) return;
      try {
        await LandscapeApi.deleteAdminUser(button.dataset.delete);
        await loadUsers();
      } catch (error) {
        alert(error.message);
      }
    };
  });
}

function openUser(user) {
  editingUser = user || null;
  $('userDialogTitle').textContent = user ? '编辑账号' : '新增账号';
  $('userName').value = user ? user.username : '';
  $('userName').disabled = Boolean(user);
  $('userRole').value = user?.role || 'user';
  // The shared select component listens to change events to refresh its visible label.
  $('userRole').dispatchEvent(new Event('change'));
  $('userPassword').value = '';
  $('userHint').textContent = user
    ? '可更改角色；密码留空则不修改。'
    : '密码将使用 scrypt 加盐哈希后保存，无法在后台查看原文。';
  $('userDialog').classList.add('show');
  (user ? $('userRole') : $('userName')).focus();
}

function closeUser() {
  $('userDialog').classList.remove('show');
  editingUser = null;
}

async function loadUsers() {
  renderUsers((await LandscapeApi.adminUsers()).users);
}

async function loadDashboard() {
  const stats = await LandscapeApi.adminStats();
  $('total').textContent = stats.total;
  $('storage').textContent = `网页入库 ${stats.storedCount} · 文件夹 ${stats.folderCount}`;
  $('pending').textContent = stats.pending;
  $('approved').textContent = stats.approved;
  $('rejected').textContent = `已驳回 ${stats.rejected}`;
  $('quality').textContent = stats.averageQuality ?? '—';
  $('reviewed').textContent = `已评分 ${stats.reviewedCount} · 近 7 天新增 ${stats.recent}`;
  renderBars('categories', stats.categories);
  renderBars('sources', stats.sources);
  renderBars('statuses', stats.statuses);
  await loadUsers();
}

$('newUser').onclick = () => openUser();
$('userCancel').onclick = closeUser;
$('userDialog').onclick = (event) => {
  if (event.target === $('userDialog')) closeUser();
};
$('userSave').onclick = async () => {
  const username = $('userName').value.trim();
  const password = $('userPassword').value;
  const role = $('userRole').value;
  if (!editingUser && !username) return alert('请输入账号。');
  if ((!editingUser || password) && password.length < 8) return alert('密码至少需要 8 位字符。');

  try {
    if (editingUser) {
      await LandscapeApi.updateAdminUser(editingUser.id, {
        role,
        ...(password ? { password } : {}),
      });
    } else {
      await LandscapeApi.createAdminUser({ username, password, role });
    }
    closeUser();
    await loadUsers();
  } catch (error) {
    alert(error.message);
  }
};
$('logout').onclick = async () => {
  await LandscapeApi.adminLogout();
  location.replace('login.html');
};

window.load = loadDashboard;
loadDashboard().catch((error) => {
  if (error.status === 401 || error.status === 403) location.replace('login.html');
  else alert(error.message);
});
