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

import AdvertisingTagMounts from '@aglyn/aglyn/app-utils/advertising-tag-mounts'
import { ADVERTISING_TAG_ATTRIBUTE } from '@aglyn/aglyn/app-utils/advertising-tags'
import {
  platformAdvertisingAllowed,
  platformAnalyticsAllowed,
} from '@aglyn/aglyn/app-utils/platform-visitor-consent'
import {
  platformGtmBootSnippet,
  platformGtmScriptSrc,
  resolvePlatformAdvertisingTags,
  resolvePlatformGtmContainerId,
} from '@aglyn/aglyn/app-utils/platform-advertising-tags'
import { VISITOR_CONSENT_CHANGED_EVENT } from '@aglyn/aglyn/app-utils/visitor-consent'
import Script from 'next/script'
import { useCallback, useEffect, useState, type ReactElement } from 'react'

/**
 * The console's consent-gated advertising tags — Meta, Google Ads, LinkedIn
 * and a Google Tag Manager container, on `app.aglyn.com` and `auth.aglyn.com`.
 *
 * ## Why the console has these at all
 *
 * Aglyn advertises, remarkets and retargets across its own surfaces, and the
 * console is one of them — `/signin` is this surface's most-collected page and
 * the whole of the signup funnel lives here. Until now the only advertising
 * enforcement channel in the repository was mounted from the TENANT runtime,
 * so the console carried no advertising vendor of any kind: not because a
 * decision was taken against it, but because there was no mount point.
 *
 * ## The gate is the console's own resolver, asked rather than re-read
 *
 * `platformAdvertisingAllowed()` reads the record the console's posture
 * machinery already wrote — the region endpoint, the prior-consent set, GPC,
 * an explicit choice from the account-menu control or from the CCPA §7015 pill
 * on the unauthenticated pages, and the registrable-domain mirror that carries
 * an answer between `app.` and `auth.`. Nothing here re-reads a cookie or
 * re-derives a posture; a second reading of the same state is how one surface
 * comes to disagree with another about what a visitor said.
 *
 * Advertising is a SEPARATE grant from analytics, and both are represented
 * here: the vendor tags ride `platformAdvertisingAllowed`, the container rides
 * `platformAnalyticsAllowed`. See `platform-advertising-tags.ts` for why a
 * container is gated on analytics and never on something looser.
 *
 * ## Why it re-reads on the consent event rather than on a render
 *
 * The record is written asynchronously — `decidePlatformConsent` has to ask
 * the region endpoint before it can record implied consent for a visitor
 * outside the prior-consent regions — so the answer at first paint is
 * routinely "not yet" and becomes "yes" a moment later with no prop changing.
 * The same event carries the opposite move: a withdrawal from the account menu
 * or the pill. Subscribing to it is what makes both act on THIS pageview.
 *
 * ## Why nothing renders on the server or on the first client render
 *
 * `ready` starts false and is set in an effect. The server has no visitor
 * state to render, and emitting a tag one visitor granted into HTML that any
 * other visitor could be served is the failure the tenant's ISR discipline
 * exists to prevent. Here it also keeps hydration honest: the server and the
 * first client render agree on "nothing yet", and the visitor's own state
 * attaches after.
 */
export default function PlatformAdvertisingTags(): ReactElement | null {
  const [ready, setReady] = useState(false)
  // A counter rather than a boolean pair: the verdict is re-read from the
  // resolvers on every render, and this only has to make a render happen. A
  // stored copy of the answer would be a second place for it to live.
  const [, setRevision] = useState(0)

  useEffect(() => {
    setReady(true)
    const sync = () => setRevision((previous) => previous + 1)
    window.addEventListener(VISITOR_CONSENT_CHANGED_EVENT, sync)
    return () => window.removeEventListener(VISITOR_CONSENT_CHANGED_EVENT, sync)
  }, [])

  // Read FRESH, for the teardown listener inside the shared mount: it fires in
  // the same tick as the record is written, and the verdict computed for the
  // current render is by definition the state before it.
  const resolve = useCallback(
    () => resolvePlatformAdvertisingTags(platformAdvertisingAllowed()),
    [],
  )

  const tags = ready ? resolve() : []
  const containerId = ready
    ? resolvePlatformGtmContainerId(platformAnalyticsAllowed())
    : null

  return (
    <>
      <AdvertisingTagMounts active={ready} tags={tags} resolve={resolve} />
      {/* GOOGLE TAG MANAGER, under the analytics gate and never a looser one.

          Consent Mode v2 is already declared by the time this runs: the
          Firebase services boot pushes `PLATFORM_CONSENT_DEFAULT_COMMANDS`
          onto `dataLayer` before it initializes gtag, which is ahead of
          anything a container can process. That ordering is the whole of its
          correctness — defaults set after a container has loaded are defaults
          its tags have already run past — so this snippet deliberately does
          not re-declare them.

          The container carries the teardown's scope marker even though a
          container is not an `AdvertisingVendor`. `revokeAdvertisingTags`
          never removes it (it acts per vendor), but `GOOGLE_ADS_VENDOR` is
          `alwaysSweep`, so the `_gcl_*` cookies a container's advertising tags
          write are cleared on withdrawal whether or not we ever marked the tag
          that wrote them.

          ⚠️ What a container LOADS is decided in Google's UI and is invisible
          to every spec in this repository. Leaving the id unconfigured is how
          a deployment runs no container; configuring one is an assertion that
          somebody has read what is in it. */}
      {containerId ? (
        <>
          <Script
            id="gtm-init"
            strategy="afterInteractive"
            {...{ [ADVERTISING_TAG_ATTRIBUTE]: 'gtm' }}
          >
            {platformGtmBootSnippet()}
          </Script>
          <Script
            id="gtm-src"
            strategy="afterInteractive"
            {...{ [ADVERTISING_TAG_ATTRIBUTE]: 'gtm' }}
            src={platformGtmScriptSrc(containerId)}
          />
        </>
      ) : null}
    </>
  )
}
PlatformAdvertisingTags.displayName = 'PlatformAdvertisingTags'
PlatformAdvertisingTags.aglyn = true
