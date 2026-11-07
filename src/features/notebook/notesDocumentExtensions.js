import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import ImageExtension from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TextStyle, Color, BackgroundColor, FontFamily, FontSize } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Suggestion, { exitSuggestion } from '@tiptap/suggestion';
import { PluginKey, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { isSafeNoteLink } from './noteContent.js';
import { getSlashCommands } from './noteEditorModel.js';

const slashPluginKey = new PluginKey('cboardNotesSlashCommands');

const NoteImage = ImageExtension.extend({
  addAttributes() {
    const inherited = this.parent?.() || {};
    return {
      ...inherited,
      alt: {
        ...inherited.alt,
        default: 'Image',
        parseHTML: (element) => element.hasAttribute('alt') ? element.getAttribute('alt') : 'Image',
      },
    };
  },
});

const NoteVideo = Node.create({
  name: 'noteVideo',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null }, title: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'video[src]', priority: 60 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(HTMLAttributes, { controls: 'controls', class: 'note-media-block' })];
  },
});

function simpleLegacyMark(name, tag) {
  return Mark.create({
    name,
    parseHTML() { return [{ tag }]; },
    renderHTML() { return [tag, 0]; },
    addCommands() {
      return { ['toggle' + name[0].toUpperCase() + name.slice(1)]: () => ({ commands }) => commands.toggleMark(this.name) };
    },
  });
}

const Subscript = simpleLegacyMark('subscript', 'sub');
const Superscript = simpleLegacyMark('superscript', 'sup');

function menuMarkup(props) {
  const panel = document.createElement('div');
  panel.id = 'notes-slash-menu';
  panel.className = 'notes-slash-menu';
  panel.setAttribute('role', 'listbox');
  panel.setAttribute('aria-label', 'Insert a block');
  const heading = document.createElement('div');
  heading.className = 'notes-slash-menu-heading';
  heading.textContent = 'Basic blocks';
  panel.append(heading);
  const list = document.createElement('div');
  list.className = 'notes-slash-menu-list';
  panel.append(list);
  return { panel, heading, list };
}

function createSlashExtension(actionsRef) {
  return Extension.create({
    name: 'cboardNotesSlashCommands',
    addProseMirrorPlugins() {
      return [Suggestion({
        pluginKey: slashPluginKey,
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        allowedPrefixes: [' ', '\n', '\t'],
        startOfLine: false,
        placement: 'bottom-start',
        offset: { mainAxis: 5, crossAxis: 0 },
        flip: true,
        dismissOnOutsideClick: true,
        items: ({ query }) => getSlashCommands(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          actionsRef.current?.onSlashCommand?.(props);
        },
        render: () => {
          let current = null;
          let surface = null;
          let unmount = null;
          let activeIndex = 0;
          const update = () => {
            if (!current || !surface) return;
            const items = current.items || [];
            if (activeIndex >= items.length) activeIndex = Math.max(0, items.length - 1);
            surface.list.replaceChildren();
            if (!items.length) {
              const empty = document.createElement('div');
              empty.className = 'notes-slash-menu-empty';
              empty.textContent = 'No matching blocks';
              empty.setAttribute('role', 'option');
              empty.setAttribute('aria-selected', 'false');
              surface.list.append(empty);
              current.editor.view.dom.removeAttribute('aria-activedescendant');
              return;
            }
            items.forEach((item, index) => {
              const button = document.createElement('button');
              button.type = 'button';
              button.id = 'notes-slash-option-' + index;
              button.className = 'notes-slash-menu-item';
              button.setAttribute('role', 'option');
              button.setAttribute('aria-selected', String(index === activeIndex));
              const label = document.createElement('span');
              label.className = 'notes-slash-menu-item-label';
              label.textContent = item.label;
              const description = document.createElement('span');
              description.className = 'notes-slash-menu-item-description';
              description.textContent = item.description;
              button.append(label, description);
              button.addEventListener('pointerdown', (event) => event.preventDefault());
              button.addEventListener('click', () => current?.command(item));
              surface.list.append(button);
            });
            current.editor.view.dom.setAttribute('aria-activedescendant', 'notes-slash-option-' + activeIndex);
          };
          const teardown = (editor) => {
            unmount?.();
            unmount = null;
            surface?.panel.remove();
            surface = null;
            if (editor?.view?.dom) {
              editor.view.dom.removeAttribute('aria-controls');
              editor.view.dom.removeAttribute('aria-haspopup');
              editor.view.dom.removeAttribute('aria-autocomplete');
              editor.view.dom.removeAttribute('aria-expanded');
              editor.view.dom.removeAttribute('aria-activedescendant');
            }
          };
          return {
            onStart(props) {
              current = props;
              activeIndex = 0;
              surface = menuMarkup(props);
              props.editor.view.dom.setAttribute('aria-haspopup', 'listbox');
              props.editor.view.dom.setAttribute('aria-autocomplete', 'list');
              props.editor.view.dom.setAttribute('aria-expanded', 'true');
              props.editor.view.dom.setAttribute('aria-controls', surface.panel.id);
              unmount = props.mount(surface.panel);
              update();
            },
            onUpdate(props) {
              current = props;
              activeIndex = 0;
              update();
            },
            onKeyDown({ view, event }) {
              const length = current?.items?.length || 0;
              if (event.key === 'ArrowDown' && length) {
                event.preventDefault();
                activeIndex = (activeIndex + 1) % length;
                update();
                return true;
              }
              if (event.key === 'ArrowUp' && length) {
                event.preventDefault();
                activeIndex = (activeIndex - 1 + length) % length;
                update();
                return true;
              }
              if (event.key === 'Enter' && length) {
                event.preventDefault();
                current.command(current.items[activeIndex]);
                return true;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                exitSuggestion(view, slashPluginKey);
                return true;
              }
              return false;
            },
            onExit(props) {
              teardown(props.editor);
              current = null;
              actionsRef.current?.onSlashMenuExit?.();
            },
          };
        },
      })];
    },
  });
}

export function createNotesDocumentExtensions(actionsRef) {
  const SafeLink = {
    openOnClick: false,
    autolink: false,
    linkOnPaste: true,
    isAllowedUri: (url) => isSafeNoteLink(url),
    HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
  };

  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: SafeLink,
    }),
    TextStyle,
    Color,
    BackgroundColor,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['paragraph', 'heading'] }),
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node) => 'Task: ' + (node.textContent || 'empty task') },
    }),
    NoteImage.configure({
      inline: false,
      allowBase64: true,
      HTMLAttributes: { class: 'note-media-block', loading: 'lazy', decoding: 'async' },
    }),
    NoteVideo,
    Subscript,
    Superscript,
    createSlashExtension(actionsRef),
    Extension.create({
      name: 'cboardNotesKeyboardSelection',
      addKeyboardShortcuts() {
        const editor = this.editor;
        return {
          Escape: () => {
            if (actionsRef.current?.onEscape?.()) return true;
            const selection = editor.state.selection;
            const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset);
            if (/\/[^\s]*$/.test(before)) return false;
            if (selection instanceof NodeSelection) return false;
            if (!selection.empty) {
              const transaction = editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(selection.to), 1));
              editor.view.dispatch(transaction);
              return true;
            }
            const position = selection.$from.pos;
            let blockPosition = 0;
            let found = false;
            editor.state.doc.forEach((node, offset) => {
              if (!found && position >= offset && position < offset + node.nodeSize) {
                blockPosition = offset;
                found = true;
              }
            });
            const node = editor.state.doc.nodeAt(blockPosition);
            if (!node || !NodeSelection.isSelectable(node)) return false;
            editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, blockPosition)));
            return true;
          },
          'Mod-y': () => editor.commands.redo(),
          'Mod-k': () => {
            actionsRef.current?.onLinkShortcut?.();
            return true;
          },
        };
      },
    }),
  ];
}
