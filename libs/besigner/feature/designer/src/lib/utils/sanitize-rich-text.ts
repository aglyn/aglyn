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

/** Plain-text projection of markup, for the `children` fallback prop. */
export function richTextToPlain(html: string): string {
  if (typeof document === 'undefined') return html
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content.textContent ?? ''
}
