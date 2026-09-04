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

/**
 * The sending-domain route.
 *
 * The store is faked; the RECORDS are real — `sendingDnsRecords` is not
 * mocked, so what this route hands a customer is what the verifier compares
 * against, which is the whole reason both come from one function.
 *
 * The assertion that matters most is that an unreachable resolver answers 503
 * rather than "not verified". Telling a customer whose DNS is correct that
 * their records are missing sends them to edit a zone that has nothing wrong
 * with it, and they have no way to discover that we simply could not look.
 */

const state: {
  role: string
  /**
   * The org's PLAN, not a pre-answered entitlement.
   *
   * `checkEntitlement` is deliberately left unmocked below, so the gate this
   * route applies is resolved from the real plan table. A mock returning a
   * boolean would have proved only that the route reads something — it would
   * pass identically whether the gate named `customSendingDomain`,
   * `whiteLabel` or a flag that does not exist.
   */
  plan: string
  domains: Record<string, Record<string, unknown>>
  verifyResult: Record<string, unknown>
} = { role: 'admin', plan: 'pro', domains: {}, verifyResult: {} }

jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    const query = Object.fromEntries(url.searchParams.entries())
    const raw = await request.text().catch(() => '')
    return {
      method: request.method,
      query,
      body: raw ? JSON.parse(raw) : {},
      headers: Object.fromEntries(request.headers.entries()),
    }
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'uid-1', email_verified: true }),
      }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({ plan: state.plan }),
              get: (field: string) =>
                name === 'orgs' && field === 'role' ? undefined : state.role,
            }),
            collection: () => ({
              doc: () => ({
                get: async () => ({
                  exists: true,
                  get: (field: string) => (field === 'role' ? state.role : undefined),
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
  listSendingDomains: async () => Object.values(state.domains),
  readDmarcPolicy: async () => ({
    policy: 'reject',
    record: 'v=DMARC1; p=reject',
    consequence: 'refused',
  }),
  releaseSendingDomain: async (_orgId: string, domain: string) => {
    delete state.domains[domain]
  },
  requestSendingDomain: async ({ domain }: { domain: string }) => {
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      return { record: null, error: 'Enter a valid domain, for example acme.com', status: 400 }
    }
    const record = {
      domain,
      status: 'records-issued',
      dkimSelector: 'aglyn-org1',
      dkimPublicKey: 'PUBLICKEYVALUE',
      returnPathHost: 'feedback-smtp.us-east-1.amazonses.com',
    }
    state.domains[domain] = record
    return { record, error: null, status: 201 }
  },
  verifySendingDomain: async () => state.verifyResult,
}))

import { GET, POST, DELETE } from '../app/api/email/sending-domains/route'

const AUTH = { authorization: 'Bearer token' }
const URL_BASE = 'https://app.aglyn.com/api/email/sending-domains'

const post = (body: Record<string, unknown>) =>
  POST(new Request(URL_BASE, { method: 'POST', headers: AUTH, body: JSON.stringify(body) }))

const get = (queryString: string) =>
  GET(new Request(`${URL_BASE}?${queryString}`, { headers: AUTH }))

beforeEach(() => {
  state.role = 'admin'
  state.plan = 'pro'
  state.domains = {}
  state.verifyResult = {}
})

describe('the records are shown, not guessed at', () => {
  it('returns SPF, DKIM and the return path with copy-paste lines', async () => {
    const response = await post({ orgId: 'org-1', domain: 'acme.com' })
    const payload = await response.json()

    expect(response.status).toBe(201)
    expect(payload.records.map((entry: { purpose: string }) => entry.purpose)).toEqual([
      'spf',
      'dkim',
      'return-path',
    ])
    expect(payload.records[0].value).toBe('v=spf1 include:amazonses.com ~all')
    expect(payload.records[1].name).toBe('aglyn-org1._domainkey.acme.com')
    expect(payload.records[2].type).toBe('MX')
    // Pre-formatted, so no surface re-derives the layout and drifts from it.
    expect(payload.lines[0]).toContain('send.acme.com')
  })

  it('reads the customer’s DMARC and suggests one only as a suggestion', async () => {
    const response = await post({ orgId: 'org-1', domain: 'acme.com' })
    const payload = await response.json()

    expect(payload.dmarc.policy).toBe('reject')
    // Read, never written. The suggestion is report-only and not required.
    expect(payload.dmarcSuggestion.required).toBe(false)
    expect(payload.dmarcSuggestion.value).toContain('p=none')
  })

  it('lists a org’s domains with their records', async () => {
    await post({ orgId: 'org-1', domain: 'acme.com' })

    const payload = await (await get('orgId=org-1')).json()

    expect(payload.domains).toHaveLength(1)
    expect(payload.domains[0].records).toHaveLength(3)
  })

  it('refuses a malformed domain with the reason', async () => {
    const response = await post({ orgId: 'org-1', domain: 'nope' })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/valid domain/i)
  })
})

describe('verification', () => {
  it('reports a verified domain', async () => {
    state.verifyResult = {
      record: { domain: 'acme.com', status: 'verified', dkimSelector: 'aglyn-org1', dkimPublicKey: 'K' },
      missing: [],
      inconclusive: false,
      error: null,
    }

    const payload = await (await post({ orgId: 'org-1', domain: 'acme.com', action: 'verify' })).json()

    expect(payload.verified).toBe(true)
    expect(payload.status).toBe('verified')
  })

  it('names what is missing when the records are not live', async () => {
    state.verifyResult = {
      record: { domain: 'acme.com', status: 'failed', dkimSelector: 'aglyn-org1', dkimPublicKey: 'K' },
      missing: ['TXT:send.acme.com'],
      inconclusive: false,
      error: null,
    }

    const payload = await (await post({ orgId: 'org-1', domain: 'acme.com', action: 'verify' })).json()

    expect(payload.verified).toBe(false)
    expect(payload.missing).toEqual(['TXT:send.acme.com'])
  })

  /**
   * The load-bearing one. A resolver we could not reach has told us nothing,
   * and reporting that as "your records are missing" sends a customer to fix
   * a zone that is already correct.
   */
  it('answers 503 when the lookup could not be made, never "not verified"', async () => {
    state.verifyResult = {
      record: { domain: 'acme.com', status: 'records-issued', dkimSelector: 'aglyn-org1', dkimPublicKey: 'K' },
      missing: [],
      inconclusive: true,
      error: null,
    }

    const response = await post({ orgId: 'org-1', domain: 'acme.com', action: 'verify' })
    const payload = await response.json()

    expect(response.status).toBe(503)
    expect(payload.error).toMatch(/could not reach DNS/i)
    expect(payload.error).toMatch(/nothing has changed/i)
    expect(payload.verified).toBeUndefined()
  })

  it('404s a domain with no claim', async () => {
    state.verifyResult = { record: null, missing: [], inconclusive: false, error: 'No claim on that domain' }

    const response = await post({ orgId: 'org-1', domain: 'acme.com', action: 'verify' })

    expect(response.status).toBe(404)
  })
})

describe('access', () => {
  it('refuses an editor — a From: line is not an editor’s call', async () => {
    state.role = 'editor'

    const response = await post({ orgId: 'org-1', domain: 'acme.com' })

    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatch(/organization admin/i)
  })

  /**
   * THE LADDER, READ FROM BEHAVIOR.
   *
   * A custom sending domain is the half of the sending model that costs this
   * platform nothing in its own zone — the customer publishes the records —
   * so it sits at the tier campaign email starts at rather than at the top of
   * the price list. Both sides run the real `checkEntitlement` against the
   * real plan table, so a gate moved to another flag fails one of them.
   */
  it.each(['pro', 'business', 'agency', 'enterprise'])(
    'lets a %s org add a domain of its own',
    async (plan) => {
      state.plan = plan

      const response = await post({ orgId: 'org-1', domain: 'acme.com' })

      expect(response.status).toBe(201)
    },
  )

  it.each(['free', 'starter'])('refuses a %s org, and names the tier', async (plan) => {
    state.plan = plan

    const response = await post({ orgId: 'org-1', domain: 'acme.com' })
    const { error } = await response.json()

    expect(response.status).toBe(403)
    expect(error).toMatch(/Pro plan/i)
    // And it says what happens meanwhile, because a refusal whose only content
    // is "not on your plan" reads as "your mail is off".
    expect(error).toMatch(/shared Aglyn address/i)
  })

  it('refuses an unauthenticated caller', async () => {
    const response = await POST(
      new Request(URL_BASE, { method: 'POST', body: JSON.stringify({ orgId: 'org-1' }) }),
    )

    expect(response.status).toBe(401)
  })

  it('requires an orgId', async () => {
    expect((await post({ domain: 'acme.com' })).status).toBe(400)
  })

  it('releases a domain', async () => {
    await post({ orgId: 'org-1', domain: 'acme.com' })

    const response = await DELETE(
      new Request(`${URL_BASE}?orgId=org-1&domain=acme.com`, { method: 'DELETE', headers: AUTH }),
    )

    expect(response.status).toBe(200)
    expect((await (await get('orgId=org-1')).json()).domains).toHaveLength(0)
  })
})
