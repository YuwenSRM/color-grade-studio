LandscapeTheme.init();
const $ = (id) => document.getElementById(id);
const statusName = { pending: '待审核', approved: '已通过', rejected: '已驳回' };
let images = [];
let selected = null;

const { escapeHtml, sourceName, categoryName, regionName } = LandscapeUI;

function render() {
  const status = $('status').value;
  const query = $('query').value.trim().toLowerCase();
  const list = images.filter((image) => {
    const searchable = [
      image.filename,
      image.category,
      image.source,
      image.region,
      regionName(image.region),
      LandscapeI18n.t(regionName(image.region)),
      image.title,
      image.description,
      LandscapeI18n.t(categoryName(image.category)),
      LandscapeI18n.t(sourceName(image.source)),
    ]
      .join(' ')
      .toLowerCase();
    return (status === 'all' || image.reviewStatus === status) && searchable.includes(query);
  });

  $('title').textContent = `${statusName[status] || '全部'} · ${list.length} 张`;
  $('rows').innerHTML = list.length
    ? list
        .map(
          (image) => `
                  <tr>
                    <td><img class="thumb" src="${image.url}" alt="" /></td>
                    <td>
                      <b translate="no">${escapeHtml(image.title || image.filename)}</b><br />
                      <small>${escapeHtml(categoryName(image.category))}${image.region ? ' · ' + escapeHtml(regionName(image.region)) : ''}</small>
                      ${image.description ? `<p class="review-copy" translate="no">${escapeHtml(image.description)}</p>` : ''}
                    </td>
                    <td>${escapeHtml(sourceName(image.source))}</td>
                    <td><span class="status ${image.reviewStatus}">${statusName[image.reviewStatus]}</span></td>
                    <td>${image.qualityScore ?? '—'}</td>
                    <td><button class="action" data-id="${image.id}">审核</button></td>
                  </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="notice">当前没有匹配图片。</td></tr>';

  document.querySelectorAll('[data-id]').forEach((button) => {
    button.onclick = () => openReview(images.find((image) => image.id === button.dataset.id));
  });
}

function openReview(image) {
  selected = image;
  $('dialogTitle').textContent = image.title || image.filename;
  $('dialogDescription').textContent = image.description || '';
  $('dialogDescription').hidden = !image.description;
  $('dialogImage').src = image.url;
  $('reviewStatus').value = image.reviewStatus;
  // Synchronize the native value with the shared custom select UI.
  $('reviewStatus').dispatchEvent(new Event('change'));
  $('qualityScore').value = image.qualityScore ?? '';
  $('reviewNote').value = image.reviewNote || '';
  $('dialog').classList.add('show');
}

function closeReview() {
  $('dialog').classList.remove('show');
  selected = null;
}

async function loadImages() {
  const data = await LandscapeApi.adminImages();
  images = data.images;
  render();
}

$('status').onchange = render;
$('query').oninput = render;
$('cancel').onclick = closeReview;
$('dialog').onclick = (event) => {
  if (event.target === $('dialog')) closeReview();
};
$('save').onclick = async () => {
  if (!selected) return;
  try {
    await LandscapeApi.reviewImage(selected.id, {
      status: $('reviewStatus').value,
      qualityScore: $('qualityScore').value,
      note: $('reviewNote').value,
    });
    closeReview();
    await loadImages();
  } catch (error) {
    alert(error.message);
  }
};
$('logout').onclick = async () => {
  await LandscapeApi.adminLogout();
  location.replace('login.html');
};

window.load = loadImages;
loadImages().catch((error) => {
  if (error.status === 401 || error.status === 403) location.replace('login.html');
  else alert(error.message);
});
