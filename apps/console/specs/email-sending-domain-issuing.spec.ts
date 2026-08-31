/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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

/**
 * Asking the provider for a signing key, and what the route says when nobody
 * answered.
 *
 * The store is faked here and its real behavior is proven in
 * `sending-domains.spec.ts`; what this file is about is the WIRING — which
 * store call the orchestrator makes for each provider outcome, and whether a
 * request reaches the network at all.
 *
 * `fetch` is guarded rather than mocked permissively: every case in this file
 * expects either a Resend call it stubs or NO call whatsoever, and a request
 * to anything else throws. The unconfigured path is the one that matters
 * most — a deployment with no issuing credential must not make a request,
 * must not throw, and must not claim to have issued anything.
 */

const DOMAIN = 'acme.com'
const PUBLIC_KEY = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCexamplekeymaterial'
const KEY = 're_domains_notarealkey_0123456789abcdef'

const mockRecordIssued = jest.fn()
const mockRecordFailure = jest.fn()

jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
  checkEntitlement: () => true,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    const raw = await request.text().catch(() => '')
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      body: raw ? JSON.parse(raw) : {},
      headers: Object.fromEntries(request.headers.entries()),
    }
  },
}))

/**
 * The record a fresh claim produces, mirroring `requestSendingDomain`: status
 * `requested`, a proposed per-org selector, and NO key — because issuing one
 * needs a credential this deployment may not have.
 */
const requestedRecord = () => ({
  domain: DOMAIN,
  status: 'requested',
  dkimSelector: 'aglyn-org1',
  dkimPublicKey: null,
  returnPathHost: null,
  createdAtMs: 1_756_000_000_000,
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'uid-1', email_verified: true }),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({ plan: 'agency' }),
              get: (field: string) => (field === 'role' ? 'owner' : undefined),
            }),
            collection: () => ({
              doc: () => ({
                get: async () => ({
                  exists: true,
                  get: (field: string) => (field === 'role' ? 'owner' : undefined),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  lockdownRefusal: async () => null,
  listSendingDomains: async () => [],
  readDmarcPolicy: async () => null,
  releaseSendingDomain: async () => undefined,
  requestSendingDomain: async () => ({
    record: requestedRecord(),
    error: null,
    status: 201,
  }),
  verifySendingDomain: async () => ({}),
  recordIssuedSendingDomain: (...args: unknown[]) => mockRecordIssued(...args),
  recordSendingDomainIssueFailure: (...args: unknown[]) => mockRecordFailure(...args),
}))

import { resolveSendingIdentity } from '@aglyn/shared-util-email'
import { issueSendingDomainRecords } from '../utils/server/issue-sending-domain'
import { POST } from '../app/api/email/sending-domains/route'

let stubbed: { ok: boolean; status: number; json: unknown }[] = []
let calls: string[] = []

function installFetchGuard() {
  global.fetch = jest.fn(async (url: any, init: any) => {
    const target = String(url)
    if (!target.startsWith('https://api.resend.com/')) {
      throw new Error(`Blocked outbound request in a spec: ${target}`)
    }
    calls.push(`${init?.method ?? 'GET'} ${target}`)
    const next = stubbed.shift()
    if (!next) throw new Error(`No stubbed response for ${target}`)
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.json,
      text: async () => JSON.stringify(next.json),
    }
  }) as unknown as typeof fetch
}

const originalFetch = global.fetch
const originalEnv = { ...process.env }

beforeEach(() => {
  calls = []
  stubbed = []
  mockRecordIssued.mockReset()
  mockRecordFailure.mockReset()
  mockRecordIssued.mockResolvedValue({ record: null, error: null, status: 200 })
  mockRecordFailure.mockResolvedValue(undefined)
  installFetchGuard()
  delete process.env.RESEND_DOMAINS_API_KEY
  delete process.env.AGLYN_SENDING_DOMAIN_PROVIDER
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  global.fetch = originalFetch
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://app.aglyn.com/api/email/sending-domains', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: JSON.stringify(body),
    }),
  )

/*==========================================
  Requirement 1 — no credential is an honest refusal
==========================================*/

describe('with no issuing credential — the state this deployment is in', () => {
  it('leaves the domain at `requested` and calls nobody', async () => {
    const result = await issueSendingDomainRecords({
      orgId: 'org-1',
      record: requestedRecord() as never,
    })

    expect(result.outcome).toBe('skipped')
    expect(result.record.status).toBe('requested')
    expect(result.record.dkimPublicKey).toBeNull()
    expect(calls).toEqual([])
    expect(mockRecordIssued).not.toHaveBeenCalled()
    expect(mockRecordFailure).not.toHaveBeenCalled()
  })

  it('the route answers `pendingProvider` with an unpublishable DKIM row', async () => {
    const payload = await (await post({ orgId: 'org-1', domain: DOMAIN })).json()

    expect(payload.status).toBe('requested')
    expect(payload.pendingProvider).toBe(true)
    expect(payload.providerDetail).toBe('unconfigured')
    // The row is present so the customer can see what is coming, and empty so
    // nothing can be published or verified against it.
    const dkim = payload.records.find((entry: { purpose: string }) => entry.purpose === 'dkim')
    expect(dkim.value).toBe('')
    expect(calls).toEqual([])
  })

  /**
   * The end of the chain, and the property the whole feature is arranged
   * around: a domain with no key does not fall back to the platform identity.
   * Asserted against the real decision function, not a restatement of it.
   */
  it('refuses the send rather than quietly using the shared domain', () => {
    const verdict = resolveSendingIdentity({
      selection: { domain: DOMAIN, status: 'requested', localPart: 'hello' },
      platformFrom: 'noreply@aglyn.com',
    })

    expect(verdict.from).toBeNull()
    expect(verdict.refusal.code).toBe('domain-unverified')
  })
})

/*==========================================
  A configured provider
==========================================*/

describe('with a credential', () => {
  const resendPayload = (overrides: Record<string, unknown> = {}) => ({
    id: 'domain-id-1',
    name: DOMAIN,
    records: [
      { record: 'DKIM', name: 'resend._domainkey', type: 'TXT', value: `p=${PUBLIC_KEY}` },
    ],
    ...overrides,
  })

  beforeEach(() => {
    process.env.RESEND_DOMAINS_API_KEY = KEY
  })

  it('stores what the provider issued, and nothing it did not', async () => {
    stubbed = [{ ok: true, status: 200, json: resendPayload() }]
    mockRecordIssued.mockResolvedValue({
      record: { ...requestedRecord(), status: 'records-issued', dkimPublicKey: PUBLIC_KEY },
      error: null,
      status: 200,
    })

    const result = await issueSendingDomainRecords({
      orgId: 'org-1',
      record: requestedRecord() as never,
    })

    expect(result.outcome).toBe('issued')
    expect(mockRecordIssued).toHaveBeenCalledWith({
      orgId: 'org-1',
      domain: DOMAIN,
      dkimPublicKey: PUBLIC_KEY,
      dkimSelector: 'resend',
      providerDomainId: 'domain-id-1',
    })
    // The return path is OURS — `sendingReturnPathHost()` — so nothing from
    // the provider's own SPF guidance is copied onto the record.
    expect(mockRecordIssued.mock.calls[0][0]).not.toHaveProperty('returnPathHost')
  })

  /*========================================
    Requirement 3 — a failure corrupts nothing
  ========================================*/

  it('writes a reason and NEVER a status when the provider refuses', async () => {
    stubbed = [{ ok: false, status: 403, json: { name: 'restricted_api_key' } }]

    const result = await issueSendingDomainRecords({
      orgId: 'org-1',
      record: requestedRecord() as never,
    })

    expect(result.outcome).toBe('failed')
    expect(result.record.status).toBe('requested')
    expect(mockRecordIssued).not.toHaveBeenCalled()
    expect(mockRecordFailure).toHaveBeenCalledWith({
      orgId: 'org-1',
      domain: DOMAIN,
      detail: 'http-403:restricted_api_key',
    })
  })

  it('treats a driver that reports success with no key as a failure', async () => {
    // A `records-issued` with an empty DKIM row is the state this feature
    // exists to prevent, so the outcome alone is never trusted.
    stubbed = [{ ok: true, status: 200, json: resendPayload({ records: [] }) }]

    const result = await issueSendingDomainRecords({
      orgId: 'org-1',
      record: requestedRecord() as never,
    })

    expect(result.outcome).toBe('failed')
    expect(mockRecordIssued).not.toHaveBeenCalled()
    expect(mockRecordFailure).toHaveBeenCalled()
  })

  it('records a reason when the provider issued a key the store would not take', async () => {
    stubbed = [{ ok: true, status: 200, json: resendPayload() }]
    mockRecordIssued.mockResolvedValue({
      record: requestedRecord(),
      error: 'That domain already has an issued signing key.',
      status: 409,
    })

    const result = await issueSendingDomainRecords({
      orgId: 'org-1',
      record: requestedRecord() as never,
    })

    expect(result.outcome).toBe('failed')
    expect(result.record.status).toBe('requested')
    expect(mockRecordFailure).toHaveBeenCalledWith({
      orgId: 'org-1',
      domain: DOMAIN,
      detail: 'store-409',
    })
  })

  /*========================================
    Requirement 5 — idempotency
  ========================================*/

  it('does not call the provider at all for a domain that already has a key', async () => {
    const issued = { ...requestedRecord(), status: 'records-issued', dkimPublicKey: PUBLIC_KEY }

    const result = await issueSendingDomainRecords({
      orgId: 'org-1',
      record: issued as never,
    })

    expect(result.outcome).toBe('already-exists')
    expect(result.record.dkimPublicKey).toBe(PUBLIC_KEY)
    // No round trip, and nothing that could overwrite a published record.
    expect(calls).toEqual([])
    expect(mockRecordIssued).not.toHaveBeenCalled()
  })

  it('adopts the domain the provider already holds, creating no second one', async () => {
    stubbed = [
      { ok: false, status: 422, json: { name: 'validation_error' } },
      { ok: true, status: 200, json: { data: [{ id: 'domain-id-1', name: DOMAIN }] } },
      { ok: true, status: 200, json: resendPayload() },
    ]

    const result = await issueSendingDomainRecords({
      orgId: 'org-1',
      record: requestedRecord() as never,
    })

    expect(result.outcome).toBe('already-exists')
    expect(calls.filter((call) => call.startsWith('POST'))).toHaveLength(1)
    expect(mockRecordIssued).toHaveBeenCalledWith(
      expect.objectContaining({ dkimPublicKey: PUBLIC_KEY, providerDomainId: 'domain-id-1' }),
    )
  })

  /*========================================
    Requirement 6 — nothing carries the credential
  ========================================*/

  it('puts no part of the credential into what the route returns', async () => {
    stubbed = [
      {
        ok: false,
        status: 401,
        json: { name: 'missing_api_key', message: `rejected Bearer ${KEY}` },
      },
    ]

    const response = await post({ orgId: 'org-1', domain: DOMAIN })
    const body = await response.text()

    expect(body).not.toContain(KEY)
    expect(body).not.toContain('notarealkey')
    expect(JSON.parse(body).providerDetail).toBe('http-401:missing_api_key')
    expect(JSON.parse(body).pendingProvider).toBe(true)
  })
})
