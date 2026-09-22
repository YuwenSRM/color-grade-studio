(function (root) {
  'use strict';
  if (root.ColorGradeAppMode?.mode !== 'full') return;
  const workbench = root.ColorGradeWorkbench;
  if (!workbench) throw new Error('Color-grade workbench must load before full integrations.');
  const { $, createExportBlob, getSource, main, showEditorToast } = workbench;
  let colorSession = null;
  let uploadReturnFocus = null;

  function updateColorAccount(session) {
    colorSession = session;
    const loggedIn = Boolean(session?.authenticated);
    $('colorAccountText').innerHTML = loggedIn
      ? `<span>${{ guest: '游客', user: '普通用户', admin: '管理员' }[session.role] || '用户'} · </span><span translate="no">${LandscapeUI.escapeHtml(session.username)}</span>`
      : '未登录';
    $('colorLogin').textContent = loggedIn ? '切换账号' : '登录后上传成片';
    $('colorLogin').href = 'login.html?next=color-grade.html';
  }

  LandscapeApi.adminSession()
    .then(updateColorAccount)
    .catch(() => updateColorAccount(null));

  const uploadModal = $('uploadModal');
  function closeUploadModal() {
    uploadModal.hidden = true;
    document.body.classList.remove('modal-open');
    const trigger = uploadReturnFocus;
    uploadReturnFocus = null;
    trigger?.focus?.();
  }
  function openUploadModal(trigger = document.activeElement) {
    if (!getSource() || !main.width) return;
    const title =
      $('publishTitle').value.trim() || $('fileName').textContent.replace(/\.[^.]+$/, '');
    $('uploadTitle').value = title;
    $('uploadDescription').value = $('publishDescription').value.trim();
    uploadReturnFocus = trigger instanceof HTMLElement ? trigger : null;
    uploadModal.hidden = false;
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => $('uploadTitle').focus());
  }
  document
    .querySelectorAll('[data-upload-close]')
    .forEach((node) => (node.onclick = closeUploadModal));
  $('cancelUpload').onclick = closeUploadModal;
  document.addEventListener('keydown', (event) => {
    if (uploadModal.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeUploadModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = Array.from(
      uploadModal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled])'
      )
    );
    const first = focusables[0],
      last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  $('uploadToLibrary').onclick = async (event) => {
    if (!getSource() || !main.width) return;
    const session = colorSession || (await LandscapeApi.adminSession());
    if (!session.authenticated) {
      showEditorToast('cg.error.generic');
      setTimeout(() => (location.href = 'login.html?next=color-grade.html'), 700);
      return;
    }
    if (session.role === 'guest') return showEditorToast('cg.error.generic');
    openUploadModal(event.currentTarget);
  };
  $('confirmUpload').onclick = async () => {
    if (!getSource() || !main.width) return;
    const title = $('uploadTitle').value.trim();
    if (!title) {
      showEditorToast('cg.error.generic');
      $('uploadTitle').focus();
      return;
    }
    $('publishTitle').value = title;
    $('publishDescription').value = $('uploadDescription').value.trim();
    const session = colorSession || (await LandscapeApi.adminSession());
    if (!session.authenticated) {
      closeUploadModal();
      return showEditorToast('cg.error.generic');
    }
    if (session.role === 'guest') {
      closeUploadModal();
      return showEditorToast('cg.error.generic');
    }
    const button = $('uploadToLibrary');
    const confirmButton = $('confirmUpload');
    button.disabled = true;
    confirmButton.disabled = true;
    confirmButton.textContent = '正在上传...';
    try {
      const exported = await createExportBlob('high');
      const file = new File(
        [exported.blob],
        `${$('previewName').textContent || 'landscape'}-graded.${exported.extension}`,
        { type: exported.mime }
      );
      await LandscapeApi.uploadImage(file, {
        title,
        description: $('uploadDescription').value.trim(),
        category: 'color-graded',
        region: $('filterRegion').value,
        preset: $('previewName').textContent,
        source: 'color-grade',
      });
      $('status').textContent = '已同步到真实景观库';
      button.textContent = '已上传';
      confirmButton.textContent = '已上传';
      closeUploadModal();
    } catch (error) {
      $('status').textContent = ColorGradeI18n.t('cg.error.generic');
      button.disabled = false;
      button.textContent = '上传入库';
      confirmButton.disabled = false;
      confirmButton.textContent = '确认上传';
    }
  };
})(window);
