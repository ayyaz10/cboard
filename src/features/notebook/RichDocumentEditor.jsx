import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Bold, Code2, Grip, ImagePlus, Italic, Link2, List, ListOrdered, MoreHorizontal, Paperclip, Palette, Plus, Quote, Redo2, Strikethrough, Underline, Undo2, X } from 'lucide-react';
import { createId } from '../progressTracker/progressTrackerStorage.js';
import { getNoteSizeIssue, isSafeNoteMedia, isSafeNoteMediaType, isSafeNoteUrl, prepareNoteHtmlForEditor, sanitizeNoteHtml } from './noteContent.js';
import { convertTopLevelBlock, createEmptyBlock, deleteTopLevelBlock, duplicateTopLevelBlock, getSlashCommands, getTopLevelBlock, insertEmptyBlock, moveTopLevelBlock, shouldDeferNoteSerialization } from './noteEditorModel.js';
import { createNotesDocumentExtensions } from './notesDocumentExtensions.js';
import './richDocumentEditor.css';

const COLOR_SWATCHES = [
  { label: 'CBoard orange', value: '#ef8744' },
  { label: 'Blue', value: '#73a6ee' },
  { label: 'Green', value: '#72b983' },
  { label: 'Rose', value: '#d17e83' },
  { label: 'Violet', value: '#a58ade' },
];
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_MEDIA_BYTES = 32 * 1024 * 1024;
const MAX_ATTACHMENTS = 24;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('This file could not be read.'));
    reader.onerror = () => reject(reader.error || new Error('This file could not be read.'));
    reader.readAsDataURL(file);
  });
}

function inferredFileType(file) {
  if (file.type) return file.type.toLowerCase();
  const extension = String(file.name || '').split('.').pop().toLowerCase();
  const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv' };
  return types[extension] || 'application/octet-stream';
}

function safeLinkHref(value) {
  const input = String(value || '').trim();
  if (!input || /[\u0000-\u001f\u007f]/.test(input) || /^data:/i.test(input) || /^javascript:/i.test(input)) return '';
  const normalized = /^[a-z][a-z\d+.-]*:/i.test(input) || input.startsWith('/') || input.startsWith('#')
    ? input
    : 'https://' + input;
  return isSafeNoteUrl(normalized) && !normalized.startsWith('//') ? normalized : '';
}


function SelectionToolbar({ editor, onError }) {
  const [colorsOpen, setColorsOpen] = useState(false);
  useEffect(() => {
    if (!editor) return undefined;
    const closeColorPopover = () => setColorsOpen(false);
    const onEscape = (event) => { if (event.key === 'Escape') closeColorPopover(); };
    editor.on('blur', closeColorPopover);
    editor.on('selectionUpdate', closeColorPopover);
    document.addEventListener('keydown', onEscape);
    return () => {
      editor.off('blur', closeColorPopover);
      editor.off('selectionUpdate', closeColorPopover);
      document.removeEventListener('keydown', onEscape);
    };
  }, [editor]);

  const selectionState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: Boolean(currentEditor?.isActive('bold')),
      italic: Boolean(currentEditor?.isActive('italic')),
      underline: Boolean(currentEditor?.isActive('underline')),
      strike: Boolean(currentEditor?.isActive('strike')),
      code: Boolean(currentEditor?.isActive('code')),
      link: Boolean(currentEditor?.isActive('link')),
      href: currentEditor?.getAttributes('link')?.href || '',
    }),
  });

  if (!editor) return null;

  function setLink() {
    const currentHref = editor.getAttributes('link').href || '';
    const nextValue = window.prompt(currentHref ? 'Edit link URL. Leave empty to remove it.' : 'Paste or type a link URL.', currentHref);
    if (nextValue === null) return;
    if (!nextValue.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    const href = safeLinkHref(nextValue);
    if (!href) {
      onError('Use a safe http, https, mailto, page, or anchor link.');
      return;
    }
    editor.chain().focus().setLink({ href, target: '_blank', rel: 'noopener noreferrer' }).run();
  }

  function applyColor(value, mode) {
    if (mode === 'highlight') {
      if (value) editor.chain().focus().setHighlight({ color: value }).run();
      else editor.chain().focus().unsetHighlight().run();
    } else if (value) {
      editor.chain().focus().setColor(value).run();
    } else {
      editor.chain().focus().unsetColor().run();
    }
    setColorsOpen(false);
  }

  function openLink() {
    const href = safeLinkHref(selectionState?.href);
    if (href) window.open(href, '_blank', 'noopener,noreferrer');
  }

  const toolButton = (label, icon, active, onClick) => (
    <button type="button" className="notes-format-button" aria-label={label} title={label} aria-pressed={Boolean(active)} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
      {icon}
    </button>
  );

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="notes-selection-toolbar"
      className="notes-selection-toolbar"
      shouldShow={({ editor: currentEditor }) => {
        const selection = currentEditor.state.selection;
        return currentEditor.isFocused && !selection.empty && !selection.node && Boolean(currentEditor.state.doc.textBetween(selection.from, selection.to, ' ').trim());
      }}
    >
      <div className="notes-format-tools" role="toolbar" aria-label="Format selected text" onMouseDown={(event) => event.preventDefault()}>
        {toolButton('Bold', <Bold size={16} aria-hidden="true" />, selectionState?.bold, () => editor.chain().focus().toggleBold().run())}
        {toolButton('Italic', <Italic size={16} aria-hidden="true" />, selectionState?.italic, () => editor.chain().focus().toggleItalic().run())}
        {toolButton('Underline', <Underline size={16} aria-hidden="true" />, selectionState?.underline, () => editor.chain().focus().toggleUnderline().run())}
        {toolButton('Strikethrough', <Strikethrough size={16} aria-hidden="true" />, selectionState?.strike, () => editor.chain().focus().toggleStrike().run())}
        {toolButton('Inline code', <Code2 size={16} aria-hidden="true" />, selectionState?.code, () => editor.chain().focus().toggleCode().run())}
        {toolButton(selectionState?.link ? 'Edit or remove link' : 'Add link', <Link2 size={16} aria-hidden="true" />, selectionState?.link, setLink)}
        {selectionState?.link && toolButton('Open link in a new tab', <Link2 size={15} aria-hidden="true" />, false, openLink)}
        <div className="notes-color-control">
          <button type="button" className="notes-format-button" aria-label="Text color and highlight" aria-expanded={colorsOpen} title="Text color and highlight" onMouseDown={(event) => event.preventDefault()} onClick={() => setColorsOpen((value) => !value)}>
            <Palette size={16} aria-hidden="true" />
          </button>
          {colorsOpen && <div className="notes-color-popover" aria-label="Text colors and highlights" role="group" onMouseDown={(event) => event.preventDefault()}>
            <strong>Text color</strong>
            <div className="notes-color-swatches">
              {COLOR_SWATCHES.map((swatch) => <button key={'text-' + swatch.value} type="button" aria-label={swatch.label + ' text'} title={swatch.label + ' text'} style={{ '--swatch': swatch.value }} onClick={() => applyColor(swatch.value, 'text')} />)}
              <button type="button" className="notes-color-reset" onClick={() => applyColor('', 'text')}>Default</button>
            </div>
            <strong>Highlight</strong>
            <div className="notes-color-swatches">
              {COLOR_SWATCHES.map((swatch) => <button key={'mark-' + swatch.value} type="button" aria-label={swatch.label + ' highlight'} title={swatch.label + ' highlight'} style={{ '--swatch': swatch.value }} onClick={() => applyColor(swatch.value, 'highlight')} />)}
              <button type="button" className="notes-color-reset" onClick={() => applyColor('', 'highlight')}>Clear</button>
            </div>
          </div>}
        </div>
      </div>
    </BubbleMenu>
  );
}

function ImageToolbar({ editor, onEditAlt, onReplace, onRemove }) {
  if (!editor) return null;
  return (
    <BubbleMenu editor={editor} pluginKey="notes-image-toolbar" className="notes-image-toolbar" shouldShow={({ editor: currentEditor }) => currentEditor.isFocused && currentEditor.isActive('image')}>
      <div role="toolbar" aria-label="Image actions" className="notes-image-tools" onMouseDown={(event) => event.preventDefault()}>
        <button type="button" onClick={onEditAlt}>Edit alt text</button>
        <button type="button" onClick={onReplace}>Replace image</button>
        <button type="button" onClick={onRemove}>Remove image</button>
      </div>
    </BubbleMenu>
  );
}

function ActionPanel({ block, onConvert, onMove, onDuplicate, onDelete, onClose }) {
  if (!block) return null;
  return (
    <div className="notes-block-action-panel" role="group" aria-label="Block actions" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
      <details>
        <summary>Turn into</summary>
        <div className="notes-block-conversions" role="group" aria-label="Turn block into">
          <button type="button" onClick={() => onConvert(block.position, 'text')}>Text</button>
          <button type="button" onClick={() => onConvert(block.position, 'heading1')}>Heading 1</button>
          <button type="button" onClick={() => onConvert(block.position, 'heading2')}>Heading 2</button>
          <button type="button" onClick={() => onConvert(block.position, 'heading3')}>Heading 3</button>
          <button type="button" onClick={() => onConvert(block.position, 'bullet')}>Bulleted list</button>
          <button type="button" onClick={() => onConvert(block.position, 'numbered')}>Numbered list</button>
          <button type="button" onClick={() => onConvert(block.position, 'todo')}>To-do</button>
          <button type="button" onClick={() => onConvert(block.position, 'quote')}>Quote</button>
        </div>
      </details>
      <button type="button" onClick={() => onDuplicate(block.position)}>Duplicate</button>
      <button type="button" onClick={() => onMove(block.position, -1)}>Move up</button>
      <button type="button" onClick={() => onMove(block.position, 1)}>Move down</button>
      <button type="button" className="notes-block-delete" onClick={() => onDelete(block.position)}>Delete block</button>
    </div>
  );
}

function InsertPanel({ onInsert, onAttach, onClose }) {
  return (
    <div className="notes-insert-panel" aria-label="Insert a block" role="group" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
      {getSlashCommands('').map((item) => (
        <button type="button" key={item.id} onClick={() => onInsert(item.id)}>{item.label}</button>
      ))}
      <span className="notes-insert-divider" aria-hidden="true" />
      <button type="button" onClick={onAttach}><Paperclip size={14} aria-hidden="true" />Attach a file</button>
    </div>
  );
}

export function RichDocumentEditor({ value = '', onChange = () => {}, media = [], onMediaChange = () => {}, ariaLabel = 'Note content', editorApiRef }) {
  const imageInputRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const pendingImageRef = useRef(null);
  const mediaRef = useRef(media);
  const onChangeRef = useRef(onChange);
  const onMediaChangeRef = useRef(onMediaChange);
  const serializedHtmlRef = useRef('');
  const serializationTimerRef = useRef(null);
  const deferredSerializationRef = useRef(false);
  const retryUploadRef = useRef(null);
  const uploadImageRef = useRef(null);
  const imageQueueRef = useRef(Promise.resolve());
  const slashActionsRef = useRef({});
  const flushContentRef = useRef(null);
  const [hoveredBlock, setHoveredBlock] = useState(null);
  const [keyboardBlock, setKeyboardBlock] = useState(null);
  const [menu, setMenu] = useState('');
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const announcementTimerRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [canRetryUpload, setCanRetryUpload] = useState(false);
  const [saveAnnouncement, setSaveAnnouncement] = useState('');

  onChangeRef.current = onChange;
  onMediaChangeRef.current = onMediaChange;
  mediaRef.current = media;

  const extensions = useMemo(() => createNotesDocumentExtensions(slashActionsRef), []);
  const queueImageFiles = useCallback((files, target) => {
    const batch = Array.from(files || []);
    if (!batch.length) return;
    imageQueueRef.current = imageQueueRef.current.catch(() => {}).then(async () => {
      for (const file of batch) await uploadImageRef.current?.(file, target);
    });
  }, []);
  const queueImageFilesRef = useRef(queueImageFiles);
  queueImageFilesRef.current = queueImageFiles;
  const editor = useEditor({
    extensions,
    content: prepareNoteHtmlForEditor(value || ''),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        spellcheck: 'true',
        class: 'notes-document-canvas',
      },
      transformPastedHTML: (html) => sanitizeNoteHtml(html),
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files || [])].filter((file) => file.type.toLowerCase().startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        const bookmark = editor?.state.selection.getBookmark();
        window.setTimeout(() => queueImageFilesRef.current?.(files, { mode: 'selection', bookmark }), 0);
        return true;
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.toLowerCase().startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (coordinates) {
          const selection = TextSelection.near(view.state.doc.resolve(coordinates.pos));
          view.dispatch(view.state.tr.setSelection(selection));
        }
        const bookmark = view.state.selection.getBookmark();
        window.setTimeout(() => queueImageFilesRef.current?.(files, { mode: 'selection', bookmark }), 0);
        return true;
      },
    },
    onUpdate: ({ editor: currentEditor }) => scheduleSerializationRef.current?.(currentEditor),
    onBlur: () => flushContentRef.current?.(true),
    onSelectionUpdate: ({ editor: currentEditor }) => {
      const selection = currentEditor.state.selection;
      if (selection instanceof NodeSelection) {
        const next = getTopLevelBlock(currentEditor.state.doc, selection.from);
        setKeyboardBlock((current) => current?.position === next?.position ? current : next);
      } else {
        setKeyboardBlock((current) => current ? null : current);
      }
    },
  }, [extensions]);

  const flushContent = useCallback((schedule = false, force = false) => {
    if (!editor || editor.isDestroyed) return '';
    window.clearTimeout(serializationTimerRef.current);
    serializationTimerRef.current = null;
    if (shouldDeferNoteSerialization(editor, force)) {
      deferredSerializationRef.current = true;
      return editor.getHTML();
    }
    deferredSerializationRef.current = false;
    const html = sanitizeNoteHtml(editor.getHTML());
    if (html !== serializedHtmlRef.current) {
      serializedHtmlRef.current = html;
      onChangeRef.current(html, schedule);
    }
    return html;
  }, [editor]);

  const scheduleSerialization = useCallback((currentEditor) => {
    window.clearTimeout(serializationTimerRef.current);
    serializationTimerRef.current = window.setTimeout(() => {
      if (!currentEditor.isDestroyed) flushContent(true);
    }, 180);
  }, [flushContent]);
  const scheduleSerializationRef = useRef(scheduleSerialization);
  scheduleSerializationRef.current = scheduleSerialization;

  useEffect(() => {
    if (!editor) return undefined;
    const initialHtml = sanitizeNoteHtml(editor.getHTML());
    serializedHtmlRef.current = initialHtml;
    flushContentRef.current = flushContent;
    if (editorApiRef) {
      editorApiRef.current = {
        flush: () => flushContent(false, true),
        focus: () => editor.commands.focus(),
      };
    }
    return () => {
      window.clearTimeout(serializationTimerRef.current);
      window.clearTimeout(announcementTimerRef.current);
      if (editorApiRef?.current?.flush) editorApiRef.current = null;
      flushContentRef.current = null;
    };
  }, [editor, editorApiRef, flushContent]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const prepared = prepareNoteHtmlForEditor(value || '');
    const preparedHtml = sanitizeNoteHtml(prepared);
    const currentHtml = sanitizeNoteHtml(editor.getHTML());
    if (preparedHtml !== currentHtml) {
      window.clearTimeout(serializationTimerRef.current);
      editor.commands.setContent(prepared, { emitUpdate: false });
      serializedHtmlRef.current = sanitizeNoteHtml(editor.getHTML());
    }
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return undefined;
    slashActionsRef.current.onSlashMenuExit = () => {
      if (!deferredSerializationRef.current) return;
      deferredSerializationRef.current = false;
      flushContentRef.current?.(false, true);
    };
    slashActionsRef.current.onSlashCommand = (item) => {
      if (item.id === 'image') {
        openImagePicker({ mode: 'selection', bookmark: editor.state.selection.getBookmark() });
        return;
      }
      if (item.id === 'divider') {
        editor.chain().focus().setHorizontalRule().run();
        return;
      }
      const block = getTopLevelBlock(editor.state.doc, editor.state.selection.from);
      if (!block) return;
      const transaction = convertTopLevelBlock(editor.state, block.position, item.id);
      if (transaction) editor.view.dispatch(transaction);
    };
    slashActionsRef.current.onEscape = () => {
      if (!menuRef.current) return false;
      setMenu('');
      return true;
    };
    slashActionsRef.current.onLinkShortcut = () => {
      const currentHref = editor.getAttributes('link').href || '';
      const nextValue = window.prompt(currentHref ? 'Edit link URL. Leave empty to remove it.' : 'Paste or type a link URL.', currentHref);
      if (nextValue === null) return;
      if (!nextValue.trim()) {
        editor.chain().focus().extendMarkRange('link').unsetLink().run();
        return;
      }
      const href = safeLinkHref(nextValue);
      if (!href) {
        setUploadError('Use a safe http, https, mailto, page, or anchor link.');
        return;
      }
      editor.chain().focus().setLink({ href, target: '_blank', rel: 'noopener noreferrer' }).run();
    };
    return () => {
      delete slashActionsRef.current.onSlashMenuExit;
      delete slashActionsRef.current.onSlashCommand;
      delete slashActionsRef.current.onLinkShortcut;
      delete slashActionsRef.current.onEscape;
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return undefined;
    const onPageHide = () => flushContent(false, true);
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [editor, flushContent]);

  const updateMedia = useCallback((nextMedia) => {
    mediaRef.current = nextMedia;
    onMediaChangeRef.current(nextMedia);
  }, []);

  const validateMedia = useCallback((file, currentMedia) => {
    if (currentMedia.length >= MAX_ATTACHMENTS) return 'A note can have up to 24 attachments.';
    if (file.size > MAX_FILE_BYTES) return file.name + ' is larger than 12 MB.';
    const currentBytes = currentMedia.reduce((total, item) => total + (Number(item.size) || 0), 0);
    if (currentBytes + file.size > MAX_MEDIA_BYTES) return 'Attachments in a note can total up to 32 MB.';
    const type = inferredFileType(file);
    if (!isSafeNoteMediaType(type)) return file.name + ' uses a file type that Notes cannot attach safely.';
    return '';
  }, []);

  const addAttachment = useCallback(async (file) => {
    const currentMedia = mediaRef.current || [];
    const problem = validateMedia(file, currentMedia);
    if (problem) throw new Error(problem);
    const type = inferredFileType(file);
    const dataUrl = await fileToDataUrl(file);
    const latestMedia = mediaRef.current || [];
    const latestProblem = validateMedia(file, latestMedia);
    if (latestProblem) throw new Error(latestProblem);
    const attachment = { id: createId('media'), name: file.name, type, size: file.size, dataUrl, createdAt: new Date().toISOString() };
    const nextMedia = [...latestMedia, attachment];
    const sizeIssue = getNoteSizeIssue({ media: nextMedia });
    if (sizeIssue) throw new Error(sizeIssue);
    updateMedia(nextMedia);
    return attachment;
  }, [updateMedia, validateMedia]);

  const insertImage = useCallback((dataUrl, file, target) => {
    if (!editor || editor.isDestroyed) return false;
    const alt = String(file.name || 'Image').slice(0, 500);
    if (target?.mode === 'replace' && editor.isActive('image')) {
      editor.chain().focus().updateAttributes('image', { src: dataUrl, alt }).run();
      return true;
    }
    if (target?.mode === 'before-block' && Number.isInteger(target.position)) {
      const imageNode = editor.schema.nodes.image.create({ src: dataUrl, alt });
      const paragraph = editor.schema.nodes.paragraph.create();
      const transaction = editor.state.tr.insert(target.position, imageNode).insert(target.position + imageNode.nodeSize, paragraph);
      const caret = target.position + imageNode.nodeSize + 1;
      editor.view.dispatch(transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(caret, transaction.doc.content.size)))));
      editor.view.focus();
      return true;
    }
    if (target?.bookmark) {
      try {
        const selection = target.bookmark.resolve(editor.state.doc);
        editor.view.dispatch(editor.state.tr.setSelection(selection));
      } catch { /* A stale bookmark falls back to the current caret. */ }
    }
    editor.chain().focus().setImage({ src: dataUrl, alt }).run();
    return true;
  }, [editor]);

  const processImageFile = useCallback(async (file, target, retry = false) => {
    if (!file || !editor) return;
    const type = inferredFileType(file);
    const currentMedia = mediaRef.current || [];
    const problem = validateMedia(file, currentMedia);
    if (problem) {
      setUploadError(problem);
      setCanRetryUpload(false);
      return;
    }
    if (!type.startsWith('image/')) {
      setUploadError(file.name + ' is not an image.');
      setCanRetryUpload(false);
      return;
    }
    setIsUploading(true);
    setUploadError('');
    setCanRetryUpload(false);
    if (!retry) retryUploadRef.current = { file, target };
    try {
      const dataUrl = await fileToDataUrl(file);
      if (!isSafeNoteUrl(dataUrl)) throw new Error('This image format cannot be inserted safely.');
      const latestMedia = mediaRef.current || [];
      const latestProblem = validateMedia(file, latestMedia);
      if (latestProblem) throw new Error(latestProblem);
      const attachment = { id: createId('media'), name: file.name, type, size: file.size, dataUrl, createdAt: new Date().toISOString() };
      const replacedSource = target?.mode === 'replace' ? editor.getAttributes('image')?.src : '';
      const retainedMedia = replacedSource ? latestMedia.filter((item) => item.dataUrl !== replacedSource) : latestMedia;
      const nextMedia = [...retainedMedia, attachment];
      const sizeIssue = getNoteSizeIssue({ media: nextMedia });
      if (sizeIssue) throw new Error(sizeIssue);
      updateMedia(nextMedia);
      insertImage(dataUrl, file, target);
      retryUploadRef.current = null;
      setSaveAnnouncement('Image added to note.');
      window.clearTimeout(announcementTimerRef.current);
      announcementTimerRef.current = window.setTimeout(() => setSaveAnnouncement(''), 3000);
      setUploadError('');
    } catch (error) {
      setUploadError(error.message || 'Image upload failed. Your note content is still here.');
      setCanRetryUpload(Boolean(retryUploadRef.current));
    } finally {
      setIsUploading(false);
    }
  }, [editor, insertImage, updateMedia, validateMedia]);

  uploadImageRef.current = processImageFile;

  function openImagePicker(target) {
    pendingImageRef.current = target || { mode: 'selection', bookmark: editor?.state.selection.getBookmark() };
    imageInputRef.current?.click();
  }

  async function handleAttachmentInput(event) {
    const files = [...(event.currentTarget.files || [])];
    event.currentTarget.value = '';
    setUploadError('');
    const bookmark = editor?.state.selection.getBookmark();
    for (const file of files) {
      try {
        const type = inferredFileType(file);
        if (type.startsWith('image/')) {
          await processImageFile(file, { mode: 'selection', bookmark });
        } else {
          const attachment = await addAttachment(file);
          if (type.startsWith('video/')) {
            editor?.chain().focus().insertContent({ type: 'noteVideo', attrs: { src: attachment.dataUrl, title: file.name } }).run();
          }
        }
      } catch (error) {
        setUploadError(error.message || 'Could not attach this file.');
        break;
      }
    }
  }

  function handleImageInput(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    const target = pendingImageRef.current || { mode: 'selection', bookmark: editor?.state.selection.getBookmark() };
    pendingImageRef.current = null;
    if (file) void processImageFile(file, target);
  }

  function retryFailedUpload() {
    const pending = retryUploadRef.current;
    if (pending) queueImageFiles([pending.file], pending.target);
  }

  function activePosition() {
    const selection = editor?.state.selection;
    return selection ? getTopLevelBlock(editor.state.doc, selection.from)?.position ?? editor.state.doc.content.size : 0;
  }

  function insertBlock(kind, position = null) {
    if (!editor) return;
    const insertionPosition = Number.isInteger(position) ? position : activePosition();
    if (kind === 'image') {
      openImagePicker({ mode: 'before-block', position: insertionPosition });
      setMenu('');
      return;
    }
    const transaction = insertEmptyBlock(editor.state, insertionPosition, kind);
    if (transaction) editor.view.dispatch(transaction);
    setMenu('');
    editor.view.focus();
  }

  function convertBlock(position, kind) {
    if (!editor) return;
    const transaction = convertTopLevelBlock(editor.state, position, kind);
    if (transaction) editor.view.dispatch(transaction);
    setMenu('');
  }

  function moveBlock(position, direction) {
    if (!editor) return;
    const transaction = moveTopLevelBlock(editor.state, position, direction);
    if (transaction) editor.view.dispatch(transaction);
    setMenu('');
  }

  function duplicateBlock(position) {
    if (!editor) return;
    const transaction = duplicateTopLevelBlock(editor.state, position);
    if (transaction) editor.view.dispatch(transaction);
    setMenu('');
  }

  function removeBlock(position) {
    if (!editor) return;
    const transaction = deleteTopLevelBlock(editor.state, position);
    if (transaction) editor.view.dispatch(transaction);
    setMenu('');
  }

  function handleInsert(kind, position) {
    if (kind === 'image') {
      openImagePicker({ mode: 'before-block', position: Number.isInteger(position) ? position : activePosition() });
      setMenu('');
      return;
    }
    if (kind === 'divider') {
      insertBlock('divider', position);
      return;
    }
    insertBlock(kind, position);
  }

  function editAltText() {
    const current = editor?.getAttributes('image')?.alt || '';
    const next = window.prompt('Describe this image for screen readers.', current);
    if (next === null) return;
    editor.chain().focus().updateAttributes('image', { alt: next.trim().slice(0, 500) }).run();
  }

  function replaceImage() {
    const selection = editor?.state.selection;
    openImagePicker({ mode: 'replace', bookmark: selection?.getBookmark(), position: selection?.from });
  }

  function removeImage() {
    const source = editor?.getAttributes('image')?.src;
    editor?.chain().focus().deleteSelection().run();
    if (source && String(source).startsWith('data:')) {
      const nextMedia = (mediaRef.current || []).filter((item) => item.dataUrl !== source);
      updateMedia(nextMedia);
    }
  }

  useEffect(() => {
    if (!editor) return undefined;
    const closeFromOutside = (event) => {
      if (!menuRef.current) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.notes-block-handle-root, .notes-keyboard-block-actions, .notes-mobile-toolbar, .notes-mobile-insert-popover, .notes-slash-menu')) return;
      setMenu('');
      setKeyboardBlock(null);
    };
    document.addEventListener('pointerdown', closeFromOutside, true);
    return () => document.removeEventListener('pointerdown', closeFromOutside, true);
  }, [editor]);

  const renderActionPanel = (position) => {
    const block = editor ? getTopLevelBlock(editor.state.doc, position) : null;
    return <ActionPanel block={block} onConvert={convertBlock} onMove={moveBlock} onDuplicate={duplicateBlock} onDelete={removeBlock} onClose={() => { setMenu(''); editor?.view.focus(); }} />;
  };

  const renderInsertPanel = (position) => (
    <InsertPanel onInsert={(kind) => handleInsert(kind, position)} onClose={() => { setMenu(''); editor?.view.focus(); }} onAttach={() => { attachmentInputRef.current?.click(); setMenu(''); }} />
  );

  const keyboardPosition = keyboardBlock?.position;
  const keyboardCurrentBlock = editor && Number.isInteger(keyboardPosition) ? getTopLevelBlock(editor.state.doc, keyboardPosition) : null;

  return (
    <div className="notes-document-editor" data-notes-document-editor>
      <div className="notes-document-tools">
        <button type="button" className="notes-document-attach" onClick={() => attachmentInputRef.current?.click()} aria-label="Attach a file to this note">
          <Paperclip size={15} aria-hidden="true" /><span>Attach file</span>
        </button>
        <div className="notes-document-history" role="group" aria-label="Document history">
          <button type="button" className="notes-history-button" aria-label="Undo" title="Undo" disabled={!editor?.can().undo()} onMouseDown={(event) => event.preventDefault()} onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={16} aria-hidden="true" /></button>
          <button type="button" className="notes-history-button" aria-label="Redo" title="Redo" disabled={!editor?.can().redo()} onMouseDown={(event) => event.preventDefault()} onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={16} aria-hidden="true" /></button>
        </div>
      </div>

      {keyboardCurrentBlock && <div className="notes-keyboard-block-actions" role="group" aria-label="Selected block actions">
        <span>Block selected</span>
        <details>
          <summary>Turn into</summary>
          <div className="notes-block-conversions" role="group" aria-label="Turn selected block into">
            <button type="button" onClick={() => convertBlock(keyboardCurrentBlock.position, 'text')}>Text</button>
            <button type="button" onClick={() => convertBlock(keyboardCurrentBlock.position, 'heading1')}>Heading 1</button>
            <button type="button" onClick={() => convertBlock(keyboardCurrentBlock.position, 'heading2')}>Heading 2</button>
            <button type="button" onClick={() => convertBlock(keyboardCurrentBlock.position, 'heading3')}>Heading 3</button>
            <button type="button" onClick={() => convertBlock(keyboardCurrentBlock.position, 'bullet')}>Bulleted list</button>
            <button type="button" onClick={() => convertBlock(keyboardCurrentBlock.position, 'numbered')}>Numbered list</button>
            <button type="button" onClick={() => convertBlock(keyboardCurrentBlock.position, 'todo')}>To-do</button>
            <button type="button" onClick={() => convertBlock(keyboardCurrentBlock.position, 'quote')}>Quote</button>
          </div>
        </details>
        <button type="button" onClick={() => duplicateBlock(keyboardCurrentBlock.position)}>Duplicate</button>
        <button type="button" onClick={() => moveBlock(keyboardCurrentBlock.position, -1)}>Move up</button>
        <button type="button" onClick={() => moveBlock(keyboardCurrentBlock.position, 1)}>Move down</button>
        <button type="button" className="notes-block-delete" onClick={() => removeBlock(keyboardCurrentBlock.position)}>Delete block</button>
        <button type="button" aria-label="Insert a block before selected block" onClick={() => setMenu(menu === 'keyboard-insert' ? '' : 'keyboard-insert')}>+ Insert</button>
        {menu === 'keyboard-insert' && renderInsertPanel(keyboardCurrentBlock.position)}
      </div>}

      <EditorContent editor={editor} className="notes-document-content" onBlur={() => flushContent(true)} />

      {menu === 'mobile-insert' && <div className="notes-mobile-insert-popover">{renderInsertPanel(activePosition())}</div>}
      <div className="notes-mobile-toolbar" role="toolbar" aria-label="Document tools">
        <button type="button" aria-label="Insert block" title="Insert block" aria-expanded={menu === 'mobile-insert'} onMouseDown={(event) => event.preventDefault()} onClick={() => setMenu(menu === 'mobile-insert' ? '' : 'mobile-insert')}><Plus size={18} aria-hidden="true" /></button>
        <button type="button" aria-label="Bold" title="Bold" onMouseDown={(event) => event.preventDefault()} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={17} aria-hidden="true" /></button>
        <button type="button" aria-label="Italic" title="Italic" onMouseDown={(event) => event.preventDefault()} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={17} aria-hidden="true" /></button>
        <button type="button" aria-label="Bulleted list" title="Bulleted list" onMouseDown={(event) => event.preventDefault()} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={17} aria-hidden="true" /></button>
        <button type="button" aria-label="Insert image" title="Insert image" onMouseDown={(event) => event.preventDefault()} onClick={() => openImagePicker({ mode: 'selection', bookmark: editor?.state.selection.getBookmark() })}><ImagePlus size={17} aria-hidden="true" /></button>
        <button type="button" aria-label="Attach a file" title="Attach a file" onClick={() => attachmentInputRef.current?.click()}><Paperclip size={17} aria-hidden="true" /></button>
        <button type="button" aria-label="Block actions" title="Block actions" onMouseDown={(event) => event.preventDefault()} onClick={() => { const block = editor ? getTopLevelBlock(editor.state.doc, editor.state.selection.from) : null; setKeyboardBlock(block); }}><MoreHorizontal size={17} aria-hidden="true" /></button>
      </div>

      {editor && <DragHandle
        editor={editor}
        className={`notes-block-handle-root${hoveredBlock ? ' is-visible' : ''}`}
        computePositionConfig={{ placement: 'left-start', strategy: 'fixed' }}
        onNodeChange={({ node, pos }) => {
          if (!node) {
            setHoveredBlock(null);
            if (menu === 'hover-actions' || menu === 'hover-insert') setMenu('');
            return;
          }
          const next = { node, position: pos };
          setHoveredBlock((current) => current?.position === next.position && current.node.type.name === node.type.name ? current : next);
        }}
      >
        <div className="notes-block-handle-group" data-notes-menu-root onKeyDown={(event) => { if (event.key === 'Escape') setMenu(''); }}>
          <button type="button" className="notes-block-insert-button" aria-label="Insert a block above" title="Insert a block" onPointerDown={(event) => event.preventDefault()} onClick={() => setMenu(menu === 'hover-insert' ? '' : 'hover-insert')}><Plus size={15} aria-hidden="true" /></button>
          <button type="button" className="notes-block-action-button" aria-label="Block options and drag handle" title="Block options; drag to move" onPointerDown={(event) => { if (event.button !== 0) event.preventDefault(); }} onClick={() => setMenu(menu === 'hover-actions' ? '' : 'hover-actions')}><Grip size={15} aria-hidden="true" /></button>
          {menu === 'hover-insert' && renderInsertPanel(hoveredBlock?.position)}
          {menu === 'hover-actions' && renderActionPanel(hoveredBlock?.position)}
        </div>
      </DragHandle>}

      <SelectionToolbar editor={editor} onError={(message) => setUploadError(message)} />
      <ImageToolbar editor={editor} onEditAlt={editAltText} onReplace={replaceImage} onRemove={removeImage} />

      {isUploading && <div className="notes-upload-status" role="status" aria-live="polite">Adding image…</div>}
      {saveAnnouncement && <div className="notes-upload-status" role="status" aria-live="polite">{saveAnnouncement}</div>}
      {uploadError && <div className="notes-upload-error" role="alert">
        <span>{uploadError}</span>
        {canRetryUpload && <button type="button" onClick={retryFailedUpload}>Retry</button>}
        <button type="button" aria-label="Dismiss upload error" onClick={() => setUploadError('')}><X size={14} aria-hidden="true" /></button>
      </div>}

      <input ref={imageInputRef} className="notes-hidden-file-input" type="file" tabIndex={-1} aria-hidden="true" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleImageInput} />
      <input ref={attachmentInputRef} className="notes-hidden-file-input" type="file" tabIndex={-1} aria-hidden="true" multiple accept="image/*,video/*,audio/*,.pdf,.txt,.md,.doc,.docx,.csv" onChange={handleAttachmentInput} />
    </div>
  );
}
