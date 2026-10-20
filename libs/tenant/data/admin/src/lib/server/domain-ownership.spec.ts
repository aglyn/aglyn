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
 * Website ownership claims (AGL-3974): the three proofs, the three answers,
 * and the emailed code's hash, clock and attempt limit. DNS, the home-page
 * read and the mail are replaced at their seams; Firestore is an in-memory
 * store with a transaction.
 */

const mockSendEmail = jest.fn(async (..._args: unknown[]) => ({ sent: true }))
const mockConsumeRateLimit = jest.fn(async (..._args: unknown[]) => ({ allowed: true }))
const mockMeterOrgEmail = jest.fn(async (..._args: unknown[]) => undefined)
const mockRenderSystemEmailContent = jest.fn(
  async (_key: string, _merge: Record<string, string>, _brand: unknown, fallback: { subject: string; text: string }) => ({
    subject: fallback.subject,
    text: fallback.text,
  }),
)

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
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
jest.mock('./render-system-email', () => ({
  __esModule: true,
  renderSystemEmailContent: (...args: Parameters<typeof mockRenderSystemEmailContent>) =>
    mockRenderSystemEmailContent(...args),
  systemEmailBrand: () => ({ merge: {}, options: {} }),
}))
jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => ({}) }) },
}))

import { SYSTEM_EMAIL_TEMPLATES } from '@aglyn/shared-util-email/system-email-catalog'
import {
  checkDomainOwnership,
  confirmDomainOwnershipCode,
  deliverDomainOwnershipCode,
  DOMAIN_OWNERSHIP_CODE_EMAIL_KEY,
  DOMAIN_OWNERSHIP_CODE_MAX_ATTEMPTS,
  DOMAIN_OWNERSHIP_CODE_TTL_MS,
  DOMAIN_OWNERSHIP_PROOF_MAX_AGE_MS,
  hashOwnershipCode,
  isDomainOwnershipProven,
  issueDomainOwnershipClaim,
  listDomainOwnershipClaims,
  normalizeOwnershipDomain,
  ownershipEmailAddress,
  sendDomainOwnershipCode,
  type DomainOwnershipClaimDoc,
  type DomainOwnershipDeps,
} from './domain-ownership'

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

const store = new Map<string, Record<string, unknown>>()

function docRef(path: string): any {
  return {
    path,
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    set: async (data: Record<string, unknown>) => {
      store.set(path, JSON.parse(JSON.stringify(data)))
    },
  }
}

function collectionRef(path: string): any {
  return {
    doc: (id: string) => ({ ...docRef(`${path}/${id}`), collection: (name: string) => collectionRef(`${path}/${id}/${name}`) }),
    get: async () => ({
      docs: [...store.entries()]
        .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .map(([, data]) => ({ data: () => data })),
    }),
  }
}

const firestore: any = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (fn: (tx: any) => Promise<unknown>) =>
    fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, data: Record<string, unknown>) => {
        store.set(ref.path, JSON.parse(JSON.stringify(data)))
      },
    }),
}

const ORG = 'org-1'
const PATH = `orgs/${ORG}/domainOwnershipClaims/rosies-bakery.com`
let clock = 1_000_000
let lookupTxt: jest.Mock
let readVerificationMeta: jest.Mock
let deliverCode: jest.Mock

function deps(extra: Partial<DomainOwnershipDeps> = {}): DomainOwnershipDeps {
  return {
    firestore,
    lookupTxt,
    readVerificationMeta,
    deliverCode,
    now: () => clock,
    secret: () => 'test-secret',
    mintToken: () => 'tok-abc',
    mintCode: () => '042917',
    ...extra,
  }
}

const stored = () => store.get(PATH) as unknown as DomainOwnershipClaimDoc

beforeEach(() => {
  store.clear()
  clock = 1_000_000
  lookupTxt = jest.fn(async () => ({ answered: true, records: [] as string[] }))
  readVerificationMeta = jest.fn(async () => ({ answered: true, values: [] as string[] }))
  deliverCode = jest.fn(async () => ({ sent: true }))
  mockSendEmail.mockClear()
  mockConsumeRateLimit.mockClear()
  mockConsumeRateLimit.mockImplementation(async () => ({ allowed: true }))
})

// ---------------------------------------------------------------------------

describe('normalizeOwnershipDomain', () => {
  it('reduces what a person pastes to the site’s domain, www folded in', () => {
    for (const input of [
      'rosies-bakery.com',
      'https://www.Rosies-Bakery.com/about?x=1',
      'WWW.rosies-bakery.com.',
      'rosies-bakery.com:443',
    ]) {
      expect(normalizeOwnershipDomain(input)).toEqual({ domain: 'rosies-bakery.com', error: null })
    }
  })

  it('refuses something that is not a domain, a mailbox provider and a brand lookalike', () => {
    expect(normalizeOwnershipDomain('localhost').domain).toBeNull()
    expect(normalizeOwnershipDomain('gmail.com').domain).toBeNull()
    expect(normalizeOwnershipDomain('paypal-account-verify.com').domain).toBeNull()
  })
})

describe('issueDomainOwnershipClaim', () => {
  it('stores a pending claim per (org, domain) and shows all three ways to prove it', async () => {
    const { claim } = await issueDomainOwnershipClaim(ORG, 'www.rosies-bakery.com', 'uid-1', deps())
    expect(stored()).toMatchObject({ domain: 'rosies-bakery.com', token: 'tok-abc', status: 'pending', createdBy: 'uid-1' })
    expect(claim).toMatchObject({
      domain: 'rosies-bakery.com',
      status: 'pending',
      current: false,
      dns: { host: '_aglyn-challenge.rosies-bakery.com', type: 'TXT', value: 'aglyn-domain-verification=tok-abc' },
      meta: { tag: '<meta name="aglyn-site-verification" content="tok-abc">' },
      email: { domain: 'rosies-bakery.com', pendingAddress: null },
    })
  })

  it('is idempotent: a second call keeps the token the person may already have published', async () => {
    await issueDomainOwnershipClaim(ORG, 'rosies-bakery.com', 'uid-1', deps())
    const { claim } = await issueDomainOwnershipClaim(ORG, 'rosies-bakery.com', 'uid-2', deps({ mintToken: () => 'other' }))
    expect(claim?.meta.content).toBe('tok-abc')
    expect(stored().createdBy).toBe('uid-1')
  })

  it('lets a second org hold its own claim on the same domain', async () => {
    await issueDomainOwnershipClaim(ORG, 'rosies-bakery.com', 'uid-1', deps())
    await issueDomainOwnershipClaim('org-2', 'rosies-bakery.com', 'uid-9', deps({ mintToken: () => 'tok-2' }))
    expect(store.get('orgs/org-2/domainOwnershipClaims/rosies-bakery.com')).toMatchObject({ token: 'tok-2' })
    expect(stored().token).toBe('tok-abc')
  })
})

describe('the DNS proof', () => {
  beforeEach(() => issueDomainOwnershipClaim(ORG, 'rosies-bakery.com', 'uid-1', deps()))

  it('is proven by the exact record, looked up at the challenge host', async () => {
    lookupTxt.mockResolvedValue({ answered: true, records: ['v=spf1 -all', 'aglyn-domain-verification=tok-abc'] })
    const { result } = await checkDomainOwnership(ORG, 'rosies-bakery.com', 'dns', deps())
    expect(lookupTxt).toHaveBeenCalledWith('_aglyn-challenge.rosies-bakery.com')
    expect(result?.status).toBe('proven')
    expect(stored()).toMatchObject({ status: 'proven', provenMethod: 'dns', provenAt: clock })
    expect(await isDomainOwnershipProven(ORG, 'rosies-bakery.com', deps())).toBe(true)
  })

  it('is not yet proven by a record that only starts the same way', async () => {
    lookupTxt.mockResolvedValue({ answered: true, records: ['aglyn-domain-verification=tok-abc-and-more'] })
    const { result } = await checkDomainOwnership(ORG, 'rosies-bakery.com', 'dns', deps())
    expect(result?.status).toBe('not-yet')
    expect(stored().status).toBe('pending')
  })

  it('answers unreachable when DNS did not answer, and never demotes a proof already made', async () => {
    lookupTxt.mockResolvedValueOnce({ answered: true, records: ['aglyn-domain-verification=tok-abc'] })
    await checkDomainOwnership(ORG, 'rosies-bakery.com', 'dns', deps())
    lookupTxt.mockResolvedValueOnce({ answered: false, records: [] })
    const { result } = await checkDomainOwnership(ORG, 'rosies-bakery.com', 'dns', deps())
    expect(result?.status).toBe('unreachable')
    expect(stored()).toMatchObject({ status: 'proven', lastChecks: { dns: 'unreachable' } })
    lookupTxt.mockRejectedValueOnce(new Error('resolver crashed'))
    expect((await checkDomainOwnership(ORG, 'rosies-bakery.com', 'dns', deps())).result?.status).toBe('unreachable')
  })

  it('refuses a check on a domain with no claim', async () => {
    const { result, error } = await checkDomainOwnership(ORG, 'unclaimed.com', 'dns', deps())
    expect(result).toBeNull()
    expect(error).toMatch(/Add the site first/)
  })
})

describe('the meta-tag proof', () => {
  beforeEach(() => issueDomainOwnershipClaim(ORG, 'rosies-bakery.com', 'uid-1', deps()))

  it('is proven by the tag on the home page, and records where it was read', async () => {
    readVerificationMeta.mockResolvedValue({ answered: true, values: ['tok-abc'], url: 'https://www.rosies-bakery.com/' })
    const { result } = await checkDomainOwnership(ORG, 'rosies-bakery.com', 'meta', deps())
    expect(readVerificationMeta).toHaveBeenCalledWith('rosies-bakery.com')
    expect(result?.status).toBe('proven')
    expect(stored()).toMatchObject({ provenMethod: 'meta', provenDetail: 'https://www.rosies-bakery.com/' })
  })

  it('is not yet proven by another token, and unreachable when the page could not be read', async () => {
    readVerificationMeta.mockResolvedValueOnce({ answered: true, values: ['someone-elses-token'] })
    expect((await checkDomainOwnership(ORG, 'rosies-bakery.com', 'meta', deps())).result?.status).toBe('not-yet')
    readVerificationMeta.mockResolvedValueOnce({ answered: false, values: [] })
    expect((await checkDomainOwnership(ORG, 'rosies-bakery.com', 'meta', deps())).result?.status).toBe('unreachable')
    expect(
      (await checkDomainOwnership(ORG, 'rosies-bakery.com', 'meta', deps({ readVerificationMeta: undefined }))).result
        ?.status,
    ).toBe('unreachable')
    expect(stored().status).toBe('pending')
  })
})

describe('the emailed code', () => {
  beforeEach(() => issueDomainOwnershipClaim(ORG, 'rosies-bakery.com', 'uid-1', deps()))
  const org = { name: 'Rosie’s' }

  it('goes only to an address at the domain itself', async () => {
    for (const address of ['owner@gmail.com', 'owner@rosies-bakery.com.evil.test', 'owner@shop.rosies-bakery.com', 'not-an-address']) {
      const sent = await sendDomainOwnershipCode(ORG, 'rosies-bakery.com', address, { org }, deps())
      expect(sent.status).toBe(400)
    }
    expect(deliverCode).not.toHaveBeenCalled()
    expect(ownershipEmailAddress('Owner@WWW.Rosies-Bakery.com', 'rosies-bakery.com')).toBe('owner@www.rosies-bakery.com')
  })

  it('is stored as an HMAC under the secret, never as the code', async () => {
    const sent = await sendDomainOwnershipCode(ORG, 'rosies-bakery.com', 'owner@rosies-bakery.com', { org }, deps())
    expect(sent.status).toBe(200)
    expect(deliverCode).toHaveBeenCalledWith(
      expect.objectContaining({ address: 'owner@rosies-bakery.com', code: '042917', domain: 'rosies-bakery.com', expiresInMinutes: 15 }),
    )
    const code = stored().emailCode
    expect(JSON.stringify(stored())).not.toContain('042917')
    expect(code?.hash).toBe(
      hashOwnershipCode('test-secret', { orgId: ORG, domain: 'rosies-bakery.com', address: 'owner@rosies-bakery.com', code: '042917' }),
    )
    expect(code?.hash).not.toBe(
      hashOwnershipCode('another-secret', { orgId: ORG, domain: 'rosies-bakery.com', address: 'owner@rosies-bakery.com', code: '042917' }),
    )
    expect(sent.claim?.email).toMatchObject({ pendingAddress: 'owner@rosies-bakery.com', attemptsLeft: DOMAIN_OWNERSHIP_CODE_MAX_ATTEMPTS })
  })

  it('proves the domain with the right code, once', async () => {
    await sendDomainOwnershipCode(ORG, 'rosies-bakery.com', 'owner@rosies-bakery.com', { org }, deps())
    const { result } = await confirmDomainOwnershipCode(ORG, 'rosies-bakery.com', ' 042 917 ', deps())
    expect(result?.status).toBe('proven')
    expect(stored()).toMatchObject({ status: 'proven', provenMethod: 'email', provenDetail: 'owner@rosies-bakery.com', emailCode: null })
    // Used: the same code proves nothing a second time.
    expect((await confirmDomainOwnershipCode(ORG, 'rosies-bakery.com', '042917', deps())).result?.message).toMatch(/Send a code first/)
  })

  it('is burned after the attempt limit, even with the right code after', async () => {
    await sendDomainOwnershipCode(ORG, 'rosies-bakery.com', 'owner@rosies-bakery.com', { org }, deps())
    for (let attempt = 1; attempt <= DOMAIN_OWNERSHIP_CODE_MAX_ATTEMPTS; attempt += 1) {
      const { result } = await confirmDomainOwnershipCode(ORG, 'rosies-bakery.com', '111111', deps())
      expect(result?.status).toBe('not-yet')
    }
    const { result } = await confirmDomainOwnershipCode(ORG, 'rosies-bakery.com', '042917', deps())
    expect(result?.status).toBe('not-yet')
    expect(result?.message).toMatch(/expired/)
    expect(stored().status).toBe('pending')
  })

  it('expires after its time', async () => {
    await sendDomainOwnershipCode(ORG, 'rosies-bakery.com', 'owner@rosies-bakery.com', { org }, deps())
    clock += DOMAIN_OWNERSHIP_CODE_TTL_MS + 1
    const { result } = await confirmDomainOwnershipCode(ORG, 'rosies-bakery.com', '042917', deps())
    expect(result?.status).toBe('not-yet')
    expect(stored().status).toBe('pending')
  })

  it('waits a minute between codes, and reports a mail that could not be sent', async () => {
    await sendDomainOwnershipCode(ORG, 'rosies-bakery.com', 'owner@rosies-bakery.com', { org }, deps())
    expect((await sendDomainOwnershipCode(ORG, 'rosies-bakery.com', 'owner@rosies-bakery.com', { org }, deps())).status).toBe(429)
    clock += 61_000
    deliverCode.mockResolvedValueOnce({ sent: false, status: 502, error: 'The code could not be sent. Try again.' })
    const failed = await sendDomainOwnershipCode(ORG, 'rosies-bakery.com', 'owner@rosies-bakery.com', { org }, deps())
    expect(failed).toMatchObject({ status: 502, claim: null })
  })
})

describe('deliverDomainOwnershipCode', () => {
  const input = { orgId: ORG, org: { name: 'Rosie’s' }, domain: 'rosies-bakery.com', address: 'owner@rosies-bakery.com', code: '042917', expiresInMinutes: 15 }

  it('sends the catalog email, with the code in the merge, under both rate ceilings', async () => {
    expect(await deliverDomainOwnershipCode(input)).toEqual({ sent: true })
    expect(mockConsumeRateLimit.mock.calls.map((call) => call[0])).toEqual([
      `domain-ownership-code:${ORG}`,
      'domain-ownership-code-target:owner@rosies-bakery.com',
    ])
    expect(mockRenderSystemEmailContent).toHaveBeenCalledWith(
      DOMAIN_OWNERSHIP_CODE_EMAIL_KEY,
      expect.objectContaining({ code: '042917', domain: 'rosies-bakery.com', 'org.name': 'Rosie’s' }),
      expect.anything(),
      expect.objectContaining({ subject: 'Your code to verify rosies-bakery.com' }),
    )
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@rosies-bakery.com', context: DOMAIN_OWNERSHIP_CODE_EMAIL_KEY }),
    )
    expect(SYSTEM_EMAIL_TEMPLATES.some((template) => template.key === DOMAIN_OWNERSHIP_CODE_EMAIL_KEY)).toBe(true)
  })

  it('refuses past a ceiling without sending', async () => {
    mockConsumeRateLimit.mockResolvedValueOnce({ allowed: false })
    expect(await deliverDomainOwnershipCode(input)).toMatchObject({ sent: false, status: 429 })
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

describe('a proof’s age', () => {
  it('stops counting after the maximum age, and the list shows it', async () => {
    await issueDomainOwnershipClaim(ORG, 'rosies-bakery.com', 'uid-1', deps())
    lookupTxt.mockResolvedValue({ answered: true, records: ['aglyn-domain-verification=tok-abc'] })
    await checkDomainOwnership(ORG, 'rosies-bakery.com', 'dns', deps())
    clock += DOMAIN_OWNERSHIP_PROOF_MAX_AGE_MS + 1
    expect(await isDomainOwnershipProven(ORG, 'rosies-bakery.com', deps())).toBe(false)
    const [view] = await listDomainOwnershipClaims(ORG, deps())
    expect(view).toMatchObject({ status: 'proven', current: false })
    expect(JSON.stringify(view)).not.toContain('hash')
  })
})
