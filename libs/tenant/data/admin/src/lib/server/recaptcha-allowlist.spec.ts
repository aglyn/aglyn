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
 * AGL-1378 — writing the App Check reCAPTCHA allowlist.
 *
 * The fake below is a **key**, not a canned response: it holds the whole
 * `webSettings` object and applies a PATCH the way the real API does, honouring
 * `updateMask`. That is the only way the assertions about sibling fields mean
 * anything — against a stub that echoes the request body, a write that wiped
 * `allowAllDomains` would pass.
 *
 * The live shape it models was read from the production key on 2026-08-23:
 *
 * ```
 * GET  https://recaptchaenterprise.googleapis.com/v1/projects/52453122264/keys/6LfnSnAb…
 * → 200 { webSettings: { allowAllDomains: false, allowedDomains: [...5],
 *          allowAmpTraffic: true, integrationType: "SCORE",
 *          challengeSecurityPreference: "CHALLENGE_SECURITY_PREFERENCE_UNSPECIFIED" } }
 * ```
 */

const getAccessToken = jest.fn(async () => ({
  access_token: 'ya29.test-token',
  expires_in: 3600,
}))

jest.mock('firebase-admin/app', () => ({
  __esModule: true,
  getApp: () => ({ options: { credential: { getAccessToken } } }),
}))

import {
  allowConsoleOrigin,
  allowlistSatisfied,
  MAX_ALLOWED_DOMAINS,
  readConsoleOriginAllowlist,
  reclaimConsoleOrigin,
} from './recaptcha-allowlist'

const SITE_KEY = '6LfnSnAbAAAAAG2PGTSOXQKQwv2snLGzMzuF1TWT'
const KEY_NAME = `projects/52453122264/keys/${SITE_KEY}`
const KEY_URL = `https://recaptchaenterprise.googleapis.com/v1/${KEY_NAME}`

const originalEnv = { ...process.env }
const fetchMock = jest.fn()

/** Everything on the live key, so a lost sibling is observable. */
let key: Record<string, any>

/** Set to make the next PATCH fail, or to corrupt what it returns. */
let patchStatus = 200
let corruptPatch: ((written: Record<string, any>) => Record<string, any>) | null

function freshKey(domains = ['aglyn.com', 'localhost', 'aglyn.app', 'auth.aglyn.com', 'app.aglyn.com']) {
  return {
    name: KEY_NAME,
    displayName: 'Aglyn',
    webSettings: {
      allowAllDomains: false,
      allowedDomains: [...domains],
      allowAmpTraffic: true,
      integrationType: 'SCORE',
      challengeSecurityPreference: 'CHALLENGE_SECURITY_PREFERENCE_UNSPECIFIED',
    },
    labels: {},
    createTime: '2021-07-03T03:44:38Z',
  }
}

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

/**
 * The API, as measured: PATCH honours `updateMask` and leaves every path
 * outside it alone, then returns the whole post-state object.
 */
function api(url: string, init?: any): Response {
  if (!url.startsWith(KEY_URL)) {
    throw new Error(`unexpected URL: ${url}`)
  }
  if ((init?.method ?? 'GET') === 'GET') return respond(200, key)
  if (patchStatus !== 200) {
    return respond(patchStatus, { error: { message: 'denied', status: 'PERMISSION_DENIED' } })
  }
  const mask = new URL(url).searchParams.get('updateMask')
  const sent = JSON.parse(init.body)
  if (mask === 'webSettings.allowedDomains') {
    key.webSettings.allowedDomains = [...sent.webSettings.allowedDomains]
  } else if (mask === 'webSettings' || !mask) {
    // What a careless mask would do, and the reason one is passed.
    key.webSettings = { ...sent.webSettings }
  } else {
    throw new Error(`unhandled updateMask: ${mask}`)
  }
  return respond(200, corruptPatch ? corruptPatch(key) : key)
}

beforeEach(() => {
  key = freshKey()
  patchStatus = 200
  corruptPatch = null
  getAccessToken.mockClear()
  fetchMock.mockReset().mockImplementation((url: string, init: any) => api(url, init))
  global.fetch = fetchMock as unknown as typeof fetch
  process.env.NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY = SITE_KEY
  process.env.RECAPTCHA_ADMIN_KEY_NAME = KEY_NAME
})

afterEach(() => {
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('allowConsoleOrigin', () => {
  it('PATCHes with a mask scoped to allowedDomains, never the whole webSettings', async () => {
    // The Vercel-firewall lesson, one API over: a PUT/PATCH that addressed the
    // parent object would carry whatever the caller happened to send and drop
    // the rest. `allowAllDomains` is the field that must never be collateral —
    // dropped or defaulted to true, the key accepts every origin on the
    // internet.
    const result = await allowConsoleOrigin('console.acme.com')

    expect(result.outcome).toBe('listed')
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe(`${KEY_URL}?updateMask=webSettings.allowedDomains`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({
      webSettings: {
        allowedDomains: [
          'aglyn.com',
          'localhost',
          'aglyn.app',
          'auth.aglyn.com',
          'app.aglyn.com',
          'console.acme.com',
        ],
      },
    })
  })

  it('leaves every sibling field on the key exactly as it found them', async () => {
    const before = JSON.parse(JSON.stringify(key.webSettings))
    await allowConsoleOrigin('console.acme.com')

    expect(key.webSettings.allowAllDomains).toBe(false)
    expect(key.webSettings.allowAmpTraffic).toBe(before.allowAmpTraffic)
    expect(key.webSettings.integrationType).toBe(before.integrationType)
    expect(key.webSettings.challengeSecurityPreference).toBe(
      before.challengeSecurityPreference,
    )
  })

  it('never drops a domain that was already there', async () => {
    await allowConsoleOrigin('console.acme.com')
    for (const existing of freshKey().webSettings.allowedDomains) {
      expect(key.webSettings.allowedDomains).toContain(existing)
    }
  })

  it('sends the token from the SAME service account firebase-admin runs as', async () => {
    await allowConsoleOrigin('console.acme.com')
    expect(getAccessToken).toHaveBeenCalled()
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer ya29.test-token')
  })

  it('normalizes what it is handed, so a pasted name cannot list a second entry', async () => {
    await allowConsoleOrigin('  CONSOLE.Acme.com.  ')
    expect(key.webSettings.allowedDomains).toContain('console.acme.com')
    expect(key.webSettings.allowedDomains).toHaveLength(6)
  })

  it('writes nothing when the exact name is already listed', async () => {
    await allowConsoleOrigin('console.acme.com')
    fetchMock.mockClear()
    const again = await allowConsoleOrigin('console.acme.com')

    expect(again.outcome).toBe('already-listed')
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'PATCH')).toHaveLength(0)
  })

  it('lists the exact name even when a parent entry already covers it', async () => {
    // A listed entry covers its whole subtree, so skipping the write here
    // would "work". It is refused because the cover belongs to a DIFFERENT
    // org's claim: that org detaching would silently break this one, with
    // nothing in either record linking them.
    key = freshKey(['aglyn.com', 'acme.com'])
    const result = await allowConsoleOrigin('console.acme.com')

    expect(result.outcome).toBe('listed')
    expect(key.webSettings.allowedDomains).toEqual(['aglyn.com', 'acme.com', 'console.acme.com'])
  })

  it('refuses at the documented 250 ceiling instead of writing a losing PATCH', async () => {
    key = freshKey(
      Array.from({ length: MAX_ALLOWED_DOMAINS }, (_, index) => `customer-${index}.example.com`),
    )
    const result = await allowConsoleOrigin('console.acme.com')

    expect(result.outcome).toBe('full')
    expect(allowlistSatisfied(result.outcome)).toBe(false)
    expect(result.detail).toContain(`${MAX_ALLOWED_DOMAINS} domains`)
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'PATCH')).toHaveLength(0)
  })

  it('reports failure — never success — when the API refuses the write', async () => {
    patchStatus = 403
    const result = await allowConsoleOrigin('console.acme.com')

    expect(result.outcome).toBe('failed')
    expect(allowlistSatisfied(result.outcome)).toBe(false)
    expect(result.detail).toContain('403')
  })

  it('refuses to believe a response that lost a domain it sent', async () => {
    // A write the API accepted but did not fully apply is indistinguishable
    // from success unless the post-state is re-read. This is that check.
    corruptPatch = (written) => ({
      ...written,
      webSettings: { ...written.webSettings, allowedDomains: ['aglyn.com'] },
    })
    const result = await allowConsoleOrigin('console.acme.com')

    expect(result.outcome).toBe('failed')
    expect(result.detail).toContain('did not keep every domain')
  })

  it('refuses a write that left the key open to every origin', async () => {
    corruptPatch = (written) => ({
      ...written,
      webSettings: { ...written.webSettings, allowAllDomains: true },
    })
    const result = await allowConsoleOrigin('console.acme.com')

    expect(result.outcome).toBe('failed')
    expect(result.detail).toContain('allowAllDomains')
  })
})

describe('configuration — the difference between "off" and "broken"', () => {
  it('is unenforced, and satisfied, when this deployment runs no App Check', async () => {
    // Self-host and local dev. Nothing gates the console here, so there is no
    // allowlist to maintain and refusing an activation would be wrong.
    delete process.env.NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY
    delete process.env.RECAPTCHA_ADMIN_KEY_NAME
    const result = await allowConsoleOrigin('console.acme.com')

    expect(result.outcome).toBe('unenforced')
    expect(allowlistSatisfied(result.outcome)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('FAILS when App Check runs but the admin key name is missing', async () => {
    // The dangerous middle. Under a "missing config → skip" rule this
    // deployment would report every custom domain ready while listing none of
    // them, and every one of those customers would meet a 401 they cannot
    // explain.
    delete process.env.RECAPTCHA_ADMIN_KEY_NAME
    const result = await allowConsoleOrigin('console.acme.com')

    expect(result.outcome).toBe('failed')
    expect(allowlistSatisfied(result.outcome)).toBe(false)
    expect(result.detail).toContain('RECAPTCHA_ADMIN_KEY_NAME')
  })

  it('FAILS when the admin key name points at a different key than the client uses', async () => {
    // Writes would land, on a key nothing attests against. The only
    // misconfiguration whose symptom is identical to success.
    process.env.RECAPTCHA_ADMIN_KEY_NAME = 'projects/52453122264/keys/6LsomeOtherKey'
    const result = await allowConsoleOrigin('console.acme.com')

    expect(result.outcome).toBe('failed')
    expect(result.detail).toContain('different key')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('FAILS on a key name that is not a resource path', async () => {
    process.env.RECAPTCHA_ADMIN_KEY_NAME = SITE_KEY
    const result = await allowConsoleOrigin('console.acme.com')

    expect(result.outcome).toBe('failed')
    expect(result.detail).toContain('projects/{project}/keys/{siteKey}')
  })
})

describe('reclaimConsoleOrigin', () => {
  it('removes the exact entry and nothing else', async () => {
    key = freshKey([...freshKey().webSettings.allowedDomains, 'console.acme.com'])
    const result = await reclaimConsoleOrigin('console.acme.com')

    expect(result.outcome).toBe('removed')
    expect(key.webSettings.allowedDomains).toEqual([
      'aglyn.com',
      'localhost',
      'aglyn.app',
      'auth.aglyn.com',
      'app.aglyn.com',
    ])
  })

  it('does NOT take a parent off the key when removing a subdomain', async () => {
    // A `filter(entry => name.endsWith(entry))` would delete `aglyn.com` here,
    // and `aglyn.com` is the entry every Aglyn origin attests against.
    key = freshKey(['aglyn.com', 'app.aglyn.com'])
    await reclaimConsoleOrigin('app.aglyn.com')
    expect(key.webSettings.allowedDomains).toEqual(['aglyn.com'])
  })

  it('is a no-op, and satisfied, when the name is not on the key', async () => {
    const result = await reclaimConsoleOrigin('console.never-listed.com')

    expect(result.outcome).toBe('absent')
    expect(allowlistSatisfied(result.outcome)).toBe(true)
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'PATCH')).toHaveLength(0)
  })

  it('reports failure when the API refuses, so the caller keeps the claim', async () => {
    key = freshKey([...freshKey().webSettings.allowedDomains, 'console.acme.com'])
    patchStatus = 403
    const result = await reclaimConsoleOrigin('console.acme.com')

    expect(result.outcome).toBe('failed')
    expect(allowlistSatisfied(result.outcome)).toBe(false)
  })
})

describe('readConsoleOriginAllowlist — occupancy is measured, the limit is quoted', () => {
  it('returns the live list rather than a count', async () => {
    const reading = await readConsoleOriginAllowlist()

    expect(reading.domains).toEqual([
      'aglyn.com',
      'localhost',
      'aglyn.app',
      'auth.aglyn.com',
      'app.aglyn.com',
    ])
    expect(reading.limit).toBe(250)
  })

  it('returns null — not an empty list — when it could not read', async () => {
    // An unreadable key rendering as "0 of 250 used" is the swallowed-query
    // shape: a measured zero that looks like plenty of headroom.
    delete process.env.RECAPTCHA_ADMIN_KEY_NAME
    const reading = await readConsoleOriginAllowlist()

    expect(reading.domains).toBeNull()
    expect(reading.detail).toContain('RECAPTCHA_ADMIN_KEY_NAME')
  })
})
