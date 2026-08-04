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
 * AGL-1239: a partial cache drop has to reach the person publishing.
 *
 * Two limits can leave live pages stale after a publish that reported success —
 * the tenant's path cap and the console's dependent-scan limit. Both were
 * recorded only in a server log, which nobody reads during a publish, so the
 * editor showed an unqualified "published" beside pages that did not change.
 *
 * The assertion that matters is the NEGATIVE one: this must stay silent on a
 * complete drop. A warning that fires on every publish teaches people to ignore
 * it, and then the one publish it was written for is ignored too.
 */

import {
  describeRevalidateShortfall,
  type RevalidateLivePagesResult,
} from '../utils/revalidate-live-pages'

const result = (
  over: Partial<RevalidateLivePagesResult> = {},
): RevalidateLivePagesResult => ({
  revalidated: 48,
  pathsDropped: 0,
  scanTruncated: false,
  ...over,
})

describe('describeRevalidateShortfall (AGL-1239)', () => {
  it('says nothing when the drop covered everything', () => {
    expect(describeRevalidateShortfall(result())).toBeNull()
  })

  it('says nothing when there was no drop to report', () => {
    // A hint that could not be sent is not a shortfall — the revalidate window
    // is still underneath it, and claiming a half-failure would be worse than
    // silence.
    expect(describeRevalidateShortfall(null)).toBeNull()
  })

  it('names the count when the tenant capped the payload', () => {
    const message = describeRevalidateShortfall(
      result({ revalidated: 250, pathsDropped: 12 }),
    )
    expect(message).toContain('12 pages')
    // Says what happens next, not just that something was truncated.
    expect(message).toMatch(/within a minute/)
  })

  it('is singular for one page', () => {
    expect(describeRevalidateShortfall(result({ pathsDropped: 1 }))).toContain(
      '1 page ',
    )
  })

  it('speaks up when the scan stopped early, even with no paths dropped', () => {
    // The subtler shortfall: every path the console FOUND was accepted, but it
    // stopped looking. Keying the warning on `pathsDropped` alone would miss
    // this entirely, and it is the one that scales with site size.
    const message = describeRevalidateShortfall(result({ scanTruncated: true }))
    expect(message).toBeTruthy()
    expect(message).toContain('Some pages')
  })
})
