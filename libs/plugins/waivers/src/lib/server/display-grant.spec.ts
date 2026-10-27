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

import { mintWaiverDisplayGrant, setWaiverDisplaySecretForTests, verifyWaiverDisplayGrant } from './display-grant'

jest.mock('@aglyn/tenant-data-admin/server/media-signing', () => ({
  tokenSigningSecret: () => {
    throw new Error('TOKEN_SIGNING_SECRET is not configured')
  },
}))

/**
 * The grant a register's customer display signs with (AGL-4042): what the
 * console minted for one staff member at one site, for thirty minutes, under
 * the shared signing secret and its own context, and nothing else.
 */

const CLAIMS = { orgId: 'org-1', hostId: 'host-1', staffUid: 'uid-1', staffName: 'Sam Clerk' }
const NOW = Date.UTC(2026, 9, 27, 15, 0)

afterEach(() => setWaiverDisplaySecretForTests(null))

describe('a customer display grant', () => {
  it('reads back what was minted, until it expires thirty minutes later', () => {
    setWaiverDisplaySecretForTests(() => 'secret-a')
    const { grant, expiresAtMs } = mintWaiverDisplayGrant(CLAIMS, NOW)
    expect(expiresAtMs).toBe(NOW + 30 * 60 * 1000)
    expect(verifyWaiverDisplayGrant(grant, NOW + 1000)).toEqual({ ...CLAIMS, exp: expiresAtMs })
    expect(verifyWaiverDisplayGrant(grant, expiresAtMs)).toBeNull()
  })

  it('refuses a tampered, foreign or malformed one, and one signed under another secret', () => {
    setWaiverDisplaySecretForTests(() => 'secret-a')
    const { grant } = mintWaiverDisplayGrant(CLAIMS, NOW)
    const [prefix, payload, signature] = grant.split('.')
    const forged = Buffer.from(JSON.stringify({ ...CLAIMS, hostId: 'host-2', exp: NOW + 60_000 })).toString('base64url')
    for (const bad of [
      `${prefix}.${forged}.${signature}`,
      `aglyn-edit-bar-v1.${payload}.${signature}`,
      `${grant}.extra`,
      'nonsense',
      42,
      null,
    ]) {
      expect(verifyWaiverDisplayGrant(bad, NOW)).toBeNull()
    }
    setWaiverDisplaySecretForTests(() => 'secret-b')
    expect(verifyWaiverDisplayGrant(grant, NOW)).toBeNull()
  })

  it('fails closed on a deploy with no signing secret', () => {
    expect(() => mintWaiverDisplayGrant(CLAIMS, NOW)).toThrow(/TOKEN_SIGNING_SECRET/)
    setWaiverDisplaySecretForTests(() => 'secret-a')
    const { grant } = mintWaiverDisplayGrant(CLAIMS, NOW)
    setWaiverDisplaySecretForTests(null)
    expect(verifyWaiverDisplayGrant(grant, NOW)).toBeNull()
  })
})
