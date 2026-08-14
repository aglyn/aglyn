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

/**
 * AGL-1562 — CTA and outbound link clicks, asserted on the DOM they actually
 * meet.
 *
 * These fire from a delegated listener rather than a call site, so "is it
 * wired" is not a question about one component: it is a question about which
 * clicks the rules claim and which they let past. Both halves matter. An
 * over-eager rule puts every internal navigation into GA's per-session event
 * budget; a shy one reports zero, which is indistinguishable from a page
 * nobody clicked.
 *
 * The consent case is the one that must never regress: a visitor who has not
 * granted analytics has no `window.gtag` at all (AGL-1498 gates at the
 * source), and their clicks must therefore produce NOTHING — not a queued
 * event, not a deferred one.
 */

import {
  installLinkClickTracking,
  classifyLinkClick,
  resetLinkClickTracking,
} from './analytics-link-clicks'

type GtagCall = [string, string, Record<string, unknown>]

function installGtag(): GtagCall[] {
  const calls: GtagCall[] = []
  ;(window as unknown as { gtag?: unknown }).gtag = (...args: unknown[]) => {
    calls.push(args as GtagCall)
  }
  return calls
}

/** The page context the tenant hands the classifier. */
const context = {
  hostname: 'localhost',
  baseHref: 'http://localhost/pricing',
  surface: 'site',
}

/** Render markup and hand back the element the visitor's pointer lands on. */
function paint(html: string, clickTargetId = 'target'): HTMLElement {
  document.body.innerHTML = html
  return document.getElementById(clickTargetId) as HTMLElement
}

const classify = (element: Element | null) => classifyLinkClick(element, context)

beforeEach(() => {
  document.body.innerHTML = ''
  resetLinkClickTracking()
})

afterEach(() => {
  delete (window as unknown as { gtag?: unknown }).gtag
})

describe('what counts as a CTA (AGL-1562)', () => {
  it('counts a link built to look like a button, with the label a report can read', () => {
    const link = paint(
      '<a id="target" class="MuiButton-root" href="https://app.localhost/signup">Start free</a>',
    )

    expect(classify(link)).toEqual({
      name: 'select_content',
      params: {
        content_type: 'cta',
        content_id: 'Start free',
        surface: 'site',
      },
    })
  })

  it('resolves the anchor from whatever the pointer actually hit', () => {
    // Real CTAs wrap their label in spans, and MUI adds a ripple element that
    // is frequently the literal event target.
    const span = paint(
      '<a class="MuiButton-root" href="/signup"><span id="target">Start free</span></a>',
    )

    expect(classify(span)?.params).toMatchObject({ content_id: 'Start free' })
  })

  it('names the section when the author marked one', () => {
    const link = paint(
      '<div data-analytics-section="pricing">' +
        '<a id="target" role="button" href="/signup">Choose Pro</a></div>',
    )

    expect(classify(link)?.params).toMatchObject({
      content_id: 'pricing:Choose Pro',
    })
  })

  it('falls back to the landmark, so a footer CTA is not the hero CTA', () => {
    // The whole point of the param: two identical labels that sell from
    // different places must not collapse into one row.
    const footer = paint(
      '<footer><a id="target" class="MuiButton-root" href="/signup">Get started</a></footer>',
    )
    expect(classify(footer)?.params).toMatchObject({
      content_id: 'footer:Get started',
    })

    const hero = paint(
      '<main><a id="target" class="MuiButton-root" href="/signup">Get started</a></main>',
    )
    expect(hero && classify(hero)?.params).toMatchObject({
      content_id: 'Get started',
    })
  })

  it('prefers the author-supplied id over the visible label', () => {
    const link = paint(
      '<a id="target" data-analytics-id="hero-primary" class="MuiButton-root" ' +
        'href="/signup">Start free</a>',
    )

    expect(classify(link)?.params).toMatchObject({ content_id: 'hero-primary' })
  })

  it('still identifies an icon-only CTA by its accessible name', () => {
    const link = paint(
      '<a id="target" role="button" aria-label="Book a demo" href="/demo"><svg></svg></a>',
    )

    expect(classify(link)?.params).toMatchObject({ content_id: 'Book a demo' })
  })

  it('takes a CTA styled by a surface that owns no MUI — the docs opt-in', () => {
    // AGL-1579 reuses this module; `data-analytics-cta` is how a surface with
    // its own design system says "this link is a call to action".
    const link = paint(
      '<a id="target" data-analytics-cta href="https://app.localhost/signup">Try it</a>',
    )

    expect(classify(link)?.name).toBe('select_content')
  })
})

describe('what counts as an outbound click', () => {
  it('reports the destination domain and which link it was', () => {
    const link = paint(
      '<a id="target" href="https://github.com/aglyn/aglyn">Star us on GitHub</a>',
    )

    expect(classify(link)).toEqual({
      name: 'click',
      params: {
        link_domain: 'github.com',
        link_id: 'Star us on GitHub',
        surface: 'site',
      },
    })
  })

  it('catches a rich-text anchor, which React never rendered', () => {
    // `AglynTypography` and the Custom HTML element write their anchors with
    // dangerouslySetInnerHTML — no handler can be attached to them, which is
    // the reason this is a delegated listener at all.
    const paragraph = document.createElement('p')
    paragraph.innerHTML = 'Read the <a id="target" href="https://docs.example.com/x">docs</a>.'
    document.body.appendChild(paragraph)

    expect(classify(document.getElementById('target'))?.params).toMatchObject({
      link_domain: 'docs.example.com',
    })
  })

  it('treats a protocol-relative href as the cross-host link it is', () => {
    const link = paint('<a id="target" href="//github.com/aglyn">Source</a>')

    expect(classify(link)?.params).toMatchObject({ link_domain: 'github.com' })
  })
})

describe('what is deliberately NOT counted', () => {
  it('an ordinary internal link — its own pageview already counts it', () => {
    expect(classify(paint('<a id="target" href="/features">Features</a>'))).toBe(
      null,
    )
  })

  it('a relative link that resolves back onto this host', () => {
    expect(classify(paint('<a id="target" href="about">About</a>'))).toBe(null)
  })

  it('a mailto: or tel: link — the browser handles it and a lead has its own event', () => {
    expect(
      classify(paint('<a id="target" href="mailto:sales@example.com">Sales</a>')),
    ).toBe(null)
    expect(classify(paint('<a id="target" href="tel:+15551234">Call</a>'))).toBe(
      null,
    )
  })

  it('a button that navigates nowhere — a drawer toggle is not a CTA', () => {
    const button = paint('<button id="target" class="MuiButton-root">Menu</button>')

    expect(classify(button)).toBe(null)
  })

  it('a click on bare page copy', () => {
    expect(classify(paint('<p id="target">Just words</p>'))).toBe(null)
  })
})

describe('a CTA that is also outbound produces ONE event, and it is the CTA', () => {
  it('keeps the section instead of degrading to "somebody left"', () => {
    // The signup CTA on aglyn.com points at app.aglyn.com, so it is both
    // button-shaped and cross-host. Reported as an outbound click it would
    // lose the section that produced it — which is the entire metric.
    const link = paint(
      '<footer><a id="target" class="MuiButton-root" ' +
        'href="https://app.aglyn.com/signup">Start free</a></footer>',
    )

    const hit = classify(link)
    expect(hit?.name).toBe('select_content')
    expect(hit?.params).not.toHaveProperty('link_domain')
  })
})

describe('delivery through the shared taxonomy', () => {
  const clickOn = (element: Element) =>
    element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )

  it('fires the real GA4 event names through trackEvent', () => {
    const calls = installGtag()
    installLinkClickTracking({ surface: 'site' })

    clickOn(
      paint('<a id="target" class="MuiButton-root" href="/signup">Start free</a>'),
    )
    clickOn(paint('<a id="target" href="https://github.com/aglyn">GitHub</a>'))

    expect(calls.map((call) => call[1])).toEqual(['select_content', 'click'])
    expect(calls[0][2]).toEqual({
      content_type: 'cta',
      content_id: 'Start free',
      surface: 'site',
    })
  })

  it('emits NOTHING when consent never loaded gtag', () => {
    // The AGL-1498 gate, inherited rather than re-implemented: no gtag, no
    // event, and no queue that could replay it after a later grant.
    installLinkClickTracking({ surface: 'site' })
    const link = paint(
      '<a id="target" class="MuiButton-root" href="/signup">Start free</a>',
    )

    expect(() => clickOn(link)).not.toThrow()

    // …and a grant that arrives afterwards must not resurrect it.
    const calls = installGtag()
    expect(calls).toHaveLength(0)
  })

  it('strips a param that carries an address, wherever the author put it', () => {
    // `sanitizeEventParams` runs on this path too — a CTA labelled with an
    // email (a "mailto sales@" button) must not put one in a GA dimension.
    const calls = installGtag()
    installLinkClickTracking({ surface: 'site' })

    clickOn(
      paint(
        '<a id="target" class="MuiButton-root" href="/contact">sales@aglyn.com</a>',
      ),
    )

    expect(calls).toHaveLength(1)
    expect(calls[0][2]).not.toHaveProperty('content_id')
    expect(JSON.stringify(calls[0][2])).not.toContain('@')
  })

  it('still counts a click a page handler swallowed', () => {
    // Menus and drawers stop propagation; the click still happened. Capture
    // phase is what makes that true.
    const calls = installGtag()
    installLinkClickTracking({ surface: 'site' })
    const link = paint(
      '<div id="menu"><a id="target" href="https://github.com/aglyn">GitHub</a></div>',
    )
    ;(document.getElementById('menu') as HTMLElement).addEventListener(
      'click',
      (event) => event.stopPropagation(),
      true,
    )

    clickOn(link)

    expect(calls).toHaveLength(1)
  })

  it('installs once, however many times it is called', () => {
    // It is called during RENDER, which React repeats freely — a second
    // listener would double every number on the page.
    const calls = installGtag()
    installLinkClickTracking({ surface: 'site' })
    installLinkClickTracking({ surface: 'site' })
    installLinkClickTracking({ surface: 'site' })

    clickOn(paint('<a id="target" href="https://github.com/aglyn">GitHub</a>'))

    expect(calls).toHaveLength(1)
  })

  it('stops when uninstalled', () => {
    const calls = installGtag()
    const uninstall = installLinkClickTracking({ surface: 'site' })
    uninstall()

    clickOn(paint('<a id="target" href="https://github.com/aglyn">GitHub</a>'))

    expect(calls).toHaveLength(0)
  })

  it('never lets a classification failure break the link', () => {
    const calls = installGtag()
    installLinkClickTracking({ surface: 'site' })
    // An href jsdom's URL parser rejects outright.
    const link = paint('<a id="target" href="http://[::1">Broken</a>')

    expect(() => clickOn(link)).not.toThrow()
    expect(calls).toHaveLength(0)
  })
})
