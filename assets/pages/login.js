LandscapeTheme.init();
const form = document.getElementById('login'),
  toast = document.getElementById('toast');
function showToast(message) {
  toast.dataset.toastSource = String(message);
  toast.textContent = window.LandscapeI18n?.t(message) || message;
  toast.classList.add('show');
  toast.setAttribute('aria-hidden', 'false');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.remove('show');
    toast.setAttribute('aria-hidden', 'true');
  }, 3200);
}
window.addEventListener('landscape:languagechange', () => {
  if (toast.classList.contains('show') && toast.dataset.toastSource)
    toast.textContent = window.LandscapeI18n.t(toast.dataset.toastSource);
});
function go(session) {
  const next = new URLSearchParams(location.search).get('next');
  const safeNext = next && /^[a-z0-9-]+\.html(?:\?[a-z0-9=&_-]*)?$/i.test(next) ? next : null;
  location.replace(session.role === 'admin' ? 'admin.html' : safeNext || 'real-landscape.html');
}
LandscapeApi.adminSession()
  .then((session) => {
    if (session.authenticated) go(session);
  })
  .catch((error) => showToast(error.message));
let busy = false;
function setBusy(value) {
  busy = value;
  form.querySelector('button').disabled = value;
  document.getElementById('guest').disabled = value;
  form.setAttribute('aria-busy', String(value));
}
form.onsubmit = async (event) => {
  event.preventDefault();
  if (busy) return;
  const username = document.getElementById('username');
  const password = document.getElementById('password');
  if (!username.value.trim()) {
    username.focus();
    return showToast('请输入账号。');
  }
  if (password.value.length < 8) {
    password.focus();
    return showToast('密码至少需要 8 位字符。');
  }
  setBusy(true);
  try {
    go(
      await LandscapeApi.adminLogin(
        document.getElementById('username').value.trim(),
        document.getElementById('password').value
      )
    );
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
};
document.getElementById('guest').onclick = async () => {
  if (busy) return;
  setBusy(true);
  try {
    go(await LandscapeApi.guestLogin());
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(false);
  }
};
