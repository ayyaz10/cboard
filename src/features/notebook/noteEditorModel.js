import { Fragment } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';

export const SLASH_COMMANDS = Object.freeze([
  { id: 'text', label: 'Text', description: 'Start with a plain paragraph', aliases: ['text', 'paragraph', 'plain'] },
  { id: 'heading1', label: 'Heading 1', description: 'Large section heading', aliases: ['h1', 'heading', 'heading 1', 'title'] },
  { id: 'heading2', label: 'Heading 2', description: 'Medium section heading', aliases: ['h2', 'heading', 'heading 2', 'subtitle'] },
  { id: 'heading3', label: 'Heading 3', description: 'Small section heading', aliases: ['h3', 'heading', 'heading 3'] },
  { id: 'bullet', label: 'Bulleted list', description: 'Create a bulleted list', aliases: ['bullet', 'bulleted', 'list', 'unordered'] },
  { id: 'numbered', label: 'Numbered list', description: 'Create a numbered list', aliases: ['number', 'numbered', 'ordered', 'ol'] },
  { id: 'todo', label: 'To-do', description: 'Add a checkbox item', aliases: ['todo', 'to-do', 'task', 'checkbox', 'checklist'] },
  { id: 'quote', label: 'Quote', description: 'Add a quote block', aliases: ['quote', 'blockquote'] },
  { id: 'divider', label: 'Divider', description: 'Separate sections', aliases: ['divider', 'rule', 'line', 'horizontal rule'] },
  { id: 'image', label: 'Image', description: 'Upload or insert an image', aliases: ['image', 'photo', 'picture', 'img'] },
]);

export function getSlashCommands(query = '') {
  const normalized = String(query).trim().toLocaleLowerCase();
  if (!normalized) return [...SLASH_COMMANDS];
  return SLASH_COMMANDS.filter((item) => item.label.toLocaleLowerCase().includes(normalized)
    || item.aliases.some((alias) => alias.includes(normalized) || normalized.includes(alias)));
}

export function getTopLevelBlock(doc, position) {
  let result = null;
  let index = 0;
  doc.forEach((node, offset) => {
    if (!result && position >= offset && position < offset + node.nodeSize) {
      result = { node, position: offset, index };
    }
    index += 1;
  });
  if (!result && doc.childCount) {
    const last = doc.lastChild;
    const lastPosition = doc.content.size - last.nodeSize;
    if (position >= lastPosition) result = { node: last, position: lastPosition, index: doc.childCount - 1 };
  }
  return result;
}

function setNearbyTextSelection(transaction, position, direction = 1) {
  const clamped = Math.max(0, Math.min(position, transaction.doc.content.size));
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(clamped), direction));
  return transaction;
}

export function moveTopLevelBlock(state, position, direction) {
  const block = getTopLevelBlock(state.doc, position);
  if (!block || (direction < 0 && block.index === 0) || (direction > 0 && block.index >= state.doc.childCount - 1)) return null;
  const adjacentIndex = block.index + (direction < 0 ? -1 : 1);
  let adjacent = null;
  state.doc.forEach((node, offset, index) => {
    if (index === adjacentIndex) adjacent = { node, position: offset };
  });
  if (!adjacent) return null;
  const start = direction < 0 ? adjacent.position : block.position;
  const end = direction < 0 ? block.position + block.node.nodeSize : adjacent.position + adjacent.node.nodeSize;
  const ordered = direction < 0 ? [block.node, adjacent.node] : [adjacent.node, block.node];
  const transaction = state.tr.replaceWith(start, end, Fragment.fromArray(ordered));
  const movedPosition = direction < 0 ? start : block.position + adjacent.node.nodeSize;
  return setNearbyTextSelection(transaction, movedPosition + 1);
}

export function duplicateTopLevelBlock(state, position) {
  const block = getTopLevelBlock(state.doc, position);
  if (!block) return null;
  const insertPosition = block.position + block.node.nodeSize;
  const transaction = state.tr.insert(insertPosition, block.node.copy(block.node.content));
  return setNearbyTextSelection(transaction, insertPosition + 1);
}

export function deleteTopLevelBlock(state, position) {
  const block = getTopLevelBlock(state.doc, position);
  if (!block) return null;
  if (state.doc.childCount === 1) {
    const emptyParagraph = state.schema.nodes.paragraph?.create();
    if (!emptyParagraph) return null;
    const transaction = state.tr.replaceWith(block.position, block.position + block.node.nodeSize, emptyParagraph);
    return setNearbyTextSelection(transaction, block.position + 1);
  }
  const transaction = state.tr.delete(block.position, block.position + block.node.nodeSize);
  return setNearbyTextSelection(transaction, block.position > 0 ? block.position - 1 : block.position + 1, block.position > 0 ? -1 : 1);
}

function collectParagraphs(node, schema, result) {
  if (node.type.name === 'paragraph' || node.type.name === 'heading') {
    result.push(schema.nodes.paragraph.create(null, node.content));
    return;
  }
  node.forEach((child) => collectParagraphs(child, schema, result));
}

function blockTypeForConversion(name) {
  if (name === 'text') return 'paragraph';
  if (name === 'bullet') return 'bulletList';
  if (name === 'numbered') return 'orderedList';
  if (name === 'todo') return 'taskList';
  if (name === 'quote') return 'blockquote';
  if (name === 'heading1' || name === 'heading2' || name === 'heading3') return 'heading';
  return '';
}

function buildConvertedBlocks(schema, paragraphs, target, level) {
  if (target === 'paragraph') return paragraphs;
  if (target === 'heading') return paragraphs.map((paragraph) => schema.nodes.heading.create({ level }, paragraph.content));
  if (target === 'blockquote') return [schema.nodes.blockquote.create(null, paragraphs)];
  if (target === 'bulletList' || target === 'orderedList') {
    const itemType = schema.nodes.listItem;
    return [schema.nodes[target].create(null, paragraphs.map((paragraph) => itemType.create(null, paragraph)))];
  }
  if (target === 'taskList') {
    const itemType = schema.nodes.taskItem;
    return [schema.nodes.taskList.create(null, paragraphs.map((paragraph) => itemType.create({ checked: false }, paragraph)))];
  }
  return [];
}

export function convertTopLevelBlock(state, position, targetType, level = null) {
  const block = getTopLevelBlock(state.doc, position);
  const target = blockTypeForConversion(targetType);
  const headingLevel = level || Number(String(targetType).match(/^heading([1-3])$/)?.[1] || 1);
  if (!block || !target) return null;
  if (block.node.type.name === target
    && (target !== 'heading' || block.node.attrs.level === headingLevel)) return null;
  const paragraphs = [];
  collectParagraphs(block.node, state.schema, paragraphs);
  if (!paragraphs.length) paragraphs.push(state.schema.nodes.paragraph.create());
  const replacement = buildConvertedBlocks(state.schema, paragraphs, target, headingLevel);
  if (!replacement.length) return null;
  const transaction = state.tr.replaceWith(block.position, block.position + block.node.nodeSize, Fragment.fromArray(replacement));
  return setNearbyTextSelection(transaction, block.position + 1);
}

function createListBlock(schema, kind) {
  const paragraph = schema.nodes.paragraph.create();
  if (kind === 'bullet') return schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, paragraph));
  if (kind === 'numbered') return schema.nodes.orderedList.create(null, schema.nodes.listItem.create(null, paragraph));
  if (kind === 'todo') return schema.nodes.taskList.create(null, schema.nodes.taskItem.create({ checked: false }, paragraph));
  return null;
}

export function createEmptyBlock(schema, kind) {
  if (kind === 'text') return { nodes: [schema.nodes.paragraph.create()], cursorOffset: 1 };
  if (kind === 'heading1' || kind === 'heading2' || kind === 'heading3') {
    const headingLevel = Number(kind.slice(-1));
    return { nodes: [schema.nodes.heading.create({ level: headingLevel })], cursorOffset: 1 };
  }
  if (kind === 'bullet' || kind === 'numbered' || kind === 'todo') {
    const list = createListBlock(schema, kind);
    return { nodes: [list], cursorOffset: 1 };
  }
  if (kind === 'quote') return { nodes: [schema.nodes.blockquote.create(null, schema.nodes.paragraph.create())], cursorOffset: 2 };
  if (kind === 'divider') {
    const rule = schema.nodes.horizontalRule.create();
    return { nodes: [rule, schema.nodes.paragraph.create()], cursorOffset: rule.nodeSize + 1 };
  }
  return null;
}

export function insertEmptyBlock(state, position, kind) {
  const block = createEmptyBlock(state.schema, kind);
  if (!block) return null;
  const transaction = state.tr.insert(position, Fragment.fromArray(block.nodes));
  return setNearbyTextSelection(transaction, position + block.cursorOffset);
}

export function selectTopLevelBlock(state, position) {
  const block = getTopLevelBlock(state.doc, position);
  if (!block || !NodeSelection.isSelectable(block.node)) return null;
  return state.tr.setSelection(NodeSelection.create(state.doc, block.position));
}

export function shouldDeferNoteSerialization(editor, force = false) {
  if (force) return false;
  const dom = editor?.view?.dom;
  return dom?.getAttribute('aria-haspopup') === 'listbox' && dom?.getAttribute('aria-expanded') === 'true';
}
