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

import {
  type ResolvedTokenLabel,
  type TokenSegment,
  TOKEN_SEGMENT_PATTERN,
} from './token-segments'

/**
 * DOM side of the token-pill editors (AGL-586): mapping between a
 * contentEditable surface holding text nodes + atomic pill elements and
 * the segment/unit model in `token-segments.ts`.
 *
 * Pills are `<span data-token="{{...}}" contenteditable="false">` elements
 * whose TEXT is the friendly label — never serialized. Reading the DOM
 * back emits the raw token from the `data-token` attribute, so the stored
 * string always keeps the id-based grammar.
 *
 * Offset mapping mirrors the AGL-582 markdown editor's TreeWalker
 * approach, with one twist: offsets are counted in UNITS (text char = 1,
 * pill = 1 regardless of its label length) so a caret can never address
 * the inside of a pill.
 */

/** Attribute carrying the raw token on a pill element. */
export const TOKEN_PILL_ATTR = 'data-token'

/** Attribute carrying the pill's color family (see token-pill styles). */
export const TOKEN_PILL_GROUP_ATTR = 'data-token-group'

// Deliberately NOT a type predicate: a `node is HTMLElement` guard would
// narrow an already-HTMLElement argument to `never` in the else branch.
const isPillElement = (node: Node): boolean =>
  node.nodeType === Node.ELEMENT_NODE &&
  (node as HTMLElement).hasAttribute(TOKEN_PILL_ATTR)

/**
 * Creates a pill element for direct-DOM surfaces (the inline canvas text
 * editor). React surfaces render the same attributes via `TokenPill`; the
 * container-level styles key off the data attributes, so both kinds of
 * pill look identical.
 */
export function createTokenPillElement(
  doc: Document,
  token: string,
  resolved: ResolvedTokenLabel,
): HTMLSpanElement {
  const pill = doc.createElement('span')
  pill.setAttribute(TOKEN_PILL_ATTR, token)
  pill.setAttribute(
    TOKEN_PILL_GROUP_ATTR,
    resolved.known ? resolved.group : 'unknown',
  )
  pill.setAttribute('contenteditable', 'false')
  pill.setAttribute('role', 'button')
  // The raw token stays inspectable as the tooltip (ids stored, names shown).
  pill.setAttribute('title', token)
  pill.textContent = resolved.label
  return pill
}

const isBlockElement = (node: Node): boolean =>
  node.nodeType === Node.ELEMENT_NODE &&
  /^(DIV|P|LI|UL|OL|H[1-6])$/.test((node as HTMLElement).tagName)

/**
 * Reads an editable surface back into segments: text nodes emit text, pill
 * elements emit their raw `data-token`, `<br>` emits a newline, and block
 * wrappers the browser may sneak in (paste, IME) emit a leading newline.
 * The pill LABEL text never leaks into the serialized value.
 */
export function readTokenSegmentsFromDom(root: HTMLElement): TokenSegment[] {
  const segments: TokenSegment[] = []
  const pushText = (text: string) => {
    if (!text) return
    const last = segments[segments.length - 1]
    if (last?.type === 'text') last.value += text
    else segments.push({ type: 'text', value: text })
  }
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(node.textContent ?? '')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as HTMLElement
    if (isPillElement(element)) {
      const token = element.getAttribute(TOKEN_PILL_ATTR) ?? ''
      if (token) segments.push({ type: 'token', value: token, token })
      return
    }
    if (element.tagName === 'BR') {
      pushText('\n')
      return
    }
    if (isBlockElement(element) && segments.length > 0) pushText('\n')
    element.childNodes.forEach(visit)
  }
  root.childNodes.forEach(visit)
  return segments
}

/** Unit length of a node subtree (text chars; pills and `<br>`s count 1). */
function unitLengthOfNode(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').length
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return 0
  if (isPillElement(node)) return 1
  if ((node as HTMLElement).tagName === 'BR') return 1
  let length = 0
  node.childNodes.forEach((child) => {
    length += unitLengthOfNode(child)
  })
  return length
}

/**
 * Unit offset of a DOM point within `root`. Points inside a pill clamp to
 * the pill's start (a caret can't live inside an atomic token).
 */
export function unitOffsetFromDomPoint(
  root: HTMLElement,
  node: Node,
  offset: number,
): number {
  let units = 0
  const visit = (current: Node): boolean => {
    if (current === node) {
      if (current.nodeType === Node.TEXT_NODE) {
        units += Math.min(offset, (current.textContent ?? '').length)
      } else if (!isPillElement(current)) {
        const children = current.childNodes
        for (let index = 0; index < offset && index < children.length; index++) {
          units += unitLengthOfNode(children[index] as Node)
        }
      }
      return true
    }
    if (current.nodeType === Node.TEXT_NODE) {
      units += (current.textContent ?? '').length
      return false
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return false
    if (isPillElement(current)) {
      // A point INSIDE the pill clamps to the pill start.
      if (current.contains(node)) return true
      units += 1
      return false
    }
    if ((current as HTMLElement).tagName === 'BR') {
      units += 1
      return false
    }
    for (const child of Array.from(current.childNodes)) {
      if (visit(child)) return true
    }
    return false
  }
  visit(root)
  return units
}

/**
 * DOM point for a unit offset. Landing on a pill boundary returns the
 * position in the pill's PARENT (before/after the pill element) so the
 * caret sits beside the atomic token, never inside it.
 */
export function domPointFromUnitOffset(
  root: HTMLElement,
  target: number,
): { node: Node; offset: number } {
  let remaining = Math.max(0, target)
  const visit = (parent: Node): { node: Node; offset: number } | null => {
    const children = parent.childNodes
    for (let index = 0; index < children.length; index++) {
      const child = children[index] as Node
      if (child.nodeType === Node.TEXT_NODE) {
        const length = (child.textContent ?? '').length
        if (remaining <= length) return { node: child, offset: remaining }
        remaining -= length
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      if (isPillElement(child) || (child as HTMLElement).tagName === 'BR') {
        if (remaining === 0) return { node: parent, offset: index }
        remaining -= 1
        if (remaining === 0) return { node: parent, offset: index + 1 }
        continue
      }
      const found = visit(child)
      if (found) return found
    }
    return null
  }
  return visit(root) ?? { node: root, offset: root.childNodes.length }
}

/** Current selection as unit offsets, or null when outside `root`. */
export function selectionUnitsWithin(
  root: HTMLElement,
): { start: number; end: number } | null {
  const selection = root.ownerDocument.defaultView?.getSelection?.()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  ) {
    return null
  }
  const start = unitOffsetFromDomPoint(
    root,
    range.startContainer,
    range.startOffset,
  )
  const end = unitOffsetFromDomPoint(root, range.endContainer, range.endOffset)
  return start <= end ? { start, end } : { start: end, end: start }
}

/** Places the selection at the given unit offsets inside `root`. */
export function setSelectionUnits(
  root: HTMLElement,
  start: number,
  end: number,
): void {
  const selection = root.ownerDocument.defaultView?.getSelection?.()
  if (!selection) return
  const from = domPointFromUnitOffset(root, start)
  const to = end === start ? from : domPointFromUnitOffset(root, end)
  const range = root.ownerDocument.createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  selection.removeAllRanges()
  selection.addRange(range)
}

/**
 * Replaces raw `{{...}}` occurrences in text nodes under `root` with pill
 * elements (inline-editor open path). Returns how many pills were made.
 */
export function materializeTokenPillsInElement(
  root: HTMLElement,
  resolve: (token: string) => ResolvedTokenLabel,
): number {
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(`[${TOKEN_PILL_ATTR}]`)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  const targets: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (new RegExp(TOKEN_SEGMENT_PATTERN.source).test(node.textContent ?? '')) {
      targets.push(node as Text)
    }
  }
  let count = 0
  for (const textNode of targets) {
    const text = textNode.textContent ?? ''
    const fragment = doc.createDocumentFragment()
    let cursor = 0
    const pattern = new RegExp(TOKEN_SEGMENT_PATTERN.source, 'g')
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (match.index > cursor) {
        fragment.appendChild(
          doc.createTextNode(text.slice(cursor, match.index)),
        )
      }
      fragment.appendChild(
        createTokenPillElement(doc, match[0], resolve(match[0])),
      )
      count += 1
      cursor = match.index + match[0].length
    }
    if (cursor < text.length) {
      fragment.appendChild(doc.createTextNode(text.slice(cursor)))
    }
    textNode.replaceWith(fragment)
  }
  return count
}

/**
 * Replaces every pill under `root` with a text node holding its raw token
 * (inline-editor commit path — run on a CLONE before sanitizing, so the
 * stored string carries `{{var:id}}` grammar, never pill labels).
 */
export function replacePillsWithTokenText(root: HTMLElement): void {
  const pills = Array.from(root.querySelectorAll(`[${TOKEN_PILL_ATTR}]`))
  for (const pill of pills) {
    const token = pill.getAttribute(TOKEN_PILL_ATTR) ?? ''
    pill.replaceWith(root.ownerDocument.createTextNode(token))
  }
}
