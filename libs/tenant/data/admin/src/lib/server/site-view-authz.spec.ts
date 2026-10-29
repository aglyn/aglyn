/**
 * @jest-environment node
 *
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

import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore'

/**
 * Who sees a site in preview (AGL-4086): its team and Aglyn staff, and nobody
 * a forged, expired, foreign or unauthorized cookie belongs to.
 *
 * The signing is REAL end to end — tokens are minted with the real minters
 * and verified by the real verifiers — so these assertions pin the crypto and
 * the kind/host walls, not mocks. Only the auth lookup and Firestore are
 * doubles, and each case changes one fact about them.
 */

process.env['TOKEN_SIGNING_SECRET'] = 'site-preview-spec-secret'

import { SITE_PREVIEW_COOKIE } from '@aglyn/aglyn/app-utils/site-preview'
import { EDIT_HINT_COOKIE, mintEditHintToken } from './edit-hint-token'
import { mintSitePreviewToken, verifySitePreviewToken } from './site-preview-token'
import { siteViewRefusal, verifySitePreviewViewer } from './site-view-authz'

const HOST_ID = 'host-1'
const ORG_ID = 'org-1'
const UID = 'uid-team'

type Row = Record<string, unknown>

function snapshot(id: string, data: Row | null): DocumentSnapshot {
  return {
    id,
    exists: data !== null,
    data: () => data ?? undefined,
    get: (field: string) => (data ? data[field] : undefined),
  } as unknown as DocumentSnapshot
}

/** A Firestore holding one host and, optionally, one roster row for UID. */
function firestoreWith(options: { host?: Row | null; member?: Row | null }): Firestore {
  const host = options.host === undefined ? { orgId: ORG_ID } : options.host
  return {
    collection: (name: string) => ({
      doc: (id: string) =>
        name === 'hosts'
          ? { get: async () => snapshot(id, id === HOST_ID ? host : null) }
          : {
              collection: () => ({
                doc: (uid: string) => ({
                  get: async () =>
                    snapshot(uid, uid === UID ? (options.member ?? null) : null),
                }),
              }),
            },
    }),
  } as unknown as Firestore
}

const account = (claims: Row = {}, disabled = false) =>
  jest.fn(async (uid: string) => ({
    record: { uid, disabled, customClaims: claims },
    tenantId: null,
  })) as never

const hintCookie = (uid = UID) =>
  `${EDIT_HINT_COOKIE}=${mintEditHintToken('cookie', uid).token}`

describe('the site-preview token (AGL-4086)', () => {
  it('verifies for the site it was minted for, as its own kind', () => {
    const { token } = mintSitePreviewToken('enter', HOST_ID)
    expect(verifySitePreviewToken('enter', token, HOST_ID)?.hostId).toBe(HOST_ID)
  })

  it('opens no other site', () => {
    const { token } = mintSitePreviewToken('cookie', HOST_ID)
    expect(verifySitePreviewToken('cookie', token, 'host-2')).toBeNull()
  })

  it('is not interchangeable between kinds (an enter URL is not a 12 h cookie)', () => {
    const enter = mintSitePreviewToken('enter', HOST_ID).token
    const cookie = mintSitePreviewToken('cookie', HOST_ID).token
    expect(verifySitePreviewToken('cookie', enter, HOST_ID)).toBeNull()
    expect(verifySitePreviewToken('enter', cookie, HOST_ID)).toBeNull()
  })

  it('expires: an enter blob after two minutes, a cookie after twelve hours', () => {
    const now = Date.now()
    const enter = mintSitePreviewToken('enter', HOST_ID, now).token
    expect(verifySitePreviewToken('enter', enter, HOST_ID, now + 119_000)).not.toBeNull()
    expect(verifySitePreviewToken('enter', enter, HOST_ID, now + 121_000)).toBeNull()
    const cookie = mintSitePreviewToken('cookie', HOST_ID, now).token
    expect(verifySitePreviewToken('cookie', cookie, HOST_ID, now + 11 * 3_600_000)).not.toBeNull()
    expect(verifySitePreviewToken('cookie', cookie, HOST_ID, now + 13 * 3_600_000)).toBeNull()
  })

  it('refuses a tampered payload and a forged signature', () => {
    const { token } = mintSitePreviewToken('cookie', HOST_ID)
    const [prefix, , sig] = token.split('.')
    const forgedPayload = Buffer.from(
      JSON.stringify({ hostId: 'host-2', exp: Date.now() + 1000 }),
    ).toString('base64url')
    expect(verifySitePreviewToken('cookie', `${prefix}.${forgedPayload}.${sig}`, 'host-2')).toBeNull()
    expect(verifySitePreviewToken('cookie', `${token.slice(0, -2)}xx`, HOST_ID)).toBeNull()
    expect(verifySitePreviewToken('cookie', 'garbage', HOST_ID)).toBeNull()
  })
})

describe('siteViewRefusal: the team and staff (AGL-4086)', () => {
  const host = (data: Row) => snapshot(HOST_ID, { orgId: ORG_ID, ...data })

  it('admits a role on the site (its memberRoles)', async () => {
    const refusal = await siteViewRefusal({
      firestore: firestoreWith({}),
      host: host({ memberRoles: { [UID]: 'viewer' } }),
      uid: UID,
    })
    expect(refusal).toBeNull()
  })

  it('admits a workspace owner and a member who holds every site', async () => {
    for (const member of [{ role: 'owner' }, { role: 'editor', allHosts: true }]) {
      const refusal = await siteViewRefusal({
        firestore: firestoreWith({ member }),
        host: host({}),
        uid: UID,
      })
      expect(refusal).toBeNull()
    }
  })

  it('admits a collaborator scoped to THIS site', async () => {
    const refusal = await siteViewRefusal({
      firestore: firestoreWith({
        member: { role: 'viewer', allHosts: false, hostAccess: { [HOST_ID]: 'viewer' } },
      }),
      host: host({}),
      uid: UID,
    })
    expect(refusal).toBeNull()
  })

  it('refuses a collaborator scoped to OTHER sites of the workspace', async () => {
    const refusal = await siteViewRefusal({
      firestore: firestoreWith({
        member: { role: 'editor', allHosts: false, hostAccess: { 'host-other': 'editor' } },
      }),
      host: host({}),
      uid: UID,
    })
    expect(refusal).toBe('not-team')
  })

  it('refuses an account with no role and no membership', async () => {
    const refusal = await siteViewRefusal({
      firestore: firestoreWith({ member: null }),
      host: host({}),
      uid: UID,
    })
    expect(refusal).toBe('not-team')
  })

  it('admits Aglyn staff with no membership at all', async () => {
    const refusal = await siteViewRefusal({
      firestore: firestoreWith({ member: null }),
      host: host({}),
      uid: 'uid-staff',
      staff: true,
    })
    expect(refusal).toBeNull()
  })
})

describe('verifySitePreviewViewer: the request (AGL-4086)', () => {
  it('admits a valid preview cookie for this site', async () => {
    const cookie = `${SITE_PREVIEW_COOKIE}=${mintSitePreviewToken('cookie', HOST_ID).token}`
    const viewer = await verifySitePreviewViewer(
      { firestore: firestoreWith({}), hostId: HOST_ID, cookieHeader: `a=1; ${cookie}` },
      { findUser: account() },
    )
    expect(viewer).toEqual({ admitted: true, via: 'cookie' })
  })

  it('refuses a forged, an expired and a foreign preview cookie', async () => {
    const now = Date.now()
    const expired = mintSitePreviewToken('cookie', HOST_ID, now - 13 * 3_600_000).token
    const foreign = mintSitePreviewToken('cookie', 'host-2').token
    for (const value of ['forged.value.here', expired, foreign]) {
      const viewer = await verifySitePreviewViewer(
        {
          firestore: firestoreWith({}),
          hostId: HOST_ID,
          cookieHeader: `${SITE_PREVIEW_COOKIE}=${value}`,
        },
        { findUser: account() },
      )
      expect(viewer.admitted).toBe(false)
    }
  })

  it('admits an edit hint whose account has a role on the site', async () => {
    const viewer = await verifySitePreviewViewer(
      {
        firestore: firestoreWith({ host: { orgId: ORG_ID, memberRoles: { [UID]: 'editor' } } }),
        hostId: HOST_ID,
        cookieHeader: hintCookie(),
      },
      { findUser: account() },
    )
    expect(viewer).toEqual({ admitted: true, via: 'hint' })
  })

  it('refuses an edit hint for a uid with no role on the site', async () => {
    const viewer = await verifySitePreviewViewer(
      {
        firestore: firestoreWith({ member: null }),
        hostId: HOST_ID,
        cookieHeader: hintCookie('uid-stranger'),
      },
      { findUser: account() },
    )
    expect(viewer.admitted).toBe(false)
  })

  it('admits staff by the claim on the ACCOUNT, not by anything in the request', async () => {
    const viewer = await verifySitePreviewViewer(
      {
        firestore: firestoreWith({ member: null }),
        hostId: HOST_ID,
        cookieHeader: `${hintCookie('uid-staff')}; staff=true`,
      },
      { findUser: account({ staff: true }) },
    )
    expect(viewer).toEqual({ admitted: true, via: 'hint' })
    // The same request from an account without the claim is a stranger.
    const stranger = await verifySitePreviewViewer(
      {
        firestore: firestoreWith({ member: null }),
        hostId: HOST_ID,
        cookieHeader: `${hintCookie('uid-staff')}; staff=true`,
      },
      { findUser: account({ staff: 'true' }) },
    )
    expect(stranger.admitted).toBe(false)
  })

  it('refuses a disabled account, whose hint the sign-out could not reach', async () => {
    const viewer = await verifySitePreviewViewer(
      {
        firestore: firestoreWith({ host: { orgId: ORG_ID, memberRoles: { [UID]: 'admin' } } }),
        hostId: HOST_ID,
        cookieHeader: hintCookie(),
      },
      { findUser: account({}, true) },
    )
    expect(viewer.admitted).toBe(false)
  })

  it('refuses a request with no cookie, and never throws when a lookup does', async () => {
    const none = await verifySitePreviewViewer({
      firestore: firestoreWith({}),
      hostId: HOST_ID,
      cookieHeader: null,
    })
    expect(none.admitted).toBe(false)
    const failing = await verifySitePreviewViewer(
      { firestore: firestoreWith({}), hostId: HOST_ID, cookieHeader: hintCookie() },
      {
        findUser: jest.fn(async () => {
          throw new Error('auth down')
        }) as never,
      },
    )
    expect(failing.admitted).toBe(false)
  })
})
