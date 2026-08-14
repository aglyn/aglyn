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
 * A percentage rollout buckets on the ORG, and on nothing else (AGL-1656).
 *
 * Every server gate used to fall back to the hostId when the org lookup
 * missed (`subjectId: resolved?.orgId ?? hostId`), while the console client
 * fell back to the uid. Three subjects for one question, and a hostId, a uid
 * and an orgId hash to three different buckets — so mid-rollout the published
 * site and the console could land on opposite sides of the same percentage for
 * the same workspace. The verdict is stable per subject, so it never
 * flickered: it just stayed wrong, which is far harder to notice and to
 * report than a flapping one.
 *
 * It only bites while `0 < rolloutPercent < 100`, which is why nothing has hit
 * it — no flag is mid-rollout today, and percentage rollout is exactly the
 * mechanism for easing features out after the beta.
 *
 * The pair of subjects is COMPUTED, not hardcoded: the suite searches for an
 * org id and a host id that genuinely straddle the boundary, in both
 * directions. That is what makes it bite. Without a straddling pair the two
 * subjects would agree by luck and any implementation would pass.
 */

const mockGetTemplate = jest.fn()
const mockOrgGet = jest.fn()
const mockDoc = jest.fn(() => ({ get: mockOrgGet }))
const mockCollection = jest.fn(() => ({ doc: mockDoc }))

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      remoteConfig: () => ({ getTemplate: mockGetTemplate }),
      firestore: () => ({ collection: mockCollection }),
    }),
  },
}))

import { releaseFlagBucket } from '@aglyn/aglyn/server'
import {
  __resetReleaseFlagCaches,
  filterEnabledPluginsByReleaseFlags,
} from './release-flags'

/** The first-party plugin `release_marketplace` gates. */
const PLUGIN = 'marketplace'
const FLAG = 'release_marketplace'
const PERCENT = 50

const template = (value: unknown) => ({
  etag: 'etag-1',
  parameters: { [FLAG]: { defaultValue: { value: JSON.stringify(value) } } },
})

const inRollout = (subjectId: string) =>
  releaseFlagBucket(FLAG, subjectId) < PERCENT

/**
 * An (orgId, hostId) pair whose buckets fall on OPPOSITE sides of the
 * boundary, in the requested direction. `wantOrgIn: false` is the dangerous
 * case: the org is outside the rollout while its host is inside, so a gate
 * that still bucketed on the hostId would serve the feature on the published
 * site that the console refuses to show.
 */
function straddlingPair(wantOrgIn: boolean): { orgId: string; hostId: string } {
  for (let index = 0; index < 2_000; index += 1) {
    const orgId = `org-${index}`
    const hostId = `host-${index}`
    if (inRollout(orgId) === wantOrgIn && inRollout(hostId) !== wantOrgIn) {
      return { orgId, hostId }
    }
  }
  throw new Error('no straddling pair found')
}

async function enabledFor(orgId: string | null): Promise<string[]> {
  return filterEnabledPluginsByReleaseFlags([PLUGIN], { orgId })
}

describe('percentage rollouts bucket on the org id', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    __resetReleaseFlagCaches()
    mockGetTemplate.mockResolvedValue(
      template({ enabled: false, rolloutPercent: PERCENT }),
    )
    // No per-org override anywhere in this suite, so every verdict below is
    // the ROLLOUT BUCKET talking and not AGL-1635's override layer.
    mockOrgGet.mockResolvedValue({ data: () => ({}) })
  })

  it('finds subjects that actually disagree', () => {
    // Guards the guard: if org and host ids ever stopped hashing apart, the
    // two assertions below would pass against any subject at all.
    const { orgId, hostId } = straddlingPair(false)
    expect(inRollout(orgId)).toBe(false)
    expect(inRollout(hostId)).toBe(true)
    expect(releaseFlagBucket(FLAG, orgId)).not.toBe(
      releaseFlagBucket(FLAG, hostId),
    )
  })

  it('excludes an org outside the rollout whose host is inside it', async () => {
    // The published-site failure: bucketing on the hostId would have kept the
    // plugin, contradicting the console for the same workspace.
    const { orgId } = straddlingPair(false)
    await expect(enabledFor(orgId)).resolves.toEqual([])
  })

  it('includes an org inside the rollout whose host is outside it', async () => {
    // The mirror image, so the fix cannot be "always exclude". A gate that
    // simply failed closed would pass the case above and fail this one.
    const { orgId } = straddlingPair(true)
    await expect(enabledFor(orgId)).resolves.toEqual([PLUGIN])
  })

  it('keeps a subject-less request out of a partial rollout', async () => {
    // No org resolved: the conservative answer, not a confidently wrong one.
    await expect(enabledFor(null)).resolves.toEqual([])
  })

  it('still honours a fully-enabled flag with no subject', async () => {
    // The fail-closed rule is scoped to PARTIAL rollouts. A flag that is on
    // for everyone must stay on for a request with no org.
    mockGetTemplate.mockResolvedValue(template({ enabled: true }))
    __resetReleaseFlagCaches()
    await expect(enabledFor(null)).resolves.toEqual([PLUGIN])
  })

  it('agrees with itself for one org across repeated resolutions', async () => {
    // Stability per subject is the property the whole scheme rests on.
    const { orgId } = straddlingPair(true)
    await expect(enabledFor(orgId)).resolves.toEqual([PLUGIN])
    __resetReleaseFlagCaches()
    await expect(enabledFor(orgId)).resolves.toEqual([PLUGIN])
  })
})
