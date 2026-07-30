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
  resolveBrandingProfile,
  type ResolvedBrandingProfile,
} from '@aglyn/aglyn'
import useCurrentOrg from './use-current-org'

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
  if (!ready) {
    return { branding: AGLYN_BRANDING_PROFILE, whiteLabel: false, ready }
  }
  return {
    branding: resolveBrandingProfile(org),
    whiteLabel: checkEntitlement(org, 'whiteLabel'),
    ready,
  }
}

export default useBranding
