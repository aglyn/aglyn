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

'use client'

// Deep app-utils modules, never the `@aglyn/aglyn` barrel (AGL-1550): this
// file joins the analytics/consent subtree that must stay independent of the
// site-plugin gate, and `site-analytics-independence.spec.ts` walks the import
// closure from `site-analytics.tsx` through here.
import {
  ADVERTISING_TAG_ATTRIBUTE,
  type AdvertisingTagHost,
  resolveAdvertisingTags,
  restoreAdvertisingTags,
  revokeAdvertisingTags,
} from '@aglyn/aglyn/app-utils/advertising-tags'
import { isPlatformMarketingHost } from '@aglyn/aglyn/app-utils/platform-marketing-host'
import {
  readStoredVisitorConsent,
  type StoredVisitorConsent,
  VISITOR_CONSENT_CHANGED_EVENT,
} from '@aglyn/aglyn/app-utils/visitor-consent'
import Script from 'next/script'
import { Fragment, useEffect } from 'react'

/**
 * The mount point for consent-gated advertising tags — Aglyn's own
 * marketing site only.
 *
 * ## Why this is a separate component from `site-analytics.tsx`
 *
 * So the gate is a unit that can be rendered, and therefore failed, on its
 * own. `advertising-tag-gate.spec.tsx` drives this component directly across
 * every consent state; folding it into `SiteAnalytics` would have meant every
 * one of those cases also depending on the GA mounts, the pageview beacon and
 * the banner. It is still mounted from `SiteAnalytics`, so it inherits that
 * component's independence from the site-plugin gate (AGL-1550).
 *
 * ## Why it renders even when the answer is no
 *
 * Because the withdrawal path needs a listener. A visitor who accepts and then
 * turns advertising off from "Your Privacy Choices" must stop being tracked in
 * THAT pageview, and by then the vendor library has executed — React dropping
 * the `<Script>` does not unload it (AGL-1608). So this component stays
 * mounted and subscribes to {@link VISITOR_CONSENT_CHANGED_EVENT}; the
 * teardown runs from the event, synchronously with the visitor's click, rather
 * than waiting on a re-render.
 *
 * Both paths run and they agree, which is deliberate: the render gate is what
 * keeps the tag out of a fresh pageview, the listener is what removes one that
 * is already there, and neither can do the other's job.
 *
 * ## Why the listener is scoped by the host too
 *
 * On a customer's site this component installs NOTHING — no listener, no
 * scripts. The teardown is additionally attribute-scoped inside
 * `revokeAdvertisingTags`, so even if it did run it could not touch a pixel a
 * customer pasted into their own Custom HTML. Two independent scopes, because
 * reaching into a customer's page to kill their tag would be its own kind of
 * breach of the promise this feature is scoped by.
 */
export interface AdvertisingTagsProps {
  /** The resolved tenant host — the GA property is the surface discriminator. */
  host?: (AdvertisingTagHost & { $id?: string }) | null
  /** The client-resolved consent record; null means undecided. */
  stored?: StoredVisitorConsent | null
  /**
   * Whether the consent machinery has resolved this visitor yet. False on the
   * server and on the first client render, which is what keeps the ISR-cached
   * HTML free of any visitor's state — the same discipline as the GA gate.
   */
  ready?: boolean
}

export default function AdvertisingTags({
  host,
  stored,
  ready,
}: AdvertisingTagsProps) {
  const hostId = host?.$id
  // Our own marketing site, or nothing at all. Evaluated before the verdict
  // as well as inside it: this is the condition that decides whether the
  // component has any behaviour on this site, listener included.
  const ourSurface = isPlatformMarketingHost(host)
  const tags = ready === true ? resolveAdvertisingTags(host, stored) : []

  useEffect(() => {
    if (ourSurface === false || !hostId) return undefined
    // Read the record FRESH rather than closing over `stored`: this fires from
    // the visitor's own click, in the same tick as the write, and the props
    // for this render are by definition the state before it.
    const sync = () => {
      const current = readStoredVisitorConsent(hostId)
      if (resolveAdvertisingTags(host, current).length === 0) {
        revokeAdvertisingTags()
      } else {
        // Symmetric: a visitor who withdrew and changed their mind inside one
        // pageview would otherwise stay un-tracked until they navigated,
        // because a re-rendered `<Script>` cannot re-execute a library the
        // browser already ran.
        restoreAdvertisingTags()
      }
    }
    window.addEventListener(VISITOR_CONSENT_CHANGED_EVENT, sync)
    return () => window.removeEventListener(VISITOR_CONSENT_CHANGED_EVENT, sync)
    // `host` participates as the surface discriminator only; its identity per
    // render is the page-props object, stable for a pageview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, ourSurface])

  if (tags.length === 0) return null

  return (
    <>
      {tags.map(({ vendor, accountId }) => (
        // A PAIR per vendor, inline boot first and library second — the same
        // shape as the `ga-init` / `ga-src` pair above it, and for the same
        // reason: the boot defines the vendor's queue shim and declares the
        // consent state, so nothing the library later drains was queued under
        // a state nobody chose. Both elements carry the teardown's scope
        // marker; only elements carrying it are ever revoked,
        // removed or cookie-swept.
        <Fragment key={vendor.id}>
          <Script
            id={`ad-tag-${vendor.id}-init`}
            strategy="afterInteractive"
            {...{ [ADVERTISING_TAG_ATTRIBUTE]: vendor.id }}
          >
            {vendor.bootSnippet(accountId)}
          </Script>
          <Script
            id={`ad-tag-${vendor.id}-src`}
            strategy="afterInteractive"
            {...{ [ADVERTISING_TAG_ATTRIBUTE]: vendor.id }}
            src={vendor.scriptSrc}
          />
        </Fragment>
      ))}
    </>
  )
}
