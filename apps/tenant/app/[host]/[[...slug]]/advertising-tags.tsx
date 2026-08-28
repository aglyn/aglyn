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
import { isPlatformMarketingHost } from '@aglyn/aglyn/app-utils/platform-marketing-host'
import {
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
 * `active` stays true for the whole of Aglyn's own marketing site, granted or
 * not, because the withdrawal path needs a listener that is still mounted when
 * the answer is no — see {@link AdvertisingTagMounts} for why React dropping a
 * `<Script>` does not unload the library it already ran (AGL-1608).
 *
 * ## Why the listener is scoped by the host too
 *
 * On a customer's site this installs NOTHING — no listener, no scripts. The
 * teardown is additionally attribute-scoped inside `revokeAdvertisingTags`, so
 * even if it did run it could not touch a pixel a customer pasted into their
 * own Custom HTML. Two independent scopes, because reaching into a customer's
 * page to kill their tag would be its own kind of breach of the promise this
 * feature is scoped by.
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
}: AdvertisingTagsProps): ReactElement | null {
  const hostId = host?.$id
  // Our own marketing site, or nothing at all. Evaluated before the verdict as
  // well as inside it: this is the condition that decides whether this
  // component has any behavior on this site, listener included.
  const ourSurface = isPlatformMarketingHost(host)
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
      active={ourSurface === true && Boolean(hostId)}
      tags={tags}
      resolve={resolve}
    />
  )
}
