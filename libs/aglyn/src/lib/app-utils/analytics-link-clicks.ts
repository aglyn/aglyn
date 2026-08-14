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
 * CTA and outbound link clicks (AGL-1562) — the two link events in the
 * AGL-1561 taxonomy that shipped typed and uncalled: `select_content` and
 * `click`.
 *
 * This is a sibling of `analytics-events.ts`, not a second taxonomy: the event
 * names and their params are still declared there, and everything below fires
 * through `trackEvent`, so the consent gate, the PII sanitizer and the "drop,
 * never queue" posture are inherited rather than reimplemented. It lives in
 * its own module because `analytics-events.ts` is imported by the SERVER-side
 * Measurement Protocol sender (`libs/tenant/data/admin/.../
 * ga4-measurement-protocol.ts`), and a document-level click listener has no
 * business in that import graph.
 *
 * ## One implementation, several surfaces
 *
 * Nothing here knows what a marketing page is. It takes a `surface` label from
 * whoever installs it and otherwise classifies from the DOM alone, so the same
 * module serves the tenant published site today and the docs site (AGL-1579)
 * without a second copy. The one thing a caller may not do is hard-code a host
 * or a path here — a CTA is recognised by how the element is BUILT, not by
 * where it points.
 *
 * ## Why a delegated document listener rather than a React handler
 *
 * Every authored Button, Screen Link, Link Container, Image link, Tab and
 * Accordion resolves through one component (`AppLink` → `NextLink`), so a prop
 * there would be tempting. It would also miss two whole classes of link:
 * rich-text anchors inside `AglynTypography` and anything in a Custom HTML
 * element are written with `dangerouslySetInnerHTML` and are plain DOM
 * anchors with no React handler at all. Those are exactly the links an author
 * drops into body copy — a docs link, a GitHub link — which is the population
 * this event exists to count. A capture-phase listener on `document` sees
 * every one of them, and matches how the marketing runtime already arms its
 * `elementClick` automation triggers.
 *
 * ## What consent does to this
 *
 * Nothing here checks consent, and that is deliberate rather than an
 * oversight: `trackEvent` reaches `window.gtag`, and on a tenant site gtag is
 * only ever LOADED once the recorded consent state grants analytics
 * (AGL-1498, enforcement at the source). So an ungranted visitor's clicks are
 * classified into an object that is then dropped on the floor. Adding a second
 * consent test here would be a copy of the gate that could drift from it.
 *
 * That reasoning had a hole, and it was observed rather than argued
 * (AGL-1608): "never loaded" is not "not running". A visitor who withdraws
 * MID-PAGEVIEW leaves a resident gtag behind — the gate stops the next load,
 * not the tag already in memory — so their clicks kept reaching GA. Measured
 * on aglyn.com: after an opt-out, one CTA click sent `select_content` and
 * re-created `_ga_YW5PG16YTM`. The fix is still not a second consent test
 * here; `storeVisitorConsent` now SILENCES the resident tag
 * (`setResidentAnalyticsTags`), so the gtag this file reaches is inert for the
 * rest of the pageview and the single gate stays single.
 */

import { trackEvent } from './analytics-events'

/**
 * Elements that count as a call to action.
 *
 * `data-analytics-cta` is the explicit opt-in for a surface whose CTAs are not
 * MUI buttons (the docs site, AGL-1579). The rest is "this link was built to
 * look like a button", which is what an author means by a CTA: `AppLink
 * componentVariant="button" | "fab"` renders `MuiButton-root` / `MuiFab-root`,
 * and `role="button"` covers hand-rolled ones.
 */
const CTA_SELECTOR =
  '[data-analytics-cta],.MuiButton-root,.MuiFab-root,[role="button"]'

/**
 * Author-supplied section names first (`data-analytics-section="pricing"`),
 * then the landmark an element sits in. The landmark tier is what makes a
 * footer CTA distinguishable from a hero CTA with no authoring at all; when
 * neither exists the label alone identifies the click, and GA already knows
 * which PAGE it happened on from `page_location`.
 */
const SECTION_MARKER = '[data-analytics-section]'
const SECTION_LANDMARK = 'header,footer,nav,aside'
const SECTION_WITH_ID = 'section[id],article[id]'

/** GA truncates at 100; a shorter cap keeps a dimension readable. */
const MAX_LABEL_LENGTH = 60

export interface LinkClickContext {
  /**
   * The page's own hostname. A link to any other host is outbound — the same
   * test GA4's enhanced measurement makes, kept explicit so the event exists
   * even on a stream where enhanced measurement is off (and so the console and
   * marketing can share one stream, AGL-1559, without inheriting each other's
   * automatic collection).
   */
  hostname: string
  /** Absolute URL of the current page; relative hrefs resolve against it. */
  baseHref: string
  /**
   * Which product surface this page belongs to — `site` for a tenant
   * published site, `docs` for the documentation app. Hostname already
   * separates the DOMAINS in GA; this separates surfaces that may one day
   * share one (docs under `aglyn.com/docs`), and it is the only
   * caller-specific value in this module.
   */
  surface?: string
}

/** A classified click, ready to hand to `trackEvent`. */
export type ClassifiedLinkClick =
  | {
      name: 'select_content'
      params: { content_type: string; content_id: string; surface?: string }
    }
  | {
      name: 'click'
      params: { link_domain: string; link_id?: string; surface?: string }
    }

function readAttribute(element: Element | null, name: string): string {
  const value = element?.getAttribute(name)
  return value ? value.trim().slice(0, MAX_LABEL_LENGTH) : ''
}

/**
 * A human-readable name for the thing that was clicked. The author's own
 * `data-analytics-id` wins; then the visible label, which is what someone
 * reading a GA report is looking for ("Start free"); then the accessible name
 * for an icon-only link; then the DOM id, which is at least stable.
 */
export function describeLinkTarget(element: Element): string {
  const explicit = readAttribute(element, 'data-analytics-id')
  if (explicit) return explicit
  const text = (element.textContent || '').replace(/\s+/g, ' ').trim()
  if (text) return text.slice(0, MAX_LABEL_LENGTH)
  const label = readAttribute(element, 'aria-label')
  if (label) return label
  return readAttribute(element, 'id')
}

/**
 * Which part of the page produced the click — the half of the CTA metric that
 * turns "signups" into "which section sells".
 */
export function describeSection(element: Element): string {
  const marked = element.closest(SECTION_MARKER)
  if (marked) {
    const named = readAttribute(marked, 'data-analytics-section')
    if (named) return named
  }
  const landmark = element.closest(SECTION_LANDMARK)
  if (landmark) return landmark.tagName.toLowerCase()
  const section = element.closest(SECTION_WITH_ID)
  if (section) return readAttribute(section, 'id')
  return ''
}

/**
 * Decide what a click on `target` means, or nothing at all.
 *
 * Exported separately from the listener so the rules can be asserted directly
 * — the listener is three lines of plumbing over this function.
 *
 * The order of the two tests is the load-bearing decision. A signup CTA on
 * `aglyn.com` points at `app.aglyn.com`, so it is BOTH button-shaped and
 * cross-host, and whichever test runs first decides which event it becomes.
 * CTA wins: `select_content` carries the section that produced the click,
 * which is the metric the funnel needs, while `click` would reduce it to
 * "somebody left for app.aglyn.com" — a fact the destination's own pageview
 * already records. The consequence, accepted knowingly: an outbound link
 * STYLED as a button (a "View on GitHub" hero button) is counted as a CTA and
 * not as an outbound click. One click produces one event here, deliberately;
 * GA4's own enhanced measurement still logs the raw exit if the stream has it
 * on.
 */
export function classifyLinkClick(
  target: Element | null | undefined,
  context: LinkClickContext,
): ClassifiedLinkClick | null {
  if (!target || typeof target.closest !== 'function') return null
  // A link is the unit. A button that submits a form, opens a drawer or
  // toggles an accordion navigates nowhere, and counting it would put every
  // piece of UI choreography on the site into the CTA dimension — the form
  // that matters already reports itself as `generate_lead`.
  const anchor = target.closest('a[href]')
  if (!anchor) return null

  const href = anchor.getAttribute('href') || ''
  let url: URL
  try {
    url = new URL(href, context.baseHref)
  } catch {
    return null
  }
  // `mailto:`, `tel:`, `#anchor` handled by the browser, and in-page jumps.
  // GA4's enhanced measurement counts none of them as an outbound click and
  // neither do we; a mail link is a lead, and leads have their own event.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const surface = context.surface || undefined

  const cta = target.closest(CTA_SELECTOR)
  if (cta) {
    const section = describeSection(anchor)
    const label = describeLinkTarget(anchor)
    const contentId = [section, label].filter(Boolean).join(':')
    // Never an empty dimension: an unlabelled, unplaced CTA is still a CTA,
    // and the destination path names it well enough to be worth a row.
    return {
      name: 'select_content',
      params: {
        content_type: 'cta',
        content_id: (contentId || url.pathname).slice(0, MAX_LABEL_LENGTH),
        ...(surface ? { surface } : {}),
      },
    }
  }

  if (url.hostname && url.hostname !== context.hostname) {
    const linkId = describeLinkTarget(anchor)
    return {
      name: 'click',
      params: {
        link_domain: url.hostname,
        ...(linkId ? { link_id: linkId } : {}),
        ...(surface ? { surface } : {}),
      },
    }
  }

  // An ordinary same-host link. Its destination pageview already counts it,
  // and an event per internal navigation would be noise bought at the price
  // of GA's per-session event budget.
  return null
}

/**
 * The one listener on `document`, or null. Held rather than a boolean flag so
 * that "forget the install" and "remove the listener" cannot come apart — a
 * flag alone lets a caller re-install over a listener that is still attached,
 * which double-counts every click on the page.
 */
let installedHandler: ((event: Event) => void) | null = null

/**
 * Start counting CTA and outbound clicks on this page.
 *
 * Idempotent and safe to call during render — which is how the tenant calls
 * it, for the AGL-1550 reason: an effect only runs if React commits, and the
 * failure this defends against is a page that renders and never commits
 * (a suspended plugin gate took every measurement surface down with it in
 * AGL-1541). Installing a passive listener has no render output and no
 * cleanup obligation: it lives for as long as the document does, which is
 * exactly the intended lifetime.
 *
 * Returns an uninstall function for tests and for a caller that genuinely
 * owns the page lifecycle.
 */
export function installLinkClickTracking(options?: {
  surface?: string
}): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => undefined
  }
  if (installedHandler) return () => undefined

  const onClick = (event: Event) => {
    try {
      const hit = classifyLinkClick(event.target as Element | null, {
        hostname: window.location.hostname,
        baseHref: window.location.href,
        surface: options?.surface,
      })
      if (!hit) return
      // Split so TypeScript keeps each event's params bound to its own name.
      if (hit.name === 'select_content') trackEvent('select_content', hit.params)
      else trackEvent('click', hit.params)
    } catch {
      // Analytics never breaks a navigation. A click that throws here would
      // otherwise be a link that does not work.
    }
  }

  // Capture phase: a click handler somewhere in the page may stop propagation
  // (menus and drawers do), and the click still happened.
  installedHandler = onClick
  document.addEventListener('click', onClick, true)
  return resetLinkClickTracking
}

/** Test seam — removes the listener and forgets it, in that order. */
export function resetLinkClickTracking(): void {
  if (!installedHandler) return
  if (typeof document !== 'undefined') {
    document.removeEventListener('click', installedHandler, true)
  }
  installedHandler = null
}
