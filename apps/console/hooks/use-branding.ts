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

import {
  AGLYN_BRANDING_PROFILE,
  checkEntitlement,
  hasBrandingProfile,
  resolveBrandingProfile,
  type ResolvedBrandingProfile,
} from '@aglyn/aglyn'
import useCurrentOrg from './use-current-org'
import { useUrlNamesOrg } from './use-secondary-nav'

/**
 * The effective brand for the signed-in user's current org (White-Label
 * Phase 2). Every console-chrome surface that shows the Aglyn logo, product
 * name, or primary color reads it from here so a white-label-entitled org
 * sees its own brand consistently and can never partly-render as Aglyn.
 *
 * `branding` runs through `resolveBrandingProfile` — the single shared
 * resolver — so it matches the published site and transactional email exactly.
 * Until the org billing doc is confirmed (`ready` false) it stays the Aglyn
 * defaults and `whiteLabel` stays false, so a slow or failed read renders the
 * Aglyn chrome rather than flashing a half-applied custom brand (the
 * loading-default trap, AGL-887).
 */
export function useBranding(): {
  /** Fully-resolved brand; Aglyn defaults when not white-label or not ready. */
  branding: ResolvedBrandingProfile
  /** True only once a white-label-entitled org doc is confirmed. */
  whiteLabel: boolean
  /** True once the current org's entitlements are trustworthy (AGL-887). */
  ready: boolean
} {
  const { org, ready } = useCurrentOrg()
  // A route the URL doesn't scope to a workspace has no brand to wear
  // (AGL-1130). `useCurrentOrg` falls back to the user's first org, so the
  // staff console and Manage Account would have taken their wordmark, product
  // name and primary color from whichever org that happened to be — the
  // platform's own console rendered in a customer's brand. Latent rather than
  // observed: it needs the fallback org to be white-label entitled AND
  // branded, which today's is not.
  //
  // `ready` stays true in that case: the brand answer is settled, it just
  // doesn't depend on an org doc. A consumer gating a spinner on it renders
  // the Aglyn chrome immediately instead of waiting for a read that cannot
  // change the outcome.
  const namesOrg = useUrlNamesOrg()
  if (!namesOrg) {
    return { branding: AGLYN_BRANDING_PROFILE, whiteLabel: false, ready: true }
  }
  if (!ready) {
    return { branding: AGLYN_BRANDING_PROFILE, whiteLabel: false, ready }
  }
  return {
    branding: resolveBrandingProfile(org),
    // White-label chrome activates only when the org is BOTH entitled AND has
    // set up a brand (AGL-1110) — an entitled-but-unconfigured org (e.g. an
    // Agency/comped-Enterprise org that never opened the branding page) keeps
    // the Aglyn wordmark, so the logo no longer flashes to product-name text.
    whiteLabel:
      checkEntitlement(org, 'whiteLabel') && hasBrandingProfile(org),
    ready,
  }
}

export default useBranding
