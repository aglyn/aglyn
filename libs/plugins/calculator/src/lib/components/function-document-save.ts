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
 * WHAT A CALCULATOR HANDS OVER (AGL-3387).
 *
 * A Calculator Document is part of the page, laid out on the canvas like
 * anything else. Saving it means getting exactly that region off the page:
 *
 * - **As a PDF**, through the browser's own print-to-PDF. Every browser and
 *   phone has one ("Save as PDF", or Share → Save to Files on an iPhone), the
 *   text stays text, the site's fonts come along, and no PDF engine has to
 *   ship with the page. For the length of the print, every element that is
 *   not the document or one of its ancestors is taken out of the printed
 *   layout, and the page's title becomes the document's, which is the name
 *   browsers give the file. Both are put back when the print ends.
 * - **As text**, for a message: copied, or handed to the device's share
 *   sheet. Line breaks follow the document's blocks.
 */

/** Marks an element left out of the printed layout while a document prints. */
export const PRINT_HIDE_ATTRIBUTE = 'data-aglyn-print-hide'
/** Marks the document being printed. */
export const PRINT_TARGET_ATTRIBUTE = 'data-aglyn-print-target'
const PRINT_STYLE_ID = 'aglyn-function-document-print'

export type FunctionDocumentPaper = 'letter' | 'a4' | 'auto'

export const FUNCTION_DOCUMENT_PAPERS: readonly FunctionDocumentPaper[] = [
  'letter',
  'a4',
  'auto',
]

/** Page margin, in millimetres, when the author gives none. */
export const DEFAULT_DOCUMENT_MARGIN_MM = 12

/**
 * A document's title with `{name}` filled from the calculator. An unknown
 * name, or one whose value is empty, fills with nothing, so
 * `Receipt {number}` before a number is given reads `Receipt`.
 */
export function fillDocumentTitle(
  template: string | undefined,
  read: (name: string) => string,
  fallback = 'Document',
): string {
  const filled = String(template ?? '')
    .replace(/\{\s*([A-Za-z_][\w.]*)\s*\}/g, (_, name: string) => read(name))
    .replace(/\s+/g, ' ')
    .trim()
  // A title that filled to nothing but separators ("Receipt — ") keeps its
  // words and loses the dangling punctuation.
  const tidy = filled.replace(/[\s\-–—·|:,]+$/u, '').trim()
  return tidy || fallback
}

function pageRule(paper: FunctionDocumentPaper | undefined, marginMm: number): string {
  const size = paper === 'a4' ? 'A4' : paper === 'auto' ? '' : 'letter'
  return `@page { ${size ? `size: ${size}; ` : ''}margin: ${marginMm}mm; }`
}

export interface PrintFunctionDocumentOptions {
  title?: string
  paper?: FunctionDocumentPaper
  /** Millimetres. */
  margin?: number
}

/**
 * Prints one element and nothing else, as a PDF where the viewer chooses to
 * save one. Returns false when the window cannot print.
 */
export function printFunctionDocument(
  target: HTMLElement,
  options: PrintFunctionDocumentOptions = {},
): boolean {
  const doc = target.ownerDocument
  const view = doc.defaultView
  if (!view || typeof view.print !== 'function') return false

  const hidden: Element[] = []
  let node: Element = target
  while (node.parentElement && node !== doc.body) {
    const parent: Element = node.parentElement
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || sibling.hasAttribute(PRINT_HIDE_ATTRIBUTE)) continue
      // A <script> or <style> prints nothing; leaving it alone keeps a
      // stylesheet the document depends on in force.
      if (/^(SCRIPT|STYLE|LINK|META|TEMPLATE)$/.test(sibling.tagName)) continue
      sibling.setAttribute(PRINT_HIDE_ATTRIBUTE, '')
      hidden.push(sibling)
    }
    node = parent
  }
  target.setAttribute(PRINT_TARGET_ATTRIBUTE, '')

  const margin =
    typeof options.margin === 'number' && Number.isFinite(options.margin) && options.margin >= 0
      ? options.margin
      : DEFAULT_DOCUMENT_MARGIN_MM
  const style = doc.createElement('style')
  style.id = PRINT_STYLE_ID
  style.textContent = [
    '@media print {',
    `  [${PRINT_HIDE_ATTRIBUTE}] { display: none !important; }`,
    // Shown even when it is kept off the screen, and with its own colours:
    // a navy header band is part of the document, not a background to drop.
    `  [${PRINT_TARGET_ATTRIBUTE}] { display: block !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }`,
    `  ${pageRule(options.paper, margin)}`,
    '}',
  ].join('\n')
  doc.head.appendChild(style)

  const previousTitle = doc.title
  if (options.title) doc.title = options.title

  let restored = false
  let fallback = 0
  const printMedia = typeof view.matchMedia === 'function' ? view.matchMedia('print') : null
  const onMediaChange = (event: MediaQueryListEvent) => {
    if (!event.matches) restore()
  }
  const restore = () => {
    if (restored) return
    restored = true
    for (const element of hidden) element.removeAttribute(PRINT_HIDE_ATTRIBUTE)
    target.removeAttribute(PRINT_TARGET_ATTRIBUTE)
    style.remove()
    if (options.title) doc.title = previousTitle
    view.removeEventListener('afterprint', restore)
    printMedia?.removeEventListener?.('change', onMediaChange)
    view.clearTimeout(fallback)
  }
  view.addEventListener('afterprint', restore)
  printMedia?.addEventListener?.('change', onMediaChange)
  // A browser that never says the print ended still gets its page back.
  fallback = view.setTimeout(restore, 5 * 60_000)

  try {
    view.print()
  } catch {
    restore()
    return false
  }
  return true
}

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3',
  'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'TABLE', 'TBODY', 'TFOOT', 'THEAD', 'TR', 'UL',
])
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'svg'])

/**
 * A document as plain text, one block per line. It works for a document kept
 * off the screen too, which `innerText` cannot do: an element that is not
 * rendered answers `innerText` with its `textContent`, line breaks gone.
 */
export function functionDocumentText(root: HTMLElement): string {
  const view = root.ownerDocument.defaultView
  const parts: string[] = []
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      parts.push((node.textContent ?? '').replace(/\s+/g, ' '))
      return
    }
    if (node.nodeType !== 1) return
    const element = node as HTMLElement
    if (SKIPPED_TAGS.has(element.tagName)) return
    if (element.getAttribute('aria-hidden') === 'true') return
    if (element.tagName === 'BR') {
      parts.push('\n')
      return
    }
    const display = view?.getComputedStyle(element).display ?? ''
    const block =
      BLOCK_TAGS.has(element.tagName) ||
      /^(block|flex|grid|list-item|table|table-row)$/.test(display)
    const cell = element.tagName === 'TD' || element.tagName === 'TH' || display === 'table-cell'
    if (block) parts.push('\n')
    for (const child of Array.from(element.childNodes)) walk(child)
    if (block) parts.push('\n')
    else if (cell) parts.push('\t')
  }
  walk(root)
  return parts
    .join('')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, (run) => (run.includes('\t') ? '  ' : ' ')).trim())
    .filter((line) => line !== '')
    .join('\n')
}

/** Copies text; false when neither the clipboard nor the fallback works. */
export async function copyFunctionDocumentText(
  text: string,
  doc: Document = document,
): Promise<boolean> {
  const clipboard = doc.defaultView?.navigator?.clipboard
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // Refused (no permission, not focused): try the selection route.
    }
  }
  const area = doc.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  doc.body.appendChild(area)
  area.select()
  let copied: boolean
  try {
    copied = typeof doc.execCommand === 'function' && doc.execCommand('copy')
  } catch {
    copied = false
  }
  area.remove()
  return copied
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

/**
 * Opens the device's share sheet with the text. Where there is none — most
 * desktop browsers — the text is copied instead, and the caller says so.
 */
export async function shareFunctionDocumentText(
  title: string,
  text: string,
  doc: Document = document,
): Promise<ShareOutcome> {
  const navigatorRef = doc.defaultView?.navigator
  if (navigatorRef && typeof navigatorRef.share === 'function') {
    try {
      await navigatorRef.share({ title, text })
      return 'shared'
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') return 'cancelled'
    }
  }
  return (await copyFunctionDocumentText(text, doc)) ? 'copied' : 'failed'
}
