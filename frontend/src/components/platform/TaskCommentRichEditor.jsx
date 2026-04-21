import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Mention from '@tiptap/extension-mention';
import DOMPurify from 'dompurify';
import {
  Bold,
  ChevronDown,
  HelpCircle,
  Italic,
  List,
  ListOrdered,
  MoreHorizontal,
  Paperclip,
  Plus,
  Type,
} from 'lucide-react';
import { mentionUserHandle } from '../../utils/taskMentions.js';

const PURIFY_COMMENT = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    'u',
    's',
    'strike',
    'code',
    'pre',
    'h1',
    'h2',
    'h3',
    'h4',
    'ul',
    'ol',
    'li',
    'a',
    'blockquote',
    'hr',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
};

export function looksLikeHtml(s) {
  if (!s || typeof s !== 'string') return false;
  return /<\/?[a-z][\s\S]*>/i.test(s.trim());
}

export function TaskCommentBodyDisplay({ body }) {
  if (!body?.trim()) return null;
  if (!looksLikeHtml(body)) {
    return <p className="task-card-modal__comment-text">{body}</p>;
  }
  const safe = DOMPurify.sanitize(body, PURIFY_COMMENT);
  return <div className="task-card-modal__comment-html" dangerouslySetInnerHTML={{ __html: safe }} />;
}

function ToolbarDivider() {
  return <span className="task-card-modal__rte-divider" aria-hidden />;
}

function mentionUserLabel(user) {
  const first = String(user?.firstName || '').trim();
  const last = String(user?.lastName || '').trim();
  const fullName = [first, last].filter(Boolean).join(' ').trim();
  const email = String(user?.email || '').trim();
  if (fullName && email) return `${fullName} · ${email}`;
  return email || fullName || 'Unknown user';
}

function createMentionSuggestion(userOptions) {
  function filteredUsers(query) {
    const q = String(query || '').trim().toLowerCase();
    const source = Array.isArray(userOptions) ? userOptions : [];
    if (!q) return source.slice(0, 8);
    return source
      .filter((u) => {
        const email = String(u?.email || '').toLowerCase();
        const first = String(u?.firstName || '').toLowerCase();
        const last = String(u?.lastName || '').toLowerCase();
        const full = `${first} ${last}`.trim();
        return email.includes(q) || first.includes(q) || last.includes(q) || full.includes(q);
      })
      .slice(0, 8);
  }

  return {
    char: '@',
    items: ({ query }) => filteredUsers(query),
    command: ({ editor, range, props }) => {
      const handle = String(mentionUserHandle(props) || '').trim();
      if (!handle) return;
      editor
        .chain()
        .focus()
        .insertContentAt(range, `@${handle} `)
        .run();
    },
    render: () => {
      let root = null;
      let selectedIndex = 0;
      let currentProps = null;

      function cleanup() {
        if (root && root.parentNode) root.parentNode.removeChild(root);
        root = null;
      }

      function pickIndex(nextIndex, count) {
        if (!count) return 0;
        if (nextIndex < 0) return count - 1;
        if (nextIndex >= count) return 0;
        return nextIndex;
      }

      function selectCurrent() {
        const items = currentProps?.items || [];
        const item = items[selectedIndex];
        if (item) currentProps?.command(item);
      }

      function renderMenu() {
        if (!root || !currentProps?.clientRect) return;
        const items = currentProps.items || [];
        if (!items.length) {
          root.innerHTML = '<div class="task-card-modal__mention-empty">No matching users</div>';
        } else {
          root.innerHTML = items
            .map((user, idx) => {
              const active = idx === selectedIndex ? ' task-card-modal__mention-item--active' : '';
              const label = mentionUserLabel(user);
              const email = String(user?.email || '');
              return `<button type="button" class="task-card-modal__mention-item${active}" data-mention-index="${idx}" title="${label}">${label || email}</button>`;
            })
            .join('');
        }
        const rect = currentProps.clientRect();
        if (!rect) return;
        root.style.left = `${Math.round(rect.left + window.scrollX)}px`;
        root.style.top = `${Math.round(rect.bottom + window.scrollY + 6)}px`;
      }

      function onClick(e) {
        const target = e.target.closest('[data-mention-index]');
        if (!target || !currentProps) return;
        const idx = Number.parseInt(String(target.getAttribute('data-mention-index') || ''), 10);
        if (Number.isNaN(idx)) return;
        selectedIndex = idx;
        selectCurrent();
      }

      return {
        onStart: (props) => {
          currentProps = props;
          selectedIndex = 0;
          root = document.createElement('div');
          root.className = 'task-card-modal__mention-menu';
          root.addEventListener('mousedown', (e) => e.preventDefault());
          root.addEventListener('click', onClick);
          document.body.appendChild(root);
          renderMenu();
        },
        onUpdate: (props) => {
          currentProps = props;
          const count = props.items?.length || 0;
          selectedIndex = pickIndex(selectedIndex, count);
          renderMenu();
        },
        onKeyDown: (props) => {
          const items = props.items || [];
          if (props.event.key === 'Escape') {
            cleanup();
            return true;
          }
          if (props.event.key === 'ArrowDown') {
            selectedIndex = pickIndex(selectedIndex + 1, items.length);
            renderMenu();
            return true;
          }
          if (props.event.key === 'ArrowUp') {
            selectedIndex = pickIndex(selectedIndex - 1, items.length);
            renderMenu();
            return true;
          }
          if (props.event.key === 'Enter') {
            selectCurrent();
            return true;
          }
          return false;
        },
        onExit: () => {
          cleanup();
          currentProps = null;
          selectedIndex = 0;
        },
      };
    },
  };
}

const TaskCommentRichEditor = forwardRef(function TaskCommentRichEditor(
  { disabled, fileInputRef, onEmptyChange, mentionUsers = [] },
  ref
) {
  const [, bump] = useState(0);
  const mentionSuggestion = useMemo(
    () => createMentionSuggestion(mentionUsers),
    [mentionUsers]
  );
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          HTMLAttributes: {
            rel: 'noopener noreferrer nofollow',
            target: '_blank',
            class: 'task-card-modal__comment-html-link',
          },
        },
      }),
      Placeholder.configure({
        placeholder: 'Write a comment…',
      }),
      Mention.configure({
        HTMLAttributes: {
          class: 'task-card-modal__mention-token',
        },
        suggestion: mentionSuggestion,
      }),
    ],
    content: '',
    editable: !disabled,
    editorProps: {
      attributes: {
        spellcheck: 'true',
        autocorrect: 'on',
        autocapitalize: 'sentences',
        lang: 'en',
      },
    },
    shouldRerenderOnTransaction: true,
    onUpdate: () => bump((n) => n + 1),
  }, [disabled, mentionSuggestion]);

  useImperativeHandle(
    ref,
    () => ({
      getHTML: () => (editor ? editor.getHTML() : ''),
      getText: () => (editor ? editor.getText() : ''),
      clear: () => {
        editor?.commands.clearContent();
      },
      isEmpty: () => !editor || editor.isEmpty,
    }),
    [editor]
  );

  useEffect(() => {
    if (!editor || !onEmptyChange) return;
    const sync = () => onEmptyChange(editor.isEmpty);
    editor.on('transaction', sync);
    sync();
    return () => {
      editor.off('transaction', sync);
    };
  }, [editor, onEmptyChange]);

  if (!editor) {
    return <div className="task-card-modal__rte task-card-modal__rte--loading muted">Loading editor…</div>;
  }

  const blockValue = editor.isActive('heading', { level: 2 })
    ? 'h2'
    : editor.isActive('heading', { level: 3 })
      ? 'h3'
      : 'p';

  const listValue = editor.isActive('bulletList') ? 'bullet' : editor.isActive('orderedList') ? 'ordered' : '';

  function setBlockType(v) {
    if (v === 'p') editor.chain().focus().setParagraph().run();
    else if (v === 'h2') editor.chain().focus().setHeading({ level: 2 }).run();
    else if (v === 'h3') editor.chain().focus().setHeading({ level: 3 }).run();
  }

  function setListType(v) {
    if (v === 'bullet') editor.chain().focus().toggleBulletList().run();
    else if (v === 'ordered') editor.chain().focus().toggleOrderedList().run();
  }

  function onMoreFormat(e) {
    const v = e.target.value;
    e.target.value = '';
    if (v === 'strike') editor.chain().focus().toggleStrike().run();
    if (v === 'code') editor.chain().focus().toggleCode().run();
  }

  function onInsert(e) {
    const v = e.target.value;
    e.target.value = '';
    if (v === 'link') {
      const prev = editor.getAttributes('link').href;
      const url = window.prompt('Link URL', prev || 'https://');
      if (url === null) return;
      const trimmed = url.trim();
      if (trimmed === '') {
        editor.chain().focus().extendMarkRange('link').unsetLink().run();
        return;
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
    }
    if (v === 'hr') editor.chain().focus().setHorizontalRule().run();
    if (v === 'code') editor.chain().focus().toggleCodeBlock().run();
  }

  return (
    <div className={`task-card-modal__rte${disabled ? ' task-card-modal__rte--disabled' : ''}`}>
      <div className="task-card-modal__rte-toolbar" role="toolbar" aria-label="Comment formatting">
        <div className="task-card-modal__rte-toolbar-group">
          <span className="task-card-modal__rte-icon-label" aria-hidden>
            <Type size={15} strokeWidth={2} />
          </span>
          <select
            className="task-card-modal__rte-select"
            value={blockValue}
            onChange={(e) => setBlockType(e.target.value)}
            disabled={disabled}
            aria-label="Text style"
          >
            <option value="p">Normal text</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
          </select>
          <ChevronDown size={14} className="task-card-modal__rte-select-chevron" aria-hidden />
        </div>

        <ToolbarDivider />

        <div className="task-card-modal__rte-toolbar-group">
          <button
            type="button"
            className={`task-card-modal__rte-tool${editor.isActive('bold') ? ' is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleBold().run()}
            disabled={disabled}
            aria-label="Bold"
            aria-pressed={editor.isActive('bold')}
          >
            <Bold size={16} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className={`task-card-modal__rte-tool${editor.isActive('italic') ? ' is-active' : ''}`}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            disabled={disabled}
            aria-label="Italic"
            aria-pressed={editor.isActive('italic')}
          >
            <Italic size={16} strokeWidth={2} aria-hidden />
          </button>
          <select
            className="task-card-modal__rte-select task-card-modal__rte-select--icon"
            value=""
            onChange={onMoreFormat}
            disabled={disabled}
            aria-label="More formatting"
          >
            <option value="">⋯</option>
            <option value="strike">Strikethrough</option>
            <option value="code">Inline code</option>
          </select>
        </div>

        <ToolbarDivider />

        <div className="task-card-modal__rte-toolbar-group">
          <span className="task-card-modal__rte-icon-label" aria-hidden>
            <List size={15} strokeWidth={2} />
          </span>
          <select
            className="task-card-modal__rte-select"
            value={listValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v) setListType(v);
            }}
            disabled={disabled}
            aria-label="List style"
          >
            <option value="">Lists…</option>
            <option value="bullet">Bullet list</option>
            <option value="ordered">Numbered list</option>
          </select>
          <ChevronDown size={14} className="task-card-modal__rte-select-chevron" aria-hidden />
        </div>

        <ToolbarDivider />

        <div className="task-card-modal__rte-toolbar-group">
          <span className="task-card-modal__rte-icon-label" aria-hidden>
            <Plus size={15} strokeWidth={2} />
          </span>
          <select
            className="task-card-modal__rte-select"
            value=""
            onChange={onInsert}
            disabled={disabled}
            aria-label="Insert"
          >
            <option value="">Insert…</option>
            <option value="link">Link</option>
            <option value="hr">Divider</option>
            <option value="code">Code block</option>
          </select>
          <ChevronDown size={14} className="task-card-modal__rte-select-chevron" aria-hidden />
        </div>

        <div className="task-card-modal__rte-toolbar-spacer" />

        <div className="task-card-modal__rte-toolbar-group task-card-modal__rte-toolbar-group--end">
          <button
            type="button"
            className="task-card-modal__rte-tool"
            onClick={() => fileInputRef?.current?.click()}
            disabled={disabled}
            aria-label="Attach images"
          >
            <Paperclip size={17} strokeWidth={1.75} aria-hidden />
          </button>
          <span
            className="task-card-modal__rte-tool task-card-modal__rte-tool--help"
            title="Use the toolbar for headings, bold, lists, links, and code. Type @ to mention a teammate; right-click underlined words for spellcheck suggestions."
            role="note"
          >
            <HelpCircle size={17} strokeWidth={1.75} aria-hidden />
          </span>
        </div>
      </div>

      <EditorContent editor={editor} className="task-card-modal__rte-content" />
    </div>
  );
});

export default TaskCommentRichEditor;
