LandscapeTheme.init();
const { escapeHtml, categoryName, regionName } = LandscapeUI;
let images = [],
  active = '全部',
  uploaded = 0,
  stats = null,
  currentSession = null;
const el = (id) => document.getElementById(id);
function renderFilters() {
  const totals = images.reduce(
    (all, item) => {
      all[item.cat] = (all[item.cat] || 0) + 1;
      return all;
    },
    { 全部: images.length }
  );
  if (!totals[active]) active = '全部';
  el('filters').innerHTML = Object.entries(totals)
    .map(
      ([name, num]) =>
        `<button class="filter ${name === active ? 'active' : ''}" data-cat="${name}"><span>${name}</span><span class="count">${num}</span></button>`
    )
    .join('');
  document.querySelectorAll('.filter').forEach(
    (b) =>
      (b.onclick = () => {
        active = b.dataset.cat;
        renderFilters();
        renderGallery();
      })
  );
}
let previewTrigger = null,
  previewItems = [],
  previewIndex = -1,
  previousBodyOverflow = '',
  previewZoomLevel = 1,
  previewBaseSize = null,
  previewPan = null;

const minPreviewZoom = 1;
const maxPreviewZoom = 3;
const previewZoomStep = 0.2;

function previewIsOpen() {
  return el('imagePreview').classList.contains('show');
}

function clampPreviewZoom(value) {
  return Math.min(maxPreviewZoom, Math.max(minPreviewZoom, Math.round(value * 100) / 100));
}

function getPreviewZoomAnchor(point) {
  const stage = el('previewStage');
  const imageBox = el('previewImage').getBoundingClientRect();
  const stageBox = stage.getBoundingClientRect();
  const stageStyle = getComputedStyle(stage);
  if (!imageBox.width || !imageBox.height) return null;
  const clientX = point?.clientX ?? stageBox.left + stageBox.width / 2;
  const clientY = point?.clientY ?? stageBox.top + stageBox.height / 2;
  return {
    x: Math.min(1, Math.max(0, (clientX - imageBox.left) / imageBox.width)),
    y: Math.min(1, Math.max(0, (clientY - imageBox.top) / imageBox.height)),
    viewportX:
      clientX - stageBox.left - stage.clientLeft - Number.parseFloat(stageStyle.paddingLeft || '0'),
    viewportY:
      clientY - stageBox.top - stage.clientTop - Number.parseFloat(stageStyle.paddingTop || '0'),
  };
}

function setPreviewZoom(value, point) {
  const preview = el('imagePreview');
  const image = el('previewImage');
  const stage = el('previewStage');
  const nextZoom = clampPreviewZoom(value);
  const anchor = getPreviewZoomAnchor(point);
  previewZoomLevel = nextZoom;

  if (nextZoom <= minPreviewZoom) {
    preview.classList.remove('zoomed');
    image.style.removeProperty('width');
    image.style.removeProperty('height');
    stage.scrollTo({ top: 0, left: 0 });
  } else {
    if (!previewBaseSize) {
      const size = image.getBoundingClientRect();
      previewBaseSize = { width: size.width, height: size.height };
    }
    if (!previewBaseSize.width || !previewBaseSize.height) return;
    preview.classList.add('zoomed');
    image.style.width = `${Math.round(previewBaseSize.width * nextZoom)}px`;
    image.style.height = `${Math.round(previewBaseSize.height * nextZoom)}px`;
    if (anchor) {
      requestAnimationFrame(() => {
        stage.scrollTo({
          left: Math.max(0, previewBaseSize.width * nextZoom * anchor.x - anchor.viewportX),
          top: Math.max(0, previewBaseSize.height * nextZoom * anchor.y - anchor.viewportY),
        });
      });
    }
  }

  const zoomed = nextZoom > minPreviewZoom;
  const label = zoomed ? '还原图片' : '放大图片';
  el('previewZoom').textContent = zoomed ? '−' : '+';
  el('previewZoom').setAttribute('aria-label', label);
  el('previewZoom').title = label;
}

function updatePreview() {
  const item = previewItems[previewIndex];
  if (!item) {
    closePreview();
    return;
  }
  previewBaseSize = null;
  setPreviewZoom(minPreviewZoom);
  el('previewImage').src = item.img;
  el('previewImage').alt = item.title;
  el('previewTitle').textContent = item.title;
  el('previewDescription').textContent = item.description || '';
  el('previewDescription').hidden = !item.description;
  el('previewDetails').textContent =
    `${item.cat} · ${item.id} · ${item.quality == null ? '待审核' : '质量 ' + item.quality}`;
  const hasMultiple = previewItems.length > 1;
  el('previewCount').textContent = `${previewIndex + 1} / ${previewItems.length}`;
  el('previewGalleryNav').hidden = !hasMultiple;
  el('previewPrevious').disabled = !hasMultiple;
  el('previewNext').disabled = !hasMultiple;
}

function openPreview(item, trigger, list = [item]) {
  previewItems = list.length ? list : [item];
  previewIndex = previewItems.indexOf(item);
  if (previewIndex < 0) previewIndex = 0;
  previewTrigger = trigger;
  previousBodyOverflow = document.body.style.overflow;
  updatePreview();
  el('imagePreview').classList.add('show');
  el('imagePreview').setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  el('previewClose').focus();
}

function closePreview() {
  const preview = el('imagePreview');
  if (!preview.classList.contains('show')) return;
  preview.classList.remove('show', 'zoomed');
  preview.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = previousBodyOverflow;
  if (previewTrigger) previewTrigger.focus();
  previewTrigger = null;
  previewItems = [];
  previewIndex = -1;
  previewZoomLevel = minPreviewZoom;
  previewBaseSize = null;
  previewPan = null;
}

function movePreview(direction) {
  if (previewItems.length < 2) return;
  previewIndex = (previewIndex + direction + previewItems.length) % previewItems.length;
  updatePreview();
}

function keepPreviewFocus(event) {
  if (!previewIsOpen() || event.key !== 'Tab') return;
  const controls = [...el('imagePreview').querySelectorAll('button:not(:disabled)')];
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function zoomPreviewFromWheel(event) {
  if (!previewIsOpen()) return;
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  const delta = Math.min(0.5, Math.max(previewZoomStep, Math.abs(event.deltaY) / 500));
  setPreviewZoom(previewZoomLevel + direction * delta, event);
}

function togglePreviewZoom(point) {
  setPreviewZoom(previewZoomLevel > minPreviewZoom ? minPreviewZoom : 1.5, point);
}

function beginPreviewPan(event) {
  if (
    !previewIsOpen() ||
    previewZoomLevel <= minPreviewZoom ||
    event.button !== 0 ||
    event.target.closest('button')
  )
    return;
  const stage = el('previewStage');
  previewPan = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    left: stage.scrollLeft,
    top: stage.scrollTop,
  };
  stage.setPointerCapture(event.pointerId);
  stage.classList.add('is-panning');
  event.preventDefault();
}

function movePreviewPan(event) {
  if (!previewPan || event.pointerId !== previewPan.pointerId) return;
  const stage = el('previewStage');
  stage.scrollLeft = previewPan.left - (event.clientX - previewPan.x);
  stage.scrollTop = previewPan.top - (event.clientY - previewPan.y);
}

function endPreviewPan(event) {
  if (!previewPan || event.pointerId !== previewPan.pointerId) return;
  const stage = el('previewStage');
  if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  stage.classList.remove('is-panning');
  previewPan = null;
}
function renderGallery() {
  const list = (active === '全部' ? images : images.filter((x) => x.cat === active)).sort((a, b) =>
    el('sort').selectedIndex
      ? (b.created || 0) - (a.created || 0)
      : (b.quality || 0) - (a.quality || 0)
  );
  el('resultText').textContent =
    `显示 ${list.length} 张${active === '全部' ? '' : '「' + active + '」'}图片`;
  el('gallery').innerHTML = list.length
    ? list
        .map(
          (x, index) =>
            `<article class="card">
              <button class="thumb" data-preview-index="${index}" type="button"
                aria-label="查看图片大图">
                <img src="${escapeHtml(x.img)}" alt="${escapeHtml(x.title)}" translate="no">
                <span class="tag">${escapeHtml(x.cat)}</span>
                <span class="quality">${x.quality == null ? '待审核' : '质量 ' + x.quality}</span>
              </button>
              <div class="info">
                <div class="title">
                  <span translate="no">${escapeHtml(x.title)}</span>
                  <span class="id">${escapeHtml(x.id)}</span>
                </div>
                ${x.description ? `<p class="image-description" translate="no">${escapeHtml(x.description)}</p>` : ''}
                <div class="meta">${x.tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('')}</div>
                <div class="review">
                  <i class="dot" style="background:${x.reviewStatus === 'approved' ? '#2c9566' : x.reviewStatus === 'rejected' ? '#cc4b5f' : '#e0a33d'}"></i>
                  ${x.reviewStatus === 'approved' ? '已通过审核' : x.reviewStatus === 'rejected' ? '审核未通过' : '待人工审核'}
                </div>
              </div>
            </article>`
        )
        .join('')
    : '<div class="empty">该分类下暂时没有图片</div>';
  document
    .querySelectorAll('.thumb[data-preview-index]')
    .forEach(
      (button) =>
        (button.onclick = () =>
          openPreview(list[Number(button.dataset.previewIndex)], button, list))
    );
}
function classify(file) {
  const name = file.name.toLowerCase();
  const guess =
    name.includes('sea') || name.includes('beach')
      ? '海岸'
      : name.includes('mount') || name.includes('山')
        ? '山地'
        : name.includes('forest') || name.includes('树')
          ? '森林'
          : name.includes('lake') || name.includes('湖')
            ? '湖泊'
            : '城市风景';
  return {
    title: file.name.replace(/\.[^.]+$/, ''),
    cat: guess,
    tags: [guess, 'AI 初步标签', '待确认'],
    quality: Math.floor(82 + Math.random() * 15),
    id: 'UP-' + String(Date.now()).slice(-6),
    img: URL.createObjectURL(file),
    created: Date.now(),
  };
}
function showToast(message) {
  const toast = el('toast');
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
  const toast = el('toast');
  if (toast.classList.contains('show') && toast.dataset.toastSource)
    toast.textContent = window.LandscapeI18n.t(toast.dataset.toastSource);
});
function storedImage(item) {
  const approved = item.reviewStatus === 'approved';
  return {
    title: approved && item.title ? item.title : item.filename.replace(/\.[^.]+$/, ''),
    description: approved ? item.description || '' : '',
    cat: categoryName(item.category || '未分类'),
    tags: [
      categoryName(item.category || '未分类'),
      regionName(item.region || '本地图库'),
      item.source === 'color-grade'
        ? '调色成片'
        : item.source === 'folder-import'
          ? '本地导入'
          : '网页入库',
    ],
    quality: item.qualityScore,
    id: item.id.slice(0, 8).toUpperCase(),
    img: item.url,
    created: new Date(item.createdAt).getTime(),
    reviewStatus: item.reviewStatus || 'pending',
  };
}
function renderStats() {
  if (!stats) return;
  el('total').textContent = stats.total;
  el('storageSummary').textContent = `网页入库 ${stats.storedCount} · 文件夹 ${stats.folderCount}`;
  el('categoryCount').textContent = stats.categories.length;
  el('pending').textContent = stats.pending;
  el('pendingSide').textContent = stats.pending;
  el('approvedSide').textContent = stats.approved;
  el('quality').textContent = stats.averageQuality ?? '—';
  el('approvedSummary').textContent = `已审核 ${stats.reviewedCount} · 通过 ${stats.approved}`;
}
async function loadStoredImages() {
  const [storedResult, statsResult] = await Promise.allSettled([
    LandscapeApi.images(),
    LandscapeApi.stats(),
  ]);
  images = storedResult.status === 'fulfilled' ? storedResult.value.images.map(storedImage) : [];
  uploaded = images.length;
  stats = statsResult.status === 'fulfilled' ? statsResult.value : null;
  renderStats();
  renderFilters();
  renderGallery();
  if (storedResult.status === 'rejected') showToast('本地图片库暂不可用');
}
function renderAccount() {
  const slot = el('accountLinks');
  if (!currentSession?.authenticated) {
    slot.innerHTML =
      '<a href="login.html" style="color:var(--forest);font-weight:700;text-decoration:none">登录</a>';
    return;
  }
  const role = { guest: '游客', user: '普通用户', admin: '管理员' }[currentSession.role] || '用户';
  const adminLink =
    currentSession.role === 'admin'
      ? '&nbsp;&nbsp;·&nbsp;&nbsp;<a href="admin.html" style="color:var(--forest);font-weight:700;text-decoration:none">后台</a>'
      : '';
  slot.innerHTML = `<span>${role} · <span translate="no">${escapeHtml(currentSession.username)}</span></span>
    ${adminLink}&nbsp;&nbsp;·&nbsp;&nbsp;<button id="logoutLink" type="button"
    style="border:0;background:transparent;color:var(--forest);font:inherit;font-weight:700;cursor:pointer;padding:0">退出</button>`;
  el('logoutLink').onclick = async () => {
    await LandscapeApi.adminLogout();
    currentSession = null;
    renderAccount();
    showToast('已退出登录');
  };
}
function uploadMessage() {
  return !currentSession?.authenticated
    ? '请先登录普通用户账号后上传图片'
    : currentSession.role === 'guest'
      ? '游客仅可浏览，请登录普通用户账号后上传'
      : '当前账号没有上传权限';
}
el('uploadTrigger').onclick = (e) => {
  if (!currentSession?.authenticated || currentSession.role === 'guest') {
    e.preventDefault();
    showToast(uploadMessage());
  }
};
el('picker').onchange = async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  if (!currentSession?.authenticated || currentSession.role === 'guest') {
    showToast(uploadMessage());
    e.target.value = '';
    return;
  }
  const button = document.querySelector('.upload');
  button.style.pointerEvents = 'none';
  button.style.opacity = '.65';
  try {
    for (const file of files) {
      const guessed = classify(file);
      await LandscapeApi.uploadImage(file, {
        category: guessed.cat,
        source: 'real-landscape',
      });
    }
    active = '全部';
    await loadStoredImages();
    showToast(`已保存 ${files.length} 张图片到本地图库`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.style.pointerEvents = '';
    button.style.opacity = '';
    e.target.value = '';
  }
};
el('previewClose').onclick = closePreview;
el('previewPrevious').onclick = () => movePreview(-1);
el('previewNext').onclick = () => movePreview(1);
el('previewZoom').onclick = () => togglePreviewZoom();
el('previewImage').ondblclick = (event) => togglePreviewZoom(event);
el('previewStage').addEventListener('wheel', zoomPreviewFromWheel, { passive: false });
el('previewStage').addEventListener('pointerdown', beginPreviewPan);
el('previewStage').addEventListener('pointermove', movePreviewPan);
el('previewStage').addEventListener('pointerup', endPreviewPan);
el('previewStage').addEventListener('pointercancel', endPreviewPan);
el('imagePreview').onclick = (e) => {
  if (e.target === el('imagePreview')) closePreview();
};
document.addEventListener('keydown', (e) => {
  if (!previewIsOpen()) return;
  if (e.key === 'Escape') closePreview();
  if (e.key === 'ArrowLeft') movePreview(-1);
  if (e.key === 'ArrowRight') movePreview(1);
  if (e.key === '+' || e.key === '=') setPreviewZoom(previewZoomLevel + previewZoomStep);
  if (e.key === '-') setPreviewZoom(previewZoomLevel - previewZoomStep);
  keepPreviewFocus(e);
});
el('sort').onchange = renderGallery;
renderFilters();
renderGallery();
LandscapeApi.adminSession()
  .then((session) => {
    currentSession = session;
    renderAccount();
  })
  .catch(() => renderAccount());
loadStoredImages();
