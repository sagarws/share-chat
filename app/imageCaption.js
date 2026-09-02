'use client';

// Draws a caption band underneath an image and returns a new File.
//
// The original is never modified — this produces a new image the same width,
// taller by the height of the caption, which is what actually gets uploaded.

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/** Split text into lines that fit `maxWidth`, honouring explicit newlines. */
const wrap = (ctx, text, maxWidth) => {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const next = `${line} ${words[i]}`;
      if (ctx.measureText(next).width <= maxWidth) {
        line = next;
      } else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
  }
  return lines;
};

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be read.'));
    };
    img.src = url;
  });

/**
 * @param {File}   file    the original image
 * @param {string} caption text to render underneath
 * @returns {Promise<File>} a new image file with the caption band
 */
export async function addCaption(file, caption) {
  const text = (caption || '').trim();
  if (!text) return file;

  const img = await loadImage(file);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) return file;

  // Scale the caption with the image so it reads the same on a phone
  // screenshot and on a wide desktop capture, but stop it running away on
  // very large or very small images.
  const scale = Math.min(Math.max(width / 900, 0.55), 2.4);
  const pad = Math.round(22 * scale);
  const fontSize = Math.round(17 * scale);
  const lineHeight = Math.round(fontSize * 1.45);
  const border = Math.max(1, Math.round(scale));

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `${fontSize}px ${FONT_STACK}`;
  const lines = wrap(measure, text, width - pad * 2);

  const bandHeight = pad * 2 + lines.length * lineHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height + bandHeight;
  const ctx = canvas.getContext('2d');

  // The band is opaque, so a transparent PNG still gets a readable caption.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, width, height);

  ctx.fillStyle = '#d9dde6';
  ctx.fillRect(0, height, width, border);

  ctx.fillStyle = '#1a1d24';
  ctx.font = `${fontSize}px ${FONT_STACK}`;
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    ctx.fillText(line, pad, height + pad + i * lineHeight);
  });

  // Keep JPEGs as JPEGs so a photo does not balloon into a huge PNG.
  const asJpeg = file.type === 'image/jpeg' || file.type === 'image/jpg';
  const mime = asJpeg ? 'image/jpeg' : 'image/png';

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, mime, asJpeg ? 0.92 : undefined)
  );
  if (!blob) return file;

  const base = file.name.replace(/\.[^.]+$/, '') || 'image';
  const ext = asJpeg ? 'jpg' : 'png';
  return new File([blob], `${base}.${ext}`, { type: mime, lastModified: Date.now() });
}

export const isImage = (file) => Boolean(file && file.type && file.type.startsWith('image/'));
