'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const EMOJI = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
  '🙂', '😉', '😊', '😍', '😘', '😜', '🤔', '🤗',
  '😐', '😴', '😎', '🥳', '😢', '😭', '😡', '🥺',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '👌', '✌️',
  '❤️', '🔥', '⭐', '✅', '❌', '⚠️', '💯', '🎉',
  '🚀', '💡', '📌', '📎', '📄', '🐛', '☕', '🍕',
];

function Icon({ path, label }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" role="img">
      <title>{label}</title>
      {path}
    </svg>
  );
}

const ICONS = {
  link: (
    <path
      d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  ),
  code: (
    <path
      d="M9 8l-4 4 4 4M15 8l4 4-4 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  quote: (
    <path
      d="M7 7h4v4c0 2.5-1.5 4.5-4 5v-2c1.2-.4 2-1.4 2-2.5H7V7zm7 0h4v4c0 2.5-1.5 4.5-4 5v-2c1.2-.4 2-1.4 2-2.5h-2V7z"
      fill="currentColor"
    />
  ),
  bullet: (
    <g fill="currentColor">
      <circle cx="5" cy="7" r="1.6" />
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="5" cy="17" r="1.6" />
      <rect x="9" y="6" width="11" height="2" rx="1" />
      <rect x="9" y="11" width="11" height="2" rx="1" />
      <rect x="9" y="16" width="11" height="2" rx="1" />
    </g>
  ),
  ordered: (
    <g fill="currentColor">
      <text x="2" y="9" fontSize="7">1</text>
      <text x="2" y="14.5" fontSize="7">2</text>
      <text x="2" y="20" fontSize="7">3</text>
      <rect x="9" y="6" width="11" height="2" rx="1" />
      <rect x="9" y="11" width="11" height="2" rx="1" />
      <rect x="9" y="16" width="11" height="2" rx="1" />
    </g>
  ),
  clear: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 16.5v.5" />
    </g>
  ),
  clip: (
    <path
      d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L16 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  emoji: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
      <path d="M9 9.5v.01M15 9.5v.01" />
    </g>
  ),
  send: <path d="M3 20l18-8L3 4l4 8-4 8z" fill="currentColor" />,
};

// Best-effort conversion of pasted HTML into the small markdown subset that
// the message renderer understands. Uses DOMParser so we never render or
// execute anything from the clipboard — the DOM is walked and thrown away.
function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.replace(/\r\n?/g, '\n');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toLowerCase();

    if (tag === 'ol') {
      let n = 1;
      return (
        Array.from(node.children)
          .map((c) =>
            c.tagName?.toLowerCase() === 'li'
              ? `${n++}. ${walk(c).trim()}\n`
              : walk(c)
          )
          .join('') + '\n'
      );
    }
    if (tag === 'ul') {
      return (
        Array.from(node.children)
          .map((c) =>
            c.tagName?.toLowerCase() === 'li'
              ? `- ${walk(c).trim()}\n`
              : walk(c)
          )
          .join('') + '\n'
      );
    }

    const inner = Array.from(node.childNodes).map(walk).join('');

    if (tag === 'br') return '\n';
    if (tag === 'strong' || tag === 'b') return inner ? `**${inner}**` : '';
    if (tag === 'em' || tag === 'i') return inner ? `_${inner}_` : '';
    if (tag === 's' || tag === 'del' || tag === 'strike')
      return inner ? `~~${inner}~~` : '';
    if (tag === 'pre') return `\n\`\`\`\n${inner.replace(/`+/g, '`')}\n\`\`\`\n`;
    if (tag === 'code') return inner ? `\`${inner.replace(/`/g, '')}\`` : '';
    if (tag === 'a') {
      const href = node.getAttribute('href') || '';
      const label = inner || href;
      return href ? `[${label}](${href})` : label;
    }
    if (tag === 'blockquote') {
      return (
        inner
          .split('\n')
          .map((l) => (l.trim() ? `> ${l}` : ''))
          .join('\n') + '\n'
      );
    }
    if (tag === 'h1') return `\n# ${inner}\n`;
    if (tag === 'h2') return `\n## ${inner}\n`;
    if (tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6')
      return `\n### ${inner}\n`;
    if (tag === 'p' || tag === 'div') return `${inner}\n`;
    if (tag === 'li') return inner;

    return inner;
  };

  return walk(doc.body).replace(/\n{3,}/g, '\n\n').trim();
}

export default function Composer({
  value,
  onChange,
  onSubmit,
  onPickFile,
  disabled,
  sending,
  hasAttachment,
  placeholder,
  maxLength = 4000,
}) {
  const taRef = useRef(null);
  const fileInputRef = useRef(null);
  const pendingSelection = useRef(null);
  const [showToolbar, setShowToolbar] = useState(true);
  const [showEmoji, setShowEmoji] = useState(false);

  // Restore the caret after a toolbar edit re-renders the textarea.
  useLayoutEffect(() => {
    const sel = pendingSelection.current;
    if (sel && taRef.current) {
      taRef.current.focus();
      taRef.current.setSelectionRange(sel[0], sel[1]);
      pendingSelection.current = null;
    }
  });

  // Auto-grow up to a cap, then scroll.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }, [value]);

  useEffect(() => {
    if (!showEmoji) return;
    const close = (e) => {
      if (!e.target.closest?.('.emoji-pop') && !e.target.closest?.('.emoji-btn')) {
        setShowEmoji(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showEmoji]);

  const edit = (nextValue, selStart, selEnd) => {
    pendingSelection.current = [selStart, selEnd ?? selStart];
    onChange(nextValue);
  };

  // Wrap the selection (or the word under the caret) in markers, toggling off
  // when the markers are already there.
  const wrap = (marker, markerEnd = marker) => {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const sel = value.slice(s, e);

    const before = value.slice(Math.max(0, s - marker.length), s);
    const after = value.slice(e, e + markerEnd.length);
    if (before === marker && after === markerEnd) {
      const next =
        value.slice(0, s - marker.length) + sel + value.slice(e + markerEnd.length);
      edit(next, s - marker.length, e - marker.length);
      return;
    }

    if (sel.startsWith(marker) && sel.endsWith(markerEnd) && sel.length > marker.length + markerEnd.length) {
      const inner = sel.slice(marker.length, sel.length - markerEnd.length);
      edit(value.slice(0, s) + inner + value.slice(e), s, s + inner.length);
      return;
    }

    const next = value.slice(0, s) + marker + sel + markerEnd + value.slice(e);
    edit(next, s + marker.length, e + marker.length);
  };

  // Add/remove a per-line prefix across the selected lines.
  const prefixLines = (make, test) => {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;

    const start = value.lastIndexOf('\n', s - 1) + 1;
    const endIdx = value.indexOf('\n', e);
    const end = endIdx === -1 ? value.length : endIdx;

    const block = value.slice(start, end);
    const lines = block.split('\n');
    const allTagged = lines.every((l) => !l.trim() || test(l));

    const next = lines
      .map((l, n) => {
        if (!l.trim()) return l;
        return allTagged ? l.replace(test(l), '') : make(l, n);
      })
      .join('\n');

    const updated = value.slice(0, start) + next + value.slice(end);
    edit(updated, start, start + next.length);
  };

  const applyLink = () => {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const sel = value.slice(s, e) || 'link';
    const url = window.prompt('Link URL', 'https://');
    if (!url) return;
    const snippet = `[${sel}](${url})`;
    edit(value.slice(0, s) + snippet + value.slice(e), s + snippet.length);
  };

  const applyCode = () => {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const sel = value.slice(s, e);
    if (sel.includes('\n')) {
      const snippet = `\`\`\`\n${sel}\n\`\`\``;
      edit(value.slice(0, s) + snippet + value.slice(e), s + 4, s + 4 + sel.length);
    } else {
      wrap('`');
    }
  };

  // Strip every marker this composer can produce from the selection.
  const clearFormatting = () => {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const target = s === e ? value : value.slice(s, e);

    const cleaned = target
      .replace(/```/g, '')
      .replace(/\*\*/g, '')
      .replace(/~~/g, '')
      .replace(/`/g, '')
      .replace(/(^|\s)_([^_\n]+)_/g, '$1$2')
      .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1')
      .split('\n')
      .map((l) => l.replace(/^\s*(>\s?|#{1,3}\s+|[-*]\s+|\d+\.\s+)/, ''))
      .join('\n');

    if (s === e) edit(cleaned, cleaned.length);
    else edit(value.slice(0, s) + cleaned + value.slice(e), s, s + cleaned.length);
  };

  const insertEmoji = (emoji) => {
    const ta = taRef.current;
    const at = ta ? ta.selectionStart : value.length;
    const end = ta ? ta.selectionEnd : value.length;
    edit(value.slice(0, at) + emoji + value.slice(end), at + emoji.length);
    setShowEmoji(false);
  };

  const handlePaste = (e) => {
    const html = e.clipboardData?.getData('text/html');
    if (!html) return; // plain-text paste keeps default browser behavior
    const md = htmlToMarkdown(html);
    if (!md) return;

    e.preventDefault();
    const ta = taRef.current;
    const s = ta ? ta.selectionStart : value.length;
    const end = ta ? ta.selectionEnd : value.length;
    const next = value.slice(0, s) + md + value.slice(end);
    const clipped = next.slice(0, maxLength);
    edit(clipped, Math.min(s + md.length, clipped.length));
  };

  const handleKeyDown = (e) => {
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (!mod) return;

    const key = e.key.toLowerCase();
    if (key === 'b') { e.preventDefault(); wrap('**'); }
    else if (key === 'i') { e.preventDefault(); wrap('_'); }
    else if (key === 'x' && e.shiftKey) { e.preventDefault(); wrap('~~'); }
    else if (key === 'k') { e.preventDefault(); applyLink(); }
    else if (key === 'e') { e.preventDefault(); applyCode(); }
  };

  const canSend = (value.trim() || hasAttachment) && !disabled && !sending;

  return (
    <div className="composer-shell">
      <textarea
        ref={taRef}
        className="composer-input"
        rows={1}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        maxLength={maxLength}
        disabled={disabled}
      />

      <div className="composer-bar">
        {showToolbar && (
          <div className="tools">
            <button type="button" className="tool bold" onClick={() => wrap('**')} title="Bold (Ctrl+B)">B</button>
            <button type="button" className="tool italic" onClick={() => wrap('_')} title="Italic (Ctrl+I)">I</button>
            <button type="button" className="tool strike" onClick={() => wrap('~~')} title="Strikethrough (Ctrl+Shift+X)">S</button>
            <button
              type="button"
              className="tool"
              onClick={() => prefixLines(() => '# ', (l) => (/^\s*#{1,3}\s+/.test(l) ? /^\s*#{1,3}\s+/ : false))}
              title="Heading"
            >
              H
            </button>

            <span className="tool-divider" />

            <button type="button" className="tool" onClick={applyLink} title="Link (Ctrl+K)"><Icon label="Link" path={ICONS.link} /></button>
            <button type="button" className="tool" onClick={applyCode} title="Code (Ctrl+E)"><Icon label="Code" path={ICONS.code} /></button>
            <button
              type="button"
              className="tool"
              onClick={() => prefixLines(() => '> ', (l) => (/^\s*>\s?/.test(l) ? /^\s*>\s?/ : false))}
              title="Blockquote"
            >
              <Icon label="Blockquote" path={ICONS.quote} />
            </button>
            <button
              type="button"
              className="tool"
              onClick={() => prefixLines(() => '- ', (l) => (/^\s*[-*]\s+/.test(l) ? /^\s*[-*]\s+/ : false))}
              title="Bulleted list"
            >
              <Icon label="Bulleted list" path={ICONS.bullet} />
            </button>
            <button
              type="button"
              className="tool"
              onClick={() => prefixLines((l, n) => `${n + 1}. `, (l) => (/^\s*\d+\.\s+/.test(l) ? /^\s*\d+\.\s+/ : false))}
              title="Numbered list"
            >
              <Icon label="Numbered list" path={ICONS.ordered} />
            </button>

            <span className="tool-divider" />

            <button type="button" className="tool" onClick={clearFormatting} title="Clear formatting"><Icon label="Clear formatting" path={ICONS.clear} /></button>
          </div>
        )}

        <div className="tools right">
          <button
            type="button"
            className="tool aa"
            onClick={() => setShowToolbar((v) => !v)}
            title={showToolbar ? 'Hide formatting' : 'Show formatting'}
            aria-pressed={showToolbar}
          >
            Aa <span className={`caret ${showToolbar ? 'up' : ''}`}>⌃</span>
          </button>

          <input ref={fileInputRef} type="file" hidden onChange={onPickFile} />
          <button
            type="button"
            className="tool"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || sending}
            title="Attach file"
          >
            <Icon label="Attach file" path={ICONS.clip} />
          </button>

          <div className="emoji-anchor">
            <button
              type="button"
              className="tool emoji-btn"
              onClick={() => setShowEmoji((v) => !v)}
              title="Emoji"
              aria-expanded={showEmoji}
            >
              <Icon label="Emoji" path={ICONS.emoji} />
            </button>
            {showEmoji && (
              <div className="emoji-pop">
                {EMOJI.map((e) => (
                  <button type="button" key={e} onClick={() => insertEmoji(e)}>
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            className={`send-btn ${canSend ? 'active' : ''}`}
            onClick={onSubmit}
            disabled={!canSend}
            title="Send (Enter)"
          >
            <Icon label="Send" path={ICONS.send} />
          </button>
        </div>
      </div>
    </div>
  );
}
