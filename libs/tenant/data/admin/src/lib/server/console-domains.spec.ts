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

function respond(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
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
  fetchMock.mockReset().mockResolvedValue(respond(200))
  global.fetch = fetchMock as unknown as typeof fetch
  resolveChallengeTxt.mockReset().mockResolvedValue([])
  process.env.VERCEL_TOKEN = 'tok_test'
  process.env.VERCEL_CONSOLE_PROJECT_ID = 'prj_console'
  process.env.VERCEL_TEAM_ID = 'team_test'
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
