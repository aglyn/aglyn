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
  dispatchVideoCommand,
  DRAWER_COMMAND_EVENT,
  ELEMENT_HIDDEN_CLASS,
  ELEMENT_HIDDEN_STYLE_ID,
  ensureElementHiddenStyle,
  expandLeafSelector,
  leafIdFromSelector,
  leafIdsMatch,
  MENU_COMMAND_EVENT,
  normalizeLeafId,
  resolveStepTarget,
  runPlayVideoStep,
  runScrollToStep,
  subscribeDrawerCommands,
  subscribeMenuCommands,
  subscribeVideoCommands,
  VIDEO_COMMAND_EVENT,
  VISIBILITY_BAND_MEDIA,
  VISIBILITY_BANDS,
} from './element-ui'
import { SCROLL_TO_MAX_OFFSET_PX } from './actions'
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

  /**
   * AGL-1229. A reusable component grafted into a layout namespaces its
   * nodes `cmp__{instanceId}__`, which — unlike the layout prefixes — cannot
   * be enumerated, so the AGL-573 fix never reached it. Every interaction
   * authored inside the Site nav component compiled fine and then matched
   * nothing on the live page: zero listeners, a mega menu that never opened.
   */
  describe('reusable-component grafts (AGL-1229)', () => {
    const GRAFTED = `cmp__inst01__${RAW}`
    const NESTED = `cmp__outer1__cmp__inner1__${RAW}`

    it('matches an authored raw id to its grafted live id', () => {
      expect(leafIdsMatch(RAW, GRAFTED)).toBe(true)
      expect(leafIdsMatch(GRAFTED, RAW)).toBe(true)
      expect(leafIdsMatch(RAW, NESTED)).toBe(true)
    })

    it('matches a component graft inside a layout', () => {
      expect(leafIdsMatch(RAW, `layout__cmp__inst01__${RAW}`)).toBe(true)
    })

    /**
     * Read off the LIVE aglyn-marketing page, not invented: the Site nav
     * component placed in a layout ships this exact id shape. The instance
     * id is itself layout-composed (`layout__52Ef-3t6yd`), so the namespace
     * CONTAINS `__` — which is why the graft is matched by suffix rather
     * than parsed off. Parsing splits `___R91yATrXH` two ways and both are
     * structurally valid.
     */
    it('matches the id shape the live nav actually ships', () => {
      expect(
        leafIdsMatch('_R91yATrXH', 'cmp__layout__52Ef-3t6yd___R91yATrXH'),
      ).toBe(true)
      expect(
        leafIdsMatch('88Mg1SKiQ1', 'cmp__layout__52Ef-3t6yd__88Mg1SKiQ1'),
      ).toBe(true)
    })

    it('leaves a graft id alone when normalizing (it is unparseable)', () => {
      // Documented non-goal: normalizeLeafId handles layout prefixes only.
      expect(normalizeLeafId(GRAFTED)).toBe(GRAFTED)
    })

    it('refuses an unrelated id that merely embeds the raw one', () => {
      expect(leafIdsMatch(RAW, `cmp__inst01__X${RAW}Y`)).toBe(false)
      expect(leafIdsMatch(RAW, `cmp__inst01__${RAW}zz`)).toBe(false)
    })

    it('refuses a suffix match on a NON-graft id', () => {
      // Only a `cmp__`-prefixed id may match by suffix; an arbitrary id that
      // happens to end in `__<raw>` must not be reachable.
      expect(leafIdsMatch(RAW, `somethingElse__${RAW}`)).toBe(false)
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
    // Plus one SUFFIX alternative (AGL-1229) — the only way to reach a
    // reusable-component graft, whose `cmp__{instanceId}__` namespace is
    // per-placement and therefore not enumerable.
    const allForms = [
      `[data-aglyn="leaf:${RAW}"]`,
      ...LAYOUT_NODE_ID_PREFIXES.map(
        (prefix) => `[data-aglyn="leaf:${prefix}${RAW}"]`,
      ),
      `[data-aglyn$="__${RAW}"]`,
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

    // The regression itself (AGL-1229), against real DOM rather than string
    // equality: this is the shape the live nav ships.
    it('matches a node grafted from a reusable component', () => {
      document.body.innerHTML = `<div data-aglyn="leaf:cmp__inst01__${RAW}">Panel</div>`
      const expanded = expandLeafSelector(`[data-aglyn="leaf:${RAW}"]`)
      expect(document.querySelector(expanded)).not.toBeNull()
    })

    it('matches a component grafted inside a layout, and nested grafts', () => {
      document.body.innerHTML =
        `<div data-aglyn="leaf:layout__cmp__inst01__${RAW}">A</div>` +
        `<div data-aglyn="leaf:cmp__outer1__cmp__inner1__${RAW}">B</div>`
      const expanded = expandLeafSelector(`[data-aglyn="leaf:${RAW}"]`)
      expect(document.querySelectorAll(expanded)).toHaveLength(2)
    })

    it('does NOT match an unrelated node that merely embeds the id', () => {
      // The suffix is anchored to `__` + the exact id, so a longer id that
      // happens to contain this one cannot be reached.
      document.body.innerHTML =
        `<div data-aglyn="leaf:cmp__inst01__X${RAW}Y">nope</div>` +
        `<div data-aglyn="leaf:${RAW}zz">nope</div>`
      const expanded = expandLeafSelector(`[data-aglyn="leaf:${RAW}"]`)
      expect(document.querySelector(expanded)).toBeNull()
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

/**
 * jsdom lays nothing out: every element reports no client rects and a zero
 * bounding box. These give an element the box a browser would, so the "is it
 * on the page" rule and the position arithmetic both have something to read.
 */
const layOut = (element: Element, top = 0) => {
  Object.defineProperty(element, 'getClientRects', {
    configurable: true,
    value: () => [{ top }],
  })
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top, left: 0, right: 0, bottom: top, width: 0, height: 0 }),
  })
  return element as HTMLElement
}

describe('resolveStepTarget (AGL-2867)', () => {
  it('takes the first match that is on the page, skipping hidden copies', () => {
    document.body.innerHTML =
      '<div id="desktop" data-aglyn="leaf:cta"></div>' +
      '<div id="mobile" data-aglyn="leaf:cta"></div>'
    const mobile = layOut(document.getElementById('mobile') as Element)
    expect(resolveStepTarget('[data-aglyn="leaf:cta"]')).toBe(mobile)
  })

  it('answers null for no match, no box, or a selector that does not parse', () => {
    document.body.innerHTML = '<div id="hidden" data-aglyn="leaf:cta"></div>'
    expect(resolveStepTarget('[data-aglyn="leaf:gone"]')).toBeNull()
    // A `display: none` element is in the document but not on the page.
    expect(resolveStepTarget('[data-aglyn="leaf:cta"]')).toBeNull()
    expect(() => resolveStepTarget('[data-aglyn="leaf:')).not.toThrow()
    expect(resolveStepTarget('[data-aglyn="leaf:')).toBeNull()
  })
})

describe('runScrollToStep (AGL-2867)', () => {
  let scrollTo: jest.SpyInstance
  let target: HTMLElement

  beforeEach(() => {
    document.body.innerHTML =
      '<header>Site nav</header>' +
      '<section id="film" data-aglyn="leaf:film">The film</section>' +
      '<button id="cta">Watch the demo</button>'
    target = layOut(document.getElementById('film') as Element, 300)
    scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 })
  })

  afterEach(() => {
    scrollTo.mockRestore()
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  const reduceMotion = (matches: boolean) => {
    ;(window as { matchMedia?: unknown }).matchMedia = (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' && matches,
    })
  }

  it('brings the target to the top of the window, smoothly, less the offset', () => {
    expect(runScrollToStep('[data-aglyn="leaf:film"]', { offsetPx: 64 })).toBe(true)
    // 500 already scrolled + 300 from the top of the window − a 64px header.
    expect(scrollTo).toHaveBeenCalledWith({ top: 736, behavior: 'smooth' })
  })

  it('jumps when the author asked for an instant scroll', () => {
    runScrollToStep('[data-aglyn="leaf:film"]', { behavior: 'instant' })
    expect(scrollTo).toHaveBeenCalledWith({ top: 800, behavior: 'instant' })
  })

  it('jumps for a visitor who asks for reduced motion, whatever was authored', () => {
    reduceMotion(true)
    runScrollToStep('[data-aglyn="leaf:film"]', { behavior: 'smooth' })
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 800, behavior: 'instant' })
    // The control: the same query answering no leaves the animation alone,
    // so the case above is about the preference and not about `matchMedia`
    // merely existing.
    reduceMotion(false)
    runScrollToStep('[data-aglyn="leaf:film"]', { behavior: 'smooth' })
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 800, behavior: 'smooth' })
  })

  it('holds a stored offset to the band the editor enforces', () => {
    // A stored document need not have passed through the editor, so the
    // runtime clamps rather than trusting the number it is handed.
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 5000 })
    runScrollToStep('[data-aglyn="leaf:film"]', { offsetPx: -80 })
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 5300, behavior: 'smooth' })
    runScrollToStep('[data-aglyn="leaf:film"]', { offsetPx: 99_999 })
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 5300 - SCROLL_TO_MAX_OFFSET_PX,
      behavior: 'smooth',
    })
    runScrollToStep('[data-aglyn="leaf:film"]', { offsetPx: Number.NaN })
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 5300, behavior: 'smooth' })
  })

  it('never asks for a position above the top of the page', () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
    layOut(target, 10)
    runScrollToStep('[data-aglyn="leaf:film"]', { offsetPx: 64 })
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('moves focus to the target without a second scroll, and tidies up after', () => {
    const focus = jest.spyOn(target, 'focus')
    runScrollToStep('[data-aglyn="leaf:film"]')
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(document.activeElement).toBe(target)
    // Focusable by script for the visit, never added to the Tab order…
    expect(target.getAttribute('tabindex')).toBe('-1')
    // …and the author's markup is as it was once focus moves on.
    target.blur()
    expect(target.hasAttribute('tabindex')).toBe(false)
  })

  it('leaves an element that already takes focus exactly as authored', () => {
    const button = layOut(document.getElementById('cta') as Element, 40)
    runScrollToStep('#cta')
    expect(document.activeElement).toBe(button)
    expect(button.hasAttribute('tabindex')).toBe(false)
  })

  it('does nothing, and throws nothing, for a target that is missing, deleted or hidden', () => {
    const active = document.activeElement
    expect(runScrollToStep('[data-aglyn="leaf:never-existed"]')).toBe(false)
    target.remove()
    expect(runScrollToStep('[data-aglyn="leaf:film"]')).toBe(false)
    document.body.insertAdjacentHTML(
      'beforeend',
      '<section data-aglyn="leaf:hidden"></section>',
    )
    expect(runScrollToStep('[data-aglyn="leaf:hidden"]')).toBe(false)
    expect(() => runScrollToStep('[data-aglyn="leaf:')).not.toThrow()
    expect(scrollTo).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(active)
  })

  it('scrolls a box that scrolls its own content, rather than only the window', () => {
    document.body.innerHTML =
      '<div id="panel" style="overflow-y: auto; height: 200px">' +
      '<p id="deep" data-aglyn="leaf:deep">Deep in the panel</p></div>'
    const panel = document.getElementById('panel') as HTMLElement
    Object.defineProperty(panel, 'scrollHeight', { configurable: true, value: 900 })
    Object.defineProperty(panel, 'clientHeight', { configurable: true, value: 200 })
    const deep = layOut(document.getElementById('deep') as Element, 600)
    const scrollIntoView = jest.fn()
    deep.scrollIntoView = scrollIntoView

    runScrollToStep('[data-aglyn="leaf:deep"]', { behavior: 'instant' })

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' })
    expect(scrollTo).not.toHaveBeenCalled()
  })
})

describe('video commands (AGL-2867)', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="film" data-aglyn="leaf:film"></div>' +
      '<div id="heading" data-aglyn="leaf:heading"></div>'
    layOut(document.getElementById('film') as Element)
    layOut(document.getElementById('heading') as Element)
  })

  it('delivers a play to the element the step names, which says it answered', () => {
    const film = document.getElementById('film') as HTMLElement
    const heard: unknown[] = []
    const unsubscribe = subscribeVideoCommands(film, (detail) => heard.push(detail))

    expect(runPlayVideoStep('[data-aglyn="leaf:film"]')).toBe(true)
    expect(heard).toEqual([{ command: 'play' }])

    unsubscribe()
    expect(runPlayVideoStep('[data-aglyn="leaf:film"]')).toBe(false)
    expect(heard).toHaveLength(1)
  })

  it('goes to that element only — never to another video, never to the window', () => {
    const film = document.getElementById('film') as HTMLElement
    const heading = document.getElementById('heading') as HTMLElement
    const filmHeard: unknown[] = []
    const onWindow = jest.fn()
    const unsubscribe = subscribeVideoCommands(film, (d) => filmHeard.push(d))
    window.addEventListener(VIDEO_COMMAND_EVENT, onWindow)

    // Not a Video: nobody answers, and a different element's listener is
    // not reached by an event sent to this one.
    expect(dispatchVideoCommand(heading, 'play')).toBe(false)
    expect(filmHeard).toHaveLength(0)
    expect(onWindow).not.toHaveBeenCalled()

    unsubscribe()
    window.removeEventListener(VIDEO_COMMAND_EVENT, onWindow)
  })

  it('does nothing, and throws nothing, for a target that is missing or deleted', () => {
    expect(runPlayVideoStep('[data-aglyn="leaf:never-existed"]')).toBe(false)
    document.getElementById('film')?.remove()
    expect(runPlayVideoStep('[data-aglyn="leaf:film"]')).toBe(false)
    expect(() => runPlayVideoStep('[data-aglyn="leaf:')).not.toThrow()
  })

  it('ignores a malformed event', () => {
    const film = document.getElementById('film') as HTMLElement
    const heard: unknown[] = []
    const unsubscribe = subscribeVideoCommands(film, (d) => heard.push(d))
    film.dispatchEvent(new CustomEvent(VIDEO_COMMAND_EVENT, {}))
    unsubscribe()
    expect(heard).toHaveLength(0)
  })
})
