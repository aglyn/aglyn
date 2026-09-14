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
 * A member's own addresses, the Firestore half (AGL-2975), over an in-memory
 * store: an address is added unconfirmed for a member and nobody else; a
 * signed link confirms it only for the member who added it, only while the
 * entry it was sent for still stands, and only before it expires; removal
 * retires the links; the email names the link and is rate-limited before it
 * is sent. `@aglyn/aglyn` is REAL — the rules are the thing under test.
 */

const mockSendEmail = jest.fn()
const mockConsumeRateLimit = jest.fn()
const mockMeterOrgEmail = jest.fn()
let mockEmailConfigured = true

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => mockEmailConfigured,
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))
jest.mock('./rate-limit-store', () => ({
  __esModule: true,
  consumeRateLimit: (...args: unknown[]) => mockConsumeRateLimit(...args),
}))
jest.mock('./email-metering', () => ({
  __esModule: true,
  meterOrgEmail: (...args: unknown[]) => mockMeterOrgEmail(...args),
}))

import {
  addMemberEmailAlias,
  confirmMemberEmailAlias,
  listMemberEmailAliases,
  memberEmailAliasConfirmUrl,
  mintMemberEmailAliasToken,
  readMemberEmailAliasToken,
  removeMemberEmailAlias,
  sendMemberEmailAliasConfirmation,
} from './member-email-aliases'

// ---------------------------------------------------------------------------
// The store: documents, one collection read, and a transaction.
// ---------------------------------------------------------------------------

const store = new Map<string, Record<string, any>>()

const last = (path: string) => path.slice(path.lastIndexOf('/') + 1)

function snapshot(path: string) {
  const data = store.get(path)
  return { id: last(path), exists: data !== undefined, data: () => data }
}

function docRef(path: string): any {
  return {
    id: last(path),
    path,
    get: async () => snapshot(path),
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  return { path, doc: (id: string) => docRef(`${path}/${id}`) }
}

const firestore = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (tx: any) => Promise<unknown>) =>
    body({
      get: async (ref: { path: string }) => snapshot(ref.path),
      set: (ref: { path: string }, data: Record<string, any>) => {
        store.set(ref.path, structuredClone(data))
      },
      delete: (ref: { path: string }) => {
        store.delete(ref.path)
      },
    }),
} as unknown as FirebaseFirestore.Firestore

// ---------------------------------------------------------------------------

const ORG = 'org-1'
const AVERY = 'u-avery'
const KIM = 'u-kim'
const ALIASES = (uid: string) => `orgs/${ORG}/memberEmailAliases/${uid}`
const T0 = 1_757_300_000_000

const add = (address: unknown, uid = AVERY, nowMs = T0) =>
  addMemberEmailAlias(firestore, {
    orgId: ORG,
    uid,
    address,
    signInEmail: 'avery@example.com',
    reservedDomains: ['in.aglyn.com'],
    nowMs,
  })

beforeEach(() => {
  store.clear()
  process.env['TOKEN_SIGNING_SECRET'] = 'member-email-alias-spec-secret'
  mockEmailConfigured = true
  mockSendEmail.mockReset().mockResolvedValue({ sent: true, id: 'em_1' })
  mockConsumeRateLimit.mockReset().mockResolvedValue({ allowed: true })
  mockMeterOrgEmail.mockReset().mockResolvedValue(undefined)
  store.set(`orgs/${ORG}`, { name: 'Acme' })
  store.set(`orgs/${ORG}/members/${AVERY}`, { role: 'admin', email: 'avery@example.com' })
  store.set(`orgs/${ORG}/members/${KIM}`, { role: 'editor', email: 'kim@aglyn.com' })
})

describe('adding an address', () => {
  it('stores it unconfirmed, normalized, for a member of the workspace', async () => {
    expect(await add('  Avery@Example.ORG ')).toEqual({
      ok: true,
      alias: { address: 'avery@example.org', addedAtMs: T0 },
      created: true,
    })
    expect(store.get(ALIASES(AVERY))).toEqual({
      uid: AVERY,
      aliases: [{ address: 'avery@example.org', addedAtMs: T0 }],
      updatedAtMs: T0,
    })
    expect(await listMemberEmailAliases(firestore, ORG, AVERY)).toEqual([
      { address: 'avery@example.org', addedAtMs: T0 },
    ])
  })

  it('answers an unconfirmed address added again with the entry it already has', async () => {
    await add('avery@example.org', AVERY, T0)
    expect(await add('avery@example.org', AVERY, T0 + 5_000)).toEqual({
      ok: true,
      alias: { address: 'avery@example.org', addedAtMs: T0 },
      created: false,
    })
  })

  it('refuses somebody who is not a member, and writes nothing', async () => {
    expect(await add('avery@example.org', 'u-stranger')).toMatchObject({ ok: false, refusal: 'not-a-member' })
    expect(store.has(ALIASES('u-stranger'))).toBe(false)
  })

  it('refuses the sign-in address and a capture-domain address', async () => {
    expect(await add('AVERY@example.com')).toMatchObject({ ok: false, refusal: 'sign-in-address' })
    expect(await add('crm+abc@in.aglyn.com')).toMatchObject({ ok: false, refusal: 'reserved-domain' })
    expect(store.has(ALIASES(AVERY))).toBe(false)
  })
})

describe('the confirmation link', () => {
  const claims = { orgId: ORG, uid: AVERY, address: 'avery@example.org', addedAtMs: T0 }

  it('carries what it was minted for, and nothing once tampered with', () => {
    const token = mintMemberEmailAliasToken(claims, T0)
    expect(readMemberEmailAliasToken(token, T0 + 1)).toEqual({
      ok: true,
      claims: { ...claims, exp: T0 + 24 * 60 * 60 * 1000 },
    })
    const [version, payload, signed] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ o: ORG, u: KIM, a: 'avery@example.org', t: T0, e: T0 + 1e9 }),
    ).toString('base64url')
    expect(readMemberEmailAliasToken(`${version}.${forged}.${signed}`, T0)).toMatchObject({
      refusal: 'token-invalid',
    })
    expect(readMemberEmailAliasToken(`mea0.${payload}.${signed}`, T0)).toMatchObject({
      refusal: 'token-invalid',
    })
    expect(readMemberEmailAliasToken(42, T0)).toMatchObject({ refusal: 'token-invalid' })
  })

  it('expires after a day', () => {
    const token = mintMemberEmailAliasToken(claims, T0)
    expect(readMemberEmailAliasToken(token, T0 + 24 * 60 * 60 * 1000)).toMatchObject({
      refusal: 'token-expired',
    })
  })

  it('proves nothing on a deployment with no signing secret, and cannot be minted there', () => {
    const token = mintMemberEmailAliasToken(claims, T0)
    delete process.env['TOKEN_SIGNING_SECRET']
    expect(readMemberEmailAliasToken(token, T0)).toMatchObject({ refusal: 'token-invalid' })
    expect(() => mintMemberEmailAliasToken(claims, T0)).toThrow('TOKEN_SIGNING_SECRET')
  })

  it('is the console origin, the page the address was added on, and the token', () => {
    expect(
      memberEmailAliasConfirmUrl({
        origin: 'https://app.aglyn.com/',
        returnPath: '/acme/crm/settings',
        token: 'mea1.abc.def',
      }),
    ).toBe('https://app.aglyn.com/acme/crm/settings?confirmEmailAlias=mea1.abc.def')
  })

  it.each(['//attacker.example/x', 'https://attacker.example', '/\\attacker.example', '/a?b=c', '', 7])(
    'lands on the console root for a return path of %p',
    (returnPath) => {
      expect(
        memberEmailAliasConfirmUrl({ origin: 'https://app.aglyn.com', returnPath, token: 't' }),
      ).toBe('https://app.aglyn.com/?confirmEmailAlias=t')
    },
  )
})

describe('confirming an address', () => {
  const tokenFor = async (address = 'avery@example.org') => {
    const added = await add(address)
    if (added.ok === false) throw new Error(added.message)
    return mintMemberEmailAliasToken(
      { orgId: ORG, uid: AVERY, address: added.alias.address, addedAtMs: added.alias.addedAtMs },
      T0,
    )
  }

  it('confirms it for the member who added it', async () => {
    const token = await tokenFor()
    expect(await confirmMemberEmailAlias(firestore, { token, callerUid: AVERY, nowMs: T0 + 60_000 })).toEqual({
      ok: true,
      orgId: ORG,
      address: 'avery@example.org',
      alreadyConfirmed: false,
    })
    expect(store.get(ALIASES(AVERY))?.['aliases']).toEqual([
      { address: 'avery@example.org', addedAtMs: T0, verifiedAtMs: T0 + 60_000 },
    ])
    // Opening the link again is not an error, and moves nothing.
    expect(
      await confirmMemberEmailAlias(firestore, { token, callerUid: AVERY, nowMs: T0 + 120_000 }),
    ).toMatchObject({ ok: true, alreadyConfirmed: true })
    expect(store.get(ALIASES(AVERY))?.['aliases'][0].verifiedAtMs).toBe(T0 + 60_000)
  })

  it('refuses whoever else opens it — the mailbox is not the member — and writes nothing', async () => {
    const token = await tokenFor()
    expect(await confirmMemberEmailAlias(firestore, { token, callerUid: KIM, nowMs: T0 })).toMatchObject({
      ok: false,
      refusal: 'wrong-member',
    })
    expect(await confirmMemberEmailAlias(firestore, { token, callerUid: '', nowMs: T0 })).toMatchObject({
      refusal: 'wrong-member',
    })
    expect(store.get(ALIASES(AVERY))?.['aliases'][0].verifiedAtMs).toBeUndefined()
  })

  it('retires a link once its address is removed, even after the address is added again', async () => {
    const stale = await tokenFor()
    await removeMemberEmailAlias(firestore, { orgId: ORG, uid: AVERY, address: 'avery@example.org', nowMs: T0 + 1 })
    expect(await confirmMemberEmailAlias(firestore, { token: stale, callerUid: AVERY, nowMs: T0 + 2 })).toMatchObject({
      refusal: 'link-retired',
    })
    await add('avery@example.org', AVERY, T0 + 3)
    expect(await confirmMemberEmailAlias(firestore, { token: stale, callerUid: AVERY, nowMs: T0 + 4 })).toMatchObject({
      refusal: 'link-retired',
    })
    expect(store.get(ALIASES(AVERY))?.['aliases'][0].verifiedAtMs).toBeUndefined()
  })

  it('refuses a member who has since left the workspace', async () => {
    const token = await tokenFor()
    store.delete(`orgs/${ORG}/members/${AVERY}`)
    expect(await confirmMemberEmailAlias(firestore, { token, callerUid: AVERY, nowMs: T0 })).toMatchObject({
      refusal: 'not-a-member',
    })
  })
})

describe('removing an address', () => {
  it('removes one entry, and the document with the last one', async () => {
    await add('avery@example.org', AVERY, T0)
    await add('outreach@aglyn.io', AVERY, T0 + 1)
    expect(
      await removeMemberEmailAlias(firestore, { orgId: ORG, uid: AVERY, address: ' AVERY@example.org', nowMs: T0 + 2 }),
    ).toEqual({ ok: true, removed: { address: 'avery@example.org', addedAtMs: T0 } })
    expect(store.get(ALIASES(AVERY))?.['aliases']).toEqual([
      { address: 'outreach@aglyn.io', addedAtMs: T0 + 1 },
    ])
    await removeMemberEmailAlias(firestore, { orgId: ORG, uid: AVERY, address: 'outreach@aglyn.io' })
    expect(store.has(ALIASES(AVERY))).toBe(false)
  })

  it('refuses an address that is not on the list', async () => {
    expect(
      await removeMemberEmailAlias(firestore, { orgId: ORG, uid: AVERY, address: 'nobody@aglyn.io' }),
    ).toMatchObject({ ok: false, refusal: 'unknown-address' })
    expect(
      await removeMemberEmailAlias(firestore, { orgId: ORG, uid: AVERY, address: 'nope' }),
    ).toMatchObject({ ok: false, refusal: 'invalid-address' })
  })
})

describe('the confirmation email', () => {
  const send = () =>
    sendMemberEmailAliasConfirmation({
      orgId: ORG,
      org: { name: 'Acme' },
      uid: AVERY,
      memberName: 'Avery Quinn',
      address: 'avery@example.org',
      confirmUrl: 'https://app.aglyn.com/acme/crm/settings?confirmEmailAlias=t',
    })

  it('sends the link to the address, names the member and the workspace, and meters the workspace', async () => {
    expect(await send()).toEqual({ sent: true })
    expect(mockConsumeRateLimit.mock.calls.map(([key]) => key)).toEqual([
      `member-email-alias-confirm:${AVERY}`,
      'member-email-alias-target:avery@example.org',
    ])
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const [options] = mockSendEmail.mock.calls[0]
    expect(options).toMatchObject({
      to: 'avery@example.org',
      subject: 'Confirm your address for Acme',
      context: 'member-email-alias-confirmation',
    })
    expect(options.text).toContain('https://app.aglyn.com/acme/crm/settings?confirmEmailAlias=t')
    expect(options.text).toContain('Avery Quinn asked to add avery@example.org')
    expect(options.text).toContain('signed in as Avery Quinn')
    expect(options).not.toHaveProperty('from')
    expect(mockMeterOrgEmail).toHaveBeenCalledWith(ORG)
  })

  it('refuses past either rate limit before anything is sent', async () => {
    mockConsumeRateLimit.mockResolvedValueOnce({ allowed: false })
    expect(await send()).toMatchObject({ sent: false, status: 429 })
    mockConsumeRateLimit.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false })
    expect(await send()).toMatchObject({ sent: false, status: 429 })
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockMeterOrgEmail).not.toHaveBeenCalled()
  })

  it('answers 501 with no mail configured and 502 for a send that failed, metering neither', async () => {
    mockEmailConfigured = false
    expect(await send()).toMatchObject({ sent: false, status: 501 })
    mockEmailConfigured = true
    mockSendEmail.mockResolvedValueOnce({ sent: false, reason: 'provider-error' })
    expect(await send()).toMatchObject({ sent: false, status: 502 })
    expect(mockMeterOrgEmail).not.toHaveBeenCalled()
  })
})
