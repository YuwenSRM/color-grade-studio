function sourceWidth() {
  return source ? source.naturalWidth || source.width : 0;
}
function sourceHeight() {
  return source ? source.naturalHeight || source.height : 0;
}
function emptyCrop() {
  return {
    zoom: 1,
    x: 0.5,
    y: 0.5,
    active: false,
    customMode: false,
    customRect: null,
    lockedRatio: null,
    applied: false,
    cropAspect: 'native',
  };
}
function setManualValue(key, value) {
  adjustments[key] = Math.round(value);
  const input = $(key);
  if (input) {
    input.value = adjustments[key];
    $(key + 'V').textContent = (adjustments[key] > 0 ? '+' : '') + adjustments[key];
    const directInput = $(key + 'Input');
    if (directInput) directInput.value = adjustments[key];
    if (input.type === 'range') updateRangeFill(input);
    input.setAttribute('aria-valuenow', String(adjustments[key]));
    input.setAttribute('aria-valuetext', signedAdjustment(key));
  }
}

// All basic controls write one state object and then enter the same revisioned
// scheduler.  In particular, number fields never synthesize a second DOM event
// on their paired range input.
function commitAdjustment(key, value, { highQuality = false, batch = false, intent = false } = {}) {
  if (!intent && intentSession) endIntentSession({ keepPreview: true });
  setManualValue(key, clampNumber(value, -100, 100, adjustments[key]));
  if (!batch) {
    syncAllPalettes();
    scheduleInteractivePreview({ highQuality });
  }
}

function commitAdjustments(values, { highQuality = false, intent = false } = {}) {
  if (!intent && intentSession) endIntentSession({ keepPreview: true });
  Object.entries(values).forEach(([key, value]) =>
    commitAdjustment(key, value, { batch: true, intent })
  );
  syncAllPalettes();
  scheduleInteractivePreview({ highQuality });
}
function profileControls(p) {
  return {
    exposure: ((p.b - 1) * 255) / 1.85,
    contrast: (p.c - 1) * 150,
    saturation: (p.s - 1) * 130,
    temperature: ((p.w - 1) * 52) / 0.55,
  };
}
function manualDelta(p) {
  const baseline = profileControls(p);
  return Object.fromEntries(
    Object.entries(adjustments).map(([key, value]) => [key, value - (baseline[key] || 0)])
  );
}
function syncControlsForProfile(p) {
  activePaletteInteraction?.finish();
  adjustments = { ...defaults, ...profileControls(p) };
  Object.keys(adjustments).forEach((key) => setManualValue(key, adjustments[key]));
  syncAllPalettes();
}
// Every palette reads the same adjustments; there is no second grading layer.
function syncAllPalettes() {
  palette = {
    x: Math.max(0, Math.min(1, 0.5 + adjustments.saturation / 100)),
    y: Math.max(0, Math.min(1, 0.5 - adjustments.exposure / 90)),
  };
  wb = {
    x: Math.max(0, Math.min(1, 0.5 + adjustments.temperature / 100)),
    y: Math.max(0, Math.min(1, 0.5 + adjustments.tint / 100)),
  };
  syncPalette();
  syncWb();
  syncQuadrantPalette('tone');
  syncQuadrantPalette('color');
}
function paletteDescription() {
  const light = palette.y < 0.34 ? 'bright' : palette.y > 0.66 ? 'dark' : 'standard';
  const color = palette.x < 0.34 ? 'muted' : palette.x > 0.66 ? 'rich' : 'balanced';
  return t('cg.a11yDynamic.paletteValue', {
    light: t(`cg.a11yDynamic.${light}`),
    color: t(`cg.a11yDynamic.${color}`),
    exposureLabel: t('cg.field.exposure'),
    exposure: signedAdjustment('exposure'),
    saturationLabel: t('cg.field.saturation'),
    saturation: signedAdjustment('saturation'),
  });
}
function syncPalette() {
  const dot = $('paletteDot');
  if (!dot || !$('brightPalette')) return;
  dot.style.left = palette.x * 100 + '%';
  dot.style.top = palette.y * 100 + '%';
  setPaletteDescription('brightPalette', 'paletteValue', paletteDescription(), palette.x);
}
function applyPalette(x, y) {
  palette.x = Math.max(0, Math.min(1, x));
  palette.y = Math.max(0, Math.min(1, y));
  commitAdjustments({
    exposure: (0.5 - palette.y) * 90,
    saturation: (palette.x - 0.5) * 100,
    vibrance: (palette.x - 0.5) * 64,
  });
}
function signedAdjustment(key) {
  return (adjustments[key] > 0 ? '+' : '') + adjustments[key];
}
function setPaletteDescription(id, valueId, description, x) {
  if (!$(id) || !$(valueId)) return;
  // Keep the complete style label on row one and numeric parameters on row two.
  const parts = String(description).split(' · ');
  const structuredDescription =
    parts.length > 2
      ? `${parts.slice(0, 2).join(' · ')}\n${parts.slice(2).join(' · ')}`
      : String(description);
  const output = $(valueId);
  output.textContent = structuredDescription;
  $(id).setAttribute('aria-valuetext', structuredDescription);
  // The numeric ARIA value describes the horizontal axis; valuetext describes both.
  $(id).setAttribute('aria-valuenow', Math.round(x * 100));
}
function paletteCoordinate(value, span, reversed = false) {
  return Math.max(0, Math.min(1, 0.5 + (reversed ? -value : value) / span));
}
function quadrantPosition(kind) {
  return kind === 'tone'
    ? {
        x: paletteCoordinate(adjustments.contrast, 100),
        y: paletteCoordinate(adjustments.exposure, 90, true),
      }
    : {
        x: paletteCoordinate(adjustments.temperature, 100),
        y: paletteCoordinate(adjustments.tint, 100),
      };
}
function syncQuadrantPalette(kind) {
  const position = quadrantPosition(kind);
  const dot = $(kind + 'Dot');
  dot.style.left = position.x * 100 + '%';
  dot.style.top = position.y * 100 + '%';
  let description;
  if (kind === 'tone') {
    const light = position.y < 0.34 ? 'bright' : position.y > 0.66 ? 'dark' : 'standard';
    const contrast = position.x < 0.34 ? 'soft' : position.x > 0.66 ? 'strong' : 'balanced';
    description = t('cg.a11yDynamic.tonePaletteValue', {
      light: t(`cg.a11yDynamic.${light}`),
      contrast: t(`cg.a11yDynamic.${contrast}`),
      exposureLabel: t('cg.field.exposure'),
      exposure: signedAdjustment('exposure'),
      contrastLabel: t('cg.field.contrast'),
      contrastValue: signedAdjustment('contrast'),
      saturationLabel: t('cg.field.saturation'),
      saturation: signedAdjustment('saturation'),
      vibranceLabel: t('cg.field.vibrance'),
      vibrance: signedAdjustment('vibrance'),
    });
  } else {
    const warmth = position.x < 0.34 ? 'cool' : position.x > 0.66 ? 'warm' : 'neutral';
    const tint = position.y < 0.34 ? 'green' : position.y > 0.66 ? 'magenta' : 'balanced';
    description = t('cg.a11yDynamic.temperatureTintPaletteValue', {
      warmth: t(`cg.a11yDynamic.${warmth}`),
      tint: t(`cg.a11yDynamic.${tint}`),
      temperatureLabel: t('cg.field.temperature'),
      temperature: signedAdjustment('temperature'),
      tintLabel: t('cg.field.tint'),
      tintValue: signedAdjustment('tint'),
    });
  }
  setPaletteDescription(kind + 'Palette', kind + 'Value', description, position.x);
}
function applyQuadrantPalette(kind, x, y) {
  const horizontal = (Math.max(0, Math.min(1, x)) - 0.5) * 2;
  const vertical = (Math.max(0, Math.min(1, y)) - 0.5) * 2;
  const values =
    kind === 'tone'
      ? {
          exposure: -vertical * 45,
          contrast: horizontal * 50,
          saturation: horizontal * 40,
          vibrance: horizontal * 24,
          // Standard-v2 follows PS/LR-style semantics: positive highlights brighten.
          highlights: horizontal * 12 + Math.max(0, -vertical) * 16,
          shadows: -horizontal * 20 - vertical * 12,
          black: horizontal * 12,
        }
      : {
          temperature: horizontal * 50,
          tint: vertical * 50,
        };
  commitAdjustments(values);
}
function updatePreviewFrame() {
  const value = $('previewAspect').value,
    stage = $('stage'),
    panel = stage.closest('.canvas-panel');
  if (value === 'auto') {
    stage.classList.remove('view-frame');
    stage.style.removeProperty('--preview-ratio');
    stage.style.removeProperty('width');
  } else {
    const [rw, rh] = value.split(':').map(Number);
    const availableWidth = Math.max(0, panel.clientWidth - 36);
    const frameWidth = Math.min(availableWidth, 500 * (rw / rh));
    stage.classList.add('view-frame');
    stage.style.setProperty('--preview-ratio', value.replace(':', ' / '));
    stage.style.width = `${Math.round(frameWidth)}px`;
  }
  main.style.margin = 'auto';
  requestAnimationFrame(() => {
    main.style.width = 'auto';
    main.style.height = 'auto';
    fitMainCanvas();
    scheduleWorkbenchPanelHeight();
  });
}
window.addEventListener('resize', updatePreviewFrame);
function syncCropUi() {
  $('zoomValue').textContent = Math.round(crop.zoom * 100) + '%';
  const canPan = crop.active || crop.zoom > 1;
  // Crop gestures are state, while their spoken guidance belongs in the locale.
  const hintKey =
    crop.customMode && !crop.customRect
      ? 'cg.dynamic.crop.select'
      : crop.customRect
        ? crop.lockedRatio
          ? 'cg.dynamic.crop.locked'
          : 'cg.dynamic.crop.free'
        : canPan
          ? 'cg.dynamic.crop.pan'
          : 'cg.dynamic.crop.zoom';
  setLocalizedText($('cropHint'), hintKey);
  $('cropLiveHint').textContent = $('cropHint').textContent;
  $('stage').classList.toggle('crop-active', canPan);
  $('stage').classList.toggle('custom-crop-mode', crop.customMode);
  $('undoCrop').disabled = !cropHistory.length && !cropApplyHistory.length;
}
function cropSnapshot() {
  return {
    zoom: crop.zoom,
    x: crop.x,
    y: crop.y,
    active: crop.active,
    customMode: crop.customMode,
    customRect: crop.customRect ? { ...crop.customRect } : null,
    lockedRatio: crop.lockedRatio,
    applied: crop.applied,
    cropAspect: crop.cropAspect,
  };
}
function pushCropHistory() {
  cropHistory.push(cropSnapshot());
  if (cropHistory.length > 20) cropHistory.shift();
  syncCropUi();
}
function restoreCrop(snapshot) {
  crop = { ...snapshot, customRect: snapshot.customRect ? { ...snapshot.customRect } : null };
  if (snapshot.cropAspect) $('cropAspect').value = snapshot.cropAspect;
  syncCropUi();
  refreshVariantCrop();
  schedulePreview(false);
}
function setCrop(zoom, x = crop.x, y = crop.y, preview = true) {
  crop.zoom = Math.max(1, Math.min(3, zoom));
  const edge = 1 / crop.zoom / 2;
  crop.x = Math.max(edge, Math.min(1 - edge, x));
  crop.y = Math.max(edge, Math.min(1 - edge, y));
  setLocalizedText($('applyCrop'), 'cg.dynamic.crop.apply');
  syncCropUi();
  if (preview && source) schedulePreview(true);
}
function resetCrop() {
  resetComparisonView();
  pushCropHistory();
  setCrop(1, 0.5, 0.5);
  crop.customMode = false;
  crop.customRect = null;
  crop.lockedRatio = null;
  crop.applied = false;
  crop.cropAspect = 'native';
  $('cropAspect').value = 'native';
  if (source) refreshVariantCrop();
}
function refreshVariantCrop() {
  resetThumbnails();
  variants.forEach((variant) => {
    variant.thumbnailReady = false;
    variant.canvas.width = variant.canvas.height = 1;
  });
  renderVariants();
}
function drawCustomCropBox() {
  const box = $('cropBox'),
    stageRect = stage.getBoundingClientRect(),
    imageRect = main.getBoundingClientRect();
  if (!crop.active || !crop.customRect || !imageRect.width) {
    box.classList.remove('show');
    return;
  }
  const rect = crop.customRect;
  box.style.left = `${imageRect.left - stageRect.left + rect.x * imageRect.width}px`;
  box.style.top = `${imageRect.top - stageRect.top + rect.y * imageRect.height}px`;
  box.style.width = `${rect.w * imageRect.width}px`;
  box.style.height = `${rect.h * imageRect.height}px`;
  box.classList.add('show');
}
function hexRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
function clampNumber(value, minimum, maximum, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, Math.round(number)))
    : fallback;
}
function hslToHex(hue, saturation, lightness) {
  const [r, g, b] = ColorGradeRenderer.hslToRgb(hue, saturation / 100, 0.5 + lightness / 200);
  return (
    '#' +
    [r, g, b]
      .map((value) =>
        Math.round(Math.max(0, Math.min(1, value)) * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}
function syncGradeControl(prefix) {
  const wheel = gradingState[studioGradeFields[prefix]];
  $(prefix + 'Hue').value = wheel.hue;
  $(prefix + 'Sat').value = wheel.saturation;
  $(prefix + 'Light').value = wheel.lightness;
  $(prefix + 'Amt').value = wheel.intensity;
  const amountValue = $(prefix + 'AmtV');
  if (amountValue) amountValue.textContent = String(wheel.intensity);
  $(prefix + 'AmtInput').value = wheel.intensity;
  const color = hslToHex(wheel.hue, wheel.saturation, wheel.lightness);
  $(prefix + 'Color').value = color;
  document.querySelectorAll(`[data-grade-swatch="${prefix}"]`).forEach((swatch) => {
    swatch.style.setProperty('--grade-color', color);
  });
  updateRangeFill($(prefix + 'Amt'));
}
function syncGradeVisual(prefix) {
  const wheel = gradingState[studioGradeFields[prefix]];
  const color = hslToHex(wheel.hue, wheel.saturation, wheel.lightness);
  $(prefix + 'Color').value = color;
  document.querySelectorAll(`[data-grade-swatch="${prefix}"]`).forEach((swatch) => {
    swatch.style.setProperty('--grade-color', color);
  });
}
function syncGradeControls() {
  Object.keys(studioGradeFields).forEach(syncGradeControl);
  const balance = $('gradeBalance');
  balance.value = gradingState.balance;
  balance.setAttribute('aria-valuenow', String(gradingState.balance));
  setLocalizedAttribute(balance, 'aria-valuetext', 'cg.a11y.balanceValue', {
    value: gradingState.balance > 0 ? `+${gradingState.balance}` : gradingState.balance,
  });
  const balanceValue = $('gradeBalanceV');
  if (balanceValue)
    balanceValue.textContent = (gradingState.balance > 0 ? '+' : '') + gradingState.balance;
  updateRangeFill(balance);
}
function gradeSnapshot() {
  return JSON.parse(JSON.stringify(gradingState));
}
function defaultGradingState() {
  return {
    model: ColorGradeRenderer.studioGradeModel || 'studio-v2',
    shadows: { hue: 210, saturation: 55, lightness: 0, intensity: 0 },
    midtones: { hue: 122, saturation: 24, lightness: 0, intensity: 0 },
    highlights: { hue: 35, saturation: 73, lightness: 0, intensity: 0 },
    balance: 0,
  };
}
function syncGradeFromControl(prefix) {
  const wheel = gradingState[studioGradeFields[prefix]];
  wheel.hue = clampNumber($(prefix + 'Hue').value, 0, 360, wheel.hue);
  wheel.saturation = clampNumber($(prefix + 'Sat').value, 0, 100, wheel.saturation);
  wheel.lightness = clampNumber($(prefix + 'Light').value, -100, 100, wheel.lightness);
  wheel.intensity = clampNumber($(prefix + 'Amt').value, 0, 100, wheel.intensity);
  syncGradeControl(prefix);
}
function commitGradeValue(prefix, field, value, { highQuality = false, batch = false } = {}) {
  const wheelKey = studioGradeFields[prefix];
  if (wheelKey) {
    const wheel = gradingState[wheelKey];
    const bounds = {
      hue: [0, 360],
      saturation: [0, 100],
      lightness: [-100, 100],
      intensity: [0, 100],
    };
    const [minimum, maximum] = bounds[field];
    wheel[field] = clampNumber(value, minimum, maximum, wheel[field]);
    if (field === 'intensity') {
      $(prefix + 'Amt').value = wheel.intensity;
      $(prefix + 'AmtInput').value = wheel.intensity;
      const amountValue = $(prefix + 'AmtV');
      if (amountValue) amountValue.textContent = String(wheel.intensity);
      updateRangeFill($(prefix + 'Amt'));
    } else {
      const inputId = field === 'hue' ? 'Hue' : field === 'saturation' ? 'Sat' : 'Light';
      $(prefix + inputId).value = wheel[field];
    }
    syncGradeVisual(prefix);
  } else if (prefix === 'balance') {
    gradingState.balance = clampNumber(value, -100, 100, gradingState.balance);
    const balance = $('gradeBalance');
    balance.value = gradingState.balance;
    balance.setAttribute('aria-valuenow', String(gradingState.balance));
    setLocalizedAttribute(balance, 'aria-valuetext', 'cg.a11y.balanceValue', {
      value: gradingState.balance > 0 ? `+${gradingState.balance}` : gradingState.balance,
    });
    const balanceValue = $('gradeBalanceV');
    if (balanceValue)
      balanceValue.textContent = (gradingState.balance > 0 ? '+' : '') + gradingState.balance;
    updateRangeFill(balance);
  }
  if (!batch) scheduleInteractivePreview({ highQuality });
}
function commitGradeColor(prefix, hex, { highQuality = false } = {}) {
  const normalized = String(hex || '');
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) return;
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const hue = delta
    ? ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 +
        360) %
      360
    : 0;
  const lightness = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  commitGradeValue(prefix, 'hue', hue, { batch: true });
  commitGradeValue(prefix, 'saturation', saturation * 100, { batch: true });
  commitGradeValue(prefix, 'lightness', (lightness - 0.5) * 200, { batch: true });
  scheduleInteractivePreview({ highQuality });
}
function initializeGradeToneTabs() {
  const tabs = [...document.querySelectorAll('.grade-tone-tab')];
  if (!tabs.length) return;
  const selectTab = (tab, focus = false) => {
    tabs.forEach((candidate) => {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      const panel = $(candidate.getAttribute('aria-controls'));
      if (panel) panel.hidden = !selected;
    });
    if (focus) tab.focus();
  };
  const moveFocus = (current, direction) => {
    const currentIndex = tabs.indexOf(current);
    const next = tabs[(currentIndex + direction + tabs.length) % tabs.length];
    tabs.forEach((tab) => (tab.tabIndex = tab === next ? 0 : -1));
    next.focus();
  };
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
      if (['ArrowLeft', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        moveFocus(tab, -1);
      } else if (['ArrowRight', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        moveFocus(tab, 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        moveFocus(tab, -tabs.indexOf(tab));
      } else if (event.key === 'End') {
        event.preventDefault();
        moveFocus(tab, tabs.length - 1 - tabs.indexOf(tab));
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectTab(tab);
      }
    });
  });
}
function bindGradeControls() {
  Object.keys(studioGradeFields).forEach((prefix) => {
    [prefix + 'Hue', prefix + 'Sat', prefix + 'Light', prefix + 'Amt', prefix + 'AmtInput'].forEach(
      (id) => {
        $(id).addEventListener('input', () => {
          const field = id.endsWith('Hue')
            ? 'hue'
            : id.endsWith('Sat')
              ? 'saturation'
              : id.endsWith('Light')
                ? 'lightness'
                : 'intensity';
          commitGradeValue(prefix, field, $(id).value);
        });
        $(id).addEventListener('change', () =>
          scheduleInteractivePreview({ highQuality: true, mutation: false })
        );
        if ($(id).type === 'range')
          $(id).addEventListener('pointerup', () =>
            scheduleInteractivePreview({ highQuality: true, mutation: false })
          );
      }
    );
    $(prefix + 'Color').addEventListener('input', () => {
      commitGradeColor(prefix, $(prefix + 'Color').value);
    });
    $(prefix + 'Color').addEventListener('change', () =>
      scheduleInteractivePreview({ highQuality: true, mutation: false })
    );
  });
  ['gradeBalance'].forEach((id) => {
    $(id).addEventListener('input', () => {
      commitGradeValue('balance', 'balance', $(id).value);
    });
    $(id).addEventListener('keydown', (event) => {
      if (event.key !== 'PageUp' && event.key !== 'PageDown') return;
      event.preventDefault();
      commitGradeValue(
        'balance',
        'balance',
        gradingState.balance + (event.key === 'PageUp' ? 10 : -10)
      );
    });
    $(id).addEventListener('change', () =>
      scheduleInteractivePreview({ highQuality: true, mutation: false })
    );
    if ($(id).type === 'range')
      $(id).addEventListener('pointerup', () =>
        scheduleInteractivePreview({ highQuality: true, mutation: false })
      );
  });
  document.querySelectorAll('[data-grade-reset]').forEach((button) => {
    button.addEventListener('click', (event) => {
      const prefix = button.dataset.gradeReset;
      if (prefix === 'all') {
        event.preventDefault();
        event.stopPropagation();
      }
      if (prefix === 'balance') gradingState.balance = 0;
      else if (prefix === 'all') gradingState = defaultGradingState();
      else gradingState[studioGradeFields[prefix]].intensity = 0;
      syncGradeControls();
      scheduleInteractivePreview({ highQuality: true });
    });
  });
  document.querySelectorAll('[data-grade-color-picker]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = $(button.getAttribute('aria-controls'));
      if (!input) return;
      try {
        if (typeof input.showPicker === 'function') input.showPicker();
        else input.click();
      } catch (_) {
        input.click();
      }
    });
  });
  syncGradeControls();
  initializeGradeToneTabs();
}
function updateRangeFill(input) {
  const min = Number(input.min || 0),
    max = Number(input.max || 100),
    value = Number(input.value);
  const progress = ((value - min) / (max - min)) * 100;
  input.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, progress))}%`);
}
function updateAllRangeFills() {
  document.querySelectorAll('input[type="range"]').forEach(updateRangeFill);
}
function renderBasic() {
  const atmosphereControls = new Set(['saturation', 'vibrance', 'temperature', 'tint', 'clarity']);
  const controlMarkup = (key) => {
    const label = labels[key];
    const valueLabel = t('cg.a11yDynamic.adjustmentValue', { label, value: '' }).trim();
    return `<div class="manual-control"><div class="slider-row"><label for="${key}"><b>${label}</b></label><output class="value" id="${key}V">0</output><input class="manual-value" id="${key}Input" type="number" min="-100" max="100" step="1" value="0" aria-label="${valueLabel}"><button class="control-reset" type="button" data-manual-reset="${key}" aria-label="${valueLabel}" title="${valueLabel}">↺</button></div><input class="manual" id="${key}" type="range" min="-100" max="100" value="0"></div>`;
  };
  $('basicControls').innerHTML = Object.keys(defaults)
    .filter((key) => !atmosphereControls.has(key))
    .map(controlMarkup)
    .join('');
  $('atmosphereControls').innerHTML = Object.keys(defaults)
    .filter((key) => atmosphereControls.has(key))
    .map(controlMarkup)
    .join('');
  document.querySelectorAll('.manual').forEach((input) => {
    input.oninput = () => {
      commitAdjustment(input.id, input.value);
    };
    input.onchange = () => scheduleInteractivePreview({ highQuality: true, mutation: false });
    input.addEventListener('pointerup', () =>
      scheduleInteractivePreview({ highQuality: true, mutation: false })
    );
  });
  document.querySelectorAll('.manual-value').forEach((input) => {
    input.oninput = () => {
      const key = input.id.replace(/Input$/, '');
      commitAdjustment(key, input.value);
    };
    input.onchange = () => scheduleInteractivePreview({ highQuality: true, mutation: false });
  });
  document.querySelectorAll('[data-manual-reset]').forEach((button) => {
    button.onclick = () => {
      const key = button.dataset.manualReset;
      const profile = neutralBaseActive ? neutralProfile : variants[selected]?.p || neutralProfile;
      commitAdjustment(key, profileControls(profile)[key] || 0, { highQuality: true });
    };
  });
}
function frame(limit = 1100, override = null) {
  const w = sourceWidth(),
    h = sourceHeight();
  if (override) {
    const sx = Math.max(0, Math.min(w - 1, Math.round(override.sx))),
      sy = Math.max(0, Math.min(h - 1, Math.round(override.sy))),
      sw = Math.max(1, Math.min(w - sx, Math.round(override.sw))),
      sh = Math.max(1, Math.min(h - sy, Math.round(override.sh))),
      scale = Math.min(1, limit / Math.max(sw, sh));
    return {
      sx,
      sy,
      sw,
      sh,
      ow: Math.max(1, Math.round(sw * scale)),
      oh: Math.max(1, Math.round(sh * scale)),
    };
  }
  if (crop.active && (crop.customRect || crop.customMode)) {
    const scale = Math.min(1, limit / Math.max(w, h));
    return {
      sx: 0,
      sy: 0,
      sw: w,
      sh: h,
      ow: Math.max(1, Math.round(w * scale)),
      oh: Math.max(1, Math.round(h * scale)),
    };
  }
  const cropW = Math.max(1, Math.round(w / crop.zoom));
  const cropH = Math.max(1, Math.round(h / crop.zoom));
  const scale = Math.min(1, limit / Math.max(cropW, cropH));
  return {
    sx: Math.round(Math.max(0, Math.min(w - cropW, crop.x * w - cropW / 2))),
    sy: Math.round(Math.max(0, Math.min(h - cropH, crop.y * h - cropH / 2))),
    sw: cropW,
    sh: cropH,
    ow: Math.max(1, Math.round(cropW * scale)),
    oh: Math.max(1, Math.round(cropH * scale)),
  };
}
function currentRenderSettings(p) {
  return {
    // New editor interactions follow standard positive-highlight semantics.
    toneModel: ColorGradeRenderer.standardToneModel || 'standard-v2',
    delta: manualDelta(p),
    shadow: hexRgb($('shadowColor').value),
    mid: hexRgb($('midColor').value),
    high: hexRgb($('highColor').value),
    shadowAmount: +$('shadowAmt').value / 100,
    midAmount: +$('midAmt').value / 100,
    highAmount: +$('highAmt').value / 100,
    gradingModel: ColorGradeRenderer.studioGradeModel || 'studio-v2',
    grading: gradeSnapshot(),
  };
}
function migrateLegacyToneSettings(settings) {
  if (!settings || settings.toneModel) return settings;
  const delta = settings.delta || {};
  return {
    ...settings,
    toneModel: ColorGradeRenderer.standardToneModel || 'standard-v2',
    delta: {
      ...delta,
      highlights: Number.isFinite(delta.highlights) ? -delta.highlights : delta.highlights,
    },
  };
}
function migrateVariantToneModel(variant) {
  if (!variant) return;
  variant.appliedSettings = migrateLegacyToneSettings(variant.appliedSettings);
  if (!variant.manualState || variant.manualState.toneModel) return;
  const highlights = variant.manualState.adjustments?.highlights;
  if (Number.isFinite(highlights)) variant.manualState.adjustments.highlights = -highlights;
  variant.manualState.toneModel = ColorGradeRenderer.standardToneModel || 'standard-v2';
}
// Cache only preview-sized ungraded pixels. Export always samples the original source.
function getSourcePixels(limit, frameOverride = null) {
  if (previewSource !== source) {
    previewPixels.clear();
    previewSource = source;
  }
  const f = frame(limit, frameOverride);
  const key = [f.sx, f.sy, f.sw, f.sh, f.ow, f.oh].join(':');
  if (limit <= 1100 && previewPixels.has(key)) return previewPixels.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = f.ow;
  canvas.height = f.oh;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, f.sx, f.sy, f.sw, f.sh, 0, 0, f.ow, f.oh);
  const pixels = context.getImageData(0, 0, f.ow, f.oh);
  canvas.width = canvas.height = 1;
  if (limit <= 1100) {
    if (previewPixels.size >= 3) previewPixels.delete(previewPixels.keys().next().value);
    previewPixels.set(key, pixels);
  }
  return pixels;
}
// Decides only the matte behind the photo. Reads the cached preview buffer so no extra
// full-size traversal happens, and never touches RGB, alpha, crop or export data.
function sourceHasAlpha() {
  if (!source) return false;
  const { data } = getSourcePixels(1100);
  for (let index = 3; index < data.length; index += 4) if (data[index] < 255) return true;
  return false;
}
function syncAlphaMatte() {
  const hasAlpha = sourceHasAlpha();
  $('stage').classList.toggle('has-alpha', hasAlpha);
  $('variants').classList.toggle('has-alpha', hasAlpha);
}
function invalidatePreviewContent({ preserveGpuPreview = false } = {}) {
  contentRevision += 1;
  if (!preserveGpuPreview) deactivateGpuPreview();
  interactiveEndpoint = null;
  // A stale 1100 result is never allowed to replace the fixed-size interaction frame.
  highQualityPreviewSequence += 1;
  pendingHighQualityPreviewSequence = 0;
  highQualityPreviewRequestKey = null;
  cancelSupersededPreviewJobs();
  return contentRevision;
}
function blendFilterIntensity(output, original, intensity) {
  for (let index = 0; index < output.length; index += 4) {
    if (intensity !== 1) {
      output[index] = original[index] + (output[index] - original[index]) * intensity;
      output[index + 1] =
        original[index + 1] + (output[index + 1] - original[index + 1]) * intensity;
      output[index + 2] =
        original[index + 2] + (output[index + 2] - original[index + 2]) * intensity;
    }
    // Endpoint effects are expected to retain alpha, but do not let a custom
    // renderer turn a color-strength adjustment into an opacity adjustment.
    output[index + 3] = original[index + 3];
  }
}
function preserveSourceAlpha(output, original) {
  for (let index = 3; index < output.length; index += 4) output[index] = original[index];
  return output;
}
function clampFilterIntensity(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}
function setIntensityPresentationBusy(busy, { immediate = false } = {}) {
  const control = $('filterIntensity');
  const status = $('filterIntensityStatus');
  if (intensityBusyClearTimer !== null) {
    clearTimeout(intensityBusyClearTimer);
    intensityBusyClearTimer = null;
  }
  const present = () => {
    control.dataset.previewBusy = String(busy);
    control.setAttribute('aria-busy', String(busy));
    status.textContent = busy ? t('cg.dynamic.preview.updating') : '';
  };
  if (busy || immediate) {
    present();
    return;
  }
  // The interactive endpoint may have painted the requested value already,
  // but a requested 1100px result is still part of the same presentation.
  if (pendingHighQualityPreviewSequence) return;
  // Keep the state stable across rAF commits while a pointer is still moving.
  intensityBusyClearTimer = setTimeout(() => {
    intensityBusyClearTimer = null;
    if (presentedIntensity === requestedIntensity) present();
  }, 120);
}
function putPreviewPixels(pixels, width, height, limit = interactivePreviewLimit) {
  const context = main.getContext('2d');
  // Fully prepare the replacement before changing the visible canvas. Resizing
  // clears its bitmap, so a malformed or cancelled result must leave the last
  // good CPU/GPU frame untouched.
  const imageDataMatchesSize =
    previewImageData && previewImageDataWidth === width && previewImageDataHeight === height;
  const nextImageData = imageDataMatchesSize
    ? previewImageData
    : context.createImageData(width, height);
  nextImageData.data.set(pixels);
  const displaySizeChanged =
    committedPreviewWidth !== width ||
    committedPreviewHeight !== height ||
    main.width !== width ||
    main.height !== height;
  // Do this only after the next frame is known to be writable. In particular,
  // an active WebGL preview remains visible while its CPU LUT replacement is
  // being prepared.
  deactivateGpuPreview();
  if (displaySizeChanged) {
    main.width = width;
    main.height = height;
    committedPreviewWidth = width;
    committedPreviewHeight = height;
  }
  previewImageData = nextImageData;
  previewImageDataWidth = width;
  previewImageDataHeight = height;
  context.putImageData(previewImageData, 0, 0);
  previewHasContent = true;
  // The comparison layer is the ungraded source. Its pixels only change when
  // the cached source frame changes, not when intensity changes.
  refreshComparisonSource(limit);
  // The CSS box is stable while dragging at 560px.  Fitting it on every
  // putImageData causes layout work and can wake the A0 ResizeObserver.
  if (displaySizeChanged) fitMainCanvas();
  if (crop.active) requestAnimationFrame(drawCustomCropBox);
  document.dispatchEvent(
    new CustomEvent('color-grade-preview-commit', {
      detail: {
        time: performance.now(),
        contentRevision,
        gradingRevision,
        intensity: requestedIntensity,
        limit,
        width,
        height,
      },
    })
  );
}

function deactivateGpuPreview() {
  gpuInteractiveState = null;
  if (gpuDrawFrameId !== null) cancelAnimationFrame(gpuDrawFrameId);
  gpuDrawFrameId = null;
  interactiveCanvas?.classList.remove('is-active');
  if (stage?.dataset.interactiveRenderer === 'webgl') stage.dataset.interactiveRenderer = 'cpu';
  main.style.removeProperty('visibility');
}

function fitInteractiveCanvas() {
  if (!interactiveCanvas || !main.style.width || !main.style.height) return;
  interactiveCanvas.style.width = main.style.width;
  interactiveCanvas.style.height = main.style.height;
}

function disableGpuPreview() {
  const fallback = gpuInteractiveState;
  gpuPreviewDisabled = true;
  gpuPreview = null;
  deactivateGpuPreview();
  if (!fallback || importing || !source || neutralBaseActive) return;
  requestAnimationFrame(() => {
    if (
      fallback.revision !== contentRevision ||
      fallback.gradingRevision !== gradingRevision ||
      variants[selected]?.id !== fallback.variant.id
    )
      return;
    startInteractiveEndpoint({
      variant: fallback.variant,
      settings: fallback.settings,
      invalidateContent: false,
      forceCpu: true,
    });
  });
}

function ensureGpuPreview() {
  if (gpuPreview || gpuPreviewDisabled || gpuPreviewAttempted) return gpuPreview;
  gpuPreviewAttempted = true;
  gpuPreview =
    window.ColorGradeWebglPreview?.create(interactiveCanvas, {
      onLost: disableGpuPreview,
      onError: disableGpuPreview,
    }) || null;
  return gpuPreview;
}

function canUseGpuPreview(variant, settings) {
  return Boolean(
    variant?.kind === 'parameters' &&
    !neutralBaseActive &&
    window.ColorGradeWebglPreview?.supportedSettings(settings)
  );
}

function presentGpuPreview(sourceEndpoint, revision, endpointGradingRevision) {
  if (revision !== contentRevision || endpointGradingRevision !== gradingRevision) return false;
  const displaySizeChanged =
    committedPreviewWidth !== sourceEndpoint.width ||
    committedPreviewHeight !== sourceEndpoint.height ||
    main.width !== sourceEndpoint.width ||
    main.height !== sourceEndpoint.height;
  if (displaySizeChanged) {
    main.width = sourceEndpoint.width;
    main.height = sourceEndpoint.height;
    committedPreviewWidth = sourceEndpoint.width;
    committedPreviewHeight = sourceEndpoint.height;
    previewImageData = null;
    previewImageDataWidth = 0;
    previewImageDataHeight = 0;
  }
  main.style.visibility = 'hidden';
  interactiveCanvas.classList.add('is-active');
  stage.dataset.interactiveRenderer = 'webgl';
  refreshComparisonSource(interactivePreviewLimit);
  if (displaySizeChanged) fitMainCanvas();
  else fitInteractiveCanvas();
  if (crop.active) requestAnimationFrame(drawCustomCropBox);
  document.dispatchEvent(
    new CustomEvent('color-grade-preview-commit', {
      detail: {
        time: performance.now(),
        contentRevision,
        gradingRevision,
        intensity: requestedIntensity,
        limit: interactivePreviewLimit,
        width: sourceEndpoint.width,
        height: sourceEndpoint.height,
        renderer: 'webgl',
      },
    })
  );
  return true;
}

function renderGpuInteractivePreview({
  sourceEndpoint,
  variant,
  settings,
  revision,
  endpointGradingRevision,
}) {
  if (!canUseGpuPreview(variant, settings)) return false;
  const preview = ensureGpuPreview();
  if (!preview) return false;
  const request = {
    source: sourceEndpoint,
    profile: variant.p,
    settings,
    intensity: requestedIntensity,
  };
  if (!preview.draw(request) || !preview.verify(ColorGradeRenderer, request)) {
    disableGpuPreview();
    return false;
  }
  gpuInteractiveState = {
    sourceEndpoint,
    variant,
    settings,
    revision,
    gradingRevision: endpointGradingRevision,
  };
  interactiveEndpoint = {
    revision,
    gradingRevision: endpointGradingRevision,
    source: sourceEndpoint,
    gpu: true,
    width: sourceEndpoint.width,
    height: sourceEndpoint.height,
    variantId: variant.id,
    sourceWidth: sourceWidth(),
    sourceHeight: sourceHeight(),
  };
  presentedIntensity = requestedIntensity;
  setIntensityPresentationBusy(false);
  return presentGpuPreview(sourceEndpoint, revision, endpointGradingRevision);
}

function scheduleGpuIntensityDraw() {
  if (!gpuInteractiveState || gpuDrawFrameId !== null) return;
  gpuDrawFrameId = requestAnimationFrame(() => {
    gpuDrawFrameId = null;
    const state = gpuInteractiveState;
    if (!state || !interactiveEndpointMatchesCurrent(interactiveEndpoint)) return;
    if (
      !renderGpuInteractivePreview({
        sourceEndpoint: state.sourceEndpoint,
        variant: state.variant,
        settings: state.settings,
        revision: state.revision,
        endpointGradingRevision: state.gradingRevision,
      })
    )
      startInteractiveEndpoint({
        variant: state.variant,
        settings: state.settings,
        invalidateContent: false,
        forceCpu: true,
      });
  });
}
function scheduleEndpointMix() {
  if (mixFrameId !== null) return;
  mixFrameId = requestAnimationFrame(() => {
    mixFrameId = null;
    const endpoint = interactiveEndpoint;
    if (!interactiveEndpointMatchesCurrent(endpoint)) {
      // 0% has an exact, immediately available endpoint even while F560 is loading.
      if (requestedIntensity === 0 && source) {
        const original = getSourcePixels(interactivePreviewLimit);
        putPreviewPixels(original.data, original.width, original.height);
        presentedIntensity = 0;
      } else if (!previewHasContent && source) {
        // A first LUT render has no prior CPU frame to retain. Fill the stable
        // 560px source immediately rather than leaving the preview transparent
        // until the Worker endpoint arrives.
        const original = getSourcePixels(interactivePreviewLimit);
        putPreviewPixels(original.data, original.width, original.height);
        presentedIntensity = 0;
      }
      setIntensityPresentationBusy(requestedIntensity !== 0);
      return;
    }
    const intensity = requestedIntensity;
    if (intensity === 0) putPreviewPixels(endpoint.source.data, endpoint.width, endpoint.height);
    else if (intensity === 1) putPreviewPixels(endpoint.effect, endpoint.width, endpoint.height);
    else {
      if (!interactiveMixPixels || interactiveMixPixels.length !== endpoint.effect.length)
        interactiveMixPixels = new Uint8ClampedArray(endpoint.effect.length);
      interactiveMixPixels.set(endpoint.effect);
      blendFilterIntensity(interactiveMixPixels, endpoint.source.data, intensity);
      putPreviewPixels(interactiveMixPixels, endpoint.width, endpoint.height);
    }
    presentedIntensity = intensity;
    setIntensityPresentationBusy(false);
  });
}
function interactiveEndpointMatchesCurrent(endpoint) {
  const variant = variants[selected];
  return Boolean(
    endpoint &&
    endpoint.revision === contentRevision &&
    endpoint.gradingRevision === gradingRevision &&
    endpoint.variantId === variant?.id &&
    endpoint.sourceWidth === sourceWidth() &&
    endpoint.sourceHeight === sourceHeight()
  );
}
function endpointRenderSettings(variant, manual) {
  return manual ? currentRenderSettings(variant.p) : variant.appliedSettings || undefined;
}
function clonePreviewVariant(variant) {
  return Object.freeze({
    ...variant,
    p: Object.freeze({ ...variant.p }),
    appliedSettings: freezeRenderSettings(cloneRenderSettings(variant.appliedSettings)),
  });
}
function createHighQualityPreviewSnapshot({ variant, manual, settings }) {
  const snapshotVariant = clonePreviewVariant(variant);
  const sourceEndpoint = getSourcePixels(highQualityPreviewLimit);
  const snapshot = {
    revision: contentRevision,
    gradingRevision,
    intensity: requestedIntensity,
    source,
    sourceWidth: sourceWidth(),
    sourceHeight: sourceHeight(),
    variant: snapshotVariant,
    variantId: snapshotVariant.id,
    sourceEndpoint,
    settings: freezeRenderSettings(
      cloneRenderSettings(settings == null ? endpointRenderSettings(variant, manual) : settings)
    ),
  };
  snapshot.key = [
    snapshot.revision,
    snapshot.gradingRevision,
    snapshot.variantId,
    snapshot.sourceWidth,
    snapshot.sourceHeight,
    snapshot.intensity,
  ].join(':');
  return Object.freeze(snapshot);
}
function highQualitySnapshotMatchesCurrent(snapshot, sequence) {
  const variant = variants[selected];
  return Boolean(
    sequence === highQualityPreviewSequence &&
    snapshot.revision === contentRevision &&
    snapshot.gradingRevision === gradingRevision &&
    snapshot.intensity === requestedIntensity &&
    snapshot.source === source &&
    snapshot.sourceWidth === sourceWidth() &&
    snapshot.sourceHeight === sourceHeight() &&
    snapshot.variantId === variant?.id
  );
}
async function renderInteractiveEffect(sourceEndpoint, variant, settings) {
  if (variant.kind !== 'lut') {
    const effect = new Uint8ClampedArray(sourceEndpoint.data);
    ColorGradeRenderer.applyPixels(effect, variant.p, settings);
    return preserveSourceAlpha(effect, sourceEndpoint.data);
  }
  const pixels = await enqueueP1LutRender({
    variant,
    sourcePixels: sourceEndpoint,
    settings,
    intensity: 1,
    priority: 'interactive',
    priorityValue: 4,
    revision: contentRevision,
    gradingRevision,
    discardWhenStale: true,
  });
  return preserveSourceAlpha(new Uint8ClampedArray(pixels.buffer), sourceEndpoint.data);
}
function startInteractiveEndpoint({
  variant,
  manual = false,
  settings = undefined,
  invalidateContent = true,
  forceCpu = false,
} = {}) {
  if (!source || !variant || neutralBaseActive) return;
  // Keep an already visible parameter-filter GPU frame alive while a CPU LUT
  // endpoint is still in flight. putPreviewPixels() retires it only after the
  // replacement ImageData has been completely prepared.
  const revision =
    invalidateContent && variant.kind === 'lut'
      ? invalidatePreviewContent({ preserveGpuPreview: true })
      : invalidateContent
        ? invalidatePreviewContent()
        : contentRevision;
  const endpointGradingRevision = gradingRevision;
  const sourceEndpoint = getSourcePixels(interactivePreviewLimit);
  const renderSettings = settings == null ? endpointRenderSettings(variant, manual) : settings;
  setIntensityPresentationBusy(true);
  if (
    !forceCpu &&
    renderGpuInteractivePreview({
      sourceEndpoint,
      variant,
      settings: renderSettings,
      revision,
      endpointGradingRevision,
    })
  )
    return;
  if (
    requestedIntensity === 0 ||
    (!previewHasContent && !interactiveCanvas?.classList.contains('is-active'))
  )
    scheduleEndpointMix();
  renderInteractiveEffect(sourceEndpoint, variant, renderSettings)
    .then((effect) => {
      if (revision !== contentRevision || endpointGradingRevision !== gradingRevision) return;
      interactiveEndpoint = {
        revision,
        gradingRevision: endpointGradingRevision,
        source: sourceEndpoint,
        effect,
        width: sourceEndpoint.width,
        height: sourceEndpoint.height,
        variantId: variant.id,
        sourceWidth: sourceWidth(),
        sourceHeight: sourceHeight(),
        settings: renderSettings,
      };
      scheduleEndpointMix();
    })
    .catch((error) => {
      if (revision === contentRevision && endpointGradingRevision === gradingRevision) {
        setIntensityPresentationBusy(false, { immediate: true });
        reportP1RenderError(error, 'cg.error.workerFailed');
      }
    });
}
function scheduleHighQualityEndpoint({ variant, manual = false, settings = undefined } = {}) {
  if (!source || !variant || neutralBaseActive) return;
  const snapshot = createHighQualityPreviewSnapshot({ variant, manual, settings });
  if (snapshot.key === highQualityPreviewRequestKey) return;
  highQualityPreviewRequestKey = snapshot.key;
  const sequence = ++highQualityPreviewSequence;
  pendingHighQualityPreviewSequence = sequence;
  const {
    revision,
    gradingRevision: endpointGradingRevision,
    intensity,
    sourceEndpoint,
  } = snapshot;
  const render =
    snapshot.variant.kind === 'lut'
      ? enqueueP1LutRender({
          variant: snapshot.variant,
          sourcePixels: sourceEndpoint,
          settings: snapshot.settings,
          intensity: 1,
          priority: 'high-quality',
          priorityValue: 2,
          revision,
          gradingRevision: endpointGradingRevision,
          discardWhenStale: true,
        }).then((pixels) => new Uint8ClampedArray(pixels.buffer))
      : Promise.resolve().then(() => {
          const effect = new Uint8ClampedArray(sourceEndpoint.data);
          ColorGradeRenderer.applyPixels(effect, snapshot.variant.p, snapshot.settings);
          return preserveSourceAlpha(effect, sourceEndpoint.data);
        });
  render
    .then((effect) => {
      // A high-quality result is valid only for the immutable request snapshot.
      if (!highQualitySnapshotMatchesCurrent(snapshot, sequence)) return;
      if (intensity === 0)
        putPreviewPixels(
          sourceEndpoint.data,
          sourceEndpoint.width,
          sourceEndpoint.height,
          highQualityPreviewLimit
        );
      else if (intensity === 1)
        putPreviewPixels(
          effect,
          sourceEndpoint.width,
          sourceEndpoint.height,
          highQualityPreviewLimit
        );
      else {
        blendFilterIntensity(effect, sourceEndpoint.data, intensity);
        putPreviewPixels(
          effect,
          sourceEndpoint.width,
          sourceEndpoint.height,
          highQualityPreviewLimit
        );
      }
      presentedIntensity = intensity;
      pendingHighQualityPreviewSequence = 0;
      highQualityPreviewRequestKey = snapshot.key;
      setIntensityPresentationBusy(false);
    })
    .catch((error) => {
      if (sequence !== highQualityPreviewSequence) return;
      pendingHighQualityPreviewSequence = 0;
      highQualityPreviewRequestKey = null;
      setIntensityPresentationBusy(false, { immediate: true });
      reportP1RenderError(error, '无法生成高清滤镜预览。');
    });
}
// The only interactive path for manual colour changes.  Event handlers mutate
// their single state object first, then ask this scheduler for one fresh frame.
function scheduleInteractivePreview({
  highQuality = false,
  intensityOnly = false,
  mutation = true,
} = {}) {
  if (importing || !source || !variants.length) return;
  // Neutral base has no LUT endpoint to mix, but it still shares the state
  // commit path and must repaint manual colour changes immediately.
  if (neutralBaseActive) {
    if (!intensityOnly && mutation) gradingRevision += 1;
    if (!intensityOnly) schedulePreview(!highQuality);
    return;
  }
  const variant = variants[selected];
  if (!variant) return;
  if (intensityOnly) {
    // A new drag value supersedes the settled-value 1100px request. Without
    // this invalidation, that request correctly refuses to paint but could
    // leave the requested/presented status stuck in its pending state. A LUT
    // Worker job must also be cancelled instead of being resumed behind the
    // new 560px interaction frame.
    if (!highQuality) {
      highQualityPreviewSequence += 1;
      pendingHighQualityPreviewSequence = 0;
      highQualityPreviewRequestKey = null;
      cancelSupersededHighQualityPreviewJobs();
    }
    setIntensityPresentationBusy(true);
    if (gpuInteractiveState && interactiveEndpointMatchesCurrent(interactiveEndpoint)) {
      scheduleGpuIntensityDraw();
      if (highQuality) scheduleHighQualityEndpoint({ variant, manual: true });
      return;
    }
    if (interactiveEndpointMatchesCurrent(interactiveEndpoint)) scheduleEndpointMix();
    else startInteractiveEndpoint({ variant, manual: true, invalidateContent: false });
    if (highQuality) scheduleHighQualityEndpoint({ variant, manual: true });
    return;
  }
  if (!mutation && highQuality) {
    if (interactivePreviewQueued) {
      interactivePreviewHighQualityRequested = true;
      return;
    }
    scheduleHighQualityEndpoint({ variant, manual: true });
    return;
  }
  if (!mutation) return;

  gradingRevision += 1;
  // Keep the last valid GPU frame visible until its replacement is ready.
  // The revision below still invalidates every stale endpoint and worker job.
  interactiveEndpoint = null;
  highQualityPreviewSequence += 1;
  pendingHighQualityPreviewSequence = 0;
  highQualityPreviewRequestKey = null;
  cancelSupersededPreviewJobs();
  interactivePreviewHighQualityRequested ||= highQuality;
  setIntensityPresentationBusy(true);
  if (interactivePreviewQueued) return;
  interactivePreviewQueued = true;
  requestAnimationFrame(() => {
    interactivePreviewQueued = false;
    if (importing || !source || neutralBaseActive) return;
    const currentVariant = variants[selected];
    if (!currentVariant) return;
    const renderHighQuality = interactivePreviewHighQualityRequested;
    interactivePreviewHighQualityRequested = false;
    startInteractiveEndpoint({ variant: currentVariant, manual: true, invalidateContent: false });
    if (renderHighQuality) scheduleHighQualityEndpoint({ variant: currentVariant, manual: true });
  });
}
function drawProfile(
  canvas,
  p,
  manual = false,
  limit = 1100,
  frameOverride = null,
  settings = null,
  intensity = 1
) {
  if (canvas === main) invalidatePreviewContent();
  const original = getSourcePixels(limit, frameOverride);
  const context = canvas.getContext('2d');
  canvas.width = original.width;
  canvas.height = original.height;
  // Full-size exports own their pixels; only the shared preview cache needs a copy.
  const pixels = limit > 1100 ? original : context.createImageData(original.width, original.height);
  if (pixels !== original) pixels.data.set(original.data);
  ColorGradeRenderer.applyPixels(
    pixels.data,
    p,
    settings || (manual ? currentRenderSettings(p) : undefined)
  );
  blendFilterIntensity(pixels.data, original.data, intensity);
  context.putImageData(pixels, 0, 0);
  if (canvas === main) {
    previewHasContent = true;
    refreshComparisonSource(limit, frameOverride);
  }
}
function refreshComparisonSource(limit = 1100, frameOverride = null) {
  if (!source) return;
  const comparisonCanvas = $('comparisonCanvas');
  const original = getSourcePixels(limit, frameOverride);
  if (
    comparisonSourcePixels === original.data &&
    comparisonCanvas.width === original.width &&
    comparisonCanvas.height === original.height
  )
    return;
  comparisonCanvas.width = original.width;
  comparisonCanvas.height = original.height;
  comparisonCanvas.getContext('2d').putImageData(original, 0, 0);
  comparisonSourcePixels = original.data;
  updateComparisonView();
}
function updateComparisonView() {
  const comparisonCanvas = $('comparisonCanvas');
  const divider = $('comparisonDivider');
  const mode = comparison.mode;
  $('stage').dataset.comparison = mode;
  comparisonCanvas.hidden = !source || mode === 'effect';
  divider.hidden = !source || !['vertical', 'horizontal'].includes(mode);
  if (mode === 'vertical') {
    comparisonCanvas.style.clipPath = `inset(0 ${100 - comparison.position * 100}% 0 0)`;
    divider.setAttribute('aria-orientation', 'vertical');
  } else if (mode === 'horizontal') {
    comparisonCanvas.style.clipPath = `inset(0 0 ${100 - comparison.position * 100}% 0)`;
    divider.setAttribute('aria-orientation', 'horizontal');
  } else comparisonCanvas.style.removeProperty('clip-path');
  syncComparisonDividerGeometry();
  divider.setAttribute('aria-valuenow', String(Math.round(comparison.position * 100)));
  const ids = {
    effect: 'compareEffect',
    original: 'compareOriginal',
    vertical: 'compareSplitVertical',
    horizontal: 'compareSplitHorizontal',
  };
  Object.entries(ids).forEach(([key, id]) => {
    const active = key === mode;
    $(id).classList.toggle('active', active);
    $(id).setAttribute('aria-pressed', String(active));
  });
}
function resetComparisonView() {
  comparison.mode = 'effect';
  comparison.position = 0.5;
  comparison.dragging = false;
  updateComparisonView();
}
function setComparisonMode(mode) {
  const splitMode = mode === 'vertical' || mode === 'horizontal';
  // Effect is the only resting view. Repeating the active split is an explicit exit,
  // while every new split begins at its predictable midpoint.
  if (mode === 'effect' || (splitMode && comparison.mode === mode)) {
    resetComparisonView();
    return;
  }
  comparison.mode = mode;
  comparison.position = 0.5;
  updateComparisonView();
}
function comparisonPosition(event) {
  const stageRect = $('stage').getBoundingClientRect();
  const rect = previewDisplayBox
    ? {
        left: stageRect.left + previewDisplayBox.left,
        top: stageRect.top + previewDisplayBox.top,
        width: previewDisplayBox.width,
        height: previewDisplayBox.height,
      }
    : stageRect;
  return comparison.mode === 'horizontal'
    ? Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    : Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
}
function bindComparisonControls() {
  [
    ['compareEffect', 'effect'],
    ['compareOriginal', 'original'],
    ['compareSplitVertical', 'vertical'],
    ['compareSplitHorizontal', 'horizontal'],
  ].forEach(([id, mode]) => {
    $(id).onclick = () => setComparisonMode(mode);
  });
  const divider = $('comparisonDivider');
  divider.addEventListener('pointerdown', (event) => {
    if (!['vertical', 'horizontal'].includes(comparison.mode)) return;
    comparison.dragging = true;
    divider.setPointerCapture(event.pointerId);
    comparison.position = comparisonPosition(event);
    updateComparisonView();
    event.preventDefault();
  });
  divider.addEventListener('pointermove', (event) => {
    if (!comparison.dragging) return;
    comparison.position = comparisonPosition(event);
    updateComparisonView();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) =>
    divider.addEventListener(type, () => (comparison.dragging = false))
  );
  divider.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
      return;
    event.preventDefault();
    if (event.key === 'Home') comparison.position = 0;
    else if (event.key === 'End') comparison.position = 1;
    else {
      const delta = event.shiftKey ? 0.1 : 0.02;
      comparison.position = Math.max(
        0,
        Math.min(
          1,
          comparison.position + (['ArrowRight', 'ArrowDown'].includes(event.key) ? delta : -delta)
        )
      );
    }
    updateComparisonView();
  });
  updateComparisonView();
}
let p1LutFailed = false;
function isApplicableVariant(variant) {
  return !variant?.compatibilityStatus || variant.compatibilityStatus === 'applicable';
}
function isApplicableFilterIntensitySelection() {
  const variant = variants[selected];
  return (
    !neutralBaseActive &&
    ['lut', 'parameters'].includes(variant?.kind) &&
    isApplicableVariant(variant)
  );
}
function syncFilterIntensityUi() {
  const control = $('filterIntensity');
  const input = $('filterIntensityInput');
  const reason = $('filterIntensityReason');
  const variant = variants[selected];
  const applicable = isApplicableFilterIntensitySelection();
  control.hidden = !applicable;
  if (!applicable) return;
  const workerUnavailable = variant.kind === 'lut' && p1LutFailed;
  input.disabled = workerUnavailable;
  reason.hidden = !workerUnavailable;
  if (workerUnavailable) setLocalizedText(reason, 'cg.dynamic.preview.intensityUnavailable');
  else reason.textContent = '';
  if (workerUnavailable) input.setAttribute('aria-describedby', 'filterIntensityReason');
  else input.removeAttribute('aria-describedby');
}
function getP1LutClient() {
  if (p1LutFailed || p1LutClient) return p1LutClient;
  try {
    const client = ColorGradeP1WorkerClient.create();
    p1LutClient = client;
    client.ready.catch(() => {
      // A cancelled export closes its own client so a later render can create a fresh Worker.
      if (p1LutClient !== client) return;
      p1LutFailed = true;
      p1LutClient = null;
      p1LutSourceGeneration = 0;
      p1WorkerSourcePixels = null;
      p1WorkerSourceWidth = 0;
      p1WorkerSourceHeight = 0;
      p1WorkerSourceGeneration = 0;
      p1ValidatedLutKeys.clear();
      syncFilterIntensityUi();
    });
  } catch (_) {
    p1LutFailed = true;
    syncFilterIntensityUi();
  }
  return p1LutClient;
}
async function validateImportedLutInWorker(file, { signal } = {}) {
  throwIfAborted(signal);
  const client = getP1LutClient();
  if (!client) throw codedError('worker-unavailable');
  const bytes = await file.arrayBuffer();
  throwIfAborted(signal);
  const result = await client.validateLut(`import-${++p1ImportValidationSequence}`, bytes);
  throwIfAborted(signal);
  return result.result;
}
async function validateImportedParametersInWorker(file, { signal } = {}) {
  throwIfAborted(signal);
  const client = getP1LutClient();
  if (!client) throw codedError('worker-unavailable');
  const bytes = await file.arrayBuffer();
  throwIfAborted(signal);
  const result = await client.validateParameters(bytes);
  throwIfAborted(signal);
  return result.result;
}
function enqueueP1LutRender(job) {
  return new Promise((resolve, reject) => {
    // A dragging preview only needs the newest frame. It is allowed to preempt
    // a thumbnail or a settled 1100px result, both of which can be resumed or
    // recomputed after the pointer becomes idle again.
    if (job.priority === 'interactive') {
      p1RenderQueue = p1RenderQueue.filter((queued) => {
        if (!['interactive', 'high-quality'].includes(queued.priority)) return true;
        queued.reject(renderSupersededError());
        return false;
      });
      yieldP1RenderToInteractive();
    }
    p1RenderQueue.push({ ...job, resolve, reject });
    p1RenderQueue.sort((left, right) => right.priorityValue - left.priorityValue);
    runP1LutQueue();
  });
}
function renderSupersededError() {
  const error = new Error('render-superseded');
  error.code = 'render-superseded';
  return error;
}
function isRenderSuperseded(error) {
  return (
    error?.name === 'AbortError' ||
    ['render-superseded', 'operation-superseded', 'invalid-generation'].includes(error?.code)
  );
}
function reportP1RenderError(error, fallback) {
  if (!isRenderSuperseded(error))
    showEditorToast(errorKey(error, fallback || 'cg.error.workerFailed'));
}
function queuedJobIsStale(job) {
  return (
    job.discardWhenStale &&
    ((Number.isSafeInteger(job.revision) && job.revision !== contentRevision) ||
      (Number.isSafeInteger(job.gradingRevision) && job.gradingRevision !== gradingRevision))
  );
}
function cancelSupersededPreviewJobs() {
  p1RenderQueue = p1RenderQueue.filter((job) => {
    if (!['interactive', 'high-quality'].includes(job.priority)) return true;
    job.reject(renderSupersededError());
    return false;
  });
  if (['interactive', 'high-quality'].includes(p1ActiveRenderJob?.priority))
    p1ActiveRenderJob.yielded = 'cancel';
  if (p1ActiveRenderJob?.yielded === 'cancel') closeP1LutClient(p1ActiveRenderJob.client);
}
function cancelSupersededHighQualityPreviewJobs() {
  p1RenderQueue = p1RenderQueue.filter((job) => {
    if (job.priority !== 'high-quality') return true;
    job.reject(renderSupersededError());
    return false;
  });
  if (p1ActiveRenderJob?.priority === 'high-quality') {
    p1ActiveRenderJob.yielded = 'cancel';
    closeP1LutClient(p1ActiveRenderJob.client);
  }
}
function yieldP1RenderToInteractive() {
  const active = p1ActiveRenderJob;
  if (!active || active.yielded || ['export', 'interactive'].includes(active.priority)) return;
  active.yielded = 'resume';
  closeP1LutClient(active.client);
}
function abortError() {
  const error = new Error('operation-aborted');
  error.name = 'AbortError';
  return error;
}
function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}
function closeP1LutClient(client) {
  if (p1LutClient !== client) return;
  p1LutClient = null;
  p1LutSourceGeneration = 0;
  p1WorkerSourcePixels = null;
  p1WorkerSourceWidth = 0;
  p1WorkerSourceHeight = 0;
  p1WorkerSourceGeneration = 0;
  p1ValidatedLutKeys.clear();
  client.close();
}
async function runP1LutQueue() {
  if (p1RenderRunning) return;
  const job = p1RenderQueue.shift();
  if (!job) return;
  p1RenderRunning = true;
  let removeAbortListener = null;
  try {
    throwIfAborted(job.signal);
    if (queuedJobIsStale(job)) throw renderSupersededError();
    const client = getP1LutClient();
    if (!client) throw codedError('worker-unavailable');
    p1ActiveRenderJob = job;
    job.client = client;
    const abort = () => closeP1LutClient(client);
    job.signal?.addEventListener('abort', abort, { once: true });
    removeAbortListener = () => job.signal?.removeEventListener('abort', abort);
    const lutKey = job.variant.contentSha256 || job.variant.contentHash || job.variant.id;
    if (p1ValidatedLutKeys.get(job.variant.id) !== lutKey) {
      const bytes = job.lutBytes
        ? job.lutBytes.slice(0)
        : await getVariantLutBytes(job.variant, { signal: job.signal });
      throwIfAborted(job.signal);
      const loaded = await client.validateLut(job.variant.id, bytes);
      throwIfAborted(job.signal);
      if (!loaded.result.ok) throw new Error(loaded.result.message || 'LUT 校验失败。');
      if (loaded.evictedLutId) p1ValidatedLutKeys.delete(loaded.evictedLutId);
      p1ValidatedLutKeys.set(job.variant.id, lutKey);
    }
    const original = job.sourcePixels || getSourcePixels(job.limit, job.frameOverride);
    const sourceUnchanged =
      p1WorkerSourcePixels === original.data &&
      p1WorkerSourceWidth === original.width &&
      p1WorkerSourceHeight === original.height;
    let generation = p1WorkerSourceGeneration;
    if (!sourceUnchanged) {
      // Keep the main-thread S560 cache intact. This clone happens only when
      // the Worker source frame changes, never for every settings revision.
      const sourceBuffer = new Uint8ClampedArray(original.data).buffer;
      generation = ++p1LutSourceGeneration;
      await client.setSource({
        generation,
        width: original.width,
        height: original.height,
        buffer: sourceBuffer,
      });
      p1WorkerSourcePixels = original.data;
      p1WorkerSourceWidth = original.width;
      p1WorkerSourceHeight = original.height;
      p1WorkerSourceGeneration = generation;
    }
    throwIfAborted(job.signal);
    const result = await client.render({
      id: `${job.variant.id}-${++p1RenderSequence}`,
      generation,
      basis: { kind: 'lut', lutId: job.variant.id, intensity: job.intensity ?? 1 },
      settings: job.settings,
    });
    throwIfAborted(job.signal);
    job.resolve({ width: result.width, height: result.height, buffer: result.buffer });
  } catch (error) {
    if (job.yielded === 'resume' && !job.signal?.aborted) {
      job.yielded = null;
      job.client = null;
      p1RenderQueue.push(job);
      p1RenderQueue.sort((left, right) => right.priorityValue - left.priorityValue);
    } else if (job.yielded === 'cancel' || queuedJobIsStale(job))
      job.reject(renderSupersededError());
    else job.reject(error);
  } finally {
    removeAbortListener?.();
    if (p1ActiveRenderJob === job) p1ActiveRenderJob = null;
    p1RenderRunning = false;
    runP1LutQueue();
  }
}
async function getVariantLutBytes(variant, { signal } = {}) {
  throwIfAborted(signal);
  if (variant.source === 'user') {
    const blob = await lutLibrary?.getBlob(variant.userFilterId);
    throwIfAborted(signal);
    if (!(blob instanceof Blob)) throw codedError('lut-unavailable');
    return blob.arrayBuffer();
  }
  if (variant.source !== 'p2-builtin' || !variant.contentPath || !variant.contentSha256)
    throw codedError('lut-unavailable');
  const cached = builtinLutBytes.get(variant.id);
  if (cached) return cached.slice(0);
  const response = await fetch(variant.contentPath, { signal, credentials: 'same-origin' });
  if (!response.ok) throw codedError('lut-read-failed');
  const bytes = await response.arrayBuffer();
  throwIfAborted(signal);
  const checked = ColorGradeLut.validateBytes(bytes);
  if (!checked.ok) throw new Error(checked.error?.message || '内置 LUT 校验失败。');
  if (checked.lut.sha256 !== variant.contentSha256) throw codedError('invalid-lut');
  builtinLutBytes.set(variant.id, bytes.slice(0));
  return bytes;
}
async function getValidatedVariantLut(variant, { signal } = {}) {
  const bytes = await getVariantLutBytes(variant, { signal });
  throwIfAborted(signal);
  const checked = ColorGradeLut.validateBytes(bytes);
  if (!checked.ok) throw new Error(checked.error?.message || 'LUT 校验失败。');
  return { bytes, lut: checked.lut };
}

function syncComparisonDividerGeometry() {
  const divider = $('comparisonDivider');
  if (!divider || !previewDisplayBox) return;
  const { width, height, left, top } = previewDisplayBox;
  if (comparison.mode === 'vertical') {
    divider.style.left = `${left + width * comparison.position}px`;
    divider.style.top = `${top}px`;
    divider.style.width = '2px';
    divider.style.height = `${height}px`;
  } else if (comparison.mode === 'horizontal') {
    divider.style.left = `${left}px`;
    divider.style.top = `${top + height * comparison.position}px`;
    divider.style.width = `${width}px`;
    divider.style.height = '2px';
  }
}
// Do not pass the click event as a message; otherwise the toast renders "[object MouseEvent]".
