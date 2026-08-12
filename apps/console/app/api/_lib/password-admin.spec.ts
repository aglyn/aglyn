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

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {},
  // The cost meter (AGL-1438); these tests never reach a send.
  meterPlatformEmail: async () => undefined,
}))
jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => ({ sent: false, reason: 'unconfigured' }),
}))
jest.mock('./render-system-email', () => ({
  renderSystemEmail: async () => null,
}))

import {
  blockedReasonForOrgSetPassword,
  validateNewPassword,
} from './password-admin'

const ORG_ID = 'org-1'
const OWNER_UID = 'owner-uid'
const ADMIN_UID = 'admin-uid'
const TARGET_UID = 'target-uid'

/**
 * Stands in for the `users/{uid}/orgs` reverse index — the only Firestore
 * read the guard makes.
 */
function firestoreWithOrgs(orgIds: string[]) {
  return {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          select: () => ({
            get: async () => ({ docs: orgIds.map((id) => ({ id })) }),
          }),
        }),
      }),
    }),
  } as unknown as FirebaseFirestore.Firestore
}

function subject(overrides: Record<string, unknown> = {}) {
  return {
    firestore: firestoreWithOrgs([ORG_ID]),
    target: { uid: TARGET_UID, customClaims: undefined },
    orgId: ORG_ID,
    ownerUid: OWNER_UID,
    actorUid: ADMIN_UID,
    ...overrides,
  } as Parameters<typeof blockedReasonForOrgSetPassword>[0]
}

describe('blockedReasonForOrgSetPassword', () => {
  it('allows a member who belongs to this org alone', async () => {
    expect(await blockedReasonForOrgSetPassword(subject())).toBeNull()
  })

  it('refuses when the account also belongs to another organization', async () => {
    const reason = await blockedReasonForOrgSetPassword(
      subject({ firestore: firestoreWithOrgs([ORG_ID, 'org-2']) }),
    )
    expect(reason).toMatch(/other organizations/i)
  })

  it('refuses a staff account', async () => {
    const reason = await blockedReasonForOrgSetPassword(
      subject({ target: { uid: TARGET_UID, customClaims: { staff: true } } }),
    )
    expect(reason).toMatch(/staff/i)
  })

  it('refuses the organization owner', async () => {
    const reason = await blockedReasonForOrgSetPassword(
      subject({ target: { uid: OWNER_UID } }),
    )
    expect(reason).toMatch(/owner/i)
  })

  it('refuses the admin acting on themselves', async () => {
    const reason = await blockedReasonForOrgSetPassword(
      subject({ target: { uid: ADMIN_UID } }),
    )
    expect(reason).toMatch(/account settings/i)
  })

  it('checks staff before the reverse index, so a staff account in one org is still refused', async () => {
    const reason = await blockedReasonForOrgSetPassword(
      subject({
        target: { uid: TARGET_UID, customClaims: { staff: true } },
        firestore: firestoreWithOrgs([ORG_ID]),
      }),
    )
    expect(reason).toMatch(/staff/i)
  })
})

describe('validateNewPassword', () => {
  it('accepts a long, varied password', () => {
    const result = validateNewPassword('correct-horse-battery')
    expect(result.error).toBeNull()
    expect(result.password).toBe('correct-horse-battery')
  })

  it('rejects anything under the minimum length', () => {
    expect(validateNewPassword('short').error).toMatch(/at least/i)
  })

  it('rejects a repetitive password that clears the length bar', () => {
    expect(validateNewPassword('aaaaaaaaaaaaaaaa').error).toMatch(
      /repetitive/i,
    )
  })

  it('rejects surrounding whitespace, which never survives a copy-paste', () => {
    expect(validateNewPassword(' correct-horse-battery ').error).toMatch(
      /space/i,
    )
  })

  it('treats a missing password as too short rather than throwing', () => {
    expect(validateNewPassword(undefined).error).toMatch(/at least/i)
  })
})
