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

import { usePathname } from 'next/navigation'
import { resolveNavSection } from '../hooks/nav-section'
import PlatformAdvertisingTags from './advertising-tags.component'
import VisitorConsent from './visitor-consent.component'

/**
 * Whether this page is a plugin's public device page (`/kiosk/…`, AGL-3608):
 * a screen a business turns toward its customers. Nobody there is a visitor
 * of Aglyn's — the person in front of it is the business's customer, on the
 * business's device — so the console's own consent banner and advertising
 * tags have no one to ask and nothing to measure, and never mount there.
 */
export function useIsPublicDevicePage(): boolean {
  return resolveNavSection(usePathname()).kind === 'kiosk'
}

/** The consent banner and advertising tags, everywhere but a device page. */
export function VisitorMarketingSurface({ nonce }: { nonce?: string }) {
  if (useIsPublicDevicePage()) return null
  return (
    <>
      {/* The visitor-consent banner and the privacy-choices panel (AGL-1498
          posture, applied to the console itself).

          OUTSIDE `LoadingLayoutAppComponent` on purpose, beside the two
          effects above: the banner has to reach a visitor who is not signed
          in and never will be — `/signin` is this surface's most-collected
          page — and it must not wait on an auth gate to say so. It needs no
          Firebase context of its own, only the MUI theme, which this whole
          subtree already has.

          Renders nothing at all for a visitor whose posture is implied
          consent and who has not opened the panel; the enforcement it
          describes lives in the Firebase services provider and holds whether
          or not this ever mounts. */}
      <VisitorConsent />
      {/* The console's consent-gated advertising tags (Meta, Google Ads,
          LinkedIn, and a Google Tag Manager container).

          Beside `VisitorConsent` and for the same reason: the advertising
          grant belongs to a visitor who may never sign in, and `/signin` is
          this surface's most-collected page — so the mount must not sit behind
          the auth gate. It needs no Firebase context of its own.

          It renders nothing at all until the visitor's record is resolved, and
          nothing ever unless that record grants the category. The enforcement
          is structural: an ungranted visitor gets no `<Script>`, so no request
          reaches a vendor — not loaded and then suppressed.

          The nonce rides down from the root layout: every boot in there is
          inline, and the console's `script-src` refuses an inline script
          without one (AGL-2640). */}
      <PlatformAdvertisingTags nonce={nonce} />
    </>
  )
}

export default VisitorMarketingSurface
