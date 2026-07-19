/**
 * @jest-environment jsdom
 */
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
  applyElementVisibility,
  dispatchDrawerCommand,
  DRAWER_COMMAND_EVENT,
  ELEMENT_HIDDEN_CLASS,
  ELEMENT_HIDDEN_STYLE_ID,
  ensureElementHiddenStyle,
  subscribeDrawerCommands,
  VISIBILITY_BAND_MEDIA,
  VISIBILITY_BANDS,
} from './element-ui'

describe('applyElementVisibility (AGL-562)', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div data-aglyn="leaf:a">A</div>' +
      '<div data-aglyn="leaf:b" class="other">B</div>'
  })

  const el = (id: string) =>
    document.querySelector(`[data-aglyn="leaf:${id}"]`) as HTMLElement

  it('hides by adding the shared hidden class', () => {
    const touched = applyElementVisibility('hide', '[data-aglyn="leaf:a"]')
    expect(touched).toBe(1)
    expect(el('a').classList.contains(ELEMENT_HIDDEN_CLASS)).toBe(true)
    // Untouched siblings keep their classes.
    expect(el('b').className).toBe('other')
  })

  it('shows by removing the class and any inline display:none', () => {
    el('a').classList.add(ELEMENT_HIDDEN_CLASS)
    el('a').style.display = 'none'
    applyElementVisibility('show', '[data-aglyn="leaf:a"]')
    expect(el('a').classList.contains(ELEMENT_HIDDEN_CLASS)).toBe(false)
    expect(el('a').style.display).toBe('')
  })

  it('keeps a non-hiding inline display on show', () => {
    el('a').style.display = 'flex'
    applyElementVisibility('show', '[data-aglyn="leaf:a"]')
    expect(el('a').style.display).toBe('flex')
  })

  it('toggles per element', () => {
    el('a').classList.add(ELEMENT_HIDDEN_CLASS)
    applyElementVisibility('toggle', 'div')
    expect(el('a').classList.contains(ELEMENT_HIDDEN_CLASS)).toBe(false)
    expect(el('b').classList.contains(ELEMENT_HIDDEN_CLASS)).toBe(true)
    applyElementVisibility('toggle', 'div')
    expect(el('a').classList.contains(ELEMENT_HIDDEN_CLASS)).toBe(true)
    expect(el('b').classList.contains(ELEMENT_HIDDEN_CLASS)).toBe(false)
  })

  it('never throws on a bad or unmatched selector', () => {
    expect(applyElementVisibility('hide', ':::nope')).toBe(0)
    expect(applyElementVisibility('hide', '.does-not-exist')).toBe(0)
  })
})

describe('ensureElementHiddenStyle', () => {
  it('injects the rule once', () => {
    document.getElementById(ELEMENT_HIDDEN_STYLE_ID)?.remove()
    ensureElementHiddenStyle()
    ensureElementHiddenStyle()
    const styles = document.querySelectorAll(`#${ELEMENT_HIDDEN_STYLE_ID}`)
    expect(styles).toHaveLength(1)
    expect(styles[0].textContent).toContain(ELEMENT_HIDDEN_CLASS)
  })
})

describe('drawer command bus (AGL-562)', () => {
  it('delivers commands with an optional node id target', () => {
    const seen: Array<{ command: string; nodeId?: string }> = []
    const unsubscribe = subscribeDrawerCommands((detail) => seen.push(detail))
    dispatchDrawerCommand('open', 'node-1')
    dispatchDrawerCommand('toggle')
    dispatchDrawerCommand('close', 'node-2')
    unsubscribe()
    dispatchDrawerCommand('open', 'node-3')
    expect(seen).toEqual([
      { command: 'open', nodeId: 'node-1' },
      { command: 'toggle' },
      { command: 'close', nodeId: 'node-2' },
    ])
  })

  it('ignores malformed events', () => {
    const seen: unknown[] = []
    const unsubscribe = subscribeDrawerCommands((detail) => seen.push(detail))
    window.dispatchEvent(new CustomEvent(DRAWER_COMMAND_EVENT, {}))
    unsubscribe()
    expect(seen).toHaveLength(0)
  })
})

describe('visibility bands (AGL-562)', () => {
  it('covers the viewport without gaps or overlap', () => {
    expect(VISIBILITY_BANDS).toEqual(['mobile', 'tablet', 'desktop'])
    expect(VISIBILITY_BAND_MEDIA.mobile).toContain('max-width:599.95px')
    expect(VISIBILITY_BAND_MEDIA.tablet).toContain('min-width:600px')
    expect(VISIBILITY_BAND_MEDIA.tablet).toContain('max-width:899.95px')
    expect(VISIBILITY_BAND_MEDIA.desktop).toContain('min-width:900px')
  })
})
