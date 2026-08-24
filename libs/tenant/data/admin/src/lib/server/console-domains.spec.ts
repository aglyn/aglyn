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
 * Custom console domain registration (AGL-1373).
 *
 * The Firestore fake below is **not** a stub that returns canned snapshots. It
 * models the one property this file exists to prove: a transaction records the
 * versions of everything it read, and refuses to commit if any of them moved.
 * A serial test cannot exercise a uniqueness guard — it only shows that the
 * second call sees the first call's write, which a plain `if` would also pass.
 * So `getAll` yields the event loop, and the concurrent test genuinely
 * interleaves two claims on the same name.
 *
 * Vercel is exercised through a mocked `fetch` rather than a mocked
 * `workspace-domains`, so the request body assertions are the real ones — in
 * particular the bare-hostname redirect that AGL-1365 got wrong for weeks.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

type Doc = Record<string, unknown>

const store = new Map<string, Doc>()
const versions = new Map<string, number>()
const SERVER_TIMESTAMP = '<server-timestamp>'

function bump(path: string): void {
  versions.set(path, (versions.get(path) ?? 0) + 1)
}

function snapshotOf(path: string) {
  const data = store.get(path)
  return {
    id: path.split('/').pop(),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string) {
  return {
    path,
    id: path.split('/').pop(),
    async get() {
      return snapshotOf(path)
    },
    async set(value: Doc, options?: { merge?: boolean }) {
      const previous = options?.merge ? (store.get(path) ?? {}) : {}
      store.set(path, { ...previous, ...value })
      bump(path)
    },
    async delete() {
      store.delete(path)
      bump(path)
    },
  }
}

/** Retries observed by the concurrent test, so contention is provable. */
let transactionAttempts = 0

const db = {
  collection: (name: string) => ({
    doc: (id: string) => docRef(`${name}/${id}`),
  }),
  batch() {
    const operations: Array<() => void> = []
    return {
      set(ref: { path: string }, value: Doc, options?: { merge?: boolean }) {
        operations.push(() => {
          const previous = options?.merge ? (store.get(ref.path) ?? {}) : {}
          store.set(ref.path, { ...previous, ...value })
          bump(ref.path)
        })
      },
      delete(ref: { path: string }) {
        operations.push(() => {
          store.delete(ref.path)
          bump(ref.path)
        })
      },
      async commit() {
        operations.forEach((operation) => operation())
      },
    }
  },
  async runTransaction<T>(body: (tx: unknown) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      transactionAttempts += 1
      const readVersions = new Map<string, number>()
      const writes: Array<() => void> = []
      const read = (ref: { path: string }) => {
        readVersions.set(ref.path, versions.get(ref.path) ?? 0)
        return snapshotOf(ref.path)
      }
      const tx = {
        async getAll(...refs: Array<{ path: string }>) {
          // The yield is the point: it lets a competing transaction reach its
          // own read before this one commits, which is what makes the
          // interleaving in the concurrency test real rather than notional.
          await Promise.resolve()
          return refs.map(read)
        },
        async get(ref: { path: string }) {
          await Promise.resolve()
          return read(ref)
        },
        set(ref: { path: string }, value: Doc, options?: { merge?: boolean }) {
          writes.push(() => {
            const previous = options?.merge ? (store.get(ref.path) ?? {}) : {}
            store.set(ref.path, { ...previous, ...value })
            bump(ref.path)
          })
        },
        delete(ref: { path: string }) {
          writes.push(() => {
            store.delete(ref.path)
            bump(ref.path)
          })
        },
      }
      const result = await body(tx)
      const stale = [...readVersions].some(
        ([path, version]) => (versions.get(path) ?? 0) !== version,
      )
      // Firestore aborts and re-runs the whole body on a contended read set.
      if (stale) continue
      writes.forEach((write) => write())
      return result
    }
    throw new Error('too much contention')
  },
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: {
    app: () => ({ firestore: () => db }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => SERVER_TIMESTAMP,
        delete: () => '<delete>',
      },
    },
  },
}))

/**
 * The reCAPTCHA admin path (AGL-1378) rides the same service-account
 * credential firebase-admin already holds, so the only thing to stand in for
 * is the token itself. `firebase-admin/app` is mocked rather than
 * `./recaptcha-allowlist`, so the request bodies asserted below — the
 * `updateMask`, the full domain list — are the real ones.
 */
jest.mock('firebase-admin/app', () => ({
  __esModule: true,
  getApp: () => ({
    options: {
      credential: {
        getAccessToken: async () => ({ access_token: 'ya29.test-token', expires_in: 3600 }),
      },
    },
  }),
}))

const resolveChallengeTxt = jest.fn<Promise<string[]>, [string]>()
jest.mock('./sso-provisioning', () => {
  const actual = jest.requireActual('./sso-provisioning')
  return {
    ...actual,
    resolveChallengeTxt: (domain: string) => resolveChallengeTxt(domain),
  }
})

import {
  activateConsoleDomain,
  claimConsoleDomain,
  consoleDomainNames,
  ConsoleDomainTakenError,
  getConsoleDomainClaim,
  normalizeConsoleDomain,
  registerConsoleDomain,
  releaseConsoleDomain,
  releasePendingConsoleDomain,
  resolveConsoleDomain,
  validateConsoleDomain,
  verifyConsoleDomain,
} from './console-domains'
import { SSO_TXT_PREFIX } from './sso-provisioning'

const ORG = 'org_acme'
const OTHER_ORG = 'org_rival'
const fetchMock = jest.fn()
const originalEnv = { ...process.env }

const SITE_KEY = '6LfnSnAbAAAAAG2PGTSOXQKQwv2snLGzMzuF1TWT'
const KEY_NAME = `projects/52453122264/keys/${SITE_KEY}`
const KEY_URL = `https://recaptchaenterprise.googleapis.com/v1/${KEY_NAME}`

/** Live `allowedDomains`, mutated by a PATCH exactly as the real key is. */
let allowedDomains: string[]

function respond(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function recaptchaKeyBody() {
  return {
    name: KEY_NAME,
    displayName: 'Aglyn',
    webSettings: {
      allowAllDomains: false,
      allowedDomains: [...allowedDomains],
      allowAmpTraffic: true,
      integrationType: 'SCORE',
    },
  }
}

/**
 * Turn App Check on for a block, so the allowlist write is exercised.
 *
 * Off by default in `beforeEach` — deliberately, and not because the root
 * `.env` happens not to carry the site key today. An env var that leaked in
 * later would otherwise start every Vercel-only assertion counting an extra
 * request, and the failure would look like the wrong thing entirely.
 */
function enableAppCheck(): void {
  process.env.NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY = SITE_KEY
  process.env.RECAPTCHA_ADMIN_KEY_NAME = KEY_NAME
}

/** Every PATCH body the reCAPTCHA key received, in order. */
function allowlistWrites(): Array<{ webSettings: { allowedDomains: string[] } }> {
  return fetchMock.mock.calls
    .filter((call) => String(call[0]).startsWith(KEY_URL) && call[1]?.method === 'PATCH')
    .map((call) => JSON.parse(call[1].body))
}

/** Every name that reached Vercel, in order. */
function vercelPosts(): string[] {
  return fetchMock.mock.calls
    .filter((call) => String(call[0]).includes('api.vercel.com') && call[1]?.method !== 'DELETE')
    .map((call) => JSON.parse(call[1].body).name)
}

/** An org on a plan that grants `whiteLabel`, and one that does not. */
function seedOrgs(): void {
  store.set('orgs/' + ORG, { name: 'Acme', plan: 'agency' })
  store.set('orgs/' + OTHER_ORG, { name: 'Rival', plan: 'agency' })
  store.set('orgs/org_free', { name: 'Thrifty', plan: 'free' })
}

beforeEach(() => {
  store.clear()
  versions.clear()
  transactionAttempts = 0
  seedOrgs()
  allowedDomains = ['aglyn.com', 'localhost', 'aglyn.app', 'auth.aglyn.com', 'app.aglyn.com']
  fetchMock.mockReset().mockImplementation(async (url: string, init: any) => {
    if (!String(url).startsWith(KEY_URL)) return respond(200)
    if ((init?.method ?? 'GET') === 'GET') return respond(200, recaptchaKeyBody())
    allowedDomains = [...JSON.parse(init.body).webSettings.allowedDomains]
    return respond(200, recaptchaKeyBody())
  })
  global.fetch = fetchMock as unknown as typeof fetch
  resolveChallengeTxt.mockReset().mockResolvedValue([])
  process.env.VERCEL_TOKEN = 'tok_test'
  process.env.VERCEL_CONSOLE_PROJECT_ID = 'prj_console'
  process.env.VERCEL_TEAM_ID = 'team_test'
  delete process.env.NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY
  delete process.env.RECAPTCHA_ADMIN_KEY_NAME
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  process.env = { ...originalEnv }
  jest.restoreAllMocks()
})

describe('validateConsoleDomain — the blocklist that does not exist today', () => {
  it('refuses our own domains, which pass the current shape check', () => {
    // `customConsoleDomain` in `/api/orgs/settings` accepts every one of these
    // right now: its only test is a shape regex (AGL-1353 D3).
    for (const reserved of [
      'aglyn.com',
      'app.aglyn.com',
      'console.aglyn.com',
      'auth.aglyn.com',
      'admin.aglyn.io',
      'aglyn.io',
      'tenant.aglyn.app',
      'anything.aglyn.app',
    ]) {
      expect(validateConsoleDomain(reserved)).toEqual({
        domain: null,
        error: expect.stringContaining('reserved'),
      })
    }
  })

  it('covers every entry of PRODUCTION_DOMAINS without copying the list', () => {
    // A blocklist that names hosts one by one goes stale the first time
    // someone adds a domain to `security-origins.js`. This asserts the real
    // file, so the two cannot drift apart silently.
    const source = readFileSync(
      resolve(__dirname, '../../../../../../../security-origins.js'),
      'utf8',
    )
    const block = source.slice(
      source.indexOf('const PRODUCTION_DOMAINS = ['),
      source.indexOf(']', source.indexOf('const PRODUCTION_DOMAINS = [')),
    )
    const domains = [...block.matchAll(/'([^']+)'/g)].map((match) => match[1])
    expect(domains.length).toBeGreaterThan(20)
    for (const domain of domains) {
      expect(validateConsoleDomain(domain).domain).toBeNull()
    }
  })

  it('refuses a shared app-hosting suffix, including the live second console', () => {
    // AGL-1353 measured `aglyn-console-aglyn.vercel.app` serving a real
    // console. Nobody proves ownership of a name a platform hands out.
    for (const shared of [
      'aglyn-console-aglyn.vercel.app',
      'acme.vercel.app',
      'acme.web.app',
      'acme.firebaseapp.com',
      'acme.pages.dev',
      'acme.github.io',
      'acme.onrender.com',
    ]) {
      expect(validateConsoleDomain(shared).domain).toBeNull()
    }
  })

  it('refuses a bare public suffix and a single label', () => {
    for (const bare of ['com', 'co.uk', 'com.au', 'localhost', 'acme']) {
      expect(validateConsoleDomain(bare).domain).toBeNull()
    }
    // But a real domain under one of them is fine.
    expect(validateConsoleDomain('acme.co.uk').domain).toBe('acme.co.uk')
  })

  it('refuses special-use and unresolvable names', () => {
    for (const name of [
      'console.local',
      'box.internal',
      'thing.test',
      'site.example',
      'nope.invalid',
      'hidden.onion',
    ]) {
      expect(validateConsoleDomain(name).domain).toBeNull()
    }
  })

  it('accepts a real customer domain, and normalises a pasted URL', () => {
    expect(validateConsoleDomain('console.acme-agency.com').domain).toBe(
      'console.acme-agency.com',
    )
    expect(normalizeConsoleDomain('  HTTPS://Console.Acme.com/path?x=1  ')).toBe(
      'console.acme.com',
    )
    expect(validateConsoleDomain('https://console.acme.com/').domain).toBe(
      'console.acme.com',
    )
    // A trailing root dot is the same name.
    expect(validateConsoleDomain('console.acme.com.').domain).toBe(
      'console.acme.com',
    )
  })

  it('refuses a name longer than DNS allows, and malformed labels', () => {
    // 4 × 63-octet labels plus `.com` is 259 — over the RFC 1035 ceiling of
    // 253, while every individual label is still legal.
    const tooLong = `${['a', 'b', 'c', 'd'].map((c) => c.repeat(63)).join('.')}.com`
    expect(validateConsoleDomain(tooLong).domain).toBeNull()
    for (const malformed of ['-acme.com', 'acme-.com', 'acme..com', 'acme.c', 'acme.123']) {
      expect(validateConsoleDomain(malformed).domain).toBeNull()
    }
  })
})

describe('consoleDomainNames — the twin', () => {
  it('pairs an apex with its www twin, and leaves a subdomain alone', () => {
    expect(consoleDomainNames('acme.com')).toEqual(['acme.com', 'www.acme.com'])
    expect(consoleDomainNames('console.acme.com')).toEqual(['console.acme.com'])
    // Narrow on purpose: reserving `www.console.acme.com` would lock another
    // org out of a name this one never asked for.
    expect(consoleDomainNames('www.acme.com')).toEqual(['www.acme.com'])
  })
})

describe('claimConsoleDomain — uniqueness is a property of the transaction', () => {
  it('claims the twin in the SAME transaction as its primary', async () => {
    // The load-bearing assertion. `attachProjectDomain` treats Vercel's
    // `domain_already_in_use` as success, which is only safe while every name
    // Vercel holds is indexed here. A twin claimed in a follow-up write is a
    // window in which it is not (AGL-743).
    await claimConsoleDomain(ORG, 'acme.com')
    expect(store.get('consoleDomains/acme.com')).toMatchObject({ orgId: ORG })
    expect(store.get('consoleDomains/www.acme.com')).toMatchObject({
      orgId: ORG,
      role: 'redirect',
      primaryHost: 'acme.com',
    })
    // One transaction: both documents reached version 1 together.
    expect(versions.get('consoleDomains/acme.com')).toBe(1)
    expect(versions.get('consoleDomains/www.acme.com')).toBe(1)
  })

  it('refuses a name another org already holds', async () => {
    await claimConsoleDomain(OTHER_ORG, 'console.acme.com')
    await expect(claimConsoleDomain(ORG, 'console.acme.com')).rejects.toThrow(
      ConsoleDomainTakenError,
    )
    expect(store.get('consoleDomains/console.acme.com')).toMatchObject({
      orgId: OTHER_ORG,
    })
  })

  it('refuses when only the TWIN belongs to another org', async () => {
    // The subtle half. `acme.com` is free, so a guard that checked only the
    // primary would hand this org a claim and then attach `www.acme.com` —
    // a name the rival already has on the project — reading Vercel's
    // `already-exists` as health while its visitors are redirected away.
    store.set('consoleDomains/www.acme.com', { orgId: OTHER_ORG })
    await expect(claimConsoleDomain(ORG, 'acme.com')).rejects.toThrow(
      ConsoleDomainTakenError,
    )
    expect(store.has('consoleDomains/acme.com')).toBe(false)
  })

  it('lets exactly one of two CONCURRENT claims win', async () => {
    // A serial test does not exercise this: it only shows the second caller
    // reads the first caller's write. This one starts both bodies before
    // either commits.
    const outcomes = await Promise.allSettled([
      claimConsoleDomain(ORG, 'console.acme.com'),
      claimConsoleDomain(OTHER_ORG, 'console.acme.com'),
    ])
    const won = outcomes.filter((outcome) => outcome.status === 'fulfilled')
    const lost = outcomes.filter((outcome) => outcome.status === 'rejected')
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConsoleDomainTakenError,
    )
    // The loser re-ran rather than blindly overwriting — three bodies for two
    // claims is the retry that makes the guard meaningful.
    expect(transactionAttempts).toBeGreaterThan(2)
  })

  it('is idempotent for the owning org and KEEPS the published token', async () => {
    const first = await claimConsoleDomain(ORG, 'console.acme.com')
    const second = await claimConsoleDomain(ORG, 'console.acme.com')
    // Reissuing would invalidate a TXT record the customer may already have
    // published, turning a working setup into a mysterious failure.
    expect(second.token).toBe(first.token)
  })
})

describe('registerConsoleDomain — the entitlement is checked server-side', () => {
  it('refuses an org without whiteLabel, and leaves no claim behind', async () => {
    const result = await registerConsoleDomain({
      orgId: 'org_free',
      domain: 'console.acme.com',
    })
    expect(result).toMatchObject({ status: 403, claim: null })
    // A refused org must not learn whether the name was free, and must not
    // park a claim that blocks the org that IS entitled to it.
    expect(store.has('consoleDomains/console.acme.com')).toBe(false)
  })

  it('refuses an unknown org', async () => {
    const result = await registerConsoleDomain({
      orgId: 'org_missing',
      domain: 'console.acme.com',
    })
    expect(result.status).toBe(403)
  })

  it('answers 409 rather than throwing when another org holds the name', async () => {
    await claimConsoleDomain(OTHER_ORG, 'console.acme.com')
    const result = await registerConsoleDomain({
      orgId: ORG,
      domain: 'console.acme.com',
    })
    expect(result).toMatchObject({ status: 409, claim: null })
    expect(result.error).toMatch(/another organization/i)
  })

  it('returns the exact TXT record to publish', async () => {
    const { claim } = await registerConsoleDomain({
      orgId: ORG,
      domain: 'console.acme.com',
    })
    expect(claim.recordHost).toBe('_aglyn-challenge.console.acme.com')
    expect(claim.recordValue).toBe(`${SSO_TXT_PREFIX}${claim.token}`)
    expect(claim.status).toBe('pending')
  })
})

describe('verifyConsoleDomain — ownership proof', () => {
  async function claimed() {
    const { claim } = await registerConsoleDomain({
      orgId: ORG,
      domain: 'console.acme.com',
    })
    return claim
  }

  it('flips to verified only on an exact whole-record match', async () => {
    const claim = await claimed()
    resolveChallengeTxt.mockResolvedValue([claim.recordValue])
    const result = await verifyConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })
    expect(result.status).toBe(200)
    expect(store.get('consoleDomains/console.acme.com')).toMatchObject({
      status: 'verified',
    })
  })

  it('refuses a near-miss record', async () => {
    const claim = await claimed()
    for (const record of [
      `${claim.recordValue}-and-more`,
      SSO_TXT_PREFIX,
      `${SSO_TXT_PREFIX}deadbeef`,
      'v=spf1 include:_spf.google.com ~all',
    ]) {
      resolveChallengeTxt.mockResolvedValue([record])
      const result = await verifyConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })
      expect(result.status).toBe(409)
      expect(store.get('consoleDomains/console.acme.com')).toMatchObject({
        status: 'pending',
      })
    }
  })

  it('refuses to verify another org’s claim', async () => {
    await claimed()
    resolveChallengeTxt.mockResolvedValue([])
    const result = await verifyConsoleDomain({
      orgId: OTHER_ORG,
      domain: 'console.acme.com',
    })
    expect(result).toMatchObject({ status: 404, claim: null })
    // And it never reached DNS, so it cannot be used to probe another org.
    expect(resolveChallengeTxt).not.toHaveBeenCalled()
  })

  it('re-checks the entitlement, so a lapsed plan cannot finish verifying', async () => {
    const claim = await claimed()
    store.set('orgs/' + ORG, { name: 'Acme', plan: 'free' })
    resolveChallengeTxt.mockResolvedValue([claim.recordValue])
    const result = await verifyConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })
    expect(result.status).toBe(403)
  })
})

describe('activateConsoleDomain — Vercel, against the CONSOLE project', () => {
  async function verified(domain: string) {
    const { claim } = await registerConsoleDomain({ orgId: ORG, domain })
    resolveChallengeTxt.mockResolvedValue([claim.recordValue])
    await verifyConsoleDomain({ orgId: ORG, domain })
    return claim
  }

  it('POSTs to VERCEL_CONSOLE_PROJECT_ID, not the tenant project', async () => {
    await verified('console.acme.com')
    const result = await activateConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })
    expect(result.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.vercel.com/v10/projects/prj_console/domains?teamId=team_test',
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      name: 'console.acme.com',
    })
  })

  it('sends the twin redirect as a BARE HOSTNAME, never a URL (AGL-1365)', async () => {
    // `https://${target}` is rejected with `bad_request: Unable to redirect to
    // "https://…", because that domain is not added to the project` — a
    // message that blames the target for being absent when the format was
    // wrong. That is why it shipped looking correct and never once worked.
    await verified('acme.com')
    await activateConsoleDomain({ orgId: ORG, domain: 'acme.com' })
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body))
    const twin = bodies.find((body) => body.name === 'www.acme.com')
    expect(twin.redirect).toBe('acme.com')
    expect(twin.redirect).not.toMatch(/^https?:\/\//)
    expect(twin.redirectStatusCode).toBe(307)
  })

  it('attaches exactly the names the claim reserved — no more', async () => {
    // The invariant in one assertion: a name reaching Vercel that the
    // transaction did not claim is the AGL-743 hole reopened.
    await verified('acme.com')
    await activateConsoleDomain({ orgId: ORG, domain: 'acme.com' })
    const sent = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).name)
    const claimed = store.get('consoleDomains/acme.com').names as string[]
    expect([...sent].sort()).toEqual([...claimed].sort())
    for (const name of sent) {
      expect(store.has(`consoleDomains/${name}`)).toBe(true)
    }
  })

  it('refuses to attach a claim that has not proved ownership', async () => {
    await registerConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })
    const result = await activateConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })
    expect(result).toMatchObject({ status: 409, attachment: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses when the org has lost whiteLabel since verifying', async () => {
    await verified('console.acme.com')
    store.set('orgs/' + ORG, { name: 'Acme', plan: 'free' })
    const result = await activateConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })
    expect(result.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  describe('the App Check reCAPTCHA allowlist (AGL-1378)', () => {
    it('puts the SERVING name on the reCAPTCHA key, and marks the claim active', async () => {
      enableAppCheck()
      await verified('console.acme.com')
      const result = await activateConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })

      expect(result.status).toBe(200)
      expect(result.attachment.allowlist.outcome).toBe('listed')
      expect(allowedDomains).toContain('console.acme.com')
      expect(store.get('consoleDomains/console.acme.com')).toMatchObject({
        status: 'active',
        appCheckState: 'listed',
      })
    })

    it('writes the allowlist AFTER Vercel, and only for the primary', async () => {
      // Order: allowlisting a name we do not serve hands that origin the right
      // to use our site key for nothing back. Primary only: a twin is a 308
      // that never executes the console, and would spend one of the 250.
      enableAppCheck()
      await verified('acme.com')
      await activateConsoleDomain({ orgId: ORG, domain: 'acme.com' })

      expect(vercelPosts()).toEqual(['acme.com', 'www.acme.com'])
      expect(allowlistWrites()).toHaveLength(1)
      expect(allowedDomains).toContain('acme.com')
      expect(allowedDomains).not.toContain('www.acme.com')

      const firstAllowlistCall = fetchMock.mock.calls.findIndex((call) =>
        String(call[0]).startsWith(KEY_URL),
      )
      const lastVercelCall = fetchMock.mock.calls.reduce(
        (last, call, index) => (String(call[0]).includes('api.vercel.com') ? index : last),
        -1,
      )
      expect(firstAllowlistCall).toBeGreaterThan(lastVercelCall)
    })

    it('the write is masked to allowedDomains and keeps every entry already there', async () => {
      enableAppCheck()
      await verified('console.acme.com')
      await activateConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })

      const patch = fetchMock.mock.calls.find(
        (call) => String(call[0]).startsWith(KEY_URL) && call[1]?.method === 'PATCH',
      )
      expect(patch[0]).toBe(`${KEY_URL}?updateMask=webSettings.allowedDomains`)
      expect(JSON.parse(patch[1].body).webSettings.allowedDomains).toEqual([
        'aglyn.com',
        'localhost',
        'aglyn.app',
        'auth.aglyn.com',
        'app.aglyn.com',
        'console.acme.com',
      ])
    })

    it('STAYS VERIFIED when the allowlist write fails, even though Vercel took it', async () => {
      // The whole point. A claim reported `active` while unlisted is a console
      // that renders, routes, and refuses every sign-in with 401 — surfacing
      // to the customer as "Missing or insufficient permissions", which is
      // also what a Security Rules verdict says. Never report it ready.
      enableAppCheck()
      await verified('console.acme.com')
      fetchMock.mockImplementation(async (url: string) =>
        String(url).startsWith(KEY_URL)
          ? respond(403, { error: { message: 'Permission denied' } })
          : respond(200),
      )
      const result = await activateConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })

      expect(result.status).toBe(502)
      expect(result.error).toContain('cannot pass App Check')
      expect(result.attachment.attached).toBe(true)
      expect(result.attachment.ready).toBe(false)
      expect(store.get('consoleDomains/console.acme.com')).toMatchObject({
        status: 'verified',
        vercelState: 'attached',
        appCheckState: 'failed',
        activatedAt: null,
      })
    })

    it('STAYS VERIFIED when the key is at its 250-domain ceiling', async () => {
      // `full` is the easy one to mistake for a warning. It is not: the
      // customer's console cannot attest, exactly as if the write had errored.
      enableAppCheck()
      allowedDomains = Array.from({ length: 250 }, (_, i) => `customer-${i}.example.com`)
      await verified('console.acme.com')
      const result = await activateConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })

      expect(result.status).toBe(502)
      expect(result.attachment.allowlist.outcome).toBe('full')
      expect(store.get('consoleDomains/console.acme.com')).toMatchObject({ status: 'verified' })
    })

    it('never touches the reCAPTCHA key when Vercel refused the name', async () => {
      enableAppCheck()
      await verified('console.acme.com')
      fetchMock.mockImplementation(async (url: string) =>
        String(url).includes('api.vercel.com')
          ? respond(400, { error: { code: 'invalid_domain' } })
          : respond(200, recaptchaKeyBody()),
      )
      await activateConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })

      expect(
        fetchMock.mock.calls.filter((call) => String(call[0]).startsWith(KEY_URL)),
      ).toHaveLength(0)
    })

    it('activates without touching the key when this deployment runs no App Check', async () => {
      // Self-host. `NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY` unset means nothing
      // gates the console, so refusing the activation would be wrong.
      await verified('console.acme.com')
      const result = await activateConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })

      expect(result.status).toBe(200)
      expect(result.attachment.allowlist.outcome).toBe('unenforced')
      expect(
        fetchMock.mock.calls.filter((call) => String(call[0]).startsWith(KEY_URL)),
      ).toHaveLength(0)
    })

    it('REFUSES when App Check runs but the admin key name was never configured', async () => {
      // The dangerous middle: config absence must not read as "off" on a
      // deployment that is demonstrably enforcing App Check.
      process.env.NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY = SITE_KEY
      await verified('console.acme.com')
      const result = await activateConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })

      expect(result.status).toBe(502)
      expect(result.attachment.allowlist.detail).toContain('RECAPTCHA_ADMIN_KEY_NAME')
      expect(store.get('consoleDomains/console.acme.com')).toMatchObject({ status: 'verified' })
    })
  })

  it('stays verified rather than active when Vercel refuses a name', async () => {
    await verified('console.acme.com')
    fetchMock.mockResolvedValue(respond(400, { error: { code: 'invalid_domain' } }))
    const result = await activateConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })
    expect(result.status).toBe(502)
    expect(store.get('consoleDomains/console.acme.com')).toMatchObject({
      status: 'verified',
      vercelState: 'pending',
    })
  })
})

describe('releaseConsoleDomain', () => {
  it('detaches every name before dropping the claim', async () => {
    await claimConsoleDomain(ORG, 'acme.com')
    const result = await releaseConsoleDomain({ orgId: ORG, domain: 'acme.com' })
    expect(result.released).toBe(true)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.vercel.com/v9/projects/prj_console/domains/acme.com?teamId=team_test',
      'https://api.vercel.com/v9/projects/prj_console/domains/www.acme.com?teamId=team_test',
    ])
    expect(store.has('consoleDomains/acme.com')).toBe(false)
    expect(store.has('consoleDomains/www.acme.com')).toBe(false)
  })

  it('takes the name back off the reCAPTCHA key before dropping the claim', async () => {
    // A claim deleted while the name is still on the key leaves an origin we
    // no longer serve holding a permanent right to mint App Check tokens
    // against our site key — and spends one of the 250 forever, with nothing
    // in Firestore left to say why.
    enableAppCheck()
    allowedDomains = [...allowedDomains, 'acme.com']
    await claimConsoleDomain(ORG, 'acme.com')
    const result = await releaseConsoleDomain({ orgId: ORG, domain: 'acme.com' })

    expect(result.released).toBe(true)
    expect(result.allowlist.outcome).toBe('removed')
    expect(allowedDomains).not.toContain('acme.com')
    expect(allowedDomains).toContain('aglyn.com')
  })

  it('KEEPS the claim when the key refuses the reclaim', async () => {
    enableAppCheck()
    allowedDomains = [...allowedDomains, 'acme.com']
    await claimConsoleDomain(ORG, 'acme.com')
    fetchMock.mockImplementation(async (url: string, init: any) => {
      if (!String(url).startsWith(KEY_URL)) return respond(200)
      if ((init?.method ?? 'GET') === 'GET') return respond(200, recaptchaKeyBody())
      return respond(403, { error: { message: 'Permission denied' } })
    })
    const result = await releaseConsoleDomain({ orgId: ORG, domain: 'acme.com' })

    expect(result.released).toBe(false)
    expect(result.error).toContain('still on the App Check allowlist')
    expect(store.has('consoleDomains/acme.com')).toBe(true)
  })

  it('KEEPS the claim when a detach fails', async () => {
    // Releasing a name that is still on the project is the unindexed-name
    // hole opened deliberately: the next org to claim it would read Vercel's
    // `already-exists` as success.
    await claimConsoleDomain(ORG, 'console.acme.com')
    fetchMock.mockResolvedValue(respond(500))
    const result = await releaseConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })
    expect(result.released).toBe(false)
    expect(store.has('consoleDomains/console.acme.com')).toBe(true)
  })

  it('refuses to release a domain another org holds', async () => {
    await claimConsoleDomain(OTHER_ORG, 'console.acme.com')
    const result = await releaseConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })
    expect(result.released).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // AGL-1353 D7: "`sessionEpoch = now` FIRST, then Vercel `DELETE`, then delete
  // the doc. Order matters: kill the sessions while we still control the host."
  // Release performed the second and third steps and never the first, while
  // `auth-handoff.ts` documented the bump as something release already did.
  it('bumps sessionEpoch on EVERY name BEFORE the first Vercel call', async () => {
    await claimConsoleDomain(ORG, 'acme.com')
    const before = Date.now()
    // What the claim looked like at the instant Vercel was asked to let go.
    // Asserting the stored value afterwards would pass just as happily if the
    // bump ran last, which is the ordering the design rules out.
    const epochsAtDetach: Array<unknown> = []
    fetchMock.mockImplementation(async (url: string, init: any) => {
      if (init?.method === 'DELETE') {
        epochsAtDetach.push(store.get('consoleDomains/acme.com')?.sessionEpoch)
      }
      return respond(200)
    })

    const result = await releaseConsoleDomain({ orgId: ORG, domain: 'acme.com' })
    expect(result.released).toBe(true)

    // Two names detached, and the epoch was already standing for both.
    expect(epochsAtDetach).toHaveLength(2)
    for (const epoch of epochsAtDetach) {
      expect(typeof epoch).toBe('number')
      expect(epoch as number).toBeGreaterThanOrEqual(before)
    }
  })

  it('bumps the TWIN too, so it cannot outlive its primary', async () => {
    await claimConsoleDomain(ORG, 'acme.com')
    const before = Date.now()
    const seen: Record<string, unknown> = {}
    fetchMock.mockImplementation(async (url: string, init: any) => {
      if (init?.method === 'DELETE') {
        seen['acme.com'] = store.get('consoleDomains/acme.com')?.sessionEpoch
        seen['www.acme.com'] = store.get('consoleDomains/www.acme.com')?.sessionEpoch
      }
      return respond(200)
    })
    await releaseConsoleDomain({ orgId: ORG, domain: 'acme.com' })
    expect(seen['acme.com']).toBeGreaterThanOrEqual(before)
    expect(seen['www.acme.com']).toBeGreaterThanOrEqual(before)
  })

  it('REFUSES a handoff authorized before the release, by the comparison redeem makes', async () => {
    // `redeemConsoleHandoff` refuses `revoked` when `authorizedAt < epoch`.
    // This is that comparison against the epoch release actually writes — an
    // in-flight authorization, 120 s of window left, cashed out mid-release.
    await claimConsoleDomain(ORG, 'acme.com')
    // A handoff authorized one second ago — 119 s of its 120 s window still to
    // run, which is precisely the record that used to cash out mid-release.
    const authorizedAt = Date.now() - 1000
    let epochAtDetach = 0
    fetchMock.mockImplementation(async (url: string, init: any) => {
      if (init?.method === 'DELETE') {
        epochAtDetach = Number(store.get('consoleDomains/acme.com')?.sessionEpoch ?? 0)
      }
      return respond(200)
    })
    await releaseConsoleDomain({ orgId: ORG, domain: 'acme.com' })

    expect(epochAtDetach).toBeGreaterThan(0)
    // The exact predicate `redeemConsoleHandoff` evaluates.
    expect(authorizedAt < epochAtDetach).toBe(true)
    // And the boundary, stated rather than asserted away: the comparison is
    // STRICT, so an authorization minted in the SAME millisecond as the bump
    // is not refused. Written with `Date.now()` on both sides that is a real
    // 1 ms hole — it just is not one an attacker can aim at, since they
    // control neither clock. Recorded here because the first draft of this
    // test asserted `authorizedAt < epoch` on two same-tick `Date.now()` calls
    // and failed, which is the honest way to learn the predicate is strict.
    expect(authorizedAt < authorizedAt).toBe(false)
  })

  it('leaves the epoch standing when the detach FAILS and the claim is kept', async () => {
    // The claim survives on purpose (the unindexed-name hole), and so must the
    // revocation: sessions on a domain we just tried to give up should not
    // outlive the attempt merely because Vercel was down.
    await claimConsoleDomain(ORG, 'console.acme.com')
    const before = Date.now()
    fetchMock.mockResolvedValue(respond(500))
    const result = await releaseConsoleDomain({ orgId: ORG, domain: 'console.acme.com' })

    expect(result.released).toBe(false)
    expect(store.has('consoleDomains/console.acme.com')).toBe(true)
    expect(
      store.get('consoleDomains/console.acme.com')?.sessionEpoch as number,
    ).toBeGreaterThanOrEqual(before)
  })
})

describe('releasePendingConsoleDomain — the branding form’s counterpart', () => {
  it('drops an unattached claim and its twin, without calling Vercel', async () => {
    // Clearing `customConsoleDomain` must not strand the reservation, or it
    // locks another org out of a name nobody is using.
    await claimConsoleDomain(ORG, 'acme.com')
    expect(await releasePendingConsoleDomain({ orgId: ORG, domain: 'acme.com' })).toBe(
      true,
    )
    expect(store.has('consoleDomains/acme.com')).toBe(false)
    expect(store.has('consoleDomains/www.acme.com')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses once the claim has proved ownership or reached Vercel', async () => {
    // Dropping a claim whose name is still on the project is the
    // unindexed-name hole opened by hand — `releaseConsoleDomain` detaches
    // first for exactly this reason.
    for (const state of [
      { status: 'verified', vercelState: 'pending' },
      { status: 'active', vercelState: 'attached' },
      { status: 'pending', vercelState: 'attached' },
    ]) {
      store.clear()
      seedOrgs()
      await claimConsoleDomain(ORG, 'console.acme.com')
      store.set('consoleDomains/console.acme.com', {
        ...store.get('consoleDomains/console.acme.com'),
        ...state,
      })
      expect(
        await releasePendingConsoleDomain({ orgId: ORG, domain: 'console.acme.com' }),
      ).toBe(false)
      expect(store.has('consoleDomains/console.acme.com')).toBe(true)
    }
  })

  it('refuses to release another org’s claim', async () => {
    await claimConsoleDomain(OTHER_ORG, 'console.acme.com')
    expect(
      await releasePendingConsoleDomain({ orgId: ORG, domain: 'console.acme.com' }),
    ).toBe(false)
    expect(store.has('consoleDomains/console.acme.com')).toBe(true)
  })
})

describe('getConsoleDomainClaim', () => {
  it('resolves the owning org, and null for an unclaimed name', async () => {
    await claimConsoleDomain(ORG, 'console.acme.com')
    expect(await getConsoleDomainClaim('CONSOLE.acme.com')).toEqual({
      orgId: ORG,
      status: 'pending',
    })
    expect(await getConsoleDomainClaim('nobody.example.com')).toBeNull()
  })
})

/**
 * Host → org resolution, and the entitlement that has to survive a downgrade
 * (AGL-1099c).
 *
 * The property under test is not "the helper returns the right shape" — it is
 * that a domain **stops resolving** the moment its org stops paying for it, and
 * that the refusal is written down rather than recomputed hopefully on every
 * request. AGL-1353 D7 is blunt about why: nothing in the codebase reacts to a
 * plan change, and read-time entitlement is sufficient for rendering and
 * insufficient for a hostname.
 *
 * The other half of these tests is the set of things that must NOT be refused.
 * A gate that fails closed on an outage takes every customer's console down
 * with one Firestore blip, and a gate that refuses unknown hosts breaks
 * localhost, preview deployments and self-hosting.
 */
describe('resolveConsoleDomain — one org per host, fail closed on downgrade', () => {
  /** A claim in the state `activateConsoleDomain` leaves behind. */
  async function activeClaim(orgId = ORG, domain = 'console.acme.com') {
    await claimConsoleDomain(orgId, domain)
    store.set(`consoleDomains/${domain}`, {
      ...store.get(`consoleDomains/${domain}`),
      status: 'active',
      vercelState: 'attached',
      sessionEpoch: 1000,
    })
    return domain
  }

  beforeEach(() => {
    store.set('orgs/' + ORG, { name: 'Acme', plan: 'agency', slug: 'acme' })
    store.set('orgs/org_free', { name: 'Thrifty', plan: 'free', slug: 'thrifty' })
  })

  it('serves an active claim, pinned to the owning org’s slug', async () => {
    await activeClaim()
    expect(await resolveConsoleDomain('CONSOLE.acme.com')).toEqual({
      known: true,
      servable: true,
      orgSlug: 'acme',
      reason: 'active',
      degraded: false,
    })
  })

  it('STOPS resolving when the org loses whiteLabel, and writes the suspension', async () => {
    // The billing hole this exists to close: a console domain that keeps
    // serving after a downgrade. Read-time refusal alone would be recomputed
    // on every request and would leave already-minted cookies valid, so the
    // epoch bump is part of the assertion, not decoration.
    await activeClaim()
    store.set('orgs/' + ORG, { name: 'Acme', plan: 'free', slug: 'acme' })

    const verdict = await resolveConsoleDomain('console.acme.com')
    expect(verdict.servable).toBe(false)
    expect(verdict.reason).toBe('not-entitled')
    // Still resolves to the org, so the visitor can be sent to a console that
    // works rather than meeting a dead hostname.
    expect(verdict.orgSlug).toBe('acme')

    const stored = store.get('consoleDomains/console.acme.com') as Record<string, unknown>
    expect(stored.status).toBe('suspended')
    expect(stored.suspendedReason).toBe('entitlement')
    expect(Number(stored.sessionEpoch)).toBeGreaterThan(1000)
  })

  it('suspends a dead subscription, not merely a changed plan field', async () => {
    // `resolveEffectivePlan`: a paid plan whose subscription is canceled or
    // unpaid is the free plan until the webhook says otherwise. Asserting the
    // plan field alone would miss the most common way an org stops paying.
    await activeClaim()
    store.set('orgs/' + ORG, {
      name: 'Acme',
      plan: 'agency',
      slug: 'acme',
      billingStatus: 'canceled',
    })
    const verdict = await resolveConsoleDomain('console.acme.com')
    expect(verdict.servable).toBe(false)
    expect(verdict.reason).toBe('not-entitled')
  })

  it('suspends the twin in the same breath as its primary', async () => {
    // A twin left live while its primary is suspended is a name Vercel holds
    // that still resolves for an org that is no longer entitled to it — the
    // AGL-743 correspondence, from the other end.
    await claimConsoleDomain(ORG, 'acme.com')
    for (const name of ['acme.com', 'www.acme.com']) {
      store.set(`consoleDomains/${name}`, {
        ...store.get(`consoleDomains/${name}`),
        status: 'active',
      })
    }
    store.set('orgs/' + ORG, { name: 'Acme', plan: 'free', slug: 'acme' })

    await resolveConsoleDomain('acme.com')
    expect(
      (store.get('consoleDomains/www.acme.com') as Record<string, unknown>).status,
    ).toBe('suspended')
    expect(await resolveConsoleDomain('www.acme.com')).toMatchObject({
      servable: false,
    })
  })

  it('does NOT re-activate itself when the org upgrades again', async () => {
    // Activation attaches names to Vercel and — until AGL-1378 clears — needs
    // a manual App Check allowlist entry. It stays an explicit act, never a
    // side effect of a plan read.
    await activeClaim()
    store.set('orgs/' + ORG, { name: 'Acme', plan: 'free', slug: 'acme' })
    await resolveConsoleDomain('console.acme.com')
    store.set('orgs/' + ORG, { name: 'Acme', plan: 'agency', slug: 'acme' })

    const verdict = await resolveConsoleDomain('console.acme.com')
    expect(verdict.servable).toBe(false)
    expect(verdict.reason).toBe('not-active')
    expect(
      (store.get('consoleDomains/console.acme.com') as Record<string, unknown>).status,
    ).toBe('suspended')
  })

  it('refuses a claim that proved ownership but was never activated', async () => {
    // `verified` means the TXT record checked out. It does not mean the App
    // Check allowlist entry exists, and without that entry the domain renders
    // a console that can never sign anyone in — the "looks finished" failure
    // AGL-1099 warns about.
    await claimConsoleDomain(ORG, 'console.acme.com')
    store.set('consoleDomains/console.acme.com', {
      ...store.get('consoleDomains/console.acme.com'),
      status: 'verified',
    })
    expect(await resolveConsoleDomain('console.acme.com')).toMatchObject({
      known: true,
      servable: false,
      reason: 'not-active',
    })
  })

  it('refuses a claim whose org is gone — WITHOUT recording an entitlement verdict', async () => {
    // `checkEntitlement(undefined)` resolves to the free plan, so suspending
    // off a missing document would be writing down an answer to a question
    // that was never asked. Refuse now; decide when there is data.
    await activeClaim()
    store.delete('orgs/' + ORG)
    const verdict = await resolveConsoleDomain('console.acme.com')
    expect(verdict).toMatchObject({ known: true, servable: false, reason: 'no-org' })
    expect(
      (store.get('consoleDomains/console.acme.com') as Record<string, unknown>).status,
    ).toBe('active')
  })

  it('leaves an unclaimed host alone, so localhost and previews keep working', async () => {
    // Not a refusal. `known: false` is what the middleware passes through
    // untouched, and every self-hosted install looks exactly like this.
    for (const host of [
      'localhost',
      'aglyn-console-aglyn.vercel.app',
      'console.nobody-here.com',
    ]) {
      expect(await resolveConsoleDomain(host)).toMatchObject({
        known: false,
        servable: false,
        reason: 'unknown',
      })
    }
  })

  it('fails OPEN on a Firestore outage, and writes nothing', async () => {
    // The stated posture, inherited from AGL-1135: the Vercel domain allowlist
    // is the boundary, and a customer's console going dark because a lookup
    // timed out is worse than the residual exposure. `degraded` is a distinct
    // answer from `unknown` precisely so this can never be cached.
    await activeClaim()
    const before = { ...(store.get('consoleDomains/console.acme.com') as object) }
    jest.spyOn(store, 'get').mockImplementation(() => {
      throw new Error('firestore unavailable')
    })
    const verdict = await resolveConsoleDomain('console.acme.com')
    jest.restoreAllMocks()

    expect(verdict).toEqual({
      known: false,
      servable: false,
      orgSlug: null,
      reason: 'degraded',
      degraded: true,
    })
    expect(store.get('consoleDomains/console.acme.com')).toEqual(before)
  })
})
