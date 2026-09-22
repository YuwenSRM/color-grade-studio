function syncScrollTopButton() {
  $('scrollTop').classList.toggle('show', window.scrollY > 24);
}
$('scrollTop').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
window.addEventListener('scroll', syncScrollTopButton, { passive: true });
syncScrollTopButton();
function showEditorToast(message = 'cg.static.importRequired', variables) {
  const toast = $('editorToast');
  const key = String(message).startsWith('cg.') ? String(message) : 'cg.error.generic';
  toast.dataset.toastKey = key;
  toast.dataset.toastVariables = JSON.stringify(variables || {});
  toast.textContent = t(key, variables);
  toast.classList.add('show');
  toast.setAttribute('aria-hidden', 'false');
  clearTimeout(showEditorToast.timer);
  showEditorToast.timer = setTimeout(() => {
    toast.classList.remove('show');
    toast.setAttribute('aria-hidden', 'true');
  }, 3200);
}
window.addEventListener('color-grade:localechange', () => {
  document.querySelectorAll('[data-i18n-dynamic-key]').forEach((element) => {
    setLocalizedText(
      element,
      element.dataset.i18nDynamicKey,
      JSON.parse(element.dataset.i18nDynamicVariables || '{}')
    );
  });
  document.querySelectorAll('[data-i18n-dynamic-attributes]').forEach((element) => {
    Object.entries(JSON.parse(element.dataset.i18nDynamicAttributes || '{}')).forEach(
      ([name, binding]) => element.setAttribute(name, t(binding.key, binding.variables))
    );
  });
  const toast = $('editorToast');
  if (toast.classList.contains('show') && toast.dataset.toastKey)
    toast.textContent = t(toast.dataset.toastKey, JSON.parse(toast.dataset.toastVariables || '{}'));
  renderRegionFilterOptions();
  syncCameraFilterLabels();
  syncSceneFilterLabels();
  Object.keys(defaults).forEach((key) => (labels[key] = t(`cg.field.${key}`)));
  if ($('basicControls')) {
    renderBasic();
    Object.keys(adjustments).forEach((key) => setManualValue(key, adjustments[key]));
  }
  updateFilterIntensity();
  renderIntentResult();
  syncAllPalettes();
  syncGradeControls();
});
function setEditingEnabled(enabled) {
  const controls = document.querySelector('.controls');
  controls.classList.toggle('is-locked', !enabled);
  controls.querySelectorAll('input, select, button').forEach((control) => {
    control.disabled = !enabled;
    if (control.tagName === 'SELECT') control.dispatchEvent(new Event('customselect:state'));
  });
  controls.querySelectorAll('[role="slider"]').forEach((control) => {
    control.setAttribute('aria-disabled', String(!enabled));
    control.tabIndex = enabled ? 0 : -1;
  });
  if (!enabled) activePaletteInteraction?.finish();
}
const defaults = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  black: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  clarity: 0,
};
const labels = Object.fromEntries(Object.keys(defaults).map((key) => [key, t(`cg.field.${key}`)]));
let source = null,
  selected = 0,
  variants = [],
  userFilters = [],
  variantPage = 1,
  adjustments = { ...defaults },
  applied = false,
  palette = { x: 0.5, y: 0.5 },
  wb = { x: 0.5, y: 0.5 },
  activePaletteInteraction = null,
  previewQueued = false,
  previewLimit = 1100,
  crop = {
    zoom: 1,
    x: 0.5,
    y: 0.5,
    active: false,
    customMode: false,
    customRect: null,
    lockedRatio: null,
    applied: false,
    cropAspect: 'native',
  },
  cropHistory = [],
  cropApplyHistory = [];
let intentResultState = null;
let intentSession = null;
let importing = false;
let importRequest = 0;
let importController = null;
let importControlSnapshot = null;
let previewSource = null;
const previewPixels = new Map();
const thumbnailLimit = 320;
let thumbnailGeneration = 0;
let thumbnailInput = null;
let thumbnailQueue = [];
let thumbnailPending = null;
let thumbnailTimer = null;
let thumbnailTimeout = null;
let thumbnailWorker = null;
let thumbnailWorkerGeneration = -1;
let thumbnailWorkerFailed = false;
let thumbnailObserver = null;
const variantsPerPage = 24;
let lutLibrary = null;
let p1LutClient = null;
let p1LutSourceGeneration = 0;
let p1RenderSequence = 0;
let p1RenderRunning = false;
let p1RenderQueue = [];
let p1ActiveRenderJob = null;
// A transform belongs to bytes, not merely a user-visible filter id. This matters
// when a library restore replaces a record while the page remains open.
const p1ValidatedLutKeys = new Map();
// Every primary-preview mutation shares this revision so an old Worker result cannot
// overwrite a newer synchronous parameter, neutral, crop, or import preview.
let contentRevision = 0;
// Source/crop/filter identity and manual colour state evolve independently.  A
// render is only paintable when it still describes both snapshots.
let gradingRevision = 0;
let exportController = null;
let haldController = null;
let editingUserFilterId = null;
let filterIntensity = 1;
const filterIntensityById = new Map();
// The input value is intentionally separate from the last pixels committed to the
// canvas.  Dragging only changes requestedIntensity; endpoints never depend on it.
let requestedIntensity = 1;
let presentedIntensity = 1;
let interactiveEndpoint = null;
let mixFrameId = null;
let gpuPreview = null;
let gpuPreviewAttempted = false;
let gpuPreviewDisabled = false;
let gpuInteractiveState = null;
let gpuDrawFrameId = null;
let interactivePreviewQueued = false;
let interactivePreviewHighQualityRequested = false;
let highQualityPreviewSequence = 0;
// Native range controls emit pointerup and change for the same settled value.
// The request key prevents that event pair from rendering the 1100px endpoint twice.
let highQualityPreviewRequestKey = null;
// A 560px frame can satisfy the current strength before a requested 1100px
// frame is ready. Keep that request visible to the status control until the
// matching high-quality pixels have actually been committed.
let pendingHighQualityPreviewSequence = 0;
let intensityBusyClearTimer = null;
const interactivePreviewLimit = 560;
const highQualityPreviewLimit = 1100;
let committedPreviewWidth = 0;
let committedPreviewHeight = 0;
// The 560px compositor runs once per animation frame while a range input is
// moving. Keep both of its scratch surfaces instead of allocating an RGBA
// array and ImageData for every intensity value.
let interactiveMixPixels = null;
let previewImageData = null;
let previewImageDataWidth = 0;
let previewImageDataHeight = 0;
// A CPU frame may be retained while a replacement LUT endpoint is rendering.
// This is deliberately separate from endpoint validity: the retained frame can
// be older than the current settings but is still safer than exposing a blank canvas.
let previewHasContent = false;
let comparisonSourcePixels = null;
// CSS preview geometry is deliberately independent from the 560/1100px
// backing buffers. Every visible canvas and the split divider use this box.
let previewDisplayBox = null;
// The Worker owns its own immutable copy after this first upload. Consecutive
// S560 renders therefore send only settings, not another source-sized buffer.
let p1WorkerSourcePixels = null;
let p1WorkerSourceWidth = 0;
let p1WorkerSourceHeight = 0;
let p1WorkerSourceGeneration = 0;
let p1ImportValidationSequence = 0;
const builtinLutBytes = new Map();
const studioGradeFields = Object.freeze({
  shadow: 'shadows',
  mid: 'midtones',
  high: 'highlights',
});
let gradingState = {
  model: ColorGradeRenderer.studioGradeModel || 'studio-v2',
  shadows: { hue: 210, saturation: 55, lightness: 0, intensity: 0 },
  midtones: { hue: 122, saturation: 24, lightness: 0, intensity: 0 },
  highlights: { hue: 35, saturation: 73, lightness: 0, intensity: 0 },
  balance: 0,
};
// Comparison is transient display state. It never belongs to a variant, crop snapshot or export.
let comparison = { mode: 'effect', position: 0.5, dragging: false };
