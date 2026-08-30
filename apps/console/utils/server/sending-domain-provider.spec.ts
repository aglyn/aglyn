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
 * The sending-domain provider seam.
 *
 * `fetch` is stubbed by a GUARD, not by a permissive mock: any request to a
 * host other than Resend throws, so a driver that reached the live API would
 * fail here rather than quietly succeed on somebody's network. The guard is
 * itself asserted, because a control that cannot fail proves nothing —
 * `send-email-governor.spec.ts` uses the same shape for the same reason.
 *
 * The assertions that matter most:
 *
 * - a `4xx` issues NOTHING, so nothing downstream can write `records-issued`;
 * - the DKIM key and selector are READ off the response, never derived;
 * - no request header, and no response body, can put the credential into a
 *   returned `detail` or a log line.
 */

const KEY = 're_domains_notarealkey_0123456789abcdef'
const DOMAIN = 'acme.com'
const PUBLIC_KEY = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCexamplekeymaterial'

type StubbedCall = { url: string; method: string; headers: Record<string, string> }

let calls: StubbedCall[] = []
let responses: {
  ok: boolean
  status: number
  json: unknown
}[] = []

/**
 * Every outbound call in this file goes through here. A non-Resend target
 * throws rather than being answered, so a driver that grew a second endpoint
 * cannot pass by accident.
 */
function installFetchGuard() {
  const stub = jest.fn(async (url: any, init: any) => {
    const target = String(url)
    if (!target.startsWith('https://api.resend.com/')) {
      throw new Error(`Blocked outbound request in a spec: ${target}`)
    }
    calls.push({
      url: target,
      method: String(init?.method ?? 'GET'),
      headers: { ...(init?.headers ?? {}) },
    })
    const next = responses.shift()
    if (!next) throw new Error(`No stubbed response for ${init?.method} ${target}`)
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.json,
      text: async () => JSON.stringify(next.json),
    }
  })
  global.fetch = stub as unknown as typeof fetch
  return stub
}

/** The shape Resend answers `POST /domains` with, trimmed to what is read. */
function resendDomainPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd91cd9bd-1176-453e-8fc1-35364d380206',
    name: DOMAIN,
    status: 'not_started',
    records: [
      {
        record: 'SPF',
        name: 'send',
        type: 'MX',
        value: 'feedback-smtp.eu-west-1.amazonses.com',
        priority: 10,
      },
      {
        record: 'SPF',
        name: 'send',
        type: 'TXT',
        value: '"v=spf1 include:amazonses.com ~all"',
      },
      {
        record: 'DKIM',
        name: 'resend._domainkey',
        type: 'TXT',
        value: `p=${PUBLIC_KEY}`,
      },
    ],
    ...overrides,
  }
}

import {
  NO_SENDING_DOMAIN_PROVIDER,
  readIssuedDkim,
  RESEND_SENDING_DOMAIN_PROVIDER,
  sendingDomainProvider,
} from './sending-domain-provider'

const originalFetch = global.fetch
const originalEnv = { ...process.env }
let errors: unknown[][]

beforeEach(() => {
  calls = []
  responses = []
  errors = []
  installFetchGuard()
  delete process.env.RESEND_DOMAINS_API_KEY
  delete process.env.AGLYN_SENDING_DOMAIN_PROVIDER
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args)
  })
})

afterEach(() => {
  global.fetch = originalFetch
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('the guard itself', () => {
  it('fails on a non-Resend target — a control that cannot fail proves nothing', async () => {
    await expect((global.fetch as any)('https://example.invalid/domains')).rejects.toThrow(
      'Blocked outbound request',
    )
  })
})

/*==========================================
  Requirement 1 — an absent key refuses cleanly
==========================================*/

describe('with no RESEND_DOMAINS_API_KEY', () => {
  it('selects the driver that issues nothing', () => {
    expect(sendingDomainProvider()).toBe(NO_SENDING_DOMAIN_PROVIDER)
    expect(sendingDomainProvider().configured()).toBe(false)
  })

  it('skips — it does not throw, and it does not report success', async () => {
    const issue = await sendingDomainProvider().issue(DOMAIN)

    expect(issue.outcome).toBe('skipped')
    expect(issue.dkimPublicKey).toBeNull()
    expect(issue.dkimSelector).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('still skips when the driver is named explicitly but has no key', async () => {
    process.env.AGLYN_SENDING_DOMAIN_PROVIDER = 'resend'

    const provider = sendingDomainProvider()

    expect(provider).toBe(RESEND_SENDING_DOMAIN_PROVIDER)
    expect(provider.configured()).toBe(false)
    expect((await provider.issue(DOMAIN)).outcome).toBe('skipped')
    expect(calls).toHaveLength(0)
  })
})

describe('with a key', () => {
  beforeEach(() => {
    process.env.RESEND_DOMAINS_API_KEY = KEY
  })

  it('selects the Resend driver by the presence of the credential', () => {
    expect(sendingDomainProvider()).toBe(RESEND_SENDING_DOMAIN_PROVIDER)
    expect(sendingDomainProvider().configured()).toBe(true)
  })

  it('honors an explicit `none`, credential or not', async () => {
    process.env.AGLYN_SENDING_DOMAIN_PROVIDER = 'none'

    expect(sendingDomainProvider()).toBe(NO_SENDING_DOMAIN_PROVIDER)
    expect((await sendingDomainProvider().issue(DOMAIN)).outcome).toBe('skipped')
  })

  /*========================================
    Requirement 4 — the record is read, not invented
  ========================================*/

  it('stores the DKIM key and selector the response carried', async () => {
    responses = [{ ok: true, status: 200, json: resendDomainPayload() }]

    const issue = await sendingDomainProvider().issue(DOMAIN)

    expect(issue.outcome).toBe('issued')
    expect(issue.dkimPublicKey).toBe(PUBLIC_KEY)
    // From `resend._domainkey`, which is NOT the per-org name we propose.
    expect(issue.dkimSelector).toBe('resend')
    expect(issue.providerDomainId).toBe('d91cd9bd-1176-453e-8fc1-35364d380206')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe('https://api.resend.com/domains')
  })

  it('reads an absolute record name as well as a relative one', () => {
    const absolute = readIssuedDkim(DOMAIN, [
      { record: 'DKIM', name: `aglyn-org1._domainkey.${DOMAIN}`, value: `p=${PUBLIC_KEY}` },
    ])

    expect(absolute).toEqual({ selector: 'aglyn-org1', publicKey: PUBLIC_KEY })
  })

  /**
   * The load-bearing half of "not invented". A response we cannot read a DKIM
   * record out of must produce nothing — a synthesized key is a record the
   * customer publishes, the verifier accepts, and no message ever signs with.
   */
  it('FAILS rather than guessing when the response carries no readable DKIM', async () => {
    responses = [
      { ok: true, status: 200, json: resendDomainPayload({ records: [] }) },
    ]

    const issue = await sendingDomainProvider().issue(DOMAIN)

    expect(issue.outcome).toBe('failed')
    expect(issue.dkimPublicKey).toBeNull()
    expect(issue.dkimSelector).toBeNull()
  })

  it('FAILS on a DKIM record whose name is not a selector', async () => {
    responses = [
      {
        ok: true,
        status: 200,
        json: resendDomainPayload({
          records: [{ record: 'DKIM', name: 'send', type: 'TXT', value: `p=${PUBLIC_KEY}` }],
        }),
      },
    ]

    expect((await sendingDomainProvider().issue(DOMAIN)).outcome).toBe('failed')
  })

  it('FAILS on a DKIM record with an empty value', async () => {
    responses = [
      {
        ok: true,
        status: 200,
        json: resendDomainPayload({
          records: [{ record: 'DKIM', name: 'resend._domainkey', type: 'TXT', value: '' }],
        }),
      },
    ]

    expect((await sendingDomainProvider().issue(DOMAIN)).outcome).toBe('failed')
  })

  /*========================================
    Requirement 3 — a provider failure issues nothing
  ========================================*/

  it.each([400, 401, 403, 429, 500, 502])(
    'issues nothing on %i and names the status',
    async (status) => {
      responses = [
        { ok: false, status, json: { statusCode: status, name: 'application_error' } },
      ]

      const issue = await sendingDomainProvider().issue(DOMAIN)

      expect(issue.outcome).toBe('failed')
      expect(issue.dkimPublicKey).toBeNull()
      expect(issue.detail).toBe(`http-${status}:application_error`)
    },
  )

  it('does not throw when the network does', async () => {
    global.fetch = jest.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' })
    }) as unknown as typeof fetch

    const issue = await sendingDomainProvider().issue(DOMAIN)

    expect(issue.outcome).toBe('failed')
    expect(issue.detail).toBe('timeout')
  })

  it('repeats only error names it already knows', async () => {
    responses = [
      {
        ok: false,
        status: 400,
        json: { name: 'something_new_we_have_never_seen' },
      },
    ]

    expect((await sendingDomainProvider().issue(DOMAIN)).detail).toBe('http-400')
  })

  /*========================================
    Requirement 5 — idempotency at the provider
  ========================================*/

  describe('a 422 duplicate', () => {
    it('adopts the domain the account already holds', async () => {
      responses = [
        { ok: false, status: 422, json: { name: 'validation_error' } },
        {
          ok: true,
          status: 200,
          json: { data: [{ id: 'existing-id', name: DOMAIN }, { id: 'other', name: 'nope.com' }] },
        },
        { ok: true, status: 200, json: resendDomainPayload({ id: 'existing-id' }) },
      ]

      const issue = await sendingDomainProvider().issue(DOMAIN)

      expect(issue.outcome).toBe('already-exists')
      expect(issue.dkimPublicKey).toBe(PUBLIC_KEY)
      expect(issue.providerDomainId).toBe('existing-id')
      // Exactly one create attempt. A second domain is never created.
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
      expect(calls[2].url).toBe('https://api.resend.com/domains/existing-id')
    })

    it('refuses when the list holds no domain by that name', async () => {
      responses = [
        { ok: false, status: 422, json: { name: 'validation_error' } },
        { ok: true, status: 200, json: { data: [{ id: 'other', name: 'nope.com' }] } },
      ]

      const issue = await sendingDomainProvider().issue(DOMAIN)

      expect(issue.outcome).toBe('failed')
      expect(issue.detail).toBe('duplicate-not-found')
      expect(issue.dkimPublicKey).toBeNull()
    })

    /**
     * The confirmation is checked TWICE, and this is the second one. Adopting
     * a domain the id resolved to but whose name is somebody else's would
     * hand a customer a record that signs for another zone.
     */
    it('refuses when the fetched domain names something else', async () => {
      responses = [
        { ok: false, status: 422, json: { name: 'validation_error' } },
        { ok: true, status: 200, json: { data: [{ id: 'existing-id', name: DOMAIN }] } },
        {
          ok: true,
          status: 200,
          json: resendDomainPayload({ id: 'existing-id', name: 'somebody-else.com' }),
        },
      ]

      const issue = await sendingDomainProvider().issue(DOMAIN)

      expect(issue.outcome).toBe('failed')
      expect(issue.detail).toBe('duplicate-mismatch')
      expect(issue.dkimPublicKey).toBeNull()
    })

    it('refuses when the duplicate cannot be listed', async () => {
      responses = [
        { ok: false, status: 422, json: { name: 'validation_error' } },
        { ok: false, status: 403, json: { name: 'restricted_api_key' } },
      ]

      const issue = await sendingDomainProvider().issue(DOMAIN)

      expect(issue.outcome).toBe('failed')
      expect(issue.detail).toBe('http-403:restricted_api_key')
    })
  })

  /*========================================
    Requirement 6 — the credential never leaves
  ========================================*/

  describe('the credential', () => {
    const carriesKey = (value: unknown): boolean =>
      JSON.stringify(value ?? '').includes(KEY) ||
      JSON.stringify(value ?? '').includes('notarealkey')

    it('is sent as a bearer header and appears in nothing that comes back', async () => {
      responses = [{ ok: true, status: 200, json: resendDomainPayload() }]

      const issue = await sendingDomainProvider().issue(DOMAIN)

      expect(calls[0].headers['Authorization']).toBe(`Bearer ${KEY}`)
      expect(carriesKey(issue)).toBe(false)
    })

    /**
     * The concrete failure: a provider — or a proxy in front of one — that
     * echoes the request into its error message. `detail` is built from a
     * fixed vocabulary rather than from the body, so there is no path for it.
     */
    it('never reaches `detail` or a log line when the provider echoes it back', async () => {
      responses = [
        {
          ok: false,
          status: 401,
          json: {
            name: 'missing_api_key',
            message: `Invalid credential: Bearer ${KEY}`,
            request: { headers: { authorization: `Bearer ${KEY}` } },
          },
        },
      ]

      const issue = await sendingDomainProvider().issue(DOMAIN)

      expect(issue.detail).toBe('http-401:missing_api_key')
      expect(carriesKey(issue)).toBe(false)
      expect(errors.length).toBeGreaterThan(0)
      expect(carriesKey(errors)).toBe(false)
    })

    it('never reaches a log line on the duplicate path either', async () => {
      responses = [
        { ok: false, status: 422, json: { name: 'validation_error' } },
        {
          ok: false,
          status: 403,
          json: { name: 'restricted_api_key', message: `key ${KEY} is restricted` },
        },
      ]

      const issue = await sendingDomainProvider().issue(DOMAIN)

      expect(carriesKey(issue)).toBe(false)
      expect(carriesKey(errors)).toBe(false)
    })
  })
})
