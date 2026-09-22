const workbench = document.querySelector('.workbench');
const canvasPanel = document.querySelector('.canvas-panel');
const adjustmentsPanel = $('adjustmentsPanel');
const lutLibraryPanel = $('lutLibrary');
// Preserve the library's live state while making it a workbench panel.
if (workbench && lutLibraryPanel && canvasPanel)
  workbench.insertBefore(lutLibraryPanel, canvasPanel);
const mobileWorkbench =
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 1099px)')
    : { matches: false };
const narrowWorkbench =
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 720px)')
    : { matches: false };
const narrowDetailsStorageKey = 'color-grade-adjustment-details-v1';
let workbenchHeightObserver = null;
let workbenchHeightFrameId = 0;
let workbenchHeightFallbackFrameId = 0;
let pendingWorkbenchHeight = null;
let appliedWorkbenchHeight = null;

function isDesktopWorkbench() {
  return Boolean(workbench && canvasPanel && adjustmentsPanel && !mobileWorkbench.matches);
}

function clearWorkbenchPanelHeight() {
  if (workbenchHeightFrameId) cancelAnimationFrame(workbenchHeightFrameId);
  if (workbenchHeightFallbackFrameId) cancelAnimationFrame(workbenchHeightFallbackFrameId);
  workbenchHeightFrameId = 0;
  workbenchHeightFallbackFrameId = 0;
  pendingWorkbenchHeight = null;
  appliedWorkbenchHeight = null;
  workbench?.style.removeProperty('--workbench-panel-height');
  adjustmentsPanel?.style.removeProperty('height');
  adjustmentsPanel?.style.removeProperty('max-height');
}

function measureWorkbenchPanelHeight() {
  if (!canvasPanel) return null;
  const height = canvasPanel.getBoundingClientRect().height;
  return Number.isFinite(height) && height > 0 ? height : null;
}

function scheduleWorkbenchPanelHeight(height = null) {
  if (!isDesktopWorkbench()) {
    clearWorkbenchPanelHeight();
    return;
  }
  if (Number.isFinite(height) && height > 0) pendingWorkbenchHeight = height;
  if (workbenchHeightFrameId) return;
  workbenchHeightFrameId = requestAnimationFrame(() => {
    workbenchHeightFrameId = 0;
    if (!isDesktopWorkbench()) {
      clearWorkbenchPanelHeight();
      return;
    }
    const nextHeight = pendingWorkbenchHeight ?? measureWorkbenchPanelHeight();
    pendingWorkbenchHeight = null;
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
    if (appliedWorkbenchHeight !== null && Math.abs(nextHeight - appliedWorkbenchHeight) < 0.5)
      return;
    workbench.style.setProperty('--workbench-panel-height', `${nextHeight}px`);
    appliedWorkbenchHeight = nextHeight;
  });
}

function stopWorkbenchHeightSync() {
  workbenchHeightObserver?.disconnect();
  workbenchHeightObserver = null;
  clearWorkbenchPanelHeight();
}

function scheduleFallbackWorkbenchMeasurement(framesRemaining = 2) {
  if (workbenchHeightFallbackFrameId || framesRemaining < 1) return;
  const measure = () => {
    workbenchHeightFallbackFrameId = 0;
    scheduleWorkbenchPanelHeight();
    if (framesRemaining > 1) {
      framesRemaining -= 1;
      workbenchHeightFallbackFrameId = requestAnimationFrame(measure);
    }
  };
  workbenchHeightFallbackFrameId = requestAnimationFrame(measure);
}

function initializeWorkbenchHeightSync() {
  if (!isDesktopWorkbench()) {
    stopWorkbenchHeightSync();
    return;
  }
  if (!workbenchHeightObserver && typeof ResizeObserver !== 'undefined') {
    workbenchHeightObserver = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === canvasPanel);
      if (entry) scheduleWorkbenchPanelHeight();
    });
    workbenchHeightObserver.observe(canvasPanel);
  }
  scheduleWorkbenchPanelHeight();
  if (typeof ResizeObserver === 'undefined') {
    // Two follow-up frames catch late initial layout without turning the fallback
    // into a polling loop. Later geometry changes use the explicit event hooks.
    scheduleFallbackWorkbenchMeasurement();
  }
}

function handleWorkbenchBreakpointChange() {
  initializeWorkbenchHeightSync();
  syncWorkbenchPaneAccessibility();
}

window.addEventListener('resize', scheduleWorkbenchPanelHeight, { passive: true });
window.addEventListener('orientationchange', scheduleWorkbenchPanelHeight, { passive: true });
if (typeof mobileWorkbench.addEventListener === 'function')
  mobileWorkbench.addEventListener('change', handleWorkbenchBreakpointChange);
else if (typeof mobileWorkbench.addListener === 'function')
  mobileWorkbench.addListener(handleWorkbenchBreakpointChange);
document.fonts?.ready?.then(() => scheduleWorkbenchPanelHeight());
initializeWorkbenchHeightSync();

function syncWorkbenchPaneAccessibility() {
  if (!workbench) return;
  const pane = workbench.dataset.mobilePane === 'adjustments' ? 'adjustments' : 'library';
  const libraryButton = $('showPresetPanel');
  const adjustmentsButton = $('showAdjustmentsPanel');
  const adjustmentsOpen = pane === 'adjustments';
  libraryButton.classList.toggle('active', !adjustmentsOpen);
  adjustmentsButton.classList.toggle('active', adjustmentsOpen);
  libraryButton.setAttribute('aria-selected', String(!adjustmentsOpen));
  adjustmentsButton.setAttribute('aria-selected', String(adjustmentsOpen));
  libraryButton.tabIndex = adjustmentsOpen ? -1 : 0;
  adjustmentsButton.tabIndex = adjustmentsOpen ? 0 : -1;

  // The desktop exposes both persistent surfaces. At medium and narrow widths,
  // only the selected drawer belongs in the accessibility tree.
  if (mobileWorkbench.matches) {
    lutLibraryPanel?.setAttribute('aria-hidden', String(adjustmentsOpen));
    adjustmentsPanel?.setAttribute('aria-hidden', String(!adjustmentsOpen));
  } else {
    lutLibraryPanel?.setAttribute('aria-hidden', 'false');
    adjustmentsPanel?.setAttribute('aria-hidden', 'false');
  }
}

function setMobileWorkbenchPane(pane, focusButton = false) {
  if (!workbench || !['library', 'adjustments'].includes(pane)) return;
  workbench.dataset.mobilePane = pane;
  syncWorkbenchPaneAccessibility();
  if (focusButton) $(pane === 'adjustments' ? 'showAdjustmentsPanel' : 'showPresetPanel').focus();
}
if (workbench) {
  $('showPresetPanel').addEventListener('click', () => {
    setMobileWorkbenchPane('library');
  });
  $('showAdjustmentsPanel').addEventListener('click', () => setMobileWorkbenchPane('adjustments'));
  document.querySelector('.workbench-tabs')?.addEventListener('keydown', (event) => {
    if (!mobileWorkbench.matches || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
      return;
    event.preventDefault();
    const pane = event.key === 'ArrowLeft' || event.key === 'Home' ? 'library' : 'adjustments';
    setMobileWorkbenchPane(pane, true);
  });
  syncWorkbenchPaneAccessibility();
}

function readNarrowDetailsState() {
  try {
    const saved = sessionStorage.getItem(narrowDetailsStorageKey);
    if (!saved) return null;
    const state = JSON.parse(saved);
    return state && typeof state === 'object' ? state : null;
  } catch (_) {
    return null;
  }
}

function writeNarrowDetailsState(details) {
  try {
    sessionStorage.setItem(
      narrowDetailsStorageKey,
      JSON.stringify(
        Object.fromEntries(details.map((detail) => [detail.dataset.adjustmentSection, detail.open]))
      )
    );
  } catch (_) {}
}

function initializeNarrowDetails() {
  if (!narrowWorkbench.matches || !adjustmentsPanel) return;
  const details = [...adjustmentsPanel.querySelectorAll(':scope > details.adjustment-group')];
  if (!details.length) return;
  details.forEach((detail, index) => {
    detail.dataset.adjustmentSection = detail.classList.contains('color-grading-group')
      ? 'grading'
      : index === 0
        ? 'basic'
        : 'detail';
  });
  const saved = readNarrowDetailsState();
  details.forEach((detail) => {
    detail.open = saved
      ? Boolean(saved[detail.dataset.adjustmentSection])
      : detail.dataset.adjustmentSection === 'grading';
  });
  if (!saved) writeNarrowDetailsState(details);
  details.forEach((detail) => {
    if (detail.dataset.narrowDetailsBound) return;
    detail.dataset.narrowDetailsBound = 'true';
    detail.addEventListener('toggle', () => {
      if (narrowWorkbench.matches) writeNarrowDetailsState(details);
    });
  });
}

function handleNarrowWorkbenchBreakpointChange() {
  initializeNarrowDetails();
}

if (typeof narrowWorkbench.addEventListener === 'function')
  narrowWorkbench.addEventListener('change', handleNarrowWorkbenchBreakpointChange);
else if (typeof narrowWorkbench.addListener === 'function')
  narrowWorkbench.addListener(handleNarrowWorkbenchBreakpointChange);
initializeNarrowDetails();
let lutStickyObserver = null;
function initializeLutStickyObserver() {
  const sentinel = document.querySelector('.lut-filter-sentinel');
  const sticky = document.querySelector('.lut-filter-sticky');
  if (!sentinel || !sticky || typeof IntersectionObserver === 'undefined') return;
  const top = Math.ceil(parseFloat(getComputedStyle(sticky).top) || 12);
  lutStickyObserver = new IntersectionObserver(
    ([entry]) =>
      sticky.classList.toggle(
        'is-stuck',
        !entry.isIntersecting && entry.boundingClientRect.top < top
      ),
    { rootMargin: `-${top}px 0px 0px 0px`, threshold: 0 }
  );
  lutStickyObserver.observe(sentinel);
}
initializeLutStickyObserver();
function bindPalettePointer(element, apply) {
  let pointerId = null,
    mouseTracking = false,
    queuedPoint = null,
    raf = 0;
  function pointFromEvent(event) {
    const samples = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
    const sample = samples[samples.length - 1] || event;
    const box = element.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (sample.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (sample.clientY - box.top) / box.height)),
    };
  }
  function flush() {
    raf = 0;
    if (!queuedPoint) return;
    const point = queuedPoint;
    queuedPoint = null;
    if (canEdit()) apply(point.x, point.y);
  }
  function canEdit() {
    return source && variants.length && element.getAttribute('aria-disabled') !== 'true';
  }
  function queue(event) {
    queuedPoint = pointFromEvent(event);
    if (!raf) raf = requestAnimationFrame(flush);
  }
  function finish() {
    const wasActive = mouseTracking || pointerId !== null;
    if (raf) {
      cancelAnimationFrame(raf);
      flush();
    }
    mouseTracking = false;
    const capturedId = pointerId;
    pointerId = null;
    if (capturedId !== null && element.hasPointerCapture(capturedId))
      element.releasePointerCapture(capturedId);
    element.classList.remove('palette-armed', 'palette-dragging');
    if (activePaletteInteraction === interaction) activePaletteInteraction = null;
    if (wasActive) scheduleInteractivePreview({ highQuality: true, mutation: false });
  }
  const interaction = { finish };
  element.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (!canEdit()) {
      showEditorToast();
      return;
    }
    element.focus({ preventScroll: true });
    if (event.pointerType === 'mouse') {
      if (mouseTracking) {
        finish();
      } else {
        activePaletteInteraction?.finish();
        activePaletteInteraction = interaction;
        mouseTracking = true;
        element.classList.add('palette-armed', 'palette-dragging');
      }
      return;
    }
    activePaletteInteraction?.finish();
    activePaletteInteraction = interaction;
    pointerId = event.pointerId;
    element.setPointerCapture(pointerId);
    element.classList.add('palette-dragging');
    queue(event);
  });
  element.addEventListener('pointermove', (event) => {
    if (event.pointerId === pointerId) queue(event);
  });
  document.addEventListener('pointermove', (event) => {
    if (mouseTracking && event.pointerType === 'mouse') queue(event);
  });
  // Commit before another control, crop tool or upload can change editor state.
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (mouseTracking && !element.contains(event.target)) finish();
    },
    true
  );
  element.addEventListener('blur', finish);
  window.addEventListener('blur', finish);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) finish();
  });
  function end(event) {
    if (event.pointerId !== pointerId) return;
    if (event.type === 'pointerup') queue(event);
    finish();
  }
  element.addEventListener('pointerup', end);
  element.addEventListener('pointercancel', end);
  element.addEventListener('lostpointercapture', end);
}
function bindPaletteKeyboard(element, position, apply) {
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activePaletteInteraction?.finish();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (!source || !variants.length || element.getAttribute('aria-disabled') === 'true') {
      showEditorToast();
      return;
    }
    activePaletteInteraction?.finish();
    const step = (event.shiftKey ? 12 : 4) / 100;
    let { x, y } = position();
    if (event.key === 'ArrowLeft') x -= step;
    if (event.key === 'ArrowRight') x += step;
    if (event.key === 'ArrowUp') y -= step;
    if (event.key === 'ArrowDown') y += step;
    apply(x, y);
    scheduleInteractivePreview({ highQuality: true, mutation: false });
  });
}
function wbDescription() {
  const temperature = wb.x < 0.34 ? '偏冷' : wb.x > 0.66 ? '偏暖' : '中性',
    tint = wb.y < 0.34 ? '偏绿' : wb.y > 0.66 ? '洋红' : '平衡';
  return `${temperature} · ${tint} · 色温 ${adjustments.temperature > 0 ? '+' : ''}${adjustments.temperature} · 色调 ${adjustments.tint > 0 ? '+' : ''}${adjustments.tint}`;
}
function syncWb() {
  const dot = $('wbDot');
  if (!dot || !$('wbPalette')) return;
  dot.style.left = wb.x * 100 + '%';
  dot.style.top = wb.y * 100 + '%';
  setPaletteDescription('wbPalette', 'wbValue', wbDescription(), wb.x);
}
function applyWb(x, y) {
  wb.x = Math.max(0, Math.min(1, x));
  wb.y = Math.max(0, Math.min(1, y));
  setManualValue('temperature', (wb.x - 0.5) * 100);
  setManualValue('tint', (wb.y - 0.5) * 100);
  syncAllPalettes();
  scheduleInteractivePreview();
}
[
  ['tonePalette', () => quadrantPosition('tone'), (x, y) => applyQuadrantPalette('tone', x, y)],
  ['colorPalette', () => quadrantPosition('color'), (x, y) => applyQuadrantPalette('color', x, y)],
].forEach(([id, position, apply]) => {
  bindPalettePointer($(id), apply);
  bindPaletteKeyboard($(id), position, apply);
});
syncAllPalettes();
function readableSize(n) {
  return n < 1024 * 1024 ? Math.round(n / 1024) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB';
}
function setImportBusy(busy, success = false) {
  importing = busy;
  $('stage').setAttribute('aria-busy', String(busy));
  $('importStatus').hidden = !busy;
  ['variants', 'canvasTools'].forEach((id) => {
    $(id).inert = busy;
  });
  if (busy) {
    if (!importControlSnapshot) {
      activePaletteInteraction?.finish();
      cropDrag = null;
      $('stage').classList.remove('drag-crop');
      const controls = document.querySelectorAll(
        '.controls input, .controls select, .controls button, #canvasTools button, #canvasTools select, ' +
          '#download, #downloadSpec, #cancelExport, #exportHald, #cancelHald, #uploadToLibrary, #publishTitle, #publishDescription'
      );
      importControlSnapshot = Array.from(controls, (control) => [control, control.disabled]);
    }
    importControlSnapshot.forEach(([control]) => {
      control.disabled = true;
      if (control.tagName === 'SELECT') control.dispatchEvent(new Event('customselect:state'));
    });
    setEditingEnabled(false);
  } else {
    importControlSnapshot?.forEach(([control, disabled]) => {
      control.disabled = disabled;
      if (control.tagName === 'SELECT') control.dispatchEvent(new Event('customselect:state'));
    });
    importControlSnapshot = null;
    setEditingEnabled(Boolean(source));
    if (success) {
      document.querySelectorAll('#canvasTools button, #canvasTools select').forEach((control) => {
        control.disabled = false;
      });
      ['download', 'downloadSpec', 'uploadToLibrary', 'publishTitle', 'publishDescription'].forEach(
        (id) => {
          const control = $(id);
          if (control) control.disabled = false;
        }
      );
      syncCropUi();
      ['downloadSpec', 'cropAspect'].forEach((id) =>
        $(id).dispatchEvent(new Event('customselect:state'))
      );
    }
    renderVariants();
    if (thumbnailQueue.length) scheduleThumbnail();
  }
}
function setImportMessage(key, variables) {
  setLocalizedText($('importMessage'), key, variables);
}
async function loadFile(file) {
  if (!file) return;
  invalidatePreviewContent();
  cancelExport();
  cancelHaldExport();
  const request = ++importRequest;
  importController?.abort();
  const controller = new AbortController();
  importController = controller;
  setImportMessage('cg.static.importing');
  setImportBusy(true);
  try {
    const nextSource = await LandscapeColorImport.load(file, { signal: controller.signal });
    if (request !== importRequest || controller.signal.aborted) return;
    setImportMessage('cg.dynamic.import.preparingPreview');
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (request !== importRequest || controller.signal.aborted) return;
    // Prepare offscreen before committing so decode/render failures preserve the current edit.
    const previousSource = source;
    const previousCrop = crop;
    const prepared = document.createElement('canvas');
    source = nextSource;
    crop = emptyCrop();
    try {
      drawProfile(prepared, variants[selected]?.p || presetCatalog[0].parameters);
    } finally {
      source = previousSource;
      crop = previousCrop;
    }
    source = nextSource;
    crop = emptyCrop();
    cropHistory = [];
    cropApplyHistory = [];
    resetComparisonView();
    ['shadowAmt', 'midAmt', 'highAmt'].forEach((id) => {
      $(id).value = 0;
    });
    basePreset = null;
    workingAdjustments = {};
    lastApplied = null;
    isDirty = false;
    $('stage').classList.remove('empty');
    syncAlphaMatte();
    $('empty').style.display = 'none';
    main.style.display = 'block';
    $('photoBar').classList.add('show');
    $('fileName').textContent = file.name;
    if (!standaloneMode) {
      $('publishTitle').value = file.name.replace(/\.[^.]+$/, '');
      $('publishDescription').value = '';
    }
    $('fileInfo').textContent = `${sourceWidth()} × ${sourceHeight()} · ${readableSize(file.size)}`;
    $('cropAspect').value = 'native';
    $('canvasTools').classList.add('show');
    syncCropUi();
    makeVariants(prepared);
    prepared.width = prepared.height = 1;
    setImportBusy(false, true);
    scheduleWorkbenchPanelHeight();
  } catch (error) {
    if (request !== importRequest) return;
    previewPixels.clear();
    previewSource = null;
    if (error.name !== 'AbortError') showEditorToast(errorKey(error, 'cg.error.imageDecode'));
    setImportBusy(false);
  } finally {
    if (request === importRequest) importController = null;
  }
}
$('cancelImport').onclick = () => {
  importRequest += 1;
  importController?.abort();
  importController = null;
  haldController?.abort();
  haldController = null;
  setImportBusy(false);
};
window.addEventListener('pagehide', () => {
  gpuPreview?.dispose();
  gpuPreview = null;
  deactivateGpuPreview();
  stopWorkbenchHeightSync();
  lutStickyObserver?.disconnect();
  lutStickyObserver = null;
  importRequest += 1;
  importController?.abort();
  importController = null;
  resetThumbnails();
  thumbnailWorker?.terminate();
  thumbnailWorker = null;
  p1LutClient?.close();
  p1LutClient = null;
  p1LutSourceGeneration = 0;
  p1WorkerSourcePixels = null;
  p1WorkerSourceWidth = 0;
  p1WorkerSourceHeight = 0;
  p1WorkerSourceGeneration = 0;
  p1ActiveRenderJob = null;
  p1ValidatedLutKeys.clear();
  p1RenderQueue.splice(0).forEach((job) => job.reject(new Error('页面已离开，LUT 渲染已取消。')));
  previewPixels.clear();
  previewSource = null;
});
window.addEventListener('pageshow', (event) => {
  initializeWorkbenchHeightSync();
  if (event.persisted) {
    setImportBusy(false);
    initializeLutStickyObserver();
    // Observers do not survive a back-forward cache entry. Re-observe the current
    // page of cards without changing the selected filter or scroll position.
    renderVariants();
  }
});
['fileInput', 'emptyFileInput'].forEach(
  (id) =>
    ($(id).onchange = (e) => {
      loadFile(e.target.files[0]);
      e.target.value = '';
    })
);
function fitMainCanvas() {
  if (!main.width || !main.height || main.style.display === 'none') return;
  const box = stage.getBoundingClientRect();
  if (!box.width || !box.height) return;
  // The source frame, rather than the current backing canvas, defines the
  // visible image box. A 560px preview and its 1100px replacement therefore
  // cannot produce different rounded CSS dimensions.
  const displayFrame = frame(Number.MAX_SAFE_INTEGER);
  const scale = Math.min(box.width / displayFrame.sw, box.height / displayFrame.sh);
  const width = Math.max(1, Math.round(displayFrame.sw * scale));
  const height = Math.max(1, Math.round(displayFrame.sh * scale));
  const left = (box.width - width) / 2;
  const top = (box.height - height) / 2;
  previewDisplayBox = {
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
  };
  stage.style.setProperty('--preview-display-width', `${width}px`);
  stage.style.setProperty('--preview-display-height', `${height}px`);
  // Keep the source, WebGL and comparison planes precisely coincident.
  [main, interactiveCanvas, $('comparisonCanvas')].filter(Boolean).forEach((canvas) => {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  });
  fitInteractiveCanvas();
  syncComparisonDividerGeometry();
  drawCustomCropBox();
}
$('editorLock').addEventListener('click', () => showEditorToast());
let cropDrag = null;
function commitCrop() {
  if (importing || !source) return;
  refreshVariantCrop();
  if (crop.active && (crop.customRect || crop.customMode)) {
    schedulePreview(false);
    return;
  }
  schedulePreview(false);
}
function adjustCropZoom(delta) {
  if (importing || !source) return;
  const nextZoom = Math.max(1, Math.min(3, crop.zoom + delta));
  if (nextZoom === crop.zoom) return;
  pushCropHistory();
  if (crop.customRect) {
    const rect = crop.customRect;
    const scale = crop.zoom / nextZoom;
    const width = Math.max(0.04, Math.min(1, rect.w * scale));
    const height = Math.max(0.04, Math.min(1, rect.h * scale));
    const centerX = rect.x + rect.w / 2;
    const centerY = rect.y + rect.h / 2;
    crop.customRect = {
      x: Math.max(0, Math.min(1 - width, centerX - width / 2)),
      y: Math.max(0, Math.min(1 - height, centerY - height / 2)),
      w: width,
      h: height,
    };
  }
  setCrop(nextZoom, crop.x, crop.y, false);
  drawCustomCropBox();
  commitCrop();
}
$('zoomIn').onclick = () => adjustCropZoom(0.1);
$('zoomOut').onclick = () => adjustCropZoom(-0.1);
$('cropReset').onclick = resetCrop;
function activeCropFrame() {
  const w = sourceWidth(),
    h = sourceHeight();
  if (crop.customRect) {
    const rect = normalizeRect(crop.customRect);
    const sx = Math.round(rect.x * w),
      sy = Math.round(rect.y * h);
    return {
      sx,
      sy,
      sw: Math.max(1, Math.min(w - sx, Math.round(rect.w * w))),
      sh: Math.max(1, Math.min(h - sy, Math.round(rect.h * h))),
    };
  }
  const sw = Math.max(1, Math.round(w / crop.zoom));
  const sh = Math.max(1, Math.round(h / crop.zoom));
  return {
    sx: Math.round(Math.max(0, Math.min(w - sw, crop.x * w - sw / 2))),
    sy: Math.round(Math.max(0, Math.min(h - sh, crop.y * h - sh / 2))),
    sw,
    sh,
  };
}
function rebuildAfterCrop(profileIndex, manualSettings, paletteState, wbState) {
  makeVariants();
  syncAlphaMatte();
  selected = Math.min(profileIndex, variants.length - 1);
  adjustments = { ...manualSettings };
  Object.keys(adjustments).forEach((key) => setManualValue(key, adjustments[key]));
  palette = { ...paletteState };
  wb = { ...wbState };
  syncPalette();
  syncWb();
  saveAppliedVariant();
  applied = true;
  renderVariants();
  showSelected();
}
$('applyCrop').onclick = () => {
  if (importing || !source || !variants.length) return;
  const f = activeCropFrame();
  if (!f.sw || !f.sh) return;
  resetComparisonView();
  const profileIndex = selected;
  const manualSettings = { ...adjustments };
  const paletteState = { ...palette };
  const wbState = { ...wb };
  cropApplyHistory.push({ source });
  if (cropApplyHistory.length > 20) cropApplyHistory.shift();
  const nextSource = document.createElement('canvas');
  nextSource.width = f.sw;
  nextSource.height = f.sh;
  nextSource.getContext('2d').drawImage(source, f.sx, f.sy, f.sw, f.sh, 0, 0, f.sw, f.sh);
  invalidatePreviewContent();
  source = nextSource;
  crop = emptyCrop();
  cropHistory = [];
  $('cropAspect').value = 'native';
  syncCropUi();
  $('cropBox').classList.remove('show');
  rebuildAfterCrop(profileIndex, manualSettings, paletteState, wbState);
  setLocalizedText($('previewMeta'), 'cg.dynamic.crop.applied');
  setLocalizedText($('applyCrop'), 'cg.dynamic.crop.apply');
};
$('undoCrop').onclick = () => {
  if (importing) return;
  const previous = cropHistory.pop();
  if (previous) {
    resetComparisonView();
    restoreCrop(previous);
    return;
  }
  const appliedCrop = cropApplyHistory.pop();
  if (appliedCrop) {
    resetComparisonView();
    const profileIndex = selected;
    const manualSettings = { ...adjustments };
    const paletteState = { ...palette };
    const wbState = { ...wb };
    invalidatePreviewContent();
    source = appliedCrop.source;
    crop = emptyCrop();
    cropHistory = [];
    $('cropAspect').value = 'native';
    syncCropUi();
    $('cropBox').classList.remove('show');
    rebuildAfterCrop(profileIndex, manualSettings, paletteState, wbState);
    setLocalizedText($('previewMeta'), 'cg.dynamic.crop.undone');
    return;
  }
};
function customPoint(event) {
  const rect = main.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  };
}
function normalizeRect(rect) {
  const min = 0.04;
  let x = Math.max(0, Math.min(1 - min, rect.x)),
    y = Math.max(0, Math.min(1 - min, rect.y));
  let w = Math.max(min, Math.min(1 - x, rect.w)),
    h = Math.max(min, Math.min(1 - y, rect.h));
  return { x, y, w, h };
}
function centeredCropRect(ratio) {
  const sourceRatio = sourceWidth() / sourceHeight();
  if (sourceRatio > ratio) {
    const width = ratio / sourceRatio;
    return { x: (1 - width) / 2, y: 0, w: width, h: 1 };
  }
  const height = sourceRatio / ratio;
  return { x: 0, y: (1 - height) / 2, w: 1, h: height };
}
function resizeLockedRect(rect, handle, point) {
  const normalizedRatio = crop.lockedRatio / (sourceWidth() / sourceHeight());
  const ax = handle.includes('w') ? rect.x + rect.w : rect.x;
  const ay = handle.includes('n') ? rect.y + rect.h : rect.y;
  let width = Math.abs(point.x - ax),
    height = width / normalizedRatio;
  if (height > Math.abs(point.y - ay)) {
    height = Math.abs(point.y - ay);
    width = height * normalizedRatio;
  }
  return normalizeRect({
    x: handle.includes('w') ? ax - width : ax,
    y: handle.includes('n') ? ay - height : ay,
    w: width,
    h: height,
  });
}
$('cropAspect').onchange = () => {
  if (importing || !source) return;
  resetComparisonView();
  const value = $('cropAspect').value;
  pushCropHistory();
  crop.cropAspect = value;
  crop.customMode = value === 'custom';
  crop.active = crop.customMode;
  crop.customRect = null;
  crop.lockedRatio = null;
  crop.applied = false;
  if (value !== 'custom') {
    crop.lockedRatio =
      value === 'native'
        ? null
        : value
            .split(':')
            .map(Number)
            .reduce((a, b) => a / b);
    crop.customRect = crop.lockedRatio ? centeredCropRect(crop.lockedRatio) : null;
    crop.active = !!crop.customRect;
  }
  setCrop(1, 0.5, 0.5);
  syncCropUi();
  drawCustomCropBox();
  commitCrop();
};
stage.addEventListener('keydown', (event) => {
  if (!source || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  if (!(crop.active || crop.zoom > 1)) return;
  event.preventDefault();
  pushCropHistory();
  const step = event.shiftKey ? 0.04 : 0.01;
  if (crop.customRect) {
    const rect = { ...crop.customRect };
    if (event.key === 'ArrowLeft') rect.x -= step;
    if (event.key === 'ArrowRight') rect.x += step;
    if (event.key === 'ArrowUp') rect.y -= step;
    if (event.key === 'ArrowDown') rect.y += step;
    crop.customRect = normalizeRect(rect);
    drawCustomCropBox();
  } else {
    setCrop(
      crop.zoom,
      crop.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      crop.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)
    );
  }
  syncCropUi();
  commitCrop();
});
stage.addEventListener('pointerdown', (e) => {
  if (
    importing ||
    !source ||
    (!(crop.active || crop.zoom > 1) && !crop.customMode) ||
    e.button !== 0
  )
    return;
  e.preventDefault();
  stage.setPointerCapture(e.pointerId);
  const point = customPoint(e);
  const handle = e.target.dataset?.handle;
  cropDrag =
    crop.customMode || crop.customRect
      ? {
          id: e.pointerId,
          mode: handle
            ? 'resize'
            : e.target === $('cropBox') && crop.customRect
              ? 'move'
              : crop.customMode
                ? 'custom'
                : 'none',
          handle,
          start: point,
          point,
          before: cropSnapshot(),
          rect: crop.customRect ? { ...crop.customRect } : null,
        }
      : { id: e.pointerId, mode: 'pan', x: e.clientX, y: e.clientY, before: cropSnapshot() };
  if (cropDrag.mode === 'none') {
    cropDrag = null;
    return;
  }
  if (cropDrag.mode === 'custom') crop.customRect = { x: point.x, y: point.y, w: 0.04, h: 0.04 };
  stage.classList.add('drag-crop');
});
stage.addEventListener('pointermove', (e) => {
  if (!cropDrag || cropDrag.id !== e.pointerId) return;
  if (['custom', 'resize', 'move'].includes(cropDrag.mode)) {
    const point = customPoint(e);
    cropDrag.point = point;
    if (cropDrag.mode === 'custom')
      crop.customRect = normalizeRect({
        x: Math.min(cropDrag.start.x, point.x),
        y: Math.min(cropDrag.start.y, point.y),
        w: Math.abs(point.x - cropDrag.start.x),
        h: Math.abs(point.y - cropDrag.start.y),
      });
    if (cropDrag.mode === 'move')
      crop.customRect = normalizeRect({
        x: cropDrag.rect.x + point.x - cropDrag.start.x,
        y: cropDrag.rect.y + point.y - cropDrag.start.y,
        w: cropDrag.rect.w,
        h: cropDrag.rect.h,
      });
    if (cropDrag.mode === 'resize') {
      const r = { ...cropDrag.rect },
        h = cropDrag.handle;
      if (crop.lockedRatio) {
        crop.customRect = resizeLockedRect(r, h, point);
        drawCustomCropBox();
        return;
      }
      if (h.includes('w')) {
        r.w += r.x - point.x;
        r.x = point.x;
      } else r.w = point.x - r.x;
      if (h.includes('n')) {
        r.h += r.y - point.y;
        r.y = point.y;
      } else r.h = point.y - r.y;
      crop.customRect = normalizeRect(r);
    }
    drawCustomCropBox();
    return;
  }
  const box = stage.getBoundingClientRect();
  const dx = (e.clientX - cropDrag.x) / box.width;
  const dy = (e.clientY - cropDrag.y) / box.height;
  cropDrag.x = e.clientX;
  cropDrag.y = e.clientY;
  setCrop(crop.zoom, crop.x - dx / crop.zoom, crop.y - dy / crop.zoom);
});
function endCrop(e) {
  if (!cropDrag || cropDrag.id !== e.pointerId) return;
  const before = cropDrag.before;
  const drag = cropDrag;
  cropDrag = null;
  stage.classList.remove('drag-crop');
  if (e.type === 'pointercancel') crop = before;
  else if (['custom', 'resize', 'move'].includes(drag.mode)) cropHistory.push(before);
  else if (before.x !== crop.x || before.y !== crop.y) cropHistory.push(before);
  syncCropUi();
  drawCustomCropBox();
  commitCrop();
}
stage.addEventListener('pointerup', endCrop);
stage.addEventListener('pointercancel', endCrop);
stage.addEventListener(
  'wheel',
  (e) => {
    if (importing || !source || !crop.active) return;
    e.preventDefault();
    adjustCropZoom(e.deltaY < 0 ? 0.08 : -0.08);
  },
  { passive: false }
);
['dragenter', 'dragover'].forEach((ev) =>
  stage.addEventListener(ev, (e) => {
    e.preventDefault();
    stage.classList.add('dragging');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  stage.addEventListener(ev, (e) => {
    e.preventDefault();
    stage.classList.remove('dragging');
  })
);
stage.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
document.addEventListener('paste', (e) => {
  const image = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
  if (image) loadFile(image);
});

const exportProfiles = {
  // "Original" keeps the current crop's full pixel dimensions, but still applies grading.
  original: { limit: 32767, mime: 'image/png', quality: undefined, extension: 'png' },
  high: { limit: 16000, mime: 'image/webp', quality: 0.96, extension: 'webp' },
  standard: { limit: 3000, mime: 'image/webp', quality: 0.9, extension: 'webp' },
  web: { limit: 2048, mime: 'image/webp', quality: 0.84, extension: 'webp' },
  preview: { limit: 1100, mime: 'image/webp', quality: 0.76, extension: 'webp' },
};

function canvasBlob(canvas, mime, quality, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, blob) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(blob);
    };
    const onAbort = () => finish(abortError());
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      canvas.toBlob(
        (blob) => finish(blob ? null : new Error('无法导出当前调色图像'), blob),
        mime,
        quality
      );
    } catch (error) {
      finish(error);
    }
  });
}

function cloneRenderSettings(settings) {
  if (!settings) return undefined;
  return {
    ...settings,
    delta: settings.delta ? { ...settings.delta } : undefined,
    shadow: settings.shadow ? [...settings.shadow] : undefined,
    mid: settings.mid ? [...settings.mid] : undefined,
    high: settings.high ? [...settings.high] : undefined,
    grading: settings.grading
      ? {
          ...settings.grading,
          shadows: settings.grading.shadows ? { ...settings.grading.shadows } : undefined,
          midtones: settings.grading.midtones ? { ...settings.grading.midtones } : undefined,
          highlights: settings.grading.highlights ? { ...settings.grading.highlights } : undefined,
        }
      : undefined,
  };
}
function freezeRenderSettings(settings) {
  if (!settings) return settings;
  if (settings.delta) Object.freeze(settings.delta);
  ['shadow', 'mid', 'high'].forEach((key) => settings[key] && Object.freeze(settings[key]));
  if (settings.grading) {
    ['shadows', 'midtones', 'highlights'].forEach(
      (key) => settings.grading[key] && Object.freeze(settings.grading[key])
    );
    Object.freeze(settings.grading);
  }
  return Object.freeze(settings);
}
function exportSourcePixels(snapshot, limit) {
  const { source: snapshotSource, cropFrame } = snapshot;
  const width = snapshotSource.naturalWidth || snapshotSource.width;
  const height = snapshotSource.naturalHeight || snapshotSource.height;
  const sx = Math.max(0, Math.min(width - 1, Math.round(cropFrame.sx)));
  const sy = Math.max(0, Math.min(height - 1, Math.round(cropFrame.sy)));
  const sw = Math.max(1, Math.min(width - sx, Math.round(cropFrame.sw)));
  const sh = Math.max(1, Math.min(height - sy, Math.round(cropFrame.sh)));
  const scale = Math.min(1, limit / Math.max(sw, sh));
  const outputWidth = Math.max(1, Math.round(sw * scale));
  const outputHeight = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(snapshotSource, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);
  const pixels = context.getImageData(0, 0, outputWidth, outputHeight);
  canvas.width = canvas.height = 1;
  return pixels;
}
async function createExportSnapshot(kind, { signal } = {}) {
  throwIfAborted(signal);
  if (importing || !source || !variants.length) throw codedError('export-failed');
  const activeVariant = variants[selected];
  const snapshot = {
    kind,
    source,
    cropFrame: { ...activeCropFrame() },
    neutralBaseActive,
    intensity: filterIntensity,
    variant: {
      ...activeVariant,
      p: Object.freeze({ ...activeVariant.p }),
      appliedSettings: freezeRenderSettings(cloneRenderSettings(activeVariant.appliedSettings)),
    },
    settings: freezeRenderSettings(
      cloneRenderSettings(
        neutralBaseActive
          ? currentRenderSettings(neutralProfile)
          : currentRenderSettings(activeVariant.p)
      )
    ),
  };
  if (snapshot.variant.kind === 'lut') {
    const bytes = await getVariantLutBytes(snapshot.variant, { signal });
    throwIfAborted(signal);
    const checked = ColorGradeLut.validateBytes(bytes);
    if (!checked.ok) throw new Error(checked.error?.message || 'LUT 校验失败。');
    const expectedHash = snapshot.variant.contentSha256 || snapshot.variant.contentHash;
    if (expectedHash && checked.lut.sha256 !== expectedHash) throw codedError('invalid-lut');
    snapshot.lutBytes = bytes.slice(0);
  }
  Object.freeze(snapshot.cropFrame);
  Object.freeze(snapshot.variant);
  return Object.freeze(snapshot);
}
function putExportPixels(canvas, pixels) {
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext('2d');
  const output = context.createImageData(pixels.width, pixels.height);
  output.data.set(pixels.data || pixels);
  context.putImageData(output, 0, 0);
}
async function createExportBlob(kind = 'high', { signal } = {}) {
  const snapshot = await createExportSnapshot(kind, { signal });
  throwIfAborted(signal);
  const profile = exportProfiles[kind] || exportProfiles.high;
  const sourcePixels = snapshot.cropFrame.sw * snapshot.cropFrame.sh;
  const memoryScale =
    kind === 'original' ? 1 : Math.min(1, Math.sqrt(36_000_000 / Math.max(1, sourcePixels)));
  const limit = Math.max(1, Math.floor(profile.limit * memoryScale));
  const output = document.createElement('canvas');
  const original = exportSourcePixels(snapshot, limit);
  if (snapshot.neutralBaseActive) {
    const effect = new Uint8ClampedArray(original.data);
    ColorGradeRenderer.applyPixels(effect, neutralProfile, snapshot.settings);
    putExportPixels(output, { width: original.width, height: original.height, data: effect });
  } else if (snapshot.variant.kind === 'lut') {
    const pixels = await enqueueP1LutRender({
      variant: snapshot.variant,
      sourcePixels: original,
      settings: snapshot.settings,
      intensity: snapshot.intensity,
      lutBytes: snapshot.lutBytes,
      priority: 'export',
      priorityValue: 3,
      signal,
    });
    putExportPixels(output, {
      width: pixels.width,
      height: pixels.height,
      data: new Uint8ClampedArray(pixels.buffer),
    });
  } else {
    const effect = new Uint8ClampedArray(original.data);
    ColorGradeRenderer.applyPixels(effect, snapshot.variant.p, snapshot.settings);
    blendFilterIntensity(effect, original.data, snapshot.intensity);
    putExportPixels(output, { width: original.width, height: original.height, data: effect });
  }
  throwIfAborted(signal);
  let mime = profile.mime;
  let blob;
  try {
    blob = await canvasBlob(output, mime, profile.quality, signal);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    mime = 'image/png';
    blob = await canvasBlob(output, mime, undefined, signal);
  }
  throwIfAborted(signal);
  return { blob, mime, extension: mime === 'image/png' ? 'png' : 'webp' };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.download = filename;
  anchor.href = url;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setExportBusy(busy) {
  $('cancelExport').hidden = !busy;
  $('cancelExport').disabled = !busy;
  $('download').disabled = busy || importing || !source;
  $('downloadSpec').disabled = busy || importing || !source;
  $('downloadSpec').dispatchEvent(new Event('customselect:state'));
}

function cancelExport() {
  if (!exportController) return;
  exportController.abort();
  $('status').textContent = t('cg.status.exportCancelled');
}
$('download').onclick = async () => {
  if (exportController) return;
  const kind = $('downloadSpec').value || 'high';
  const controller = new AbortController();
  exportController = controller;
  setExportBusy(true);
  $('status').textContent = t('cg.status.exporting');
  try {
    const { blob, extension } = await createExportBlob(kind, { signal: controller.signal });
    throwIfAborted(controller.signal);
    const name = ($('previewName').textContent || 'landscape').replace(' · 调整中', '');
    downloadBlob(blob, `${name}-${kind}.${extension}`);
    $('status').textContent = t('cg.status.exported');
  } catch (error) {
    if (error.name === 'AbortError') $('status').textContent = t('cg.status.exportCancelled');
    else showEditorToast(errorKey(error, 'cg.error.exportFailed'));
  } finally {
    if (exportController === controller) {
      exportController = null;
      setExportBusy(false);
    }
  }
};
$('cancelExport').onclick = cancelExport;
window.ColorGradeWorkbench = Object.freeze({
  $,
  createExportBlob,
  getSource: () => source,
  main,
  showEditorToast,
});
