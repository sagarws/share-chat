// Minimal markdown subset -> React elements.
// Everything is built as real elements (never dangerouslySetInnerHTML), so a
// message can't smuggle HTML or scripts into another user's page.

const SAFE_PROTOCOL = /^(https?:\/\/|mailto:)/i;

const safeHref = (raw) => {
  const href = raw.startsWith('www.') ? `https://${raw}` : raw;
  return SAFE_PROTOCOL.test(href) ? href : null;
};

const INLINE = new RegExp(
  [
    '(`[^`\\n]+`)', // code
    '(\\*\\*[^*\\n]+\\*\\*)', // bold
    '(~~[^~\\n]+~~)', // strike
    '(_[^_\\n]+_)', // italic
    '(\\[[^\\]\\n]+\\]\\([^)\\s]+\\))', // [text](url)
    '((?:https?://|www\\.)[^\\s<]+)', // bare url
  ].join('|'),
  'g'
);

function renderInline(text, keyPrefix) {
  const nodes = [];
  let last = 0;
  let match;

  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('~~')) {
      nodes.push(<s key={key}>{token.slice(2, -2)}</s>);
    } else if (token.startsWith('_')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      nodes.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          label
        )
      );
    } else {
      const href = safeHref(token);
      nodes.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {token}
          </a>
        ) : (
          token
        )
      );
    }

    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length ? nodes : [text];
}

export function renderMarkdown(source) {
  const lines = String(source ?? '').split('\n');
  const blocks = [];
  let i = 0;

  const flushList = (ordered) => {
    const items = [];
    const re = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
    while (i < lines.length && re.test(lines[i])) {
      items.push(lines[i].replace(re, ''));
      i++;
    }
    const Tag = ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`l${blocks.length}`}>
        {items.map((item, n) => (
          <li key={n}>{renderInline(item, `${blocks.length}-${n}`)}</li>
        ))}
      </Tag>
    );
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        body.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push(
        <pre key={`c${blocks.length}`}>
          <code>{body.join('\n')}</code>
        </pre>
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote key={`q${blocks.length}`}>
          {renderInline(body.join('\n'), `q${blocks.length}`)}
        </blockquote>
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      flushList(true);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushList(false);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const Tag = `h${Math.min(3, heading[1].length) + 2}`;
      blocks.push(
        <Tag key={`h${blocks.length}`} className="md-heading">
          {renderInline(heading[2], `h${blocks.length}`)}
        </Tag>
      );
      i++;
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    // Gather consecutive plain lines into one paragraph, keeping line breaks.
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(>|#{1,3}\s|\d+\.\s|[-*]\s|```)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={`p${blocks.length}`}>
        {renderInline(para.join('\n'), `p${blocks.length}`)}
      </p>
    );
  }

  return blocks;
}
