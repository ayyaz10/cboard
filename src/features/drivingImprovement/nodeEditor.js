const EDITABLE_NODE_FIELDS = ['parentId', 'title', 'description', 'whyItHappens', 'whatIDoDifferently', 'richNotes', 'status', 'priority', 'focusNow'];

export function hasUnsavedNodeChanges(draft, original) {
  return EDITABLE_NODE_FIELDS.some(field => (draft?.[field] ?? '') !== (original?.[field] ?? ''));
}
