const allowedTags = new Set([
  'A',
  'B',
  'BLOCKQUOTE',
  'BR',
  'DIV',
  'EM',
  'FONT',
  'H1',
  'H2',
  'H3',
  'H4',
  'I',
  'IMG',
  'LI',
  'OL',
  'P',
  'PRE',
  'S',
  'SPAN',
  'STRIKE',
  'STRONG',
  'SUB',
  'SUP',
  'U',
  'UL',
  'VIDEO',
]);

const allowedAttributes = new Set([
  'alt',
  'class',
  'color',
  'controls',
  'face',
  'href',
  'size',
  'src',
  'style',
  'target',
  'title',
]);

function isSafeUrl(value) {
  return /^(https?:|mailto:|data:image\/|data:video\/|#|\/)/i.test(value || '');
}

function cleanNode(node) {
  [...node.children].forEach((child) => {
    if (!allowedTags.has(child.tagName)) {
      child.replaceWith(...child.childNodes);
      return;
    }

    [...child.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;

      if (name.startsWith('on') || !allowedAttributes.has(name)) {
        child.removeAttribute(attribute.name);
        return;
      }

      if ((name === 'href' || name === 'src') && !isSafeUrl(value)) {
        child.removeAttribute(attribute.name);
      }
    });

    if (child.tagName === 'A') {
      child.setAttribute('target', '_blank');
    }

    if (child.tagName === 'VIDEO') {
      child.setAttribute('controls', 'controls');
    }

    cleanNode(child);
  });
}

export function sanitizeNoteHtml(html) {
  if (!html || typeof window === 'undefined') {
    return '';
  }

  const template = document.createElement('template');
  template.innerHTML = html;
  cleanNode(template.content);
  return template.innerHTML;
}

export function getTextFromHtml(html) {
  if (!html || typeof window === 'undefined') {
    return '';
  }

  const template = document.createElement('template');
  template.innerHTML = sanitizeNoteHtml(html);
  return (template.content.textContent || '').replace(/\s+/g, ' ').trim();
}

export function sortNotes(notes) {
  return [...notes].sort((leftNote, rightNote) => (
    (rightNote.updatedAt || rightNote.createdAt || '')
      .localeCompare(leftNote.updatedAt || leftNote.createdAt || '')
  ));
}
