/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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
 * `/api/domains/verify` — the check that decides whether a customer's DNS is
 * pointed at us.
 *
 * It has been wrong in both directions before. AGL-733: it read a server-only
 * env var the wizard did not, and when that var was unset in production the
 * check degraded to "any CNAME passes" — a domain pointed anywhere at all
 * verified. AGL-1264/1275: an apex could not verify at all, then could only
 * verify against one hardcoded address. So the refusal is tested as carefully
 * as the acceptance here, and `VERCEL` is set in every case that claims
 * production behaviour — unset, the route soft-passes any CNAME by design, and
 * a suite that forgot it would assert the dev fallback while reading like it
 * asserted the real thing.
 *
 * The stray-address cases are AGL-1913: a name can answer with our addresses
 * AND a previous host's at the same time, which every earlier check called
 * simply verified.
 */

// A module, not a script — without this the const declarations below collide
// with the other console route specs' identical globals under `tsc`.
export {}

/** name → CNAME targets, as public DNS would answer. */
let mockCnames = new Map<string, string[]>()
/** name → A records. */
let mockAddresses = new Map<string, string[]>()

const mockVerifyIdToken = jest.fn()

function mockNotFound() {
  return Object.assign(new Error('queryCname ENOTFOUND'), { code: 'ENOTFOUND' })
}

jest.mock('dns', () => ({
  __esModule: true,
  promises: {
    resolveCname: async (name: string) => {
      const found = mockCnames.get(name)
      if (!found) throw mockNotFound()
      return found
    },
    resolve4: async (name: string) => {
      const found = mockAddresses.get(name)
      if (!found) throw mockNotFound()
      return found
    },
  },
  Resolver: class {
    setServers() {
      return undefined
    }
    resolveCname(name: string, callback: (error: unknown, records?: string[]) => void) {
      const found = mockCnames.get(name)
      found ? callback(null, found) : callback(mockNotFound())
    }
    resolve4(name: string, callback: (error: unknown, records?: string[]) => void) {
      const found = mockAddresses.get(name)
      found ? callback(null, found) : callback(mockNotFound())
    }
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams),
    headers: Object.fromEntries(request.headers),
  }),
  // The REAL predicate, re-implemented to the same rule rather than stubbed
  // to a constant (AGL-2180). This mock is a closed world: the moment the
  // route imported a second symbol from this module, every case here threw
  // `isDevelopmentRuntime is not a function`. A stub returning `false` would
  // have made them pass again while pinning nothing — and the whole point of
  // the suite below is which environments get the soft pass, so a double that
  // ignores the environment would assert the opposite of the thing under test.
  isDevelopmentRuntime: (
    env: Record<string, string | undefined> = process.env,
  ) => env['NODE_ENV'] !== 'production',
}))

const { GET } = require('./route') as {
  GET: (request: Request) => Promise<Response>
}

function get(domain: string, token = 'token') {
  return new Request(
    `https://app.aglyn.com/api/domains/verify?domain=${encodeURIComponent(domain)}`,
    { headers: token ? { authorization: `Bearer ${token}` } : {} },
  )
}

/** The pool `sites.aglyn.app` itself resolves to, as production does today. */
const TARGET_POOL = ['64.29.17.1', '216.198.79.1']

const ORIGINAL_NODE_ENV = process.env.NODE_ENV

beforeEach(() => {
  mockCnames = new Map()
  mockAddresses = new Map([['sites.aglyn.app', [...TARGET_POOL]]])
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  // Production semantics. Without this the route soft-passes any CNAME.
  // `NODE_ENV`, not `VERCEL`, since AGL-2180 — the soft pass now keys on
  // whether this is a development runtime rather than on which vendor is
  // hosting, so a container gets production rules. `VERCEL` is still set
  // because other assertions below speak about it.
  process.env.VERCEL = '1'
  Object.assign(process.env, { NODE_ENV: 'production' })
})

afterEach(() => {
  delete process.env.VERCEL
  Object.assign(process.env, { NODE_ENV: ORIGINAL_NODE_ENV })
  jest.restoreAllMocks()
})

describe('a CNAME is accepted only when it points at us (AGL-733)', () => {
  it('verifies the documented target', async () => {
    mockCnames.set('www.example.com', ['sites.aglyn.app'])
    const body = await (await GET(get('www.example.com'))).json()
    expect(body).toMatchObject({
      domain: 'www.example.com',
      verified: true,
      expected: 'sites.aglyn.app',
    })
  })

  it('REFUSES a CNAME pointed somewhere else, and says where it points', async () => {
    mockCnames.set('www.example.com', ['some-other-host.example.net'])
    const body = await (await GET(get('www.example.com'))).json()
    expect(body.verified).toBe(false)
    expect(body.records).toEqual(['some-other-host.example.net'])
    expect(body.expected).toBe('sites.aglyn.app')
  })

  it('refuses a name with no records at all', async () => {
    const body = await (await GET(get('www.example.com'))).json()
    expect(body.verified).toBe(false)
    expect(body.records).toEqual([])
  })

  it('never lets a WRONG CNAME fall through to the address check', async () => {
    // Otherwise "pointed at the wrong place" and "pointed at an apex" verify
    // identically — a domain CNAME'd elsewhere whose A records happen to be
    // ours would pass.
    mockCnames.set('www.example.com', ['some-other-host.example.net'])
    mockAddresses.set('www.example.com', [...TARGET_POOL])
    const body = await (await GET(get('www.example.com'))).json()
    expect(body.verified).toBe(false)
    expect(body.matchedBy).toBeUndefined()
  })

  it('normalises the trailing dot and the case a resolver returns', async () => {
    mockCnames.set('www.example.com', ['Sites.Aglyn.App.'])
    expect((await (await GET(get('WWW.example.com'))).json()).verified).toBe(true)
  })
})

describe('an apex verifies by the addresses it lands on (AGL-1264/1327)', () => {
  it('accepts an apex sharing an address with the CNAME target', async () => {
    mockAddresses.set('example.com', ['64.29.17.1'])
    const body = await (await GET(get('example.com'))).json()
    expect(body.verified).toBe(true)
    expect(body.matchedBy).toBe('apex-address')
  })

  it('accepts an apex on the host pool that the target does NOT return', async () => {
    // The whole reason `HOST_APEX_ADDRESSES` exists: the platform routes apexes
    // by Host header, so a correctly-pointed apex shares no address with
    // `sites.aglyn.app`.
    mockAddresses.set('example.com', ['216.198.79.65'])
    expect((await (await GET(get('example.com'))).json()).verified).toBe(true)
  })

  it('REFUSES an apex pointed at somebody else entirely', async () => {
    mockAddresses.set('example.com', ['203.0.113.9'])
    const body = await (await GET(get('example.com'))).json()
    expect(body.verified).toBe(false)
    expect(body.matchedBy).toBeUndefined()
    // And it names what it saw, so the customer can find the record.
    expect(body.strayAddresses).toEqual(['203.0.113.9'])
  })
})

describe('a domain can be pointed here AND wrong at once (AGL-1913)', () => {
  it('verifies a shadowed apex but reports the record that is not ours', async () => {
    // A stale A record from a previous host answering alongside a correct
    // ALIAS. Every check before this one called it simply verified — and it
    // is, for whichever visitor the resolver hands the right address to.
    mockAddresses.set('example.com', ['216.198.79.1', '203.0.113.9'])
    const body = await (await GET(get('example.com'))).json()
    expect(body.verified).toBe(true)
    expect(body.matchedBy).toBe('apex-address')
    expect(body.strayAddresses).toEqual(['203.0.113.9'])
  })

  it('says NOTHING about strays on a cleanly-pointed apex — the control', async () => {
    // A warning that fires on every apex is a warning nobody reads.
    mockAddresses.set('example.com', ['216.198.79.1', '64.29.17.1'])
    const body = await (await GET(get('example.com'))).json()
    expect(body.verified).toBe(true)
    expect(body.strayAddresses).toBeUndefined()
  })
})

describe('it is the wizard lookup, not a public one', () => {
  it('401s without a bearer token', async () => {
    mockCnames.set('www.example.com', ['sites.aglyn.app'])
    const response = await GET(
      new Request('https://app.aglyn.com/api/domains/verify?domain=www.example.com'),
    )
    expect(response.status).toBe(401)
  })

  it('401s on a token that does not verify', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('nope'))
    expect((await GET(get('www.example.com'))).status).toBe(401)
  })

  it('400s a value that is not a domain', async () => {
    expect((await GET(get('not a domain'))).status).toBe(400)
  })
})

describe('in dev it stays testable; anywhere deployed it does not', () => {
  it('soft-passes any CNAME in local dev, where nothing points at the edge', async () => {
    Object.assign(process.env, { NODE_ENV: 'development' })
    mockCnames.set('www.example.com', ['whatever.example.net'])
    expect((await (await GET(get('www.example.com'))).json()).verified).toBe(true)
  })

  it('but the same lookup in production refuses it — the AGL-733 regression', async () => {
    mockCnames.set('www.example.com', ['whatever.example.net'])
    expect((await (await GET(get('www.example.com'))).json()).verified).toBe(false)
  })

  it('REFUSES it on a self-host container, which has no VERCEL set', async () => {
    // The AGL-2180 case, and the one that was broken. `softPass` read
    // `!process.env.VERCEL`, so on an operator's container it was ON in
    // production and any domain carrying any CNAME verified — a user could
    // claim a domain they do not control. Note VERCEL is deleted here on
    // purpose: that is exactly the container's environment, and the case
    // would have passed before this fix only by verifying the wrong thing.
    delete process.env.VERCEL
    process.env.AGLYN_STANDALONE = '1'
    Object.assign(process.env, { NODE_ENV: 'production' })
    mockCnames.set('www.example.com', ['whatever.example.net'])
    expect((await (await GET(get('www.example.com'))).json()).verified).toBe(
      false,
    )
    delete process.env.AGLYN_STANDALONE
  })
})
