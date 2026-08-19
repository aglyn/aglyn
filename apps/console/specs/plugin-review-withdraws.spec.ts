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
 * What a REJECT or a REVOKE has to withdraw (AGL-2306).
 *
 * Two things a review verdict failed to reach:
 *
 * 1. `latestApprovedVersion` — written on approval and never moved back, so a
 *    version rejected on re-review or killed with the per-version switch was
 *    still advertised as "Update to vX" for bytes `install-plugin` 409s on.
 * 2. `trust`/`signature` — `sign-plugin` refuses to GRANT realm trust unless
 *    the version is approved, and nothing ungated it. Approve → sign →
 *    re-review → reject left the bundle loading in the APP REALM, where
 *    neither the sandbox iframe nor the plugin-origin CSP is between it and
 *    user data.
 *
 * The decision behind (1) is unit-tested where it lives —
 * `newestInstallableVersion` in `libs/aglyn/src/lib/app-utils/plugin-manifest.ts`,
 * with the approved-but-revoked case that a mirror reading only `reviewState`
 * gets wrong. What that cannot see is whether the ROUTE calls it, and the
 * route has no runnable harness in this app, so this file reads the source —
 * the same idiom `plugin-review-actions-reachable.spec.ts` already uses on the
 * same file, and for the same reason.
 *
 * It is a presence guard and is worth exactly that: it catches the withdrawal
 * being dropped, not a subtly wrong one.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROUTE = readFileSync(
  join(__dirname, '..', 'app/api/admin/plugin-reviews/route.ts'),
  'utf8',
)

/** The `versionRef.set` that records the verdict, non-approving arm only. */
function rejectionArm(): string {
  const start = ROUTE.indexOf('reviewRejectionReason: reason,')
  expect(start).toBeGreaterThan(-1)
  const end = ROUTE.indexOf('{ merge: true },', start)
  expect(end).toBeGreaterThan(start)
  return ROUTE.slice(start, end)
}

describe('a rejection withdraws realm trust (AGL-2306)', () => {
  it.each(['trust', 'signature', 'trustGrantedBy', 'trustGrantedAt'])(
    'clears %s',
    (field) => {
      expect(rejectionArm()).toContain(`${field}: FieldValue.delete()`)
    },
  )

  it('clears the SAME four fields sign-plugin clears, and no others', () => {
    // One shape of "untrusted", not two. `sign-plugin`'s revoke branch is the
    // definition; a rejection that cleared three of the four would leave a
    // version that reads as signed-but-untrusted to somebody.
    const signRoute = readFileSync(
      join(__dirname, '..', 'app/api/admin/sign-plugin/route.ts'),
      'utf8',
    )
    const cleared = (source: string) =>
      Array.from(
        source.matchAll(/(\w+): FieldValue\.delete\(\)/g),
        (match) => match[1],
      )
        .filter((field) => field.startsWith('trust') || field === 'signature')
        .sort()
    expect(cleared(rejectionArm())).toEqual(cleared(signRoute))
  })

  it('does NOT revoke the version as well', () => {
    // Deliberate, and the reason AGL-1085 made the kill switch a separate
    // control: most rejections are a thin README, and an unannounced site
    // outage is worse than a rejected version continuing to run sandboxed.
    // Withdrawing realm trust is not the same decision as stopping the bytes.
    expect(rejectionArm()).not.toContain('revocations')
  })
})

describe('a reject or a revoke re-derives what is on offer (AGL-2306)', () => {
  it('the repair is derived by the shared core decision, not a local copy', () => {
    expect(ROUTE).toContain('newestInstallableVersion(')
  })

  it('runs when the REJECTED version is the one being offered', () => {
    expect(ROUTE).toMatch(
      /String\(listing\.latestApprovedVersion \?\? ''\) === version[\s\S]{0,600}?repairLatestApprovedVersion\(/,
    )
  })

  it('runs on revoke AND unrevoke, because both change what is installable', () => {
    // Called once, unconditionally, inside the shared
    // revoke-version/unrevoke-version branch — not behind a `revoking` test,
    // which would leave a restored version off the offer forever.
    const start = ROUTE.indexOf(
      "if (action === 'revoke-version' || action === 'unrevoke-version') {",
    )
    expect(start).toBeGreaterThan(-1)
    const branch = ROUTE.slice(start, ROUTE.indexOf('decline-verification', start))
    expect(branch).toContain('await repairLatestApprovedVersion(listingRef, next)')
    expect(branch).not.toMatch(/if \(revoking\)[\s\S]{0,80}repairLatestApprovedVersion/)
  })

  it('deletes the mirror rather than leaving a stale string', () => {
    expect(ROUTE).toContain('latestApprovedVersion: newest ?? FieldValue.delete()')
  })
})
