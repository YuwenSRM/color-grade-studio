/*
 * Color Grade workbench coordinator.
 *
 * The classic scripts loaded immediately before this file own the implementation.
 * They intentionally share one global lexical environment so existing state,
 * initialization order, DOM contracts, and event timing remain unchanged.
 */
window.ColorGradeWorkbench = Object.freeze({
  $,
  createExportBlob,
  getSource: () => source,
  main,
  showEditorToast,
});
