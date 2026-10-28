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

import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { setWaiversDbForTests } from './db'
import {
  closeWaiverDisplayGrant,
  isWaiverDisplayGrantOpen,
  mintWaiverDisplayGrant,
  openWaiverDisplayGrant,
  setWaiverDisplaySecretForTests,
  verifyWaiverDisplayGrant,
} from './display-grant'

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: { app: () => ({}) } }))
jest.mock('@aglyn/tenant-data-admin/server/media-signing', () => ({
  tokenSigningSecret: () => {
    throw new Error('TOKEN_SIGNING_SECRET is not configured')
  },
}))

/**
 * The grant a register's customer display signs with (AGL-4042): what the
 * console minted for one staff member at one site, under the shared signing
 * secret and its own context, open until it is closed, with no timer, and
 * nothing else.
 */

const CLAIMS = { orgId: 'org-1', hostId: 'host-1', staffUid: 'uid-1', staffName: 'Sam Clerk' }
const NOW = Date.UTC(2026, 9, 27, 15, 0)

let db: MemoryFirestore
beforeEach(() => {
  db = createMemoryFirestore()
  setWaiversDbForTests(db)
})
afterEach(() => setWaiverDisplaySecretForTests(null))
afterAll(() => setWaiversDbForTests(null))

describe('a customer display grant', () => {
  it('reads back what was minted, and stays open, with no expiry, until it is closed', async () => {
    setWaiverDisplaySecretForTests(() => 'secret-a')
    const { grant, grantId } = await mintWaiverDisplayGrant(CLAIMS, NOW)
    expect(grantId).toMatch(/^[a-f0-9]{32}$/)
    expect(verifyWaiverDisplayGrant(grant)).toEqual({ ...CLAIMS, grantId })
    expect(db.docs.get(`orgs/org-1/waiverDisplayGrants/${grantId}`)).toEqual({
      hostId: 'host-1',
      staffUid: 'uid-1',
      staffName: 'Sam Clerk',
      createdAtMs: NOW,
    })
    // Nothing in it expires: it is the document that says whether it is open.
    expect(grant).not.toMatch(/exp/)
    expect(await openWaiverDisplayGrant(grant)).toEqual({ ...CLAIMS, grantId })
    expect(await isWaiverDisplayGrantOpen('org-1', 'host-1', grantId)).toBe(true)
    // Another site's staff cannot close it, nor ask about it.
    expect(await closeWaiverDisplayGrant('org-1', 'host-2', grantId)).toBe(false)
    expect(await isWaiverDisplayGrantOpen('org-1', 'host-2', grantId)).toBe(false)
    expect(await closeWaiverDisplayGrant('org-1', 'host-1', grantId)).toBe(true)
    expect(db.docs.has(`orgs/org-1/waiverDisplayGrants/${grantId}`)).toBe(false)
    expect(await openWaiverDisplayGrant(grant)).toBeNull()
    expect(await isWaiverDisplayGrantOpen('org-1', 'host-1', grantId)).toBe(false)
    // Closing it again changes nothing.
    expect(await closeWaiverDisplayGrant('org-1', 'host-1', grantId)).toBe(false)
  })

  it('refuses a tampered, foreign or malformed one, one signed under another secret, and a timed v1 grant', async () => {
    setWaiverDisplaySecretForTests(() => 'secret-a')
    const { grant, grantId } = await mintWaiverDisplayGrant(CLAIMS, NOW)
    const [prefix, payload, signature] = grant.split('.')
    const forged = Buffer.from(JSON.stringify({ ...CLAIMS, grantId, hostId: 'host-2' })).toString('base64url')
    for (const bad of [
      `${prefix}.${forged}.${signature}`,
      `aglyn-waiver-display-v1.${payload}.${signature}`,
      `aglyn-edit-bar-v1.${payload}.${signature}`,
      `${grant}.extra`,
      'nonsense',
      42,
      null,
    ]) {
      expect(verifyWaiverDisplayGrant(bad)).toBeNull()
      expect(await openWaiverDisplayGrant(bad)).toBeNull()
    }
    setWaiverDisplaySecretForTests(() => 'secret-b')
    expect(verifyWaiverDisplayGrant(grant)).toBeNull()
  })

  it('fails closed on a deploy with no signing secret, opening nothing', async () => {
    await expect(mintWaiverDisplayGrant(CLAIMS, NOW)).rejects.toThrow(/TOKEN_SIGNING_SECRET/)
    expect([...db.docs.keys()].some((path) => path.includes('waiverDisplayGrants'))).toBe(false)
    setWaiverDisplaySecretForTests(() => 'secret-a')
    const { grant } = await mintWaiverDisplayGrant(CLAIMS, NOW)
    setWaiverDisplaySecretForTests(null)
    expect(verifyWaiverDisplayGrant(grant)).toBeNull()
  })
})
