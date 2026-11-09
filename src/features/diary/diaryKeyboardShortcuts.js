export function getDiaryShortcutAction(event, { editorOpen = false, editable = false, inDialog = false, sectionFocused = false } = {}) {
  if (event.defaultPrevented || event.repeat || event.isComposing || inDialog) return null;
  const key = String(event.key || '').toLowerCase();
  if (editorOpen && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && key === 'enter') return 'save-meal';
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return null;
  if (editorOpen) {
    if (key === 'a') return 'add-food-lookup';
    if (key === 'n') return 'add-manual-food';
    return null;
  }
  if (!editable && key === 'm') return 'add-meal';
  if (!editable && sectionFocused && key === 'c') return 'copy-previous-meal';
  return null;
}
