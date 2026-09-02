'use client';

// Pasted screenshots arrive with a useless name ("image.png") or none at all,
// so give them something sortable and readable instead.
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`;
};

const extFor = (mime) => {
  const sub = (mime.split('/')[1] || 'png').split('+')[0];
  return sub === 'jpeg' ? 'jpg' : sub;
};

/**
 * Pull a file out of a paste event.
 *
 * Handles both shapes browsers use: `clipboardData.files` (a real file copied
 * from the OS file manager, which keeps its name) and `clipboardData.items`
 * (a screenshot or an image copied from a web page, which does not).
 *
 * @returns {File|null}
 */
export function fileFromPaste(event) {
  const data = event.clipboardData || window.clipboardData;
  if (!data) return null;

  // A real file copied from Finder/Explorer — keep its own name.
  const direct = data.files && data.files.length ? data.files[0] : null;
  if (direct && direct.size > 0) {
    if (direct.name && direct.name !== 'image.png') return direct;
    return renamed(direct);
  }

  for (const item of data.items || []) {
    if (item.kind !== 'file') continue;
    const blob = item.getAsFile();
    if (blob && blob.size > 0) return renamed(blob);
  }
  return null;
}

const renamed = (blob) => {
  const mime = blob.type || 'image/png';
  return new File([blob], `pasted-${stamp()}.${extFor(mime)}`, {
    type: mime,
    lastModified: Date.now(),
  });
};

/** True when the paste landed in a field where the user is typing. */
export function isTextTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}
