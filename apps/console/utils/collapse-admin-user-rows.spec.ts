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

import {
  adminUserRowIdentityStrength,
  collapseAdminUserRows,
} from './collapse-admin-user-rows'

/**
 * AGL-2005 — one row per human in the staff Users list, and the row staff read
 * is the record every action lands on.
 *
 * The per-page half is proved elsewhere: `auth-pools.spec.ts` proves the merge
 * rule against the real algorithm, and `admin-users-list-one-row-per-human`
 * proves `GET /api/admin/users` applies it. Neither can see the hole this
 * covers, because both stop at ONE page — and the page the staff console
 * renders is several pages concatenated.
 *
 * Every case below drives the accumulation the page actually performs
 * (`[...previous, ...payload.users]`) rather than a hand-built array, so a
 * change to how pages are joined shows up here.
 */

const SHADOW_UID = 'SsoTenantUidFixture000000000'
const SSO_TENANT = 'aglyn-org-y5v14'

interface Row {
  uid: string
  email: string | null
  displayName: string | null
  disabled: boolean
  staff: boolean
  providers: string[]
  tenantId?: string | null
  uidAlsoInPools?: (string | null)[] | null
}

const row = (over: Partial<Row> & { uid: string }): Row => ({
  email: null,
  displayName: null,
  disabled: false,
  staff: false,
  providers: [],
  tenantId: null,
  uidAlsoInPools: null,
  ...over,
})

/**
 * The forged twin, as `GET /api/admin/users` serializes it on a NON-final
 * page: no address, no provider, and — the detail that makes this invisible —
 * no `uidAlsoInPools` marker, because the route only marks collisions on the
 * page where every pool's rows are in hand.
 */
const shadowOnPageOne = row({ uid: SHADOW_UID })

/** The account the human actually signs in as, appended on the LAST page. */
const ssoOnLastPage = row({
  uid: SHADOW_UID,
  email: 'staff@aglyn.com',
  displayName: 'Zach Gover',
  providers: ['saml.aglyn-workspace'],
  tenantId: SSO_TENANT,
})

/** How the page builds the list it renders. */
const accumulate = (...pages: Row[][]): Row[] =>
  pages.reduce<Row[]>((previous, page) => [...previous, ...page], [])

describe('collapseAdminUserRows — one row per human across pages (AGL-2005)', () => {
  /**
   * The report itself, in the shape that survives the per-page collapse.
   *
   * Forced red by deleting the `collapseAdminUserRows` call from the page's
   * `visible` memo (and by keying the merge on `email` instead of `uid`,
   * which reddens the two negative cases below instead).
   */
  it('collapses a twin from an earlier page into the identified record', () => {
    const collapsed = collapseAdminUserRows(
      accumulate([shadowOnPageOne], [ssoOnLastPage]),
    )
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0].uid).toBe(SHADOW_UID)
    // The survivor is the record that identifies the human, never the
    // artifact — the display must not tell staff this person has no email.
    expect(collapsed[0].email).toBe('staff@aglyn.com')
    expect(collapsed[0].tenantId).toBe(SSO_TENANT)
  })

  /**
   * Merged is not hidden. The per-page collapse structurally CANNOT mark this
   * collision — the two rows were never on one page — so without this the fix
   * would be a cover-up: a real duplicate would vanish with nothing to notice.
   */
  it('still reports the pool the folded-away row came from', () => {
    const collapsed = collapseAdminUserRows(
      accumulate([shadowOnPageOne], [ssoOnLastPage]),
    )
    expect(collapsed[0].uidAlsoInPools).toEqual([null])
  })

  it('keeps the identified record even when the twin is encountered first', () => {
    const shadowFirst = collapseAdminUserRows(
      accumulate([shadowOnPageOne], [ssoOnLastPage]),
    )
    const ssoFirst = collapseAdminUserRows(
      accumulate([ssoOnLastPage], [shadowOnPageOne]),
    )
    expect(shadowFirst[0].email).toBe('staff@aglyn.com')
    expect(ssoFirst[0].email).toBe('staff@aglyn.com')
  })

  /**
   * The action-targeting half. Every control on the row posts `record.uid` to
   * `/api/admin/users/manage`, which re-resolves the pool through
   * `findUserByUidAcrossPools` — so what this has to guarantee is that the uid
   * staff act with is the identified human's, and that the identity rendered
   * beside the buttons is that same record rather than the artifact's blanks.
   *
   * Forced red by returning the first row of the group unconditionally.
   */
  it('hands the action the identified record, not the artifact', () => {
    const [merged] = collapseAdminUserRows(
      accumulate([shadowOnPageOne], [ssoOnLastPage]),
    )
    // What the row posts.
    expect(merged.uid).toBe(ssoOnLastPage.uid)
    // What the row shows next to the buttons that post it.
    expect(merged.email).toBe(ssoOnLastPage.email)
    expect(merged.providers).toEqual(ssoOnLastPage.providers)
    expect(merged.tenantId).toBe(ssoOnLastPage.tenantId)
  })

  /**
   * THE NEGATIVE CASE, and the reason AGL-1962 declined to dedupe at all.
   *
   * Two different humans who share an address have two uids. Merging them
   * would delete a real account from the staff console — worse than the bug
   * being fixed, and silent. Forced red by keying the merge on email.
   */
  it('does NOT merge two distinct accounts that share an email', () => {
    const personA = row({
      uid: 'uid-person-a',
      email: 'shared@aglyn.com',
      displayName: 'Alex',
      providers: ['password'],
    })
    const personB = row({
      uid: 'uid-person-b',
      email: 'shared@aglyn.com',
      displayName: 'Blair',
      providers: ['google.com'],
      tenantId: SSO_TENANT,
    })
    const collapsed = collapseAdminUserRows(accumulate([personA], [personB]))
    expect(collapsed).toHaveLength(2)
    expect(collapsed.map((r) => r.uid)).toEqual(['uid-person-a', 'uid-person-b'])
    // And neither is falsely labelled a cross-pool twin.
    expect(collapsed[0].uidAlsoInPools).toBeNull()
    expect(collapsed[1].uidAlsoInPools).toBeNull()
  })

  /**
   * The same negative taken to its worst case: two accounts identical in every
   * displayed field, differing only in uid. Anything that merges these has
   * stopped keying on identity.
   */
  it('does NOT merge two accounts that differ only by uid', () => {
    const twinA = row({
      uid: 'uid-a',
      email: 'same@aglyn.com',
      displayName: 'Same Person',
      providers: ['password'],
    })
    const twinB = { ...twinA, uid: 'uid-b' }
    expect(collapseAdminUserRows(accumulate([twinA], [twinB]))).toHaveLength(2)
  })

  it('leaves ordering alone so loading a page never reshuffles the rows above', () => {
    const first = row({ uid: 'uid-1', email: 'one@aglyn.com' })
    const third = row({ uid: 'uid-3', email: 'three@aglyn.com' })
    const collapsed = collapseAdminUserRows(
      accumulate([first, shadowOnPageOne], [third, ssoOnLastPage]),
    )
    // The merged human keeps the twin's ORIGINAL slot, not the survivor's.
    expect(collapsed.map((r) => r.uid)).toEqual([
      'uid-1',
      SHADOW_UID,
      'uid-3',
    ])
  })

  /**
   * The route already collapses each page, so this runs over its output far
   * more often than over a real collision. A second pass must be a no-op.
   */
  it('is idempotent over already-collapsed server output', () => {
    const serverCollapsed = [
      { ...ssoOnLastPage, uidAlsoInPools: [null] as (string | null)[] },
    ]
    expect(collapseAdminUserRows(serverCollapsed)).toEqual(serverCollapsed)
  })

  it('unions the pools when a uid turns up in three of them', () => {
    const otherTenant = row({
      uid: SHADOW_UID,
      tenantId: 'aglyn-org-other',
    })
    const collapsed = collapseAdminUserRows(
      accumulate([shadowOnPageOne], [otherTenant, ssoOnLastPage]),
    )
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0].tenantId).toBe(SSO_TENANT)
    expect(collapsed[0].uidAlsoInPools).toEqual([null, 'aglyn-org-other'])
  })
})

/**
 * The ranking has to agree with `identityStrength` in `auth-pools.ts` on the
 * only question that can hurt anyone: is this record an identity, or an
 * artifact? If the two drift, the console shows one record and the action
 * mutates another.
 */
describe('adminUserRowIdentityStrength (AGL-2005)', () => {
  it('scores an artifact below any identified record', () => {
    const artifact = row({ uid: SHADOW_UID })
    expect(adminUserRowIdentityStrength(artifact)).toBe(0)
    expect(
      adminUserRowIdentityStrength(row({ uid: 'u', email: 'a@aglyn.com' })),
    ).toBeGreaterThan(adminUserRowIdentityStrength(artifact))
    expect(
      adminUserRowIdentityStrength(row({ uid: 'u', providers: ['password'] })),
    ).toBeGreaterThan(adminUserRowIdentityStrength(artifact))
  })

  /**
   * `displayName` and the staff claim are written onto whatever record a staff
   * action last landed on — `updateProfile` and `grantStaff` do exactly that.
   * If either were enough on its own, a twin would start winning BECAUSE it
   * had been acted upon, which is the failure mode inverted rather than fixed.
   */
  it('never lets a name or a staff claim outrank a real identity', () => {
    const dressedUpArtifact = row({
      uid: SHADOW_UID,
      displayName: 'Zach Gover',
      staff: true,
    })
    const realAccount = row({
      uid: SHADOW_UID,
      email: 'staff@aglyn.com',
      providers: ['saml.aglyn-workspace'],
      tenantId: SSO_TENANT,
    })
    expect(adminUserRowIdentityStrength(realAccount)).toBeGreaterThan(
      adminUserRowIdentityStrength(dressedUpArtifact),
    )
    const [merged] = collapseAdminUserRows(
      accumulate([dressedUpArtifact], [realAccount]),
    )
    expect(merged.tenantId).toBe(SSO_TENANT)
  })
})
