/**
 * @jest-environment node
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
 * The `mediaCdn` entitlement gate (AGL-1409).
 *
 * `serveMediaCdn` deliberately checks no entitlement — it is an
 * unauthenticated delivery route whose answer must be a pure function of
 * (URL, doc) so the edge cache key stays sound. The gate lives one layer
 * up instead: a CDN URL only ever exists because `mediaCdnPathUpdate` minted
 * a `cdnPath`, and `mediaNodeSrc` derives every stored `media:` reference
 * from that field. No `cdnPath`, no reference, no paid delivery — a free-tier
 * org degrades to the raw storage URL.
 *
 * That makes this one helper the whole enforcement point for a paid feature,
 * which is exactly why it is worth pinning. It has drifted once already:
 * `set-private` used to mint a path on un-privating with no entitlement
 * check, handing an unentitled org a URL that upload and replace had both
 * withheld. Consolidating the rule here fixed that; these tests stop the
 * next writer re-opening it.
 */

import { mediaCdnPathUpdate } from './media-scope'

const CDN_SCOPE = 'org:testOrg'
const MEDIA_ID = 'mediaAbc'
const PATH = `/api/media/cdn/${CDN_SCOPE}/${MEDIA_ID}`

const update = (
  billing: Record<string, unknown> | undefined,
  isPrivate = false,
) =>
  mediaCdnPathUpdate({
    billing,
    cdnScope: CDN_SCOPE,
    mediaId: MEDIA_ID,
    isPrivate,
  })

/**
 * The refusal is a FieldValue delete sentinel rather than a falsy string:
 * an org that loses the entitlement must have the field removed, not set to
 * something empty that `mediaNodeSrc` would still have to reason about.
 */
const isDeleteSentinel = (value: unknown) =>
  typeof value === 'object' && value !== null && !(typeof value === 'string')

describe('mediaCdnPathUpdate — the mediaCdn entitlement gate', () => {
  describe('refuses an org without the entitlement', () => {
    it('MINTS a path for a free-tier org (AGL-1152)', () => {
      // Inverted 2026-08-26 with the packaging. `free` used to be the only
      // plan whose `features.mediaCdn` was false, and gating it had the
      // economics backwards: without a path the site serves the FULL-SIZE
      // original from Storage egress with no shared edge cache, which costs
      // Aglyn more per visitor than the CDN the gate was withholding.
      expect(isDeleteSentinel(update({ plan: 'free' }))).toBe(false)
    })

    it('mints a path for an org with no plan at all', () => {
      // Missing/unknown plans resolve as free (AGL-247), and free now has it.
      // The invariant worth keeping is the RESOLUTION, not the answer: a
      // plan-less org must be treated as free rather than skipping the gate.
      expect(isDeleteSentinel(update({}))).toBe(false)
      expect(isDeleteSentinel(update(undefined))).toBe(false)
      expect(isDeleteSentinel(update({ plan: 'not-a-plan' }))).toBe(false)
    })

    it('still mints a path for a paid plan whose subscription is dead', () => {
      // Also inverted, and deliberately so. A canceled subscription drops the
      // org to FREE, and free now carries `mediaCdn` — so the lapsed
      // customer's images keep loading, over the delivery path that is cheaper
      // for us than the fallback. Billing status still gates everything free
      // does not include; it simply no longer gates this.
      for (const status of ['canceled', 'unpaid', 'incomplete']) {
        expect(
          isDeleteSentinel(update({ plan: 'business', billingStatus: status })),
        ).toBe(false)
      }
    })

    it('mints no path when a staff override turns the feature off', () => {
      expect(
        isDeleteSentinel(
          update({ plan: 'business', entitlements: { features: { mediaCdn: false } } }),
        ),
      ).toBe(true)
    })
  })

  describe('positive control — an entitled org is unaffected', () => {
    it('mints the path for every plan that carries mediaCdn', () => {
      for (const plan of [
        'starter',
        'pro',
        'business',
        'scale',
        'advanced',
        'agency',
        'enterprise',
      ]) {
        expect(update({ plan })).toBe(PATH)
      }
    })

    it('mints the path for a live paid subscription', () => {
      expect(update({ plan: 'starter', billingStatus: 'active' })).toBe(PATH)
    })

    it('mints the path for a comped org via an entitlement override', () => {
      expect(
        update({ plan: 'free', entitlements: { features: { mediaCdn: true } } }),
      ).toBe(PATH)
    })
  })

  describe('private assets leave the public model regardless of plan', () => {
    it('mints no path for a private asset even on an entitled plan', () => {
      // Two independent reasons to have no path; both must clear to get one.
      expect(isDeleteSentinel(update({ plan: 'enterprise' }, true))).toBe(true)
    })

    it('mints no path for a private asset on a free plan', () => {
      expect(isDeleteSentinel(update({ plan: 'free' }, true))).toBe(true)
    })
  })
})
