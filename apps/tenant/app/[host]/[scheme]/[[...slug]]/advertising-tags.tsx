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
import AdvertisingTagMounts from '@aglyn/aglyn/app-utils/advertising-tag-mounts'
import {
  type AdvertisingTagHost,
  resolveAdvertisingTags,
} from '@aglyn/aglyn/app-utils/advertising-tags'
import {
  hostConfiguresAdvertisingTag,
  readStoredVisitorConsent,
  type StoredVisitorConsent,
} from '@aglyn/aglyn/app-utils/visitor-consent'
import { useCallback, type ReactElement } from 'react'

/**
 * The tenant runtime's answer to "which advertising tags may load" — Aglyn's
 * own marketing site only.
 *
 * ## What this file is, now that the mount is shared
 *
 * The RESOLUTION and nothing else. It reads the host document, asks
 * {@link resolveAdvertisingTags} for the verdict, and hands both the verdict
 * and a way to re-take it to {@link AdvertisingTagMounts}, which owns the
 * script pair and the withdrawal teardown for every surface that has one.
 *
 * The split is where it is because the resolution is the part that differs.
 * The console reads a platform record and build-configured ids; the docs site
 * reads the registrable-domain mirror of that record; this reads a Firestore
 * host document and a per-host localStorage record. Duplicating the TEARDOWN
 * across those three is how one surface comes to keep firing after consent is
 * withdrawn on another, so there is one of it.
 *
 * ## Why the component still renders when the answer is no
 *
 * `active` stays true for the whole of any site that configures an
 * advertising tag — Aglyn's own marketing site, or a customer's site running
 * the tags its owner set on Setup → Tracking (AGL-3694) — granted or not,
 * because the withdrawal path needs a listener that is still mounted when the
 * answer is no — see {@link AdvertisingTagMounts} for why React dropping a
 * `<Script>` does not unload the library it already ran (AGL-1608).
 *
 * ## Why the listener is scoped by the host too
 *
 * On a site with no advertising tag configured this installs NOTHING — no
 * listener, no scripts. The teardown is additionally attribute-scoped inside
 * `revokeAdvertisingTags`, so it can never touch a pixel a customer pasted
 * into their own Custom HTML: we did not load it and it does not run on a
 * consent record of ours.
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
  /**
   * The request's CSP nonce, for the day this surface enforces a nonce'd
   * `script-src`. The tenant sends none today (see `page.tsx`), so nothing is
   * stamped; the mount refuses nothing without it because nothing refuses.
   */
  nonce?: string
  /**
   * Libraries this page renders itself, by the vendor's `sharesLibrary`
   * needle (AGL-2681). `site-analytics.tsx` names gtag here from the very
   * condition that renders the GA pair, because the pair and these tags first
   * render together and the document cannot yet show one to the other.
   */
  sharedLibraries?: readonly string[]
}

export default function AdvertisingTags({
  host,
  stored,
  ready,
  nonce,
  sharedLibraries,
}: AdvertisingTagsProps): ReactElement | null {
  const hostId = host?.$id
  // Our own marketing site, or a customer's site running the tags its owner
  // configured (AGL-3694). A site with no advertising tag of either kind has
  // no behavior here at all, listener included: there is nothing of ours to
  // withdraw on it.
  const configured = hostConfiguresAdvertisingTag(host)
  const tags = ready === true ? resolveAdvertisingTags(host, stored) : []

  // Read the record FRESH rather than closing over `stored`: the teardown
  // fires from the visitor's own click, in the same tick as the write, and the
  // props for that render are by definition the state before it.
  const resolve = useCallback(
    () => resolveAdvertisingTags(host, readStoredVisitorConsent(hostId)),
    // `host` participates as the surface discriminator only; its identity per
    // render is the page-props object, stable for a pageview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostId],
  )

  return (
    <AdvertisingTagMounts
      active={configured && Boolean(hostId)}
      tags={tags}
      resolve={resolve}
      nonce={nonce}
      sharedLibraries={sharedLibraries}
    />
  )
}
