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

export function isSafeNoteUrl(value) {
  const url = String(value || '').trim();
  if (/[\u0000-\u001f\u007f]/.test(url)) return false;
  return /^(https?:|mailto:|#|\/(?!\/))/i.test(url)
    || /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(url)
    || /^data:video\/(?:mp4|webm|ogg);base64,/i.test(url);
}

const safeMediaTypes = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/ogg',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm',
  'application/pdf', 'application/octet-stream',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', 'text/markdown', 'text/csv',
]);

export function isSafeNoteMedia(item) {
  const type = String(item?.type || '').toLowerCase();
  const dataUrl = String(item?.dataUrl || '');
  if (!isSafeNoteMediaType(type)) return false;
  const separator = dataUrl.indexOf(',');
  return separator > 0
    && dataUrl.slice(0, separator).toLowerCase() === `data:${type};base64`
    && /^[a-z0-9+/=\r\n]+$/i.test(dataUrl.slice(separator + 1));
}

export function isSafeNoteMediaType(value) {
  return safeMediaTypes.has(String(value || '').toLowerCase());
}

function cleanInlineStyle(element) {
  const allowedProperties = new Set(['color', 'background-color', 'text-align', 'font-family', 'font-size']);
  const safeStyle = [];

  [...element.style].forEach((property) => {
    const value = element.style.getPropertyValue(property).trim();
    if (!allowedProperties.has(property) || /url\s*\(|expression|[<>]/i.test(value)) return;
    if (property === 'text-align' && !/^(left|right|center|justify)$/i.test(value)) return;
    if (property === 'font-size' && !/^(\d+(\.\d+)?(px|pt|em|rem|%)|small|medium|large|x-large|xx-large)$/i.test(value)) return;
    if (property === 'font-family' && !/^[\w\s,'-]{1,80}$/.test(value)) return;
    if ((property === 'color' || property === 'background-color') && !/^(#[\da-f]{3,8}|rgba?\([\d.,%\s]+\)|hsla?\([\d.,%\s]+\)|[a-z]{1,24})$/i.test(value)) return;
    safeStyle.push(`${property}: ${value}`);
  });

  if (safeStyle.length) element.setAttribute('style', safeStyle.join('; '));
  else element.removeAttribute('style');
}

function cleanNode(node) {
  [...node.children].forEach((child) => {
    if (!allowedTags.has(child.tagName)) {
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE'].includes(child.tagName)) {
        child.remove();
      } else {
        cleanNode(child);
        child.replaceWith(...child.childNodes);
      }
      return;
    }

    [...child.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;

      if (name.startsWith('on') || !allowedAttributes.has(name)) {
        child.removeAttribute(attribute.name);
        return;
      }

      if (name === 'style') {
        cleanInlineStyle(child);
        return;
      }

      if (name === 'class' && value !== 'note-media-block') {
        child.removeAttribute(attribute.name);
        return;
      }

      if ((name === 'href' || name === 'src') && !isSafeNoteUrl(value)) {
        child.removeAttribute(attribute.name);
      }
    });

    if (child.tagName === 'A') {
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer');
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

export function matchesNoteSearch(note, query) {
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return `${note?.title || ''} ${note?.contentText || ''} ${(note?.tags || []).join(' ')}`
    .toLocaleLowerCase()
    .includes(normalizedQuery);
}

export function getNoteLifecycleChanges(note, action, now = new Date().toISOString()) {
  const state = note?.lifecycle_state || note?.lifecycleState || 'active';
  const previous = note?.state_before_trash || note?.stateBeforeTrash || 'active';
  if (action === 'archive' && state === 'active') return { lifecycle_state: 'archived' };
  if (action === 'unarchive' && state === 'archived') return { lifecycle_state: 'active' };
  if (action === 'trash' && state !== 'trashed') return {
    lifecycle_state: 'trashed', state_before_trash: state === 'archived' ? 'archived' : 'active',
  };
  if (action === 'restore' && state === 'trashed') return { lifecycle_state: previous };
  if (action === 'pin' && state === 'active') return { pinned_at: note?.pinned_at || note?.pinnedAt ? null : now };
  return null;
}

const MAX_NOTE_HTML_BYTES = 50 * 1024 * 1024;
const MAX_NOTE_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_NOTE_MEDIA_JSON_BYTES = 45 * 1024 * 1024;
const MAX_NOTE_MEDIA_BYTES = 32 * 1024 * 1024;

export function getNoteSizeIssue({ title = '', contentHtml = '', contentText = '', tags = [], media = [] } = {}) {
  if (String(title).length > 240) return 'Note titles can be up to 240 characters.';
  if (new TextEncoder().encode(String(contentHtml)).byteLength > MAX_NOTE_HTML_BYTES) return 'This note is too large to save (50 MB maximum).';
  if (new TextEncoder().encode(String(contentText)).byteLength > MAX_NOTE_TEXT_BYTES) return 'This note contains too much searchable text (5 MB maximum).';
  if (tags.length > 12 || tags.some((tag) => String(tag).length > 128)) return 'Use up to 12 tags, with 128 characters per tag.';
  if (media.length > 24) return 'A note can have up to 24 attachments.';
  const mediaBytes = media.reduce((total, item) => total + Math.max(0, Number(item.size) || 0), 0);
  if (media.some((item) => Number(item.size) > 12 * 1024 * 1024)) return 'Each attachment must be 12 MB or smaller.';
  if (mediaBytes > MAX_NOTE_MEDIA_BYTES) return 'Attachments in a note can total up to 32 MB.';
  if (new TextEncoder().encode(JSON.stringify(media)).byteLength > MAX_NOTE_MEDIA_JSON_BYTES) return 'Attachments in a note can total up to 32 MB.';
  return null;
}
