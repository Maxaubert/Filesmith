// Minimal, dependency-free Markdown -> HTML for the text preview. Block structure
// is parsed from the RAW lines; only text CONTENT is HTML-escaped (via inline()),
// so block markers like `>` survive. A safe subset of raw HTML (common in READMEs
// for centered logos) passes through a sanitizer that strips scripts, event
// handlers, and javascript: URLs. Relative image paths resolve against the file's
// directory and load through the fsmedia:// protocol. No untrusted script reaches
// the DOM.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** A URL is "relative" if it has no scheme, protocol, anchor, or root slash. */
const isRel = (url: string): boolean => !/^([a-zA-Z][\w+.-]*:|\/\/|#|\/)/.test(url)

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}

/**
 * Fully decode HTML entities (named + numeric, semicolon optional). Runs to a
 * fixed point so layered encodings — e.g. our own esc() turning `&#115;` into
 * `&amp;#115;` — collapse back to the real character before a scheme check.
 */
function decodeEntities(s: string): string {
  let prev = ''
  let cur = s
  for (let i = 0; i < 5 && cur !== prev; i++) {
    prev = cur
    cur = cur.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);?/gi, (m, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m
        try {
          return String.fromCodePoint(code)
        } catch {
          return m
        }
      }
      const key = body.toLowerCase()
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : m
    })
  }
  return cur
}

// Browsers strip whitespace and C0 control chars from URLs before acting on the
// scheme, so we do the same before allowlist-checking. Matching control chars is
// the whole point here, so the no-control-regex rule is intentionally disabled.
// eslint-disable-next-line no-control-regex
const URL_STRIP = new RegExp('[\u0000-\u0020]+', 'g')

/**
 * Allowlist for link/autolink hrefs. Permits only http(s):, mailto:, `#`
 * fragments, and relative/root paths; every other scheme (data:, vbscript:, and
 * anything unknown) is rejected. Entities are decoded first, and browser-ignored
 * whitespace/control chars stripped, so obfuscated schemes can't slip through.
 */
function isSafeUrl(url: string): boolean {
  const cleaned = decodeEntities(url).replace(URL_STRIP, '')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned)
  if (!scheme) return true // no scheme: #fragment, /root, ./ ../ relative, or bare filename
  return /^(https?|mailto)$/i.test(scheme[1])
}

/** Resolve `rel` against `baseDir` (forward-slashed), collapsing . and .. */
function joinPath(baseDir: string, rel: string): string {
  const parts = (baseDir.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + rel.replace(/\\/g, '/')).split(
    '/'
  )
  const stack: string[] = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') stack.pop()
    else stack.push(p)
  }
  return stack.join('/')
}

/** Map a URL to a loadable src: relative paths become fsmedia:// under baseDir. */
function resolveSrc(url: string, baseDir?: string): string {
  if (!baseDir || !isRel(url)) return url
  return `fsmedia://local/${encodeURIComponent(joinPath(baseDir, url))}`
}

/** Escape text, then apply inline Markdown (code, links, images, bold, italic). */
function inline(s: string, baseDir?: string): string {
  return esc(s)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_m, alt: string, url: string) => {
      const src = resolveSrc(url, baseDir)
      return /^(https?:|data:image\/|fsmedia:)/i.test(src) ? `<img alt="${alt}" src="${src}">` : alt
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, t: string, url: string) => {
      const safe = isSafeUrl(url) ? url : '#'
      return `<a href="${safe}" target="_blank" rel="noreferrer">${t}</a>`
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\s][^_]*)_/g, '$1<em>$2</em>')
}

/** Strip dangerous tags/attributes from raw HTML that passes through. */
function sanitizeHtml(s: string): string {
  return s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|link|meta|base|form|input|button)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"')
}

/** Rewrite relative src="…" in raw HTML to fsmedia:// under baseDir. */
function resolveHtmlSrcs(html: string, baseDir?: string): string {
  if (!baseDir) return html
  return html.replace(/(\ssrc\s*=\s*)("|')([^"']+)\2/gi, (m, pre: string, q: string, url: string) =>
    isRel(url) ? `${pre}${q}${resolveSrc(url, baseDir)}${q}` : m
  )
}

const isHtmlLine = (line: string): boolean => /^<\/?[a-zA-Z][\s\S]*>$/.test(line.trim())
const cells = (row: string): string[] =>
  row
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim())

/** One collected list item, before nesting is resolved at flush time. */
type ListItem = { rawLevel: number; type: 'ul' | 'ol'; content: string; start: number | null }

export function renderMarkdown(src: string, baseDir?: string): string {
  // Drop HTML comments (incl. multi-line) so they don't render as literal text.
  const lines = src.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)
  const out: string[] = []
  let para: string[] = []
  let listItems: ListItem[] = []
  const fmt = (s: string): string => inline(s, baseDir)

  const flushPara = (): void => {
    if (para.length) {
      out.push(`<p>${fmt(para.join(' '))}</p>`)
      para = []
    }
  }

  // Render the collected items into nested <ul>/<ol> via a depth stack.
  // Indentation sets nesting (2 spaces per level, tab = 2). A jump deeper than
  // one level is clamped, which also pins a lone indented list to the top level
  // (preserving single-level behavior for un-indented lists).
  const flushList = (): void => {
    if (!listItems.length) return
    let html = ''
    const stack: ('ul' | 'ol')[] = []
    const open = (type: 'ul' | 'ol', start: number | null): void => {
      html += type === 'ol' && start != null && start !== 1 ? `<ol start="${start}">` : `<${type}>`
      stack.push(type)
      html += '<li>'
    }
    const closeList = (): void => {
      html += `</li></${stack.pop()}>`
    }
    for (const it of listItems) {
      const level = Math.min(it.rawLevel, stack.length)
      if (stack.length === 0 || level > stack.length - 1) {
        // Open nested lists inside the current <li>, down to the target level.
        for (let l = stack.length; l <= level; l++) open(it.type, l === level ? it.start : null)
      } else {
        while (stack.length - 1 > level) closeList()
        if (stack[stack.length - 1] !== it.type) {
          closeList()
          open(it.type, it.start)
        } else {
          html += '</li><li>'
        }
      }
      html += fmt(it.content)
    }
    while (stack.length) closeList()
    out.push(html)
    listItems = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (/^\s*```/.test(line)) {
      flushPara()
      flushList()
      const buf: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(esc(lines[i++]))
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`)
      continue
    }

    if (/^\s*$/.test(line)) {
      flushPara()
      flushList()
      continue
    }

    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) &&
      lines[i + 1].includes('-')
    ) {
      flushPara()
      flushList()
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]))
      i--
      const thead = `<thead><tr>${head.map((h) => `<th>${fmt(h)}</th>`).join('')}</tr></thead>`
      const tbody = `<tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${fmt(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`
      out.push(`<table>${thead}${tbody}</table>`)
      continue
    }

    if (isHtmlLine(line)) {
      flushPara()
      flushList()
      out.push(resolveHtmlSrcs(sanitizeHtml(line), baseDir))
      continue
    }

    const h = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      flushPara()
      flushList()
      out.push(`<h${h[1].length}>${fmt(h[2])}</h${h[1].length}>`)
      continue
    }

    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara()
      flushList()
      out.push('<hr>')
      continue
    }

    if (/^\s*>/.test(line)) {
      flushPara()
      flushList()
      const buf: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''))
      i--
      out.push(`<blockquote>${fmt(buf.join(' '))}</blockquote>`)
      continue
    }

    const ul = /^(\s*)[-*+]\s+(.*)$/.exec(line)
    const ol = /^(\s*)(\d+)\.\s+(.*)$/.exec(line)
    if (ul || ol) {
      flushPara()
      const indent = (ul ?? ol)![1]
      // Tabs count as 2 spaces; 2 spaces of indent = one nesting level.
      const width = [...indent].reduce((n, c) => n + (c === '\t' ? 2 : 1), 0)
      const rawLevel = Math.floor(width / 2)
      if (ul) {
        listItems.push({ rawLevel, type: 'ul', content: ul[2], start: null })
      } else {
        listItems.push({ rawLevel, type: 'ol', content: ol![3], start: parseInt(ol![2], 10) })
      }
      continue
    }

    flushList()
    para.push(line.trim())
  }
  flushPara()
  flushList()
  return out.join('\n')
}
