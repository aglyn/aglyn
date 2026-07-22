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
  dispatchMenuCommand,
  DRAWER_COMMAND_EVENT,
  ELEMENT_HIDDEN_CLASS,
  ELEMENT_HIDDEN_STYLE_ID,
  ensureElementHiddenStyle,
  expandLeafSelector,
  leafIdFromSelector,
  leafIdsMatch,
  MENU_COMMAND_EVENT,
  normalizeLeafId,
  subscribeDrawerCommands,
  subscribeMenuCommands,
  VISIBILITY_BAND_MEDIA,
  VISIBILITY_BANDS,
} from './element-ui'
import { LAYOUT_NODE_ID_PREFIXES } from './compose-layout-nodes'

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

describe('menu command bus (AGL-568)', () => {
  it('delivers commands with an optional node id target', () => {
    const seen: Array<{ command: string; nodeId?: string }> = []
    const unsubscribe = subscribeMenuCommands((detail) => seen.push(detail))
    dispatchMenuCommand('open', 'menu-1')
    dispatchMenuCommand('toggle')
    dispatchMenuCommand('close', 'menu-2')
    unsubscribe()
    dispatchMenuCommand('open', 'menu-3')
    expect(seen).toEqual([
      { command: 'open', nodeId: 'menu-1' },
      { command: 'toggle' },
      { command: 'close', nodeId: 'menu-2' },
    ])
  })

  it('carries the hover provenance flag only when set', () => {
    const seen: Array<Record<string, unknown>> = []
    const unsubscribe = subscribeMenuCommands((detail) =>
      seen.push(detail as never),
    )
    dispatchMenuCommand('open', 'menu-1', { hover: true })
    dispatchMenuCommand('open', 'menu-1', { hover: false })
    dispatchMenuCommand('toggle', undefined, { hover: true })
    unsubscribe()
    expect(seen).toEqual([
      { command: 'open', nodeId: 'menu-1', hover: true },
      { command: 'open', nodeId: 'menu-1' },
      { command: 'toggle', hover: true },
    ])
  })

  it('stays off the drawer bus (separate event names)', () => {
    const drawerSeen: unknown[] = []
    const unsubscribe = subscribeDrawerCommands((d) => drawerSeen.push(d))
    dispatchMenuCommand('open', 'menu-1')
    unsubscribe()
    expect(drawerSeen).toHaveLength(0)
    expect(MENU_COMMAND_EVENT).not.toBe(DRAWER_COMMAND_EVENT)
  })

  it('ignores malformed events', () => {
    const seen: unknown[] = []
    const unsubscribe = subscribeMenuCommands((detail) => seen.push(detail))
    window.dispatchEvent(new CustomEvent(MENU_COMMAND_EVENT, {}))
    unsubscribe()
    expect(seen).toHaveLength(0)
  })
})

describe('layout-namespace-insensitive id matching (AGL-573)', () => {
  // The live example from the bug: the Northwind Main Layout Shop dropdown
  // is stamped `leaf:layout___5I3TBXywa` on the live DOM, but the builder
  // persisted the raw canvas id `_5I3TBXywa`.
  const RAW = '_5I3TBXywa'
  const NAMESPACED = `layout__${RAW}` // layout___5I3TBXywa

  describe('normalizeLeafId', () => {
    it('strips a leading layout__ namespace', () => {
      expect(normalizeLeafId(NAMESPACED)).toBe(RAW)
    })

    it('leaves a raw id unchanged (idempotent)', () => {
      expect(normalizeLeafId(RAW)).toBe(RAW)
      expect(normalizeLeafId(normalizeLeafId(NAMESPACED))).toBe(RAW)
    })

    it('only strips a LEADING prefix, never an embedded one', () => {
      expect(normalizeLeafId('Xlayout__abc')).toBe('Xlayout__abc')
      expect(normalizeLeafId('abc-layout__z')).toBe('abc-layout__z')
    })

    it('coerces nullish ids to an empty string', () => {
      expect(normalizeLeafId(undefined)).toBe('')
      expect(normalizeLeafId(null)).toBe('')
    })
  })

  describe('leafIdsMatch', () => {
    it('matches a raw command id to a namespaced live id and back', () => {
      expect(leafIdsMatch(RAW, NAMESPACED)).toBe(true)
      expect(leafIdsMatch(NAMESPACED, RAW)).toBe(true)
    })

    it('matches the un-prefixed case', () => {
      expect(leafIdsMatch(RAW, RAW)).toBe(true)
      expect(leafIdsMatch(NAMESPACED, NAMESPACED)).toBe(true)
    })

    it('never matches unrelated ids (suffix stays anchored)', () => {
      // `_5I3TBXywa` must not match a node that merely embeds it.
      expect(leafIdsMatch(RAW, `layout__X${RAW}Y`)).toBe(false)
      expect(leafIdsMatch(RAW, 'somethingElse')).toBe(false)
    })

    it('treats a missing id as no-match, not a wildcard', () => {
      expect(leafIdsMatch(undefined, undefined)).toBe(false)
      expect(leafIdsMatch('', NAMESPACED)).toBe(false)
    })
  })

  describe('leafIdFromSelector', () => {
    it('reads the id out of a canonical leaf selector', () => {
      expect(leafIdFromSelector(`[data-aglyn="leaf:${RAW}"]`)).toBe(RAW)
    })

    it('returns undefined for non-leaf selectors', () => {
      expect(leafIdFromSelector('#menu-button')).toBeUndefined()
      expect(leafIdFromSelector('header, nav')).toBeUndefined()
      expect(leafIdFromSelector('[data-other="leaf:x"]')).toBeUndefined()
    })
  })

  describe('expandLeafSelector', () => {
    // One alternative per layout-chain depth (AGL-703): a node in a layout
    // nested inside another carries `layout2__`, and an interaction
    // authored on it has to match there too.
    const allForms = [
      `[data-aglyn="leaf:${RAW}"]`,
      ...LAYOUT_NODE_ID_PREFIXES.map(
        (prefix) => `[data-aglyn="leaf:${prefix}${RAW}"]`,
      ),
    ].join(', ')

    it('adds a layout-namespaced alternative per chain depth', () => {
      expect(expandLeafSelector(`[data-aglyn="leaf:${RAW}"]`)).toBe(allForms)
      // The depth-1 form is still the original prefix, unchanged.
      expect(expandLeafSelector(`[data-aglyn="leaf:${RAW}"]`)).toContain(
        `[data-aglyn="leaf:${NAMESPACED}"]`,
      )
    })

    it('normalizes an already-namespaced selector to cover every form', () => {
      expect(expandLeafSelector(`[data-aglyn="leaf:${NAMESPACED}"]`)).toBe(
        allForms,
      )
    })

    it('matches a node nested two layouts deep', () => {
      document.body.innerHTML = `<div data-aglyn="leaf:layout2__${RAW}">Shop</div>`
      const expanded = expandLeafSelector(`[data-aglyn="leaf:${RAW}"]`)
      expect(document.querySelector(expanded)).not.toBeNull()
    })

    it('passes hand-typed CSS selectors through unchanged', () => {
      expect(expandLeafSelector('#menu-button')).toBe('#menu-button')
      expect(expandLeafSelector('header, nav')).toBe('header, nav')
    })

    it('actually matches the namespaced live element via querySelector', () => {
      document.body.innerHTML = `<div data-aglyn="leaf:${NAMESPACED}">Shop</div>`
      const expanded = expandLeafSelector(`[data-aglyn="leaf:${RAW}"]`)
      expect(document.querySelector(expanded)).not.toBeNull()
      // …and does not over-match a similarly-named node.
      document.body.innerHTML = `<div data-aglyn="leaf:layout__X${RAW}Y"></div>`
      expect(document.querySelector(expanded)).toBeNull()
    })
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

// AGL-589: menu-grade choreography for element-visibility steps — grace
// delays with later-intent cancellation, and Escape / outside-pointerdown
// self-dismissal armed only while the target is shown.
describe('runElementVisibilityStep (AGL-589)', () => {
  const {
    runElementVisibilityStep,
    resetElementVisibilityChoreography,
  } = jest.requireActual('./element-ui')

  const mount = () => {
    document.body.innerHTML =
      '<div id="outside"></div>' +
      '<div data-aglyn="leaf:wrap"><button id="btn"></button>' +
      `<div id="panel" data-aglyn="leaf:panel" class="${ELEMENT_HIDDEN_CLASS}"></div></div>`
    return document.getElementById('panel') as HTMLElement
  }
  const hidden = (el: Element) => el.classList.contains(ELEMENT_HIDDEN_CLASS)

  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    resetElementVisibilityChoreography()
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('applies immediately without options (parity with applyElementVisibility)', () => {
    const panel = mount()
    runElementVisibilityStep('show', '#panel')
    expect(hidden(panel)).toBe(false)
  })

  it('defers with delayMs and applies after the delay', () => {
    const panel = mount()
    runElementVisibilityStep('show', '#panel')
    runElementVisibilityStep('hide', '#panel', { delayMs: 250 })
    expect(hidden(panel)).toBe(false)
    jest.advanceTimersByTime(249)
    expect(hidden(panel)).toBe(false)
    jest.advanceTimersByTime(1)
    expect(hidden(panel)).toBe(true)
  })

  it('a later step cancels a pending one — the hover grace period', () => {
    const panel = mount()
    runElementVisibilityStep('show', '#panel')
    // Pointer leaves: delayed hide…
    runElementVisibilityStep('hide', '#panel', { delayMs: 250 })
    jest.advanceTimersByTime(100)
    // …pointer re-enters before the grace elapses: show cancels the hide.
    runElementVisibilityStep('show', '#panel')
    jest.advanceTimersByTime(500)
    expect(hidden(panel)).toBe(false)
  })

  it('dismisses a shown element on Escape and disarms after', () => {
    const panel = mount()
    runElementVisibilityStep('show', '#panel', { dismissOn: ['escape'] })
    expect(hidden(panel)).toBe(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(hidden(panel)).toBe(true)
    // Re-show without dismissal: Escape no longer hides.
    runElementVisibilityStep('show', '#panel')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(hidden(panel)).toBe(false)
  })

  it('dismisses on outside pointerdown but never from inside the target', () => {
    const panel = mount()
    runElementVisibilityStep('show', '#panel', { dismissOn: ['outsideClick'] })
    // Inside the panel: stays open.
    panel.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(hidden(panel)).toBe(false)
    // Outside: closes.
    document
      .getElementById('outside')!
      .dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(hidden(panel)).toBe(true)
  })

  it('toggle arms dismissal only when it lands shown', () => {
    const panel = mount()
    runElementVisibilityStep('toggle', '#panel', { dismissOn: ['escape'] })
    expect(hidden(panel)).toBe(false)
    // Toggle again — now hidden; Escape listeners must be gone.
    runElementVisibilityStep('toggle', '#panel', { dismissOn: ['escape'] })
    expect(hidden(panel)).toBe(true)
    runElementVisibilityStep('show', '#panel')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(hidden(panel)).toBe(false)
  })
})
