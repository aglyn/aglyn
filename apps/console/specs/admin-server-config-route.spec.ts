/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, the suite runs on jsdom, and `Request` is not a constructor.
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
 * `GET /api/admin/server-config` — the runtime answering for itself
 * (AGL-2069).
 *
 * The claims, each given the input that makes it fail:
 *
 * 1. **The gate FAILS CLOSED.** No token, a token that will not verify, an
 *    unverified email and a valid token with no `staff` claim are all
 *    refusals. The last one matters most: AGL-1993 found the staff claim is
 *    minted correctly and was being read wrong on the client, so a route that
 *    trusted anything but the decoded claim would be admitting non-staff.
 * 2. **A refusal carries NO report.** The dangerous failure is not the status
 *    code, it is a 403 that still serialized the body first — so every
 *    refusal is asserted to contain no config at all.
 * 3. **It reports the resolver's real answer**, including the trailing-space
 *    case that resolves against the intent.
 * 4. **No configured VALUE appears in the response**, asserted over the raw
 *    response text with every secret-shaped var carrying the same tell.
 * 5. **It is not cacheable** — a cached answer describes whichever deployment
 *    warmed the edge, the exact deployment-identity confusion this ends.
 */

// A module, not a script.
export {}

const mockVerifyIdToken = jest.fn()

/*==========================================
 * The REAL barrel, with only the web adapter replaced.
 *
 * `meteredBackfillMode()` is imported for real — quoting the resolver instead
 * of re-deriving its answer is the endpoint's entire claim, so a spec that
 * stubbed it would be asserting against a copy of the rule and would pass
 * while production disagreed. That drags in the plan constants, which is why
 * the barrel is spread rather than replaced.
 *=========================================*/
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn/server'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: undefined,
    headers: Object.fromEntries(request.headers),
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  firebaseAdmin: {
    app: () => ({ auth: () => ({ verifyIdToken: mockVerifyIdToken }) }),
  },
}))

const ORIGINAL_ENV = process.env

/**
 * A tell with no substring in common with any legitimate output word, so a
 * leak cannot be mistaken for a coincidence.
 */
const SECRET_TAIL = 'ZZQQXX7391WWVV'

function load() {
  jest.resetModules()
  return require('../app/api/admin/server-config/route') as {
    GET: (request: Request) => Promise<Response>
  }
}

function request(headers: Record<string, string> = {}, method = 'GET') {
  return new Request('https://app.aglyn.com/api/admin/server-config', {
    method,
    headers,
  })
}

const STAFF = { authorization: 'Bearer staff-id-token' }

describe('GET /api/admin/server-config (AGL-2069)', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      STRIPE_METERED_BACKFILL: 'immediate',
      STRIPE_SECRET_KEY: `sk_live_${SECRET_TAIL}`,
      CRON_SECRET: `cron-${SECRET_TAIL}`,
      PLUGIN_ARTIFACTS_BUCKET: `bucket-${SECRET_TAIL}`,
      STAFF_ALERT_EMAIL: `alerts-${SECRET_TAIL}@aglyn.com`,
      VERCEL_DEPLOYMENT_ID: 'dpl_test',
      VERCEL_GIT_COMMIT_SHA: 'deadbeef',
      VERCEL_ENV: 'production',
    } as NodeJS.ProcessEnv
    mockVerifyIdToken.mockReset().mockResolvedValue({
      uid: 'uid-staff',
      email_verified: true,
      staff: true,
    })
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  describe('the gate fails closed', () => {
    it('refuses a request with no Authorization header', async () => {
      const response = await load().GET(request())
      expect(response.status).toBe(401)
      expect(await response.text()).not.toContain('STRIPE')
    })

    it('refuses a token that will not verify', async () => {
      mockVerifyIdToken.mockRejectedValue(new Error('token expired'))
      const response = await load().GET(request(STAFF))
      // Unreadable credential is a refusal, never a report.
      expect(response.status).toBe(500)
      expect(await response.text()).not.toContain('STRIPE')
    })

    it('refuses a verified token with NO staff claim', async () => {
      // AGL-1993: the claim is minted correctly; the bug was reading it
      // wrong. The route must key on the decoded claim and nothing else.
      mockVerifyIdToken.mockResolvedValue({
        uid: 'uid-customer',
        email_verified: true,
      })
      const response = await load().GET(request(STAFF))
      expect(response.status).toBe(403)
      const text = await response.text()
      expect(text).toContain('Staff only')
      // The refusal did not serialize the report first.
      expect(text).not.toContain('STRIPE')
      expect(text).not.toContain('deployment')
    })

    it('refuses a staff token whose email is unverified', async () => {
      mockVerifyIdToken.mockResolvedValue({
        uid: 'uid-staff',
        email_verified: false,
        staff: true,
      })
      const response = await load().GET(request(STAFF))
      expect(response.status).toBe(403)
      expect(await response.text()).not.toContain('STRIPE')
    })

    it('refuses a non-GET method', async () => {
      const response = await load().GET(request(STAFF, 'POST'))
      expect(response.status).toBe(405)
    })
  })

  describe('the report', () => {
    it('answers staff with the deployment identity and the knobs', async () => {
      const response = await load().GET(request(STAFF))
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.deployment).toEqual({
        id: 'dpl_test',
        commit: 'deadbeef',
        env: 'production',
        region: null,
      })
      const backfill = body.knobs.find(
        (knob: { key: string }) => knob.key === 'STRIPE_METERED_BACKFILL',
      )
      expect(backfill.value).toBe('immediate')
      expect(backfill.source).toBe('env')
    })

    it('is never cached', async () => {
      const response = await load().GET(request(STAFF))
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    })

    it('reports what the resolver REALLY returned for a trailing space', async () => {
      // The AGL-1875 hazard, end to end through the real resolver:
      // `meteredBackfillMode()` lowercases without trimming.
      process.env.STRIPE_METERED_BACKFILL = 'immediate '
      const response = await load().GET(request(STAFF))
      const body = await response.json()
      const backfill = body.knobs.find(
        (knob: { key: string }) => knob.key === 'STRIPE_METERED_BACKFILL',
      )
      expect(backfill.value).toBe('boundary')
      expect(backfill.warning).toContain('whitespace')
      expect(body.warnings).toHaveLength(1)
    })

    it('distinguishes a set default from an unset one', async () => {
      delete process.env.STRIPE_METERED_BACKFILL
      const response = await load().GET(request(STAFF))
      const body = await response.json()
      const backfill = body.knobs.find(
        (knob: { key: string }) => knob.key === 'STRIPE_METERED_BACKFILL',
      )
      expect(backfill.value).toBe('boundary')
      expect(backfill.source).toBe('default')
    })
  })

  /*==========================================
   * THE ONE THAT OUTRANKS THE REST.
   *
   * Asserted over the whole response text, because the risk is a knob added
   * later whose reporter hands back the raw string — which a field-by-field
   * assertion would not be looking at.
   *=========================================*/
  describe('no configured value ever reaches the wire', () => {
    it('serializes with no trace of any secret', async () => {
      const response = await load().GET(request(STAFF))
      const text = await response.text()
      expect(text).not.toContain(SECRET_TAIL)
      expect(text).not.toContain('sk_live')
      // Not vacuous: the knobs WERE reported, by class and by presence.
      const body = JSON.parse(text)
      const value = (key: string) =>
        body.knobs.find((knob: { key: string }) => knob.key === key).value
      expect(value('STRIPE_SECRET_KEY')).toBe('live')
      expect(value('CRON_SECRET')).toBe('set')
      expect(value('PLUGIN_ARTIFACTS_BUCKET')).toBe('set')
    })

    it('reports a test key as test without echoing it', async () => {
      process.env.STRIPE_SECRET_KEY = `sk_test_${SECRET_TAIL}`
      const response = await load().GET(request(STAFF))
      const text = await response.text()
      expect(text).not.toContain(SECRET_TAIL)
      expect(JSON.parse(text).knobs).toContainEqual(
        expect.objectContaining({ key: 'STRIPE_SECRET_KEY', value: 'test' }),
      )
    })

    it('does not leak an env var it was never asked about', async () => {
      process.env.SOME_OTHER_CREDENTIAL = SECRET_TAIL
      const response = await load().GET(request(STAFF))
      expect(await response.text()).not.toContain(SECRET_TAIL)
    })
  })
})
