/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * SVG sanitization at the upload chokepoints (AGL-1474).
 *
 * An SVG is a DOCUMENT, not a picture. `image/*` has always been the one open
 * family in the upload allowlist, the stored content type is whatever the
 * client declared, and the CDN serves the bytes `inline` from the console's
 * own origin — so `<script>alert(document.domain)</script>` inside an uploaded
 * logo executes on `app.aglyn.com`, or on the customer's published domain,
 * the moment the asset URL is opened top-level. Every editor could do it.
 *
 * **This file is the remediation, not the containment.** The containment is
 * `mediaCdnContentSecurityPolicy` in `serve-media-cdn.ts`, which stamps a
 * `sandbox` / `script-src 'none'` policy on the serve response and therefore
 * covers every asset already in the bucket without touching a byte. This
 * sanitizer is what keeps the STORED artifact clean — so the platform is not
 * one header regression away from the same hole, and so an SVG handed to a
 * customer through any other channel is not carrying a payload.
 *
 * Neither layer touches `<img src>`: a browser loading an SVG as an image
 * never runs its script and never applies the response's CSP. The vector is
 * top-level navigation (and `<object>`/`<iframe>` embedding), and that is
 * exactly what both layers close.
 *
 * ## Why a scanner rather than a DOM
 *
 * `dompurify` is already a dependency, but only in `apps/docs` (mermaid) and
 * only in a browser. Server-side it needs `jsdom`, which is a devDependency —
 * promoting a full HTML engine into every serverless upload function to strip
 * a handful of constructs is the wrong trade. So: a small XML-shaped scanner
 * that keeps kept attributes VERBATIM (their raw source span, entities and
 * all) and drops the rest. Nothing is re-encoded, so nothing can be mangled
 * by a re-encode.
 *
 * ## What it removes
 *
 * - `<script>` and its content, at any nesting depth and under any namespace
 *   prefix (`<html:script>` has local name `script`).
 * - `<foreignObject>` and its subtree — the documented HTML escape hatch.
 * - `<iframe>`, `<frame>`, `<frameset>`, `<embed>`, `<object>`, `<handler>`,
 *   `<listener>`, `<animation>`, `<audio>`, `<video>` and their subtrees.
 * - Every `on*` attribute (`onload`, `onclick`, `onbegin`, …).
 * - Every URL-bearing attribute (`href`, `xlink:href`, `src`, `data`,
 *   `action`, `formaction`, `poster`) whose value is not a same-document
 *   `#fragment` or a raster `data:image/…` — which covers `javascript:`,
 *   `data:text/html`, nested `data:image/svg+xml`, and plain external refs.
 * - Animation elements (`<set>`, `<animate>`, …) that target a URL attribute,
 *   because `<set attributeName="href" to="javascript:…">` reintroduces one.
 * - `url(…)` references to anywhere but a `#fragment` inside `style=`,
 *   presentation attributes (`fill`, `filter`, `mask`, `clip-path`, …) and
 *   `<style>` text, plus `@import` and `expression(`.
 * - `<?xml-stylesheet?>` and every other processing instruction — an external
 *   XSLT is a script engine.
 * - A DOCTYPE with an internal subset, whose `<!ENTITY>` definitions expand
 *   into markup after every check here has run. A plain external-id DOCTYPE
 *   is inert and kept, because Illustrator has emitted one for twenty years
 *   and rewriting those files buys nothing.
 *
 * Scheme detection decodes numeric and named entities first and ignores
 * control characters and whitespace, so `&#106;avascript:` and `java&#9;script:`
 * resolve the same way the browser resolves them.
 */

/** Elements dropped together with everything inside them. */
const REMOVED_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'frame',
  'frameset',
  'embed',
  'object',
  'handler',
  'listener',
  'animation',
  'audio',
  'video',
])

/**
 * Elements whose content is raw text rather than markup. Consumed to their
 * close tag verbatim, so a `<` inside CSS or script source can never be
 * mistaken for a tag and desynchronize the scan.
 */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style'])

/** SMIL animation elements — safe unless they animate a URL attribute. */
const ANIMATION_ELEMENTS = new Set([
  'set',
  'animate',
  'animatetransform',
  'animatemotion',
  'animatecolor',
])

/** Attributes whose whole value is a URL. */
const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'data',
  'action',
  'formaction',
  'poster',
])

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  colon: ':',
  tab: '\t',
  newline: '\n',
  sol: '/',
}

/** What a sanitization pass took out, for the asset's audit trail. */
export interface SvgSanitizeResult {
  /** The sanitized document. Only meaningful when `changed`. */
  svg: string
  /** Whether anything was removed at all. */
  changed: boolean
  /** Distinct reasons, e.g. `['script', 'event handler']`. */
  removed: string[]
}

/** The one content type that is a document wearing an `image/` label. */
export function isSvgUploadType(contentType: string): boolean {
  const type = String(contentType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  return type === 'image/svg+xml' || type === 'image/svg'
}

function decodeEntities(value: string): string {
  let out = String(value ?? '')
  // Bounded, because `&amp;#106;` is a decode away from `&#106;` and an
  // attacker gets to pick the depth. Three passes is past anything a browser
  // will itself resolve.
  for (let pass = 0; pass < 3; pass++) {
    const next = out
      .replace(/&#x([0-9a-f]+);?/gi, (match, hex) => codePoint(parseInt(hex, 16), match))
      .replace(/&#(\d+);?/g, (match, decimal) => codePoint(parseInt(decimal, 10), match))
      .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[String(name).toLowerCase()] ?? match)
    if (next === out) break
    out = next
  }
  return out
}

function codePoint(value: number, fallback: string): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return fallback
  try {
    return String.fromCodePoint(value)
  } catch {
    return fallback
  }
}

/**
 * Drops every character a browser ignores while resolving a URL's scheme —
 * control characters and whitespace — so `java\tscript:` and a leading NUL
 * both collapse to `javascript:` before the check below sees them.
 *
 * Written as a code-point filter rather than a character class because a
 * control-character range in a regex is exactly what `no-control-regex`
 * exists to flag, and silencing that rule here would be the wrong signal.
 */
function stripInsignificant(value: string): string {
  let out = ''
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code > 0x20 && code !== 0x7f) out += character
  }
  return out
}

/**
 * A URL value the sanitizer will keep.
 *
 * Same-document fragments (`#gradient-1`, what `<use>` and `fill="url(#…)"`
 * actually need) and raster data URIs. Everything else goes, including plain
 * relative and `https:` references: AGL-1474 asks for external references to
 * be stripped, and inside an `<img>`-embedded SVG — the way logos are used
 * across this product — a browser refuses to load them anyway.
 *
 * `data:image/svg+xml` is NOT safe: it is another document, and nesting is how
 * a sanitizer gets walked past.
 */
export function isSafeSvgUrl(raw: string): boolean {
  const value = stripInsignificant(decodeEntities(raw))
  if (!value) return true
  if (value.startsWith('#')) return true
  const lower = value.toLowerCase()
  if (lower.startsWith('data:image/') && !lower.startsWith('data:image/svg')) {
    return true
  }
  return false
}

const URL_FUNCTION = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi

/** `url(…)`, `javascript:` or `expression(` pointing anywhere but this document. */
function hasUnsafeUrlReference(value: string): boolean {
  const decoded = decodeEntities(value)
  const tight = stripInsignificant(decoded)
  if (/javascript:/i.test(tight)) return true
  if (/expression\(/i.test(tight)) return true
  URL_FUNCTION.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = URL_FUNCTION.exec(decoded)) !== null) {
    if (!isSafeSvgUrl(match[2])) return true
  }
  return false
}

/**
 * `<style>` text. Kept rather than dropped — class-based styling is how every
 * exported SVG carries its colours, and removing it would visibly break
 * legitimate assets — with the escapes neutralized in place.
 */
function sanitizeCss(css: string): { css: string; changed: boolean } {
  let out = css.replace(/@import[^;}]*(;|(?=\}))/gi, '')
  URL_FUNCTION.lastIndex = 0
  out = out.replace(URL_FUNCTION, (match, _quote, target) =>
    isSafeSvgUrl(String(target)) ? match : 'url(#)',
  )
  out = out.replace(/javascript:/gi, '')
  out = out.replace(/expression\(/gi, '(')
  return { css: out, changed: out !== css }
}

interface ParsedAttribute {
  /** Raw source INCLUDING the leading whitespace run, so kept attributes
   *  round-trip byte for byte. */
  raw: string
  name: string
  /** Lower-cased, namespace prefix removed: `xlink:href` → `href`. */
  localName: string
  value: string
}

interface ParsedTag {
  name: string
  localName: string
  closing: boolean
  selfClosing: boolean
  attributes: ParsedAttribute[]
  /** Index just past the tag's `>`. */
  end: number
}

function localNameOf(name: string): string {
  const lower = name.toLowerCase()
  const colon = lower.lastIndexOf(':')
  return colon >= 0 ? lower.slice(colon + 1) : lower
}

const TAG_NAME = /^[A-Za-z_][A-Za-z0-9:._-]*/
const ATTRIBUTE_NAME = /^[^\s=/>]+/
const WHITESPACE = /\s/

/** Reads one tag starting at `from` (the `<`), or `null` if it is not one. */
function readTag(source: string, from: number): ParsedTag | null {
  let i = from + 1
  const closing = source[i] === '/'
  if (closing) i++
  const nameMatch = TAG_NAME.exec(source.slice(i))
  if (!nameMatch) return null
  const name = nameMatch[0]
  i += name.length
  const attributes: ParsedAttribute[] = []
  const tag = (selfClosing: boolean, end: number): ParsedTag => ({
    name,
    localName: localNameOf(name),
    closing,
    selfClosing,
    attributes,
    end,
  })
  while (i < source.length) {
    const spanStart = i
    while (i < source.length && WHITESPACE.test(source[i])) i++
    if (i >= source.length) break
    if (source[i] === '>') return tag(false, i + 1)
    if (source[i] === '/' && source[i + 1] === '>') return tag(true, i + 2)
    const attributeMatch = ATTRIBUTE_NAME.exec(source.slice(i))
    if (!attributeMatch) {
      i++
      continue
    }
    const attributeName = attributeMatch[0]
    let cursor = i + attributeName.length
    let after = cursor
    while (after < source.length && WHITESPACE.test(source[after])) after++
    let value = ''
    if (source[after] === '=') {
      after++
      while (after < source.length && WHITESPACE.test(source[after])) after++
      const quote = source[after]
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, after + 1)
        value = source.slice(after + 1, close < 0 ? source.length : close)
        cursor = close < 0 ? source.length : close + 1
      } else {
        const unquoted = /^[^\s>]*/.exec(source.slice(after)) as RegExpExecArray
        value = unquoted[0]
        cursor = after + unquoted[0].length
      }
    }
    attributes.push({
      raw: source.slice(spanStart, cursor),
      name: attributeName,
      localName: localNameOf(attributeName),
      value,
    })
    i = cursor
  }
  return null
}

/** Consumes an element's raw text content up to and including its close tag. */
function consumeRawText(
  source: string,
  from: number,
  name: string,
): { text: string; end: number } {
  const lower = source.toLowerCase()
  const needle = `</${name.toLowerCase()}`
  let index = lower.indexOf(needle, from)
  while (index >= 0) {
    const next = source[index + needle.length]
    if (next === undefined || /[\s>/]/.test(next)) break
    index = lower.indexOf(needle, index + needle.length)
  }
  if (index < 0) return { text: source.slice(from), end: source.length }
  const gt = source.indexOf('>', index)
  return {
    text: source.slice(from, index),
    end: gt < 0 ? source.length : gt + 1,
  }
}

function renderTag(tag: ParsedTag, kept: ParsedAttribute[]): string {
  return `<${tag.name}${kept.map((attribute) => attribute.raw).join('')}${
    tag.selfClosing ? '/>' : '>'
  }`
}

/** Strips the executable and external-reference surface from an SVG source. */
export function sanitizeSvg(source: string): SvgSanitizeResult {
  const removed = new Set<string>()
  /** Stack of local names of removed subtrees; non-empty means "dropping". */
  const skipping: string[] = []
  let out = ''
  let i = 0
  const emit = (text: string) => {
    if (!skipping.length) out += text
  }

  while (i < source.length) {
    const lt = source.indexOf('<', i)
    if (lt < 0) {
      emit(source.slice(i))
      break
    }
    emit(source.slice(i, lt))

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4)
      const stop = end < 0 ? source.length : end + 3
      emit(source.slice(lt, stop))
      i = stop
      continue
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9)
      const stop = end < 0 ? source.length : end + 3
      emit(source.slice(lt, stop))
      i = stop
      continue
    }
    if (source.startsWith('<!', lt)) {
      const bracket = source.indexOf('[', lt)
      const close = source.indexOf('>', lt)
      if (bracket >= 0 && close >= 0 && bracket < close) {
        // Internal subset: `<!ENTITY payload "<script>…">` expands AFTER
        // every check below. Drop the whole declaration.
        const end = source.indexOf(']>', bracket)
        removed.add('doctype entity subset')
        i = end < 0 ? source.length : end + 2
        continue
      }
      const stop = close < 0 ? source.length : close + 1
      emit(source.slice(lt, stop))
      i = stop
      continue
    }
    if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt + 2)
      const stop = end < 0 ? source.length : end + 2
      const instruction = source.slice(lt, stop)
      if (/^<\?xml[\s?]/i.test(instruction)) emit(instruction)
      else removed.add('processing instruction')
      i = stop
      continue
    }

    const tag = readTag(source, lt)
    if (!tag) {
      emit('<')
      i = lt + 1
      continue
    }

    // Raw-text elements are consumed whole, in or out of a removed subtree —
    // a `<` inside their content is content, not markup.
    if (!tag.closing && !tag.selfClosing && RAW_TEXT_ELEMENTS.has(tag.localName)) {
      const raw = consumeRawText(source, tag.end, tag.name)
      if (skipping.length || REMOVED_ELEMENTS.has(tag.localName)) {
        if (!skipping.length) removed.add(tag.localName)
      } else {
        const kept = tag.attributes.filter((attribute) =>
          keepAttribute(attribute, removed),
        )
        const styles = sanitizeCss(raw.text)
        if (styles.changed) removed.add('external style reference')
        emit(`${renderTag(tag, kept)}${styles.css}</${tag.name}>`)
      }
      i = raw.end
      continue
    }

    if (tag.closing) {
      if (skipping.length) {
        if (skipping[skipping.length - 1] === tag.localName) skipping.pop()
      } else {
        emit(`</${tag.name}>`)
      }
      i = tag.end
      continue
    }

    if (skipping.length) {
      // Track same-name nesting so the matching close is the one that ends
      // the removal, not the first one encountered.
      if (!tag.selfClosing && skipping[skipping.length - 1] === tag.localName) {
        skipping.push(tag.localName)
      }
      i = tag.end
      continue
    }

    if (REMOVED_ELEMENTS.has(tag.localName)) {
      removed.add(tag.localName)
      if (!tag.selfClosing) skipping.push(tag.localName)
      i = tag.end
      continue
    }

    if (ANIMATION_ELEMENTS.has(tag.localName)) {
      const target = tag.attributes.find(
        (attribute) => attribute.localName === 'attributename',
      )
      const animated = localNameOf(decodeEntities(target?.value ?? '').trim())
      if (target && (URL_ATTRIBUTES.has(animated) || animated === 'style')) {
        removed.add('animated reference')
        if (!tag.selfClosing) skipping.push(tag.localName)
        i = tag.end
        continue
      }
    }

    emit(
      renderTag(
        tag,
        tag.attributes.filter((attribute) => keepAttribute(attribute, removed)),
      ),
    )
    i = tag.end
  }

  return { svg: out, changed: removed.size > 0, removed: [...removed].sort() }
}

function keepAttribute(
  attribute: ParsedAttribute,
  removed: Set<string>,
): boolean {
  // No standard SVG attribute begins with `on` except the event handlers.
  if (/^on/i.test(attribute.localName) || /^on/i.test(attribute.name)) {
    removed.add('event handler')
    return false
  }
  if (URL_ATTRIBUTES.has(attribute.localName)) {
    if (isSafeSvgUrl(attribute.value)) return true
    removed.add('external reference')
    return false
  }
  // `style=`, and the presentation attributes that take a paint server
  // (`fill`, `stroke`, `filter`, `mask`, `clip-path`, `marker-*`).
  if (hasUnsafeUrlReference(attribute.value)) {
    removed.add(
      attribute.localName === 'style'
        ? 'external style reference'
        : 'external reference',
    )
    return false
  }
  return true
}

/**
 * Buffer form for the upload routes.
 *
 * When nothing was removed the ORIGINAL buffer comes back untouched — not a
 * re-encode of the parsed source. That is deliberate: it means a legitimate
 * SVG in some encoding this scanner does not model can never be corrupted by
 * merely passing through, and it keeps the stored content hash stable.
 */
export function sanitizeSvgBuffer(buffer: Buffer): {
  buffer: Buffer
  changed: boolean
  removed: string[]
} {
  const result = sanitizeSvg(buffer.toString('utf8'))
  return {
    buffer: result.changed ? Buffer.from(result.svg, 'utf8') : buffer,
    changed: result.changed,
    removed: result.removed,
  }
}
