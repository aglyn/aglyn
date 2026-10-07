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
  POS_CASHIER_ASSERTION_TTL_MS,
  POS_MANAGER_ASSERTION_TTL_MS,
  POS_PIN_LOCKOUT_MS,
} from '../model/commerce-pos-ops'
import { posOpsHarness, type PosOpsHarness } from '../testing/pos-ops-harness'
import {
  mintPosAssertion,
  readPosAssertion,
  resolvePosCashier,
  resolvePosStaffAssertion,
} from './pos-ops-gate'
import { handlePosStaffPin } from './pos-staff-pin'

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({ resolveOrgPermissions: jest.fn() }))

/**
 * Staff PINs (AGL-3609): a PIN is hashed and server-only, buys a short-lived
 * signed assertion bound to one site, one register and one member, locks out
 * after five wrong tries however fast they arrive, and never carries more
 * than its member's role holds at the moment it is used.
 */

let h: PosOpsHarness
const pin = (body: Record<string, unknown>, uid = 'cashier') =>
  handlePosStaffPin(h.deps, h.request(uid, { hostId: 'shop', ...body }))
const verify = (memberUid: string, value: string, extra: Record<string, unknown> = {}, uid = 'cashier') =>
  pin({ action: 'verify', registerId: 'front', memberUid, pin: value, ...extra }, uid)

beforeEach(async () => {
  h = posOpsHarness()
  await pin({ action: 'set', pin: '2580' }, 'cashier')
  await pin({ action: 'set', pin: '9137' }, 'owner')
})

describe('setting a PIN', () => {
  it('stores a salted scrypt hash, never the digits', () => {
    const stored = h.memory.read('hosts/shop/posStaffPins/cashier')!
    expect(stored['pinScrypt']).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/)
    expect(JSON.stringify(stored)).not.toContain('2580')
  })

  it('refuses a weak or malformed PIN', async () => {
    for (const value of ['123', '1234567', '1111', '1234', '9876', 'abcd']) {
      expect((await pin({ action: 'set', pin: value })).status).toBe(400)
    }
  })

  it("lets only a workspace admin set someone else's", async () => {
    expect((await pin({ action: 'set', pin: '4826', memberUid: 'cashier2' }, 'cashier')).status).toBe(403)
    expect((await pin({ action: 'set', pin: '4826', memberUid: 'cashier2' }, 'owner')).status).toBe(200)
    expect((await pin({ action: 'set', pin: '4826', memberUid: 'viewer' }, 'owner')).status).toBe(404)
  })

  it('reports and clears', async () => {
    expect((await pin({ action: 'status' })).body['hasPin']).toBe(true)
    await pin({ action: 'clear' })
    expect((await pin({ action: 'status' })).body['hasPin']).toBe(false)
  })

  it('lists who can switch in, by name', async () => {
    const roster = (await pin({ action: 'roster' })).body['members'] as Array<{ uid: string; name: string }>
    expect(roster).toEqual([
      { uid: 'cashier', name: 'Cal Cashier' },
      { uid: 'owner', name: 'Olive Owner' },
    ])
  })
})

describe('switching cashier with a PIN', () => {
  it('answers a signed assertion for that member at that register', async () => {
    const outcome = await verify('cashier', '2580', {}, 'owner')
    expect(outcome.status).toBe(200)
    expect(outcome.body['memberUid']).toBe('cashier')
    expect(outcome.body['expiresAtMs']).toBe(h.clock.now + POS_CASHIER_ASSERTION_TTL_MS)
    const read = readPosAssertion(h.deps, outcome.body['assertion'], { hostId: 'shop', registerId: 'front', purpose: 'cashier' })
    expect(read?.memberUid).toBe('cashier')
  })

  it('binds the assertion to its site, register and purpose', async () => {
    const token = (await verify('cashier', '2580')).body['assertion']
    expect(readPosAssertion(h.deps, token, { hostId: 'other', registerId: 'front', purpose: 'cashier' })).toBeNull()
    expect(readPosAssertion(h.deps, token, { hostId: 'shop', registerId: 'back', purpose: 'cashier' })).toBeNull()
    expect(readPosAssertion(h.deps, token, { hostId: 'shop', registerId: 'front', purpose: 'manager' })).toBeNull()
  })

  it('refuses a forged or tampered assertion', async () => {
    const token = String((await verify('cashier', '2580')).body['assertion'])
    const [payload, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ v: 1, h: 'shop', r: 'front', u: 'owner', p: 'cashier', e: h.clock.now + 1e9 })).toString('base64url')
    expect(readPosAssertion(h.deps, `${forged}.${signature}`, { hostId: 'shop', registerId: 'front', purpose: 'cashier' })).toBeNull()
    expect(readPosAssertion(h.deps, `${payload}.${'0'.repeat(64)}`, { hostId: 'shop', registerId: 'front', purpose: 'cashier' })).toBeNull()
    expect(readPosAssertion(h.deps, 'garbage', { hostId: 'shop', registerId: 'front', purpose: 'cashier' })).toBeNull()
  })

  it('expires, and refresh hands out a new one only while the old one holds', async () => {
    const token = (await verify('cashier', '2580')).body['assertion']
    h.clock.now += POS_CASHIER_ASSERTION_TTL_MS - 1000
    const refreshed = await pin({ action: 'refresh', registerId: 'front', assertion: token })
    expect(refreshed.status).toBe(200)
    h.clock.now += 2000
    expect(readPosAssertion(h.deps, token, { hostId: 'shop', registerId: 'front', purpose: 'cashier' })).toBeNull()
    expect((await pin({ action: 'refresh', registerId: 'front', assertion: token })).status).toBe(401)
    expect(readPosAssertion(h.deps, refreshed.body['assertion'], { hostId: 'shop', registerId: 'front', purpose: 'cashier' })?.memberUid).toBe('cashier')
  })

  it('never carries more than the member holds now: a revoked member stops working on the next tap', async () => {
    const token = (await verify('cashier', '2580')).body['assertion']
    const hostRef = h.memory.firestore.collection('hosts').doc('shop')
    const expected = { hostId: 'shop', registerId: 'front', purpose: 'cashier' as const }
    expect(await resolvePosStaffAssertion(h.deps, hostRef, token, expected)).toBe('cashier')
    h.memberships['cashier'] = { ...h.memberships['cashier']!, permissions: { managePos: false } }
    expect(await resolvePosStaffAssertion(h.deps, hostRef, token, expected)).toBeNull()
    // …and the sale falls back to the member signed in on the device.
    expect(await resolvePosCashier(h.deps, { uid: 'owner', hostId: 'shop', hostRef }, 'front', token)).toEqual({
      cashierId: 'owner',
      via: 'session',
    })
    expect((await verify('cashier', '2580', {}, 'owner')).status).toBe(403)
  })

  it('mints a manager approval only for a workspace admin, for two minutes', async () => {
    expect((await verify('cashier', '2580', { purpose: 'manager' })).status).toBe(403)
    const manager = await verify('owner', '9137', { purpose: 'manager' })
    expect(manager.status).toBe(200)
    expect(manager.body['expiresAtMs']).toBe(h.clock.now + POS_MANAGER_ASSERTION_TTL_MS)
    expect(readPosAssertion(h.deps, manager.body['assertion'], { hostId: 'shop', registerId: 'front', purpose: 'cashier' })).toBeNull()
  })

  it("refuses another site's register", async () => {
    expect((await verify('cashier', '2580', { registerId: 'theirs' })).status).toBe(404)
  })

  it('needs the signing secret, and says so rather than minting an unsigned one', async () => {
    h.deps.signingSecret = () => {
      throw new Error('unset')
    }
    expect((await verify('cashier', '2580')).status).toBe(501)
    expect(() => mintPosAssertion(h.deps, { hostId: 'shop', registerId: 'front', memberUid: 'cashier', purpose: 'cashier' })).toThrow()
  })
})

describe('lockout', () => {
  it('locks after five wrong PINs, refuses the right one while locked, and lifts after the window', async () => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const wrong = await verify('cashier', '0000')
      expect(wrong.status).toBe(401)
      expect(wrong.body['attemptsLeft']).toBe(5 - attempt)
    }
    expect((await verify('cashier', '0000')).status).toBe(423)
    expect((await verify('cashier', '2580')).status).toBe(423)
    h.clock.now += POS_PIN_LOCKOUT_MS + 1
    expect((await verify('cashier', '2580')).status).toBe(200)
    expect(h.memory.read('hosts/shop/posStaffPins/cashier')?.['failedAttempts']).toBe(0)
  })

  it('a right PIN clears the count', async () => {
    await verify('cashier', '0000')
    await verify('cashier', '0000')
    expect((await verify('cashier', '2580')).status).toBe(200)
    for (let attempt = 0; attempt < 4; attempt += 1) expect((await verify('cashier', '0000')).status).toBe(401)
  })

  it('gives a burst of parallel guesses five tries, not five each', async () => {
    const guesses = await Promise.all(
      Array.from({ length: 12 }, (_unused, at) => verify('cashier', String(4000 + at))),
    )
    const checked = guesses.filter((guess) => guess.status === 401 || guess.status === 200).length
    expect(checked).toBeLessThanOrEqual(5)
    expect(guesses.some((guess) => guess.status === 423)).toBe(true)
  })

  it('a workspace admin resetting the PIN lifts the lockout', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await verify('cashier', '0000')
    await pin({ action: 'set', pin: '3691', memberUid: 'cashier' }, 'owner')
    expect((await verify('cashier', '3691')).status).toBe(200)
  })

  it('answers a member with no PIN as such', async () => {
    expect((await verify('cashier2', '2580')).status).toBe(404)
  })
})
