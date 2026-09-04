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
 * Keeps the credit badge and the abuse-report control on the page.
 *
 * Both render as ordinary elements in the published document, which means the
 * site's own author can take them off it. Not by breaking anything — by using
 * the product as sold: a tag manager container, a custom-code block, or three
 * lines of theme CSS. `a[href="/api/report-abuse"] { display: none }` is the
 * whole exploit, and the report control is precisely the thing a phishing
 * site's author wants gone.
 *
 * ## What this can and cannot do
 *
 * It cannot make suppression impossible. The author controls the page: they
 * can run script before this does, and at the limit they can put a proxy in
 * front of the whole site. Anyone who promises otherwise is selling something.
 *
 * What it CAN do is move suppression out of reach of the tools people
 * actually reach for, and make the attempt visible when it happens:
 *
 * - **Restore into a closed shadow root.** No selector crosses a shadow
 *   boundary, so the CSS above stops matching, and `document.querySelector`
 *   cannot find the contents to remove them. The mount element carries a
 *   name minted per page load, so a stylesheet cannot name it either, and its
 *   own layout properties are set inline `!important` — the highest
 *   precedence an author-origin declaration has, which a stylesheet rule of
 *   any specificity cannot beat.
 * - **Put it back.** Removing the mount re-appends it; overwriting its styles
 *   re-asserts them.
 * - **Say so.** A suppression that had to be repaired is reported once per
 *   page view, so the site becomes reviewable rather than quietly
 *   unattributed. This is the part that actually matters: enforcement is a
 *   policy decision made by a person, and it needs a signal to act on.
 *
 * ## Deliberately not pre-emptive
 *
 * The badge is left in the light DOM until something tries to suppress it.
 * It is the platform's only organic acquisition surface — one crawlable link
 * on every free site — and burying it in a closed shadow root on every page
 * load to defend against a minority would cost that on all of them.
 *
 * ## Why not `MuiShadowDom` / `shadowDomRootFactory`
 *
 * Both existing shadow-root helpers are React components that `createPortal`
 * their children into the root, and React has to own the contents. That is
 * the one thing this cannot have.
 *
 * The job is to put back a node that foreign script deleted, and React does
 * not react to its own output being removed — the reconciler answers to state
 * changes, not to DOM deletion, so a portalled subtree whose mount is taken
 * off `document.body` simply stays gone. The MutationObserver below would be
 * needed either way, and it would then be re-appending an element React
 * believes it is managing, which is the shape that produces "removeChild on a
 * node that is not a child" the next time React touches it.
 *
 * Plain DOM also means the repair outlives React: an unmount, an error
 * boundary tripping, or the author's own script tearing out the root does not
 * take it with them. (Both helpers also default to `mode: 'open'` and carry
 * SSR and adopted-stylesheet machinery built for the besigner canvas, none of
 * which applies here.)
 *
 * Framework-free, like `error-beacon` beside it, and for the same reason: the
 * install must be able to run before any effect. Deliberately NO 'use client'
 * directive — inside this shared lib the directive forks the module graph
 * (AGL-52), and every importer is already a client module.
 */

/** Marks an element this guard is responsible for keeping visible. */
export const ATTRIBUTION_ATTRIBUTE = 'data-aglyn-attribution'

/** Why a check failed. Reported verbatim, so keep these short and stable. */
export type AttributionSuppression =
  | 'removed'
  | 'display'
  | 'visibility'
  | 'opacity'
  | 'collapsed'
  | 'pointer-events'
  | 'offscreen'
  | 'covered'

export interface AttributionGuardOptions {
  /** Where a suppression is reported. Same-origin path, never a URL. */
  endpoint?: string
  /** The site being checked, so the report names one without a lookup. */
  hostId?: string
  /** Overridable for tests; the real one is `window`. */
  view?: Window & typeof globalThis
}

const DEFAULT_ENDPOINT = '/api/attribution'

/**
 * When the checks run, in ms after install.
 *
 * Front-loaded because the interesting case is a tag manager that fires on
 * load and removes the control before anyone sees it; the long tail catches
 * a rule that only applies after an interaction, or a script that waits.
 * Bounded rather than a forever-interval: a permanently-armed timer on every
 * published page is a cost on every visitor to defend against one author.
 */
const CHECK_SCHEDULE_MS = [800, 2_500, 6_000, 15_000, 40_000] as const

/** Below this, an element is not meaningfully on the page. */
const MIN_VISIBLE_PX = 4
const MIN_OPACITY = 0.15

let installed = false

/**
 * The observers this guard has armed.
 *
 * Kept so a test can take them off the document again. In a browser they run
 * for the life of the page, which is the point — a keeper that stops keeping
 * is the same as no keeper — but a test document outlives the test, and an
 * observer left watching `body` puts its mount back the moment the next test
 * clears the page.
 */
const keepers: MutationObserver[] = []

/**
 * Whether an element is actually presented to the reader.
 *
 * Computed style first, because that is what CSS suppression changes, and
 * hit-testing last, because that is what a full-page overlay does — an
 * element can be perfectly visible by every style property and still sit
 * under something with a higher `z-index`.
 */
export function inspectAttributionElement(
  element: Element | null | undefined,
  view: Window & typeof globalThis,
): AttributionSuppression | null {
  if (!element || !element.isConnected) return 'removed'
  const style = view.getComputedStyle(element)
  if (style.display === 'none') return 'display'
  if (style.visibility === 'hidden' || style.visibility === 'collapse') {
    return 'visibility'
  }
  // An unreadable opacity is treated as fully opaque, not as zero. `opacity`
  // has an initial value of 1 and every engine should report it, but a value
  // this function cannot parse is a question it did not get an answer to —
  // and the cost of guessing wrong is accusing a site of hiding something it
  // is showing.
  const opacity = Number.parseFloat(style.opacity)
  if (Number.isFinite(opacity) && opacity < MIN_OPACITY) return 'opacity'
  if (style.pointerEvents === 'none') return 'pointer-events'
  const rect = element.getBoundingClientRect()
  if (rect.width < MIN_VISIBLE_PX || rect.height < MIN_VISIBLE_PX) {
    return 'collapsed'
  }
  // `position: fixed` with a large negative offset is the other classic —
  // still rendered, still the right size, nowhere a reader will ever look.
  const beyond =
    rect.right < 0 ||
    rect.bottom < 0 ||
    rect.left > view.innerWidth ||
    rect.top > view.innerHeight
  if (beyond) return 'offscreen'
  const x = Math.round(rect.left + rect.width / 2)
  const y = Math.round(rect.top + rect.height / 2)
  const hit = element.ownerDocument?.elementFromPoint(x, y)
  // A descendant is the element; an ancestor means nothing was drawn over it
  // and the point landed on the parent's own box. Anything else is a cover.
  if (hit && hit !== element && !element.contains(hit) && !hit.contains(element)) {
    return 'covered'
  }
  return null
}

/** A tag name no stylesheet written before this page load can name. */
function mintMountName(view: Window & typeof globalThis): string {
  const bytes = new Uint8Array(8)
  if (view.crypto?.getRandomValues) view.crypto.getRandomValues(bytes)
  const suffix = Array.from(bytes, (byte) =>
    byte.toString(36).padStart(2, '0'),
  ).join('')
  // Hyphenated, so the parser treats it as an unknown ELEMENT rather than
  // trying to match a built-in, and it inherits nothing from a `div` rule.
  return `a-${suffix}`.slice(0, 24)
}

/**
 * The layout properties an author's CSS would have to win to hide this, set
 * inline and important. Re-applied rather than set once: a script can
 * overwrite `style` as easily as a stylesheet can lose to it.
 *
 * Writes only what is actually wrong. The observer that calls this watches
 * the mount's `style` attribute, so an unconditional write is a mutation that
 * schedules the observer that performs the write — the loop does not
 * terminate, and it is not slow enough to look like anything but a hang.
 */
function pinMountStyle(mount: HTMLElement, corner: 'left' | 'right'): void {
  const pinned: Array<[string, string]> = [
    ['position', 'fixed'],
    ['bottom', '12px'],
    [corner, '12px'],
    ['z-index', '2147483000'],
    ['display', 'block'],
    ['visibility', 'visible'],
    ['opacity', '1'],
    ['pointer-events', 'auto'],
    ['transform', 'none'],
    ['clip-path', 'none'],
    ['filter', 'none'],
    ['width', 'auto'],
    ['height', 'auto'],
    ['max-width', 'none'],
    ['max-height', 'none'],
  ]
  for (const [property, value] of pinned) {
    if (
      mount.style.getPropertyValue(property) === value &&
      mount.style.getPropertyPriority(property) === 'important'
    ) {
      continue
    }
    mount.style.setProperty(property, value, 'important')
  }
}

export function installAttributionGuard(
  options: AttributionGuardOptions = {},
): void {
  const view = options.view ?? (globalThis as never as Window & typeof globalThis)
  if (installed || typeof view?.document === 'undefined') return
  installed = true
  const doc = view.document
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT

  let reported = false
  const restored = new Set<string>()

  const report = (
    reason: AttributionSuppression,
    subject: string,
  ): void => {
    if (reported) return
    reported = true
    try {
      const body = JSON.stringify({
        hostId: options.hostId ?? '',
        reason,
        subject,
        // Origin + pathname only, like the error beacon: a query string on a
        // published page carries search terms and campaign ids.
        url: `${view.location.origin}${view.location.pathname}`,
      })
      // `sendBeacon` survives the pagehide that a script removing the badge
      // on the way out would otherwise win against; `fetch` with `keepalive`
      // is the fallback where it is missing. Both are same-origin.
      if (view.navigator?.sendBeacon) {
        view.navigator.sendBeacon(endpoint, body)
      } else {
        void fetch(endpoint, { method: 'POST', body, keepalive: true }).catch(
          (): void => undefined,
        )
      }
    } catch {
      // A guard that throws is worse than a guard that misses one report.
    }
  }

  /**
   * Rebuilds one element inside a closed shadow root and keeps it there.
   *
   * The original is left where it is. It may be perfectly fine and merely
   * covered; removing it would take away a working link on the chance that it
   * is not, and a duplicate that cannot be seen costs nothing.
   */
  const restore = (subject: string, original: Element): void => {
    if (restored.has(subject)) return
    restored.add(subject)
    try {
      const corner = subject === 'report' ? 'left' : 'right'
      const mount = doc.createElement(mintMountName(view))
      pinMountStyle(mount as HTMLElement, corner)
      const root = mount.attachShadow({ mode: 'closed' })
      const clone = original.cloneNode(true) as HTMLElement
      // The clone is positioned by its mount now, not by its own `fixed`
      // coordinates, or the two would stack in the same corner.
      clone.style.setProperty('position', 'static', 'important')
      clone.style.setProperty('display', 'inline-flex', 'important')
      root.appendChild(clone)
      doc.body.appendChild(mount)

      // Put it back if it is taken off, and re-pin the styles if they are
      // overwritten. Watching the mount's own attributes as well as the body's
      // children covers both moves with one observer.
      const keeper = new MutationObserver(() => {
        try {
          if (!mount.isConnected) doc.body.appendChild(mount)
          pinMountStyle(mount as HTMLElement, corner)
        } catch {
          // Ditto.
        }
      })
      keeper.observe(doc.body, { childList: true })
      keeper.observe(mount, { attributes: true, attributeFilter: ['style'] })
      keepers.push(keeper)
    } catch {
      // Ditto: a browser without shadow DOM keeps the original element and
      // loses only the repair.
    }
  }

  // What this page rendered, captured before anything has had a chance to
  // take it away — the repair needs a copy of the element to rebuild, and by
  // the time one is missing there is nothing left to clone.
  const shipped: string[] = []
  const templates = new Map<string, Element>()
  try {
    for (const element of Array.from(
      doc.querySelectorAll(`[${ATTRIBUTION_ATTRIBUTE}]`),
    )) {
      const subject = element.getAttribute(ATTRIBUTION_ATTRIBUTE) ?? ''
      if (!subject || templates.has(subject)) continue
      shipped.push(subject)
      templates.set(subject, element.cloneNode(true) as Element)
    }
  } catch {
    return
  }
  if (!shipped.length) return

  const check = (): void => {
    let elements: Element[]
    try {
      elements = Array.from(doc.querySelectorAll(`[${ATTRIBUTION_ATTRIBUTE}]`))
    } catch {
      return
    }
    for (const element of elements) {
      const subject = element.getAttribute(ATTRIBUTION_ATTRIBUTE) ?? 'unknown'
      if (restored.has(subject)) continue
      const suppression = inspectAttributionElement(element, view)
      if (!suppression) continue
      restore(subject, element)
      report(suppression, subject)
    }
    // A removed element has no node left to inspect, so the loop above cannot
    // see it. The subjects this page shipped are the ones to account for.
    for (const subject of shipped) {
      if (restored.has(subject)) continue
      if (doc.querySelector(`[${ATTRIBUTION_ATTRIBUTE}="${subject}"]`)) continue
      const template = templates.get(subject)
      if (template) restore(subject, template)
      report('removed', subject)
    }
  }

  for (const delay of CHECK_SCHEDULE_MS) {
    view.setTimeout(() => {
      try {
        check()
      } catch {
        // Ditto.
      }
    }, delay)
  }
}

/**
 * Test seam: forgets the install so a second one takes effect, and stops the
 * keepers it armed. Nothing in a browser calls this — see `keepers`.
 */
export function resetAttributionGuard(): void {
  installed = false
  for (const keeper of keepers.splice(0)) keeper.disconnect()
}
