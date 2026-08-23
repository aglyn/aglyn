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

/** Tags the inline rich-text editor may persist (AGL-54). */
const ALLOWED_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  'a',
  'ul',
  'ol',
  'li',
  'br',
  'p',
  'div',
  'span',
])

const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/)/i

/**
 * Allowlist HTML sanitizer for inline rich text: keeps basic formatting
 * tags, strips every attribute except a safe `href` on links (which gains
 * `rel="noopener noreferrer"`), and unwraps disallowed elements to their
 * text content (so nothing script-capable survives). Runs at commit time in
 * the editor (browser DOM available).
 */
export function sanitizeRichText(html: string): string {
  if (typeof document === 'undefined') return ''
  const template = document.createElement('template')
  template.innerHTML = html

  const sanitizeNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeText(node.textContent ?? '')
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const element = node as Element
    const tag = element.tagName.toLowerCase()
    const inner = Array.from(element.childNodes).map(sanitizeNode).join('')
    if (!ALLOWED_TAGS.has(tag)) return inner
    if (tag === 'br') return '<br>'
    if (tag === 'a') {
      const href = element.getAttribute('href') ?? ''
      if (!SAFE_HREF.test(href)) return inner
      return `<a href="${escapeAttribute(href)}" rel="noopener noreferrer">${inner}</a>`
    }
    return `<${tag}>${inner}</${tag}>`
  }

  return Array.from(template.content.childNodes).map(sanitizeNode).join('')
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;')
}

/**
 * Tags that end the line they are on. `br` is the explicit one; the rest are
 * the block-level members of {@link ALLOWED_TAGS}, which a contentEditable
 * produces on its own — pressing Enter in the rich surface forks the DOM
 * into `div`s, and that fork IS the author's line break.
 */
const LINE_BREAKING_TAGS = new Set(['BR', 'DIV', 'P', 'LI', 'UL', 'OL'])

/**
 * Plain-text projection of markup, for the `children` fallback prop.
 *
 * Line breaks SURVIVE (AGL-2486). Zach: *"I also still do not see the line
 * break in the text field in the attributes panel"* — and he was right, on
 * a node that really does carry one. Measured on `yFjgqiG2wm`, node
 * `C3rodYc1Gd` stores `html: "Your entire web <div>presence. </div>"` beside
 * `children: "Your entire web presence. "`. The canvas renders `html` and
 * shows two lines; the Attributes panel renders `children` and showed one.
 * They disagreed because this function was `template.content.textContent`,
 * and `textContent` concatenates across every element boundary — a `<div>`
 * fork and a `<br>` both vanish into nothing.
 *
 * So the panel was not lying about a soft wrap, as the earlier `h3` report
 * genuinely was; it was displaying a projection that had silently dropped
 * the break. `children` is not a display detail either: it is what every
 * plain renderer, the SSR fallback and the panel field all read, so the
 * break was being lost to all three.
 *
 * Only the trailing newline is trimmed — a block element closes at the end
 * of the string and that boundary separates nothing.
 */
export function richTextToPlain(html: string): string {
  if (typeof document === 'undefined') return html
  const template = document.createElement('template')
  template.innerHTML = html
  const parts: string[] = []
  const endsOpen = () =>
    parts.length > 0 && !parts[parts.length - 1]!.endsWith('\n')

  const walk = (parent: Node): void => {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === 3 /* TEXT_NODE */) {
        parts.push(child.nodeValue ?? '')
        continue
      }
      if (child.nodeType !== 1 /* ELEMENT_NODE */) continue
      const element = child as Element
      if (element.tagName === 'BR') {
        parts.push('\n')
        continue
      }
      const breaks = LINE_BREAKING_TAGS.has(element.tagName)
      // A block that FOLLOWS content starts its own line; one that opens the
      // string, or already sits after a break, does not add an empty one.
      if (breaks && endsOpen()) parts.push('\n')
      walk(element)
      if (breaks && endsOpen()) parts.push('\n')
    }
  }

  walk(template.content)
  return parts.join('').replace(/\n+$/, '')
}
