'use client';

import { useState } from 'react';

/**
 * Recursive folder tree for the File Share panel.
 *
 * Folders only — files belong in the pane on the right. The tree is built on
 * the server (`GET /api/folders/tree`); this renders it and tracks which
 * branches are open.
 *
 * Every folder is expandable even when empty, because every folder can hold a
 * new subfolder: expanding one reveals a "+ New folder" row at the child
 * indent, which is how nesting is created.
 *
 * @param {Array}    nodes      [{ id, name, root?, children: [...] }]
 * @param {string}   selectedId currently open folder
 * @param {Function} onSelect   (id) => void
 * @param {Function} onCreate   (parentNode, name) => Promise
 * @param {Function} onRemove   (node) => void — roots only
 */
export default function FolderTree({
  nodes,
  selectedId,
  onSelect,
  onCreate,
  onRemove,
  depth = 0,
}) {
  return (
    <ul className={depth ? 'tree tree-children' : 'tree'}>
      {nodes.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={depth}
          selectedId={selectedId}
          onSelect={onSelect}
          onCreate={onCreate}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}

// Does this node's subtree contain the open folder?
const contains = (node, id) =>
  (node.children || []).some((c) => c.id === id || contains(c, id));

function TreeNode({ node, depth, selectedId, onSelect, onCreate, onRemove }) {
  const children = node.children || [];
  // Roots start open so the tree is not a wall of collapsed rows; the open
  // folder and any branch leading to it are revealed rather than hidden. The
  // selected folder opens itself so its "+ New folder" row is reachable without
  // a second click — which is how you keep nesting downwards.
  const [open, setOpen] = useState(
    depth === 0 || node.id === selectedId || contains(node, selectedId)
  );
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const active = node.id === selectedId;

  const startAdding = () => {
    setOpen(true);
    setAdding(true);
    setName('');
  };

  const submit = async (e) => {
    e.preventDefault();
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await onCreate(node, value);
      setAdding(false);
      setName('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li>
      <div className={`tree-row${active ? ' active' : ''}`}>
        <button
          type="button"
          className="tree-caret"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
          aria-expanded={open}
        >
          {open ? '▾' : '▸'}
        </button>

        <button
          type="button"
          className="tree-name"
          onClick={() => onSelect(node.id)}
          title={node.name}
          aria-current={active ? 'true' : undefined}
        >
          <span className="tree-icon">{open ? '📂' : '📁'}</span>
          <span className="tree-label">{node.name}</span>
          {children.length > 0 && <span className="tree-count">{children.length}</span>}
        </button>

        {node.root && (
          <button
            type="button"
            className="tree-action danger"
            onClick={() => onRemove(node)}
            aria-label={`Remove ${node.name} from the list`}
            title="Remove from list (keeps the Drive folder)"
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <ul className="tree tree-children">
          {children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onCreate={onCreate}
              onRemove={onRemove}
            />
          ))}

          <li>
            {adding ? (
              <form className="tree-new" onSubmit={submit}>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setAdding(false);
                  }}
                  onBlur={() => !name.trim() && setAdding(false)}
                  placeholder="Folder name"
                  maxLength={60}
                  disabled={busy}
                />
              </form>
            ) : (
              <button type="button" className="tree-new-btn" onClick={startAdding}>
                + New folder
              </button>
            )}
          </li>
        </ul>
      )}
    </li>
  );
}
