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
      const safe = /^(https?:|mailto:|#|\/)/i.test(url) ? url : '#'
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

export function renderMarkdown(src: string, baseDir?: string): string {
  // Drop HTML comments (incl. multi-line) so they don't render as literal text.
  const lines = src.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)
  const out: string[] = []
  let para: string[] = []
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null
  const fmt = (s: string): string => inline(s, baseDir)

  const flushPara = (): void => {
    if (para.length) {
      out.push(`<p>${fmt(para.join(' '))}</p>`)
      para = []
    }
  }
  const flushList = (): void => {
    if (list) {
      out.push(`<${list.type}>${list.items.map((x) => `<li>${fmt(x)}</li>`).join('')}</${list.type}>`)
      list = null
    }
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

    const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ul || ol) {
      flushPara()
      const type = ul ? 'ul' : 'ol'
      if (!list || list.type !== type) {
        flushList()
        list = { type, items: [] }
      }
      list.items.push((ul ?? ol)![1])
      continue
    }

    flushList()
    para.push(line.trim())
  }
  flushPara()
  flushList()
  return out.join('\n')
}
