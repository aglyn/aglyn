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
  createTokenPillElement,
  domPointFromUnitOffset,
  materializeTokenPillsInElement,
  readTokenSegmentsFromDom,
  replacePillsWithTokenText,
  selectionUnitsWithin,
  setSelectionUnits,
  unitOffsetFromDomPoint,
} from './token-editable-dom'
import { serializeTokenSegments } from './token-segments'

const resolved = { label: 'Message', group: 'variable' as const, known: true }

/** `ab` + pill + `cd` — the canonical 5-unit fixture. */
function buildSurface(): HTMLElement {
  const root = document.createElement('div')
  root.appendChild(document.createTextNode('ab'))
  root.appendChild(createTokenPillElement(document, '{{var:v1}}', resolved))
  root.appendChild(document.createTextNode('cd'))
  document.body.appendChild(root)
  return root
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('createTokenPillElement (AGL-586)', () => {
  it('renders the label but carries the raw token in attributes', () => {
    const pill = createTokenPillElement(document, '{{var:v1}}', resolved)
    expect(pill.textContent).toBe('Message')
    expect(pill.getAttribute('data-token')).toBe('{{var:v1}}')
    expect(pill.getAttribute('data-token-group')).toBe('variable')
    expect(pill.getAttribute('contenteditable')).toBe('false')
    expect(pill.getAttribute('title')).toBe('{{var:v1}}')
  })

  it('marks unresolved tokens with the unknown group', () => {
    const pill = createTokenPillElement(document, '{{var:g}}', {
      label: 'g',
      group: 'variable',
      known: false,
    })
    expect(pill.getAttribute('data-token-group')).toBe('unknown')
  })
})

describe('readTokenSegmentsFromDom (AGL-586)', () => {
  it('emits raw tokens for pills — labels never leak into the value', () => {
    const root = buildSurface()
    expect(serializeTokenSegments(readTokenSegmentsFromDom(root))).toBe(
      'ab{{var:v1}}cd',
    )
  })

  it('reads <br> as a newline', () => {
    const root = buildSurface()
    root.appendChild(document.createElement('br'))
    root.appendChild(document.createTextNode('e'))
    expect(serializeTokenSegmentsOf(root)).toBe('ab{{var:v1}}cd\ne')
  })

  it('reads browser-inserted block wrappers as line breaks', () => {
    const root = document.createElement('div')
    root.appendChild(document.createTextNode('one'))
    const block = document.createElement('div')
    block.appendChild(document.createTextNode('two'))
    root.appendChild(block)
    expect(serializeTokenSegmentsOf(root)).toBe('one\ntwo')
  })

  function serializeTokenSegmentsOf(root: HTMLElement): string {
    return serializeTokenSegments(readTokenSegmentsFromDom(root))
  }
})

describe('unit offset ↔ DOM point mapping (AGL-586)', () => {
  it('counts a pill as exactly one unit', () => {
    const root = buildSurface()
    const cd = root.childNodes[2] as Text
    // Point at start of 'cd' = after a(1) + b(1) + pill(1) = 3 units.
    expect(unitOffsetFromDomPoint(root, cd, 0)).toBe(3)
    expect(unitOffsetFromDomPoint(root, cd, 2)).toBe(5)
  })

  it('clamps a point inside a pill to the pill start', () => {
    const root = buildSurface()
    const pillText = root.childNodes[1]?.firstChild as Text
    expect(unitOffsetFromDomPoint(root, pillText, 4)).toBe(2)
  })

  it('maps unit offsets back to text positions', () => {
    const root = buildSurface()
    expect(domPointFromUnitOffset(root, 1)).toEqual({
      node: root.childNodes[0],
      offset: 1,
    })
    expect(domPointFromUnitOffset(root, 4)).toEqual({
      node: root.childNodes[2],
      offset: 1,
    })
  })

  it('maps pill boundaries to caret-valid positions beside the pill', () => {
    const root = buildSurface()
    // Unit 2 = before the pill: the end of the preceding text node (an
    // equivalent caret position to parent/child-offset 1).
    expect(domPointFromUnitOffset(root, 2)).toEqual({
      node: root.childNodes[0],
      offset: 2,
    })
    // With no preceding text (pill first), boundaries resolve in the
    // parent, before/after the pill element itself.
    const pillFirst = document.createElement('div')
    pillFirst.appendChild(
      createTokenPillElement(document, '{{var:v1}}', resolved),
    )
    pillFirst.appendChild(document.createTextNode('xy'))
    document.body.appendChild(pillFirst)
    expect(domPointFromUnitOffset(pillFirst, 0)).toEqual({
      node: pillFirst,
      offset: 0,
    })
    expect(domPointFromUnitOffset(pillFirst, 1)).toEqual({
      node: pillFirst,
      offset: 1,
    })
  })

  it('round-trips through the live selection', () => {
    const root = buildSurface()
    setSelectionUnits(root, 1, 4)
    expect(selectionUnitsWithin(root)).toEqual({ start: 1, end: 4 })
    setSelectionUnits(root, 3, 3)
    expect(selectionUnitsWithin(root)).toEqual({ start: 3, end: 3 })
  })

  it('returns null when the selection lives outside the root', () => {
    const root = buildSurface()
    const other = document.createElement('div')
    other.appendChild(document.createTextNode('elsewhere'))
    document.body.appendChild(other)
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(other)
    selection?.removeAllRanges()
    selection?.addRange(range)
    expect(selectionUnitsWithin(root)).toBeNull()
  })
})

describe('materialize / serialize pills (AGL-586)', () => {
  it('turns raw {{...}} text into pills and back', () => {
    const root = document.createElement('div')
    root.innerHTML = 'Hello <b>bold {{var:v1}} text</b> tail {{entry.title}}'
    const count = materializeTokenPillsInElement(root, (token) => ({
      label: token === '{{var:v1}}' ? 'Message' : 'Title',
      group: token === '{{var:v1}}' ? 'variable' : 'entry',
      known: true,
    }))
    expect(count).toBe(2)
    const pills = root.querySelectorAll('[data-token]')
    expect(pills.length).toBe(2)
    expect(pills[0]?.textContent).toBe('Message')
    // Bold structure around the pill survives.
    expect(root.querySelector('b')?.contains(pills[0] as Node)).toBe(true)

    replacePillsWithTokenText(root)
    expect(root.querySelectorAll('[data-token]').length).toBe(0)
    expect(root.textContent).toBe(
      'Hello bold {{var:v1}} text tail {{entry.title}}',
    )
  })

  it('leaves token-free content untouched', () => {
    const root = document.createElement('div')
    root.innerHTML = 'no tokens <i>here</i>'
    expect(materializeTokenPillsInElement(root, () => resolved)).toBe(0)
    expect(root.innerHTML).toBe('no tokens <i>here</i>')
  })
})
