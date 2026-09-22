function drawLutProfile(
  canvas,
  variant,
  manual = false,
  limit = 1100,
  frameOverride = null,
  settings = null,
  priority = 'preview',
  signal = undefined
) {
  if (!source) return Promise.resolve(false);
  const revision = canvas === main ? invalidatePreviewContent() : contentRevision;
  const renderSettings = settings || (manual ? currentRenderSettings(variant.p) : undefined);
  const priorityValue = priority === 'export' ? 3 : priority === 'preview' ? 2 : 1;
  return enqueueP1LutRender({
    variant,
    limit,
    frameOverride,
    settings: renderSettings,
    intensity: filterIntensity,
    priority,
    priorityValue,
    signal,
  }).then((pixels) => {
    throwIfAborted(signal);
    if (canvas === main && revision !== contentRevision) return false;
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const context = canvas.getContext('2d');
    const output = context.createImageData(pixels.width, pixels.height);
    output.data.set(new Uint8ClampedArray(pixels.buffer));
    context.putImageData(output, 0, 0);
    if (canvas === main) refreshComparisonSource(limit, frameOverride);
    return true;
  });
}
function resetThumbnails() {
  thumbnailGeneration += 1;
  thumbnailQueue = [];
  thumbnailPending = null;
  thumbnailInput = null;
  clearTimeout(thumbnailTimer);
  clearTimeout(thumbnailTimeout);
  thumbnailTimer = null;
  thumbnailObserver?.disconnect();
  thumbnailObserver = null;
  $('variants').setAttribute('aria-busy', 'false');
}
function queueThumbnail(variant) {
  if (
    !source ||
    importing ||
    variant.thumbnailReady ||
    thumbnailPending?.variant === variant ||
    thumbnailQueue.includes(variant)
  )
    return;
  thumbnailQueue.push(variant);
  scheduleThumbnail();
}
function scheduleThumbnail() {
  if (!source || thumbnailTimer !== null || thumbnailPending || importing) return;
  // Yield to the first main-preview paint and to input between fallback jobs.
  thumbnailTimer = setTimeout(() => {
    thumbnailTimer = null;
    runThumbnail();
  }, 16);
}
function finishThumbnail(job, pixels) {
  if (job !== thumbnailPending || job.generation !== thumbnailGeneration) return;
  clearTimeout(thumbnailTimeout);
  thumbnailPending = null;
  if (job.version === job.variant.version) {
    const variant = job.variant;
    variant.canvas.width = pixels.width;
    variant.canvas.height = pixels.height;
    const context = variant.canvas.getContext('2d');
    const output = context.createImageData(pixels.width, pixels.height);
    output.data.set(new Uint8ClampedArray(pixels.buffer));
    context.putImageData(output, 0, 0);
    variant.thumbnailReady = true;
    variant.canvas.closest('.variant')?.classList.remove('is-pending');
  } else {
    queueThumbnail(job.variant);
  }
  $('variants').setAttribute('aria-busy', String(thumbnailQueue.length > 0));
  if (thumbnailQueue.length) scheduleThumbnail();
}
function fallbackThumbnail(job) {
  if (job !== thumbnailPending || job.generation !== thumbnailGeneration) return;
  if (job.variant.kind === 'lut') {
    finishThumbnailError(job, new Error('LUT 缩略图需要浏览器 Worker 支持。'));
    return;
  }
  const data = new Uint8ClampedArray(thumbnailInput.data);
  ColorGradeRenderer.applyPixels(data, job.variant.p, job.variant.appliedSettings || undefined);
  finishThumbnail(job, {
    width: thumbnailInput.width,
    height: thumbnailInput.height,
    buffer: data.buffer,
  });
}
function finishThumbnailError(job, error) {
  if (job !== thumbnailPending || job.generation !== thumbnailGeneration) return;
  clearTimeout(thumbnailTimeout);
  thumbnailPending = null;
  job.variant.canvas.closest('.variant')?.classList.remove('is-pending');
  job.variant.canvas.closest('.variant')?.classList.add('thumbnail-unavailable');
  $('variants').setAttribute('aria-busy', String(thumbnailQueue.length > 0));
  if (job.priority === 'preview') showEditorToast(errorKey(error, 'cg.error.workerFailed'));
  if (thumbnailQueue.length) scheduleThumbnail();
}
function disableThumbnailWorker() {
  thumbnailWorkerFailed = true;
  thumbnailWorker?.terminate();
  thumbnailWorker = null;
  clearTimeout(thumbnailTimeout);
  // A worker can fail to load even when the API is present (CSP, unsupported browser).
  const job = thumbnailPending;
  if (job) setTimeout(() => fallbackThumbnail(job), 0);
}
function getThumbnailWorker() {
  if (thumbnailWorkerFailed || typeof Worker === 'undefined') return null;
  if (thumbnailWorker) return thumbnailWorker;
  try {
    thumbnailWorker = new Worker('assets/pages/color-grade-worker.js');
    thumbnailWorkerGeneration = -1;
    thumbnailWorker.onmessage = ({ data }) => {
      const job = thumbnailPending;
      if (!job || data.generation !== job.generation || data.id !== job.id) return;
      if (data.type === 'rendered') finishThumbnail(job, data);
      else if (data.type === 'error') disableThumbnailWorker();
    };
    thumbnailWorker.onerror = (event) => {
      event.preventDefault();
      disableThumbnailWorker();
    };
    thumbnailWorker.onmessageerror = disableThumbnailWorker;
  } catch (_) {
    disableThumbnailWorker();
  }
  return thumbnailWorker;
}
function runThumbnail() {
  if (!source) {
    thumbnailQueue = [];
    $('variants').setAttribute('aria-busy', 'false');
    return;
  }
  if (importing || thumbnailPending) return;
  let variant;
  while (thumbnailQueue.length) {
    const next = thumbnailQueue.shift();
    if (!next.thumbnailReady && variants.includes(next) && matchesFilter(next)) {
      variant = next;
      break;
    }
  }
  if (!variant) {
    $('variants').setAttribute('aria-busy', 'false');
    return;
  }
  $('variants').setAttribute('aria-busy', 'true');
  if (!thumbnailInput) thumbnailInput = getSourcePixels(thumbnailLimit);
  const job = {
    variant,
    generation: thumbnailGeneration,
    version: variant.version,
    id: variant.id,
  };
  thumbnailPending = job;
  if (variant.kind === 'lut') {
    enqueueP1LutRender({
      variant,
      limit: thumbnailLimit,
      frameOverride: null,
      settings: variant.appliedSettings || undefined,
      // Library cards are fixed 100% style samples for meaningful comparison.
      intensity: 1,
      priority: 'thumbnail',
      priorityValue: 1,
    })
      .then((pixels) => finishThumbnail(job, pixels))
      .catch((error) => finishThumbnailError(job, error));
    return;
  }
  const worker = getThumbnailWorker();
  if (!worker) {
    fallbackThumbnail(job);
    return;
  }
  try {
    if (thumbnailWorkerGeneration !== thumbnailGeneration) {
      const buffer = new Uint8ClampedArray(thumbnailInput.data).buffer;
      worker.postMessage(
        {
          type: 'init',
          generation: thumbnailGeneration,
          width: thumbnailInput.width,
          height: thumbnailInput.height,
          buffer,
        },
        [buffer]
      );
      thumbnailWorkerGeneration = thumbnailGeneration;
    }
    worker.postMessage({
      type: 'render',
      generation: job.generation,
      id: job.id,
      profile: variant.p,
      settings: variant.appliedSettings || undefined,
    });
    thumbnailTimeout = setTimeout(disableThumbnailWorker, 5000);
  } catch (_) {
    disableThumbnailWorker();
  }
}
function makeVariantCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  return canvas;
}
function makeUserVariant(filter, previous = null) {
  return {
    ...filter,
    id: `user-${filter.id}`,
    userFilterId: filter.id,
    source: 'user',
    region: '',
    regionLabel: '',
    cameras: [],
    simulation: '',
    p: filter.kind === 'parameters' ? filter.parameters : { b: 1, c: 1, s: 1, w: 1, t: 0 },
    canvas: previous?.canvas || makeVariantCanvas(),
    version: previous?.version || 0,
    thumbnailReady: Boolean(previous?.thumbnailReady),
    appliedSettings: previous?.appliedSettings || null,
    manualState: previous?.manualState || null,
  };
}
function makeP2BuiltinVariant(filter, previous = null) {
  return {
    ...filter,
    region: '',
    regionLabel: '',
    simulation: '',
    p: { b: 1, c: 1, s: 1, w: 1, t: 0 },
    canvas: previous?.canvas || makeVariantCanvas(),
    version: previous?.version || 0,
    thumbnailReady: Boolean(previous?.thumbnailReady),
    appliedSettings: previous?.appliedSettings || null,
    manualState: previous?.manualState || null,
  };
}
function makeVariants(preparedPreview = null, { preserveSelection = false } = {}) {
  const previousId = variants[selected]?.id;
  const previousVariants = new Map(variants.map((variant) => [variant.id, variant]));
  resetThumbnails();
  if (!preserveSelection) {
    variants.forEach((variant) => {
      variant.canvas.width = variant.canvas.height = 1;
    });
  }
  const builtins = presetCatalog.map((preset) => {
    const previous = preserveSelection ? previousVariants.get(preset.id) : null;
    const catalog = window.ColorGradeBuiltinCatalog?.forPreset(preset);
    return {
      ...preset,
      catalog,
      p: preset.parameters,
      kind: 'parameters',
      isUser: false,
      canvas: previous?.canvas || makeVariantCanvas(),
      version: previous?.version || 0,
      thumbnailReady: Boolean(previous?.thumbnailReady),
      appliedSettings: previous?.appliedSettings || null,
      manualState: previous?.manualState || null,
    };
  });
  const p2Builtins = (window.LandscapeP2BuiltinFilters || []).map((filter) => {
    const variant = makeP2BuiltinVariant(
      filter,
      preserveSelection ? previousVariants.get(filter.id) : null
    );
    return { ...variant, catalog: window.ColorGradeBuiltinCatalog?.forLut(filter) };
  });
  variants = builtins
    .concat(p2Builtins)
    .concat(
      userFilters.map((filter) =>
        makeUserVariant(
          filter,
          preserveSelection ? previousVariants.get(`user-${filter.id}`) : null
        )
      )
    );
  selected = Math.max(
    0,
    variants.findIndex((variant) => variant.id === previousId)
  );
  if (!variants.length) selected = 0;
  if (!preserveSelection) neutralBaseActive = false;
  applied = preserveSelection && !neutralBaseActive && Boolean(variants[selected]?.appliedSettings);
  const current = variants[selected];
  // A metadata edit can make the active user filter unassigned. Do not leave its
  // previous pixels silently applied after that transition.
  if (current && !isApplicableVariant(current)) {
    neutralBaseActive = true;
    applied = false;
  }
  if (source && current) {
    if (preserveSelection && current.id === previousId && current.manualState)
      restoreVariantControls(current);
    else syncControlsForProfile(neutralBaseActive ? neutralProfile : current.p);
    showSelected(current.kind === 'lut' || neutralBaseActive ? null : preparedPreview);
  }
  renderSceneFilterOptions();
  renderVariants();
  $('variantHint').textContent = source ? t('cg.static.livePreview') : t('cg.static.filtersLocal');
  updateHaldAction({ resetInfo: true });
}
function isVariantFavorite(variant) {
  return variant.source === 'user' ? Boolean(variant.favorite) : fujiFavorites.has(variant.id);
}
function variantSmallText(variant, index) {
  if (variant.source === 'user') {
    const format = variant.kind === 'lut' ? t('cg.dynamic.card.lut') : t('cg.dynamic.card.profile');
    const availability =
      variant.compatibilityStatus === 'applicable'
        ? t('cg.dynamic.card.applicable')
        : t('cg.dynamic.card.unavailable');
    return `${format} · ${availability}${variant.scenes.length ? ` · ${variant.scenes.join(' / ')}` : ''}`;
  }
  if (variant.source === 'p2-builtin')
    return `${t('cg.dynamic.card.builtIn')} · ${t('cg.dynamic.card.lut')} · sRGB SDR${variant.scenes.length ? ` · ${variant.scenes.join(' / ')}` : ''}`;
  return variant.source === 'film'
    ? `${variant.learningStudy ? `${variant.brand} · ${t('cg.dynamic.card.profile')}` : simulationLabels[variant.simulation] || variant.simulation} · ${variant.scenes.join(' / ')}`
    : `${regionLabelSource(variant.region)} · ${index === selected && applied ? t('cg.dynamic.card.appliedAdjustments') : t('cg.static.livePreview')}`;
}
function renderPagination(total) {
  const pages = Math.max(1, Math.ceil(total / variantsPerPage));
  if (variantPage > pages) variantPage = pages;
  const navigation = $('filterPagination');
  navigation.hidden = total <= variantsPerPage;
  $('previousVariantPage').disabled = variantPage <= 1;
  $('nextVariantPage').disabled = variantPage >= pages;
  setLocalizedText($('variantPageStatus'), 'cg.dynamic.card.page', {
    current: variantPage,
    total: pages,
  });
}
function renderVariants() {
  thumbnailObserver?.disconnect();
  if (!thumbnailObserver && typeof IntersectionObserver !== 'undefined') {
    thumbnailObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && source) queueThumbnail(entry.target.variant);
        });
      },
      { rootMargin: '240px' }
    );
  }
  $('variants').replaceChildren();
  const matches = variants.filter(matchesFilter);
  renderPagination(matches.length);
  const start = (variantPage - 1) * variantsPerPage;
  const visible = matches.slice(start, start + variantsPerPage);
  const fragment = document.createDocumentFragment();
  visible.forEach((variant) => {
    const index = variants.indexOf(variant);
    const card = document.createElement('article');
    card.className = `variant ${index === selected && !neutralBaseActive ? 'selected ' : ''}${source ? (variant.thumbnailReady ? '' : 'is-pending') : 'no-preview'}${variant.compatibilityStatus && variant.compatibilityStatus !== 'applicable' ? ' incompatible' : ''}`;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute(
      'aria-label',
      `${variant.name}, ${variantSmallText(variant, index)}${
        index === selected && !neutralBaseActive ? t('cg.dynamic.card.selected') : ''
      }`
    );
    card.setAttribute('aria-pressed', String(index === selected && !neutralBaseActive));
    card.variant = variant;
    const pill = document.createElement('span');
    pill.className = 'pill';
    setLocalizedText(pill, 'cg.dynamic.card.current');
    card.append(pill);
    if (variant.source === 'user' || variant.source === 'p2-builtin') {
      const kind = document.createElement('span');
      kind.className = 'filter-kind';
      setLocalizedText(
        kind,
        variant.source === 'user' ? 'cg.dynamic.card.myLut' : 'cg.dynamic.card.builtIn'
      );
      card.append(kind);
    }
    if (source) card.append(variant.canvas);
    const title = document.createElement('strong');
    title.setAttribute('translate', 'no');
    title.textContent =
      variant.source === 'user'
        ? variant.name
        : t(
            variant.catalog?.labelKey || 'cg.catalog.builtin.name',
            variant.catalog?.labelVariables || { name: variant.name }
          );
    const small = document.createElement('small');
    const smallText = variantSmallText(variant, index);
    small.textContent =
      variant.source === 'user'
        ? smallText
        : variant.catalog?.descriptionVariables?.description
          ? t(variant.catalog.descriptionKey, variant.catalog.descriptionVariables)
          : smallText;
    card.append(title, small);
    if (index === selected && !neutralBaseActive && isApplicableFilterIntensitySelection()) {
      const intensity = document.createElement('span');
      intensity.className = 'applied-filter-intensity';
      const label = document.createElement('span');
      setLocalizedText(label, 'cg.static.filterStrength');
      const value = document.createElement('span');
      value.className = 'applied-filter-intensity-value';
      value.textContent = `${Math.round(filterIntensity * 100)}%`;
      intensity.append(label, ' ', value);
      card.append(intensity);
    }
    const favorite = document.createElement('button');
    favorite.type = 'button';
    favorite.className = 'favorite-button';
    favorite.textContent = isVariantFavorite(variant) ? '★' : '☆';
    setLocalizedAttribute(
      favorite,
      'title',
      isVariantFavorite(variant) ? 'cg.dynamic.card.unfavorite' : 'cg.dynamic.card.favorite'
    );
    setLocalizedAttribute(
      favorite,
      'aria-label',
      isVariantFavorite(variant) ? 'cg.dynamic.card.unfavorite' : 'cg.dynamic.card.favorite'
    );
    favorite.onclick = (event) => {
      event.stopPropagation();
      toggleFavorite(variant);
    };
    card.append(favorite);
    if (variant.source === 'user') {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'filter-edit-button';
      edit.textContent = '⋯';
      setLocalizedAttribute(edit, 'title', 'cg.dynamic.card.edit');
      setLocalizedAttribute(edit, 'aria-label', 'cg.dynamic.card.edit');
      edit.onclick = (event) => {
        event.stopPropagation();
        openFilterEdit(variant.userFilterId);
      };
      card.append(edit);
    }
    const selectVariant = () => {
      if (importing || !isApplicableVariant(variant)) {
        if (!isApplicableVariant(variant)) showEditorToast('cg.error.haldInvalid');
        return;
      }
      if (intentSession) endIntentSession({ keepPreview: true });
      selected = index;
      neutralBaseActive = false;
      if (isApplicableFilterIntensitySelection()) {
        filterIntensity = filterIntensityById.get(variant.id) ?? 1;
        requestedIntensity = filterIntensity;
        presentedIntensity = filterIntensity;
        $('filterIntensityInput').value = String(Math.round(filterIntensity * 100));
        updateFilterIntensity();
      }
      applied = Boolean(variant.appliedSettings);
      basePreset = variant;
      workingAdjustments = { ...variant.p };
      lastApplied = null;
      isDirty = false;
      if (source) restoreVariantControls(variant);
      renderVariants();
      updateHaldAction({ resetInfo: true });
      if (source) showSelected();
    };
    card.onclick = selectVariant;
    card.onkeydown = (event) => {
      if (event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      selectVariant();
    };
    fragment.append(card);
    if (source) {
      if (thumbnailObserver) thumbnailObserver.observe(card);
      else queueThumbnail(variant);
    }
  });
  $('variants').append(fragment);
  $('filterEmpty').hidden = matches.length > 0;
  syncFilterIntensityUi();
  updateHaldAction({ resetInfo: true });
}
function matchesFilter(variant) {
  const haystack =
    `${variant.name} ${variant.brand || ''} ${variant.author || ''} ${variant.simulation} ${variant.region} ${variant.regionLabel || ''} ${regionSearchText(variant.region)} ${(variant.scenes || []).join(' ')}`.toLowerCase();
  const intentLooks = intentResultState?.looks || [];
  const intentMatches =
    !intentLooks.length ||
    intentLooks.some(
      (look) =>
        (look === 'look.tokyo-night' && variant.region === 'tokyo') ||
        (look === 'look.warm-film' && /warm|film|暖|胶片/i.test(haystack)) ||
        (look === 'look.teal-orange' && /teal|orange|青|橙/i.test(haystack))
    );
  return (
    intentMatches &&
    (!filterState.search ||
      intentLooks.length ||
      haystack.includes(filterState.search.toLowerCase())) &&
    (filterState.source === 'all' ||
      (filterState.source === 'user' ? variant.source === 'user' : variant.source !== 'user')) &&
    (filterState.region === 'all' || variant.region === filterState.region) &&
    (filterState.camera === 'all' || variant.cameras.includes(filterState.camera)) &&
    (filterState.scene === 'all' || variant.scenes.includes(filterState.scene)) &&
    (!filterState.favorites || isVariantFavorite(variant))
  );
}
function syncFilterOptionLabels(select, fallbackSource) {
  if (!select) return;
  Array.from(select.options).forEach((option) => {
    const source = option.dataset.i18nSource || fallbackSource(option);
    option.dataset.i18nSource = source;
    option.textContent = localizedSource(source);
  });
  select.dispatchEvent(new Event('customselect:refresh'));
}
function syncRegionFilterLabels() {
  syncFilterOptionLabels($('filterRegion'), (option) =>
    option.value === 'all' ? 'cg.static.allRegions' : regionLabelSource(option.value)
  );
}
function syncCameraFilterLabels() {
  syncFilterOptionLabels($('filterCamera'), (option) =>
    option.value === 'all' ? 'cg.dynamic.filter.allCameras' : option.value
  );
}
function syncSceneFilterLabels() {
  syncFilterOptionLabels($('filterScene'), (option) =>
    option.value === 'all' ? 'cg.dynamic.filter.allScenes' : option.value
  );
}
function renderRegionFilterOptions() {
  const select = $('filterRegion');
  if (!select) return;
  const selectedValue = select.value;
  while (select.options.length > 1) select.remove(1);
  const first = select.options[0] || document.createElement('option');
  first.value = 'all';
  first.dataset.i18nSource = 'cg.static.allRegions';
  first.textContent = t(first.dataset.i18nSource);
  if (!first.parentNode) select.append(first);
  Object.keys(regionConfig).forEach((region) => {
    const option = document.createElement('option');
    option.value = region;
    option.dataset.i18nSource = regionLabelSource(region);
    option.textContent = option.dataset.i18nSource;
    select.append(option);
  });
  select.value = Array.from(select.options).some((option) => option.value === selectedValue)
    ? selectedValue
    : 'all';
  syncRegionFilterLabels();
}
renderRegionFilterOptions();

function renderCameraFilterOptions() {
  const select = $('filterCamera');
  if (!select) return;
  const selectedValue = select.value;
  const cameras = [...new Set(presetCatalog.flatMap((preset) => preset.cameras || []))];
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.dataset.i18nSource = 'cg.dynamic.filter.allCameras';
  allOption.textContent = localizedSource(allOption.dataset.i18nSource);
  select.replaceChildren(allOption);
  cameras.forEach((camera) => {
    const option = document.createElement('option');
    option.value = camera;
    option.dataset.i18nSource = camera;
    option.textContent = localizedSource(camera);
    select.append(option);
  });
  select.value = cameras.includes(selectedValue) ? selectedValue : 'all';
  syncCameraFilterLabels();
}
renderCameraFilterOptions();

function getAvailableSceneOptions() {
  const region = $('filterRegion').value;
  const camera = $('filterCamera').value;
  const sourceFilter = $('filterSource').value;
  return [
    ...new Set(
      variants
        .filter(
          (variant) =>
            (sourceFilter === 'all' ||
              (sourceFilter === 'user' ? variant.source === 'user' : variant.source !== 'user')) &&
            (region === 'all' || variant.region === region) &&
            (camera === 'all' || variant.cameras.includes(camera))
        )
        .flatMap((variant) => variant.scenes || [])
    ),
  ];
}

function renderSceneFilterOptions() {
  const select = $('filterScene');
  const selectedValue = select.value;
  const scenes = getAvailableSceneOptions();
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.dataset.i18nSource = 'cg.dynamic.filter.allScenes';
  allOption.textContent = localizedSource(allOption.dataset.i18nSource);
  select.replaceChildren(allOption);
  scenes.forEach((scene) => {
    const option = document.createElement('option');
    option.value = scene;
    option.dataset.i18nSource = scene;
    option.textContent = localizedSource(scene);
    select.append(option);
  });
  select.value = scenes.includes(selectedValue) ? selectedValue : 'all';
  select.dispatchEvent(new Event('customselect:refresh'));
}
renderSceneFilterOptions();

function syncRegionFilterControl() {
  const region = $('filterRegion');
  region.dispatchEvent(new Event('change', { bubbles: true }));
  region.dispatchEvent(new Event('customselect:state'));
}

function syncRegionForCameraFilter({ reset = false } = {}) {
  const region = $('filterRegion');
  const cameraIsFiltered = $('filterCamera').value !== 'all';

  if (reset) {
    regionBeforeCameraFilter = 'all';
    cameraFilterActive = false;
    region.value = 'all';
    region.disabled = false;
  } else if (cameraIsFiltered) {
    if (!cameraFilterActive) regionBeforeCameraFilter = region.value;
    region.value = 'all';
    region.disabled = true;
    cameraFilterActive = true;
  } else {
    region.disabled = false;
    if (cameraFilterActive) region.value = regionBeforeCameraFilter;
    cameraFilterActive = false;
  }

  syncRegionFilterControl();
}

function syncFilterStateFromControls() {
  filterState.search = $('filterSearch').value.trim();
  filterState.source = $('filterSource').value;
  filterState.camera = $('filterCamera').value;
  filterState.region = $('filterRegion').value;
  filterState.scene = $('filterScene').value;
  filterState.favorites = $('filterFavorites').checked;
}

function renderIntentResult() {
  const result = intentResultState;
  const panel = $('intentResult');
  const chips = $('intentChips');
  const suggestion = $('intentSuggestion');
  if (!panel || !chips || !suggestion) return;
  panel.hidden = !result || (!result.chips.length && !result.unsupported && !result.looks.length);
  chips.replaceChildren();
  (result?.chips || []).forEach((chip) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'intent-chip';
    item.dataset.intentField = chip.field;
    item.textContent = `${t(`cg.field.${chip.field}`)} ${chip.value > 0 ? '+' : ''}${chip.value}`;
    item.setAttribute('aria-label', item.textContent);
    item.onclick = () => {
      delete result.intentPatch[chip.field];
      result.chips = result.chips.filter((candidate) => candidate.field !== chip.field);
      result.executable = result.chips.length > 0;
      renderIntentResult();
    };
    chips.append(item);
  });
  suggestion.textContent = result?.unsupported
    ? t('cg.static.intentUnsupported')
    : result?.suggestions?.length
      ? t('cg.static.intentSuggestion')
      : '';
  $('previewIntent').disabled = !result?.executable;
  $('clearIntent').disabled = !result && !intentSession;
}

function updateIntentFromSearch() {
  const parser = window.ColorGradeIntent;
  intentResultState = parser ? parser.parse($('filterSearch').value, adjustments) : null;
  renderIntentResult();
}

function endIntentSession({ keepPreview = false } = {}) {
  if (!intentSession) return;
  intentSession = null;
  if (!keepPreview) scheduleInteractivePreview({ highQuality: true });
  renderIntentResult();
}

function clearIntent({ restore = true, clearSearch = true } = {}) {
  if (restore && intentSession) {
    const snapshot = intentSession.adjustments;
    intentSession = null;
    commitAdjustments(snapshot, { highQuality: true, intent: true });
  }
  if (clearSearch) {
    $('filterSearch').value = '';
    intentResultState = null;
    syncFilterStateFromControls();
    applyFilters();
  }
  renderIntentResult();
}

function previewIntent() {
  const result = intentResultState;
  if (!result?.executable || !source || importing) {
    if (!source) showEditorToast();
    return;
  }
  if (!intentSession) intentSession = { adjustments: { ...adjustments } };
  commitAdjustments(result.intentPatch, { highQuality: true, intent: true });
  renderIntentResult();
}

// 浏览器可能在刷新后恢复原生 select 的旧值；以统一筛选状态为准，避免出现
// 下拉显示“全部”但列表仍被上次滤镜筛选隐藏的情况。
function normalizeFilterState() {
  ['filterSource', 'filterRegion', 'filterCamera', 'filterScene'].forEach((id) => {
    $(id).value = 'all';
  });
  $('filterSearch').value = '';
  $('filterFavorites').checked = false;
  variantPage = 1;
  syncRegionForCameraFilter({ reset: true });
  renderSceneFilterOptions();
  syncFilterStateFromControls();
  ['filterSource', 'filterRegion', 'filterCamera', 'filterScene'].forEach((id) =>
    $(id).dispatchEvent(new Event('change', { bubbles: true }))
  );
}
normalizeFilterState();
// custom-select 组件可能在 DOMContentLoaded 后恢复旧值，再做一次延迟归一化。
window.addEventListener('load', normalizeFilterState, { once: true });
['filterSearch', 'filterFavorites', 'filterSource'].forEach((id) => {
  $(id).addEventListener(id === 'filterSearch' ? 'input' : 'change', () => {
    if (id === 'filterSearch') updateIntentFromSearch();
    if (id === 'filterSource') renderSceneFilterOptions();
    syncFilterStateFromControls();
    applyFilters();
  });
});
$('previewIntent').onclick = previewIntent;
$('clearIntent').onclick = () => clearIntent();
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !intentSession) return;
  event.preventDefault();
  clearIntent();
});
$('filterRegion').addEventListener('change', () => {
  renderSceneFilterOptions();
  syncFilterStateFromControls();
  applyFilters();
});
$('filterScene').addEventListener('change', () => {
  syncFilterStateFromControls();
  applyFilters();
});
$('filterCamera').addEventListener('change', () => {
  syncRegionForCameraFilter();
  renderSceneFilterOptions();
  syncFilterStateFromControls();
  applyFilters();
});
$('clearFilters').onclick = normalizeFilterState;
async function toggleFavorite(variant) {
  if (variant.source === 'user') {
    try {
      await lutLibrary?.update(variant.userFilterId, { favorite: !variant.favorite });
      await loadUserFilters();
    } catch (error) {
      showEditorToast(errorKey(error, 'cg.error.libraryUnavailable'));
    }
    return;
  }
  fujiFavorites.has(variant.id) ? fujiFavorites.delete(variant.id) : fujiFavorites.add(variant.id);
  try {
    localStorage.setItem(favoriteStorageKey, JSON.stringify([...fujiFavorites]));
  } catch (_) {}
  renderVariants();
}
function applyFilters({ resetPage = true } = {}) {
  // 筛选只改变列表展示，保留当前预设、手动调整和已应用效果。
  if (resetPage) variantPage = 1;
  renderVariants();
}
$('previousVariantPage').onclick = () => {
  if (variantPage > 1) {
    variantPage -= 1;
    applyFilters({ resetPage: false });
  }
};
$('nextVariantPage').onclick = () => {
  const count = variants.filter(matchesFilter).length;
  if (variantPage * variantsPerPage < count) {
    variantPage += 1;
    applyFilters({ resetPage: false });
  }
};
function setLibraryStatus(message) {
  const key = String(message).startsWith('cg.') ? message : null;
  if (key) setLocalizedText($('libraryStatus'), key);
  else $('libraryStatus').textContent = message;
}
async function loadUserFilters() {
  if (!lutLibrary) return;
  const activeId = variants[selected]?.id;
  const editorState =
    source && activeId
      ? {
          id: activeId,
          adjustments: { ...adjustments },
          wheels: Object.fromEntries(
            ['shadowColor', 'midColor', 'highColor', 'shadowAmt', 'midAmt', 'highAmt'].map((id) => [
              id,
              $(id).value,
            ])
          ),
        }
      : null;
  userFilters = await lutLibrary.list();
  makeVariants(null, { preserveSelection: true });
  if (editorState && variants[selected]?.id === editorState.id) {
    Object.entries(editorState.adjustments).forEach(([key, value]) => setManualValue(key, value));
    Object.entries(editorState.wheels).forEach(([id, value]) => {
      $(id).value = value;
    });
    syncAllPalettes();
    updateAllRangeFills();
    previewManual();
  }
  if (userFilters.length)
    setLocalizedText($('libraryStatus'), 'cg.status.savedFilters', { count: userFilters.length });
  else setLocalizedText($('libraryStatus'), 'cg.static.filtersLocal');
}
async function initializeLutLibrary() {
  if (!window.LandscapeLutLibrary) {
    setLibraryStatus('cg.error.libraryUnavailable');
    return;
  }
  try {
    lutLibrary = new LandscapeLutLibrary.LutLibrary({
      lutValidator: validateImportedLutInWorker,
      parameterValidator: validateImportedParametersInWorker,
    });
    await loadUserFilters();
  } catch (error) {
    setLibraryStatus('cg.error.libraryUnavailable');
    showEditorToast(errorKey(error, 'cg.error.libraryUnavailable'));
    [
      'importFilters',
      'backupFilters',
      'restoreFilters',
      'filterImportInput',
      'filterRestoreInput',
    ].forEach((id) => {
      $(id).disabled = true;
    });
    // The persistent user library is unavailable, but built-in presets and editing
    // remain usable in browsers where IndexedDB has been disabled by policy.
    makeVariants();
  }
}
function updateFilterIntensity() {
  filterIntensity = clampFilterIntensity(Number($('filterIntensityInput').value) / 100);
  requestedIntensity = filterIntensity;
  const variant = variants[selected];
  if (isApplicableFilterIntensitySelection()) filterIntensityById.set(variant.id, filterIntensity);
  $('filterIntensityValue').value = `${Math.round(filterIntensity * 100)}%`;
  $('filterIntensityValue').textContent = `${Math.round(filterIntensity * 100)}%`;
  $('filterIntensityInput').setAttribute(
    'aria-valuenow',
    String(Math.round(filterIntensity * 100))
  );
  setLocalizedAttribute(
    $('filterIntensityInput'),
    'aria-valuetext',
    'cg.a11yDynamic.adjustmentValue',
    {
      label: t('cg.static.filterStrength'),
      value: `${Math.round(filterIntensity * 100)}%`,
    }
  );
  updateRangeFill($('filterIntensityInput'));
  document.querySelectorAll('.applied-filter-intensity-value').forEach((value) => {
    value.textContent = `${Math.round(filterIntensity * 100)}%`;
  });
}
$('filterIntensityInput').addEventListener('input', () => {
  updateFilterIntensity();
  if (source && isApplicableFilterIntensitySelection())
    scheduleInteractivePreview({ intensityOnly: true });
});
$('filterIntensityInput').addEventListener('change', () => {
  if (source && isApplicableFilterIntensitySelection()) {
    scheduleInteractivePreview({ intensityOnly: true, highQuality: true, mutation: false });
  }
});
$('filterIntensityInput').addEventListener('pointerup', () => {
  if (source && isApplicableFilterIntensitySelection()) {
    scheduleInteractivePreview({ intensityOnly: true, highQuality: true, mutation: false });
  }
});
updateFilterIntensity();
syncFilterIntensityUi();
const libraryMenu = $('libraryMenu');
const libraryMenuToggle = $('libraryMenuToggle');
const positionLibraryMenu = () => {
  if (libraryMenu.hidden) return;
  const toggleRect = libraryMenuToggle.getBoundingClientRect();
  const menuRect = libraryMenu.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const inset = 12;
  const left = Math.max(
    inset,
    Math.min(toggleRect.right - menuRect.width, viewportWidth - menuRect.width - inset)
  );
  const top = Math.max(
    inset,
    Math.min(toggleRect.bottom + 6, viewportHeight - menuRect.height - inset)
  );
  libraryMenu.style.left = `${left}px`;
  libraryMenu.style.top = `${top}px`;
};
libraryMenuToggle.addEventListener('click', () => {
  const menu = libraryMenu;
  const opening = menu.hidden;
  menu.hidden = !opening;
  libraryMenuToggle.setAttribute('aria-expanded', String(opening));
  if (opening) {
    menu.classList.add('is-viewport-anchored');
    positionLibraryMenu();
    menu.querySelector('button:not(:disabled), select:not(:disabled)')?.focus();
  }
});
window.addEventListener('resize', positionLibraryMenu);
document.addEventListener('click', (event) => {
  const wrap = document.querySelector('.library-menu-wrap');
  if (!wrap || wrap.contains(event.target) || libraryMenu.contains(event.target)) return;
  libraryMenu.hidden = true;
  libraryMenuToggle.setAttribute('aria-expanded', 'false');
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || libraryMenu.hidden) return;
  libraryMenu.hidden = true;
  libraryMenuToggle.setAttribute('aria-expanded', 'false');
  libraryMenuToggle.focus();
});
$('importFilters').onclick = () => {
  if (!lutLibrary) {
    showEditorToast('cg.error.libraryUnavailable');
    return;
  }
  $('filterImportInput').click();
};
$('filterImportInput').onchange = async (event) => {
  let files = Array.from(event.target.files || []);
  event.target.value = '';
  if (!files.length || !lutLibrary) return;
  const threeDlFiles = files.filter((file) => /\.3dl$/i.test(file.name || ''));
  if (threeDlFiles.length) {
    const diagnostics = await Promise.all(
      threeDlFiles.map((file) => window.ColorGrade3dl?.detectFile?.(file) || Promise.resolve(null))
    );
    const recognized = diagnostics.filter((result) => result?.status === 'detected-unsupported');
    setLocalizedText(
      $('libraryStatus'),
      recognized.length ? 'cg.dynamic.threedl.detected' : 'cg.dynamic.threedl.skipped',
      { count: recognized.length || threeDlFiles.length }
    );
    showEditorToast('cg.dynamic.threedl.toast');
    files = files.filter((file) => !/\.3dl$/i.test(file.name || ''));
    if (!files.length) return;
  }
  setLocalizedText($('libraryStatus'), 'cg.status.importingFilters', { count: files.length });
  const results = await lutLibrary.importFiles(
    files,
    {},
    {
      onResult(result) {
        const status =
          result.status === 'imported'
            ? t('cg.static.importFilters')
            : result.status === 'duplicate'
              ? t('cg.static.unknown')
              : t('cg.static.cancel');
        setLocalizedText($('libraryStatus'), 'cg.status.importItem', {
          status,
          name: result.file?.name || '',
        });
      },
    }
  );
  await loadUserFilters();
  $('filterSource').value = 'user';
  $('filterSource').dispatchEvent(new Event('customselect:refresh'));
  renderSceneFilterOptions();
  syncFilterStateFromControls();
  applyFilters();
  const succeeded = results.filter((result) => result.status === 'imported').length;
  const duplicates = results.filter((result) => result.status === 'duplicate').length;
  const rejectedResults = results.filter((result) => result.status === 'rejected');
  const rejected = rejectedResults.length;
  setLocalizedText($('libraryStatus'), 'cg.status.importSummary', {
    success: succeeded,
    duplicate: duplicates,
    rejected,
  });
};
$('backupFilters').onclick = async () => {
  if (!lutLibrary) return;
  try {
    const blob = await lutLibrary.exportBackup();
    downloadBlob(
      blob,
      `real-landscape-filter-library-${new Date().toISOString().slice(0, 10)}.zip`
    );
    setLocalizedText($('libraryStatus'), 'cg.status.backedUpFilters', {
      count: userFilters.length,
    });
  } catch (error) {
    showEditorToast(errorKey(error, 'cg.error.libraryUnavailable'));
  }
};
$('restoreFilters').onclick = () => $('filterRestoreInput').click();
$('filterRestoreInput').onchange = async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !lutLibrary) return;
  const mode = $('restoreMode').value;
  if (mode === 'replace' && !window.confirm(t('cg.confirm.restoreValidate'))) return;
  try {
    setLocalizedText($('libraryStatus'), 'cg.status.validatingBackup');
    const preview = await lutLibrary.previewRestore(file, { mode });
    if (
      mode === 'replace' &&
      !window.confirm(
        t('cg.confirm.restoreReplace', { replaced: preview.replaced, imported: preview.imported })
      )
    ) {
      setLocalizedText($('libraryStatus'), 'cg.status.restoreCancelled');
      return;
    }
    const result = await lutLibrary.restoreBackup(file, { mode });
    await loadUserFilters();
    setLocalizedText($('libraryStatus'), 'cg.status.restoreComplete', result);
  } catch (error) {
    showEditorToast(errorKey(error, 'cg.error.restoreFailed'));
    setLocalizedText($('libraryStatus'), 'cg.error.restoreFailed');
  }
};
function closeFilterModal() {
  deleteFilterPending = false;
  $('filterDeleteConfirmation').hidden = true;
  setLocalizedText($('deleteFilter'), 'cg.static.delete');
  $('deleteFilter').classList.remove('danger');
  editingUserFilterId = null;
  $('filterModal').hidden = true;
  document.body.classList.remove('modal-open');
  const returnFocus = filterModalReturnFocus;
  filterModalReturnFocus = null;
  returnFocus?.focus?.();
}
function openFilterEdit(id, trigger = document.activeElement) {
  const filter = userFilters.find((item) => item.id === id);
  if (!filter) return;
  filterModalReturnFocus = trigger instanceof HTMLElement ? trigger : null;
  deleteFilterPending = false;
  $('filterDeleteConfirmation').hidden = true;
  setLocalizedText($('deleteFilter'), 'cg.static.delete');
  $('deleteFilter').classList.remove('danger');
  editingUserFilterId = id;
  $('filterEditName').value = filter.name;
  $('filterEditBrand').value = filter.brand || '';
  $('filterEditAuthor').value = filter.author || '';
  $('filterEditSource').value = filter.sourceUrl || '';
  $('filterEditScenes').value = (filter.scenes || []).join(', ');
  $('filterEditInputSpace').value = filter.inputColorSpace || '';
  $('filterEditOutputSpace').value = filter.outputColorSpace || '';
  $('filterEditLicense').value = filter.licenseNote || '';
  $('filterModal').hidden = false;
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => $('filterEditName').focus());
}
document.querySelectorAll('[data-filter-modal-close]').forEach((node) => {
  node.onclick = closeFilterModal;
});
$('cancelFilterEdit').onclick = closeFilterModal;
function getFilterModalFocusables() {
  return Array.from(
    $('filterModal').querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    )
  ).filter((element) => !element.closest('[hidden]'));
}
document.addEventListener('keydown', (event) => {
  if ($('filterModal').hidden) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeFilterModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusables = getFilterModalFocusables();
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
$('saveFilterEdit').onclick = async () => {
  if (!editingUserFilterId || !lutLibrary) return;
  const scenes = $('filterEditScenes')
    .value.split(/[,，]/)
    .map((scene) => scene.trim())
    .filter(Boolean);
  try {
    await lutLibrary.update(editingUserFilterId, {
      name: $('filterEditName').value,
      brand: $('filterEditBrand').value,
      author: $('filterEditAuthor').value,
      sourceUrl: $('filterEditSource').value,
      licenseNote: $('filterEditLicense').value,
      scenes,
      inputColorSpace: $('filterEditInputSpace').value,
      outputColorSpace: $('filterEditOutputSpace').value,
    });
    closeFilterModal();
    await loadUserFilters();
  } catch (error) {
    showEditorToast(errorKey(error, 'cg.error.libraryUnavailable'));
  }
};
$('deleteFilter').onclick = async () => {
  if (!editingUserFilterId || !lutLibrary) return;
  const active = variants[selected]?.userFilterId === editingUserFilterId;
  const filter = userFilters.find((item) => item.id === editingUserFilterId);
  const wording = active
    ? t('cg.confirm.deleteActiveFilter')
    : t('cg.confirm.deleteFilter', { name: filter?.name || t('cg.dynamic.delete.fallbackName') });
  if (!deleteFilterPending) {
    deleteFilterPending = true;
    setLocalizedText($('filterDeleteMessage'), 'cg.dynamic.delete.repeat', { message: wording });
    $('filterDeleteConfirmation').hidden = false;
    setLocalizedText($('deleteFilter'), 'cg.dynamic.delete.confirm');
    $('deleteFilter').classList.add('danger');
    $('deleteFilter').focus();
    return;
  }
  try {
    const manualState = active
      ? {
          adjustments: { ...adjustments },
          wheels: Object.fromEntries(
            ['shadowColor', 'midColor', 'highColor', 'shadowAmt', 'midAmt', 'highAmt'].map((id) => [
              id,
              $(id).value,
            ])
          ),
        }
      : null;
    await lutLibrary.remove(editingUserFilterId);
    filterIntensityById.delete(`user-${editingUserFilterId}`);
    if (active) {
      selected = 0;
      neutralBaseActive = true;
      applied = false;
      basePreset = null;
      workingAdjustments = { ...neutralProfile };
      lastApplied = null;
      isDirty = false;
    }
    closeFilterModal();
    await loadUserFilters();
    if (active && source) {
      syncControlsForProfile(neutralProfile);
      Object.entries(manualState.adjustments).forEach(([key, value]) => setManualValue(key, value));
      Object.entries(manualState.wheels).forEach(([id, value]) => {
        $(id).value = value;
      });
      syncAllPalettes();
      updateAllRangeFills();
      renderVariants();
      showSelected();
    }
  } catch (error) {
    showEditorToast(errorKey(error, 'cg.error.libraryUnavailable'));
  }
};
$('cancelFilterDelete').onclick = () => {
  deleteFilterPending = false;
  $('filterDeleteConfirmation').hidden = true;
  setLocalizedText($('deleteFilter'), 'cg.static.delete');
  $('deleteFilter').classList.remove('danger');
  $('deleteFilter').focus();
};
initializeLutLibrary();
function restoreVariantControls(variant) {
  migrateVariantToneModel(variant);
  syncControlsForProfile(variant.p);
  if (variant.manualState) {
    Object.entries(variant.manualState.adjustments).forEach(([key, value]) =>
      setManualValue(key, value)
    );
    Object.entries(variant.manualState.wheels).forEach(([id, value]) => {
      if ($(id)) $(id).value = value;
    });
    if (variant.manualState.grading?.model === (ColorGradeRenderer.studioGradeModel || 'studio-v2'))
      gradingState = JSON.parse(JSON.stringify(variant.manualState.grading));
    else gradingState = defaultGradingState();
  } else {
    gradingState = defaultGradingState();
  }
  syncAllPalettes();
  syncGradeControls();
  updateAllRangeFills();
}
function saveAppliedVariant() {
  if (neutralBaseActive) return;
  Object.keys(studioGradeFields).forEach(syncGradeFromControl);
  gradingState.balance = clampNumber($('gradeBalance').value, -100, 100, gradingState.balance);
  const variant = variants[selected];
  variant.appliedSettings = currentRenderSettings(variant.p);
  variant.manualState = {
    toneModel: ColorGradeRenderer.standardToneModel || 'standard-v2',
    adjustments: { ...adjustments },
    wheels: Object.fromEntries(
      ['shadowColor', 'midColor', 'highColor', 'shadowAmt', 'midAmt', 'highAmt'].map((id) => [
        id,
        $(id).value,
      ])
    ),
    grading: gradeSnapshot(),
  };
  variant.version += 1;
  variant.thumbnailReady = false;
}
function showSelected(preparedPreview = null) {
  if (!variants.length) return;
  const v = variants[selected];
  if (preparedPreview) {
    invalidatePreviewContent();
    main.width = preparedPreview.width;
    main.height = preparedPreview.height;
    main.getContext('2d').drawImage(preparedPreview, 0, 0);
    previewHasContent = true;
    refreshComparisonSource();
  } else if (!neutralBaseActive) {
    startInteractiveEndpoint({ variant: v, settings: v.appliedSettings });
  } else {
    drawProfile(
      main,
      neutralBaseActive ? neutralProfile : v.p,
      neutralBaseActive,
      1100,
      null,
      neutralBaseActive ? null : v.appliedSettings,
      neutralBaseActive ? 1 : filterIntensity
    );
  }
  fitMainCanvas();
  requestAnimationFrame(drawCustomCropBox);
  if (neutralBaseActive) setLocalizedText($('previewName'), 'cg.dynamic.preview.neutral');
  else {
    $('previewName').setAttribute('translate', 'no');
    $('previewName').textContent = v.name;
  }
  setLocalizedText($('previewMeta'), 'cg.status.localProcessing', {
    width: main.width,
    height: main.height,
  });
  $('download').disabled = importing;
  $('downloadSpec').disabled = importing;
  $('downloadSpec').dispatchEvent(new Event('customselect:state'));
  $('uploadToLibrary').disabled = importing;
}
function previewManual(limit = 1100) {
  if (importing || !source || !variants.length) return;
  const variant = variants[selected];
  if (neutralBaseActive) {
    drawProfile(main, neutralProfile, true, limit);
    fitMainCanvas();
  } else {
    // Interactive filters always establish S560/F560.  Their strength is mixed
    // later in a rAF instead of rerunning the filter algorithm per input event.
    startInteractiveEndpoint({ variant, manual: true });
    if (limit > interactivePreviewLimit) scheduleHighQualityEndpoint({ variant, manual: true });
  }
  setLocalizedText($('previewName'), 'cg.dynamic.preview.adjusting', {
    name: neutralBaseActive ? t('cg.dynamic.preview.neutral') : variants[selected].name,
  });
  setLocalizedText($('previewMeta'), 'cg.status.livePreview');
}
function schedulePreview(lowLatency = false) {
  if (importing) return;
  // The mutation has happened before this rAF runs. Invalidate now so a late
  // Worker completion cannot briefly repaint the previous crop or adjustment.
  invalidatePreviewContent();
  previewLimit = lowLatency ? interactivePreviewLimit : highQualityPreviewLimit;
  if (previewQueued) return;
  previewQueued = true;
  const request = importRequest;
  requestAnimationFrame(() => {
    previewQueued = false;
    if (request !== importRequest || importing) return;
    previewManual(previewLimit);
  });
}
function resetManual() {
  if (!variants.length) return;
  if (intentSession) endIntentSession({ keepPreview: true });
  syncControlsForProfile(neutralBaseActive ? neutralProfile : variants[selected].p);
  gradingState = defaultGradingState();
  syncGradeControls();
  scheduleInteractivePreview({ highQuality: true });
}
$('apply').onclick = () => {
  if (importing || !source) return;
  saveAppliedVariant();
  applied = !neutralBaseActive;
  renderVariants();
  showSelected();
  setLocalizedText($('previewMeta'), 'cg.dynamic.preview.applied');
};
$('reset').onclick = resetManual;
renderBasic();
setEditingEnabled(false);
bindGradeControls();
bindComparisonControls();
$('previewAspect').onchange = updatePreviewFrame;
updatePreviewFrame();

function selectedHaldVariant() {
  const variant = variants[selected];
  return variant?.kind === 'lut' ? variant : null;
}
function haldEligibilityMessage(variant) {
  if (!variant) return t('cg.dynamic.hald.noSelection');
  if (
    variant.inputColorSpace !== 'sRGB SDR' ||
    variant.outputColorSpace !== 'sRGB SDR' ||
    variant.compatibilityStatus !== 'applicable'
  )
    return t('cg.dynamic.hald.ineligible');
  return t('cg.dynamic.hald.eligible');
}
function updateHaldAction({ resetInfo = false } = {}) {
  const variant = selectedHaldVariant();
  const eligible = Boolean(
    variant &&
    variant.inputColorSpace === 'sRGB SDR' &&
    variant.outputColorSpace === 'sRGB SDR' &&
    variant.compatibilityStatus === 'applicable'
  );
  $('exportHald').disabled = !eligible || Boolean(haldController) || importing;
  $('cancelHald').hidden = !haldController;
  $('cancelHald').disabled = !haldController;
  if (resetInfo) {
    const key = !variant
      ? 'cg.static.haldInfo'
      : eligible
        ? 'cg.dynamic.hald.eligible'
        : 'cg.dynamic.hald.ineligible';
    setLocalizedText($('haldInfo'), key);
  }
}
function cancelHaldExport() {
  if (!haldController) return;
  haldController.abort();
  setLocalizedText($('haldInfo'), 'cg.status.exportCancelled');
}
$('exportHald').onclick = async () => {
  if (haldController) return;
  const variant = selectedHaldVariant();
  if (!variant) {
    updateHaldAction();
    return;
  }
  const controller = new AbortController();
  haldController = controller;
  updateHaldAction();
  setLocalizedText($('haldInfo'), 'cg.status.haldExporting', {
    level: ColorGradeHald.DEFAULT_LEVEL,
  });
  try {
    const { lut } = await getValidatedVariantLut(variant, { signal: controller.signal });
    throwIfAborted(controller.signal);
    const encoded = await ColorGradeHald.encodeHaldPngAsync(
      {
        lut,
        inputColorSpace: variant.inputColorSpace,
        outputColorSpace: variant.outputColorSpace,
        compatibilityStatus: variant.compatibilityStatus,
        sha256: lut.sha256,
      },
      { level: ColorGradeHald.DEFAULT_LEVEL, signal: controller.signal }
    );
    throwIfAborted(controller.signal);
    const filename = `${(variant.name || 'real-landscape-lut').replace(/[^a-z0-9\u4e00-\u9fff_-]+/gi, '-')}-hald-l8.png`;
    downloadBlob(new Blob([encoded.bytes], { type: 'image/png' }), filename);
    setLocalizedText($('haldInfo'), 'cg.status.haldExported', {
      level: ColorGradeHald.DEFAULT_LEVEL,
    });
  } catch (error) {
    if (error.name === 'AbortError' || error.code === 'operation-aborted')
      setLocalizedText($('haldInfo'), 'cg.status.exportCancelled');
    else {
      setLocalizedText($('haldInfo'), errorKey(error, 'cg.error.haldInvalid'));
      showEditorToast(errorKey(error, 'cg.error.haldInvalid'));
    }
  } finally {
    if (haldController === controller) {
      haldController = null;
      updateHaldAction();
    }
  }
};
$('cancelHald').onclick = cancelHaldExport;
