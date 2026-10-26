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
 * The account-holder ad audience (AGL-3780): normalization and hashing per
 * provider, who is eligible, the diff, each provider's request against a
 * fixture, and one whole run against an in-memory store and a recorded fetch.
 * The stage lists (AGL-4072): who is in which stage, their configuration,
 * their own ledgers and the counts the report carries for each.
 * No network: every request is captured, never sent.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AD_AUDIENCE_LAPSE_MS,
  adAudienceExclusion,
  adAudienceStages,
  buildGoogleMemberRequests,
  buildGoogleTokenRequest,
  buildLinkedInUserRequests,
  buildMetaReplaceRequests,
  diffAudience,
  hashAudienceEmail,
  instantMs,
  isLapsedAccount,
  isOwnPublishedScreen,
  isRealActivityAction,
  isSuspiciousShrink,
  linkedInRefusedCount,
  normalizeAudienceEmail,
  readAdAudienceConfig,
  resolveAccountCountry,
  sha256Hex,
  stageListVariable,
  type AdAudienceAccount,
  type AdAudienceConfig,
  type AdAudienceStageFacts,
} from './ad-audience-sync'
import {
  adAudienceLedgerId,
  readAdAudienceAccounts,
  readSentHashes,
  runAdAudienceSync,
  selectAdAudience,
  type AudienceFetch,
} from './ad-audience-sync-run'

/** The published SHA-256 of `test@example.com`. */
const TEST_HASH = '973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b'

const account = (overrides: Partial<AdAudienceAccount> = {}): AdAudienceAccount => ({
  uid: 'u1',
  email: 'person@example.com',
  emailVerified: true,
  disabled: false,
  staff: false,
  optedOut: false,
  locked: false,
  banned: false,
  billingCountries: [],
  signupCountry: 'US',
  ...overrides,
})

describe('normalization and hashing', () => {
  it('hashes a normalized address to lowercase SHA-256 hex', () => {
    expect(sha256Hex('test@example.com')).toBe(TEST_HASH)
    expect(hashAudienceEmail('meta', '  Test@Example.COM ')).toBe(TEST_HASH)
    expect(hashAudienceEmail('linkedin', 'Test@Example.com')).toBe(TEST_HASH)
    expect(hashAudienceEmail('google', 'TEST@example.com')).toBe(TEST_HASH)
  })

  it('normalizes the way each provider documents', () => {
    // Meta: trim and lowercase, nothing else.
    expect(normalizeAudienceEmail('meta', ' John.Smith+ads@Gmail.com ')).toBe('john.smith+ads@gmail.com')
    // LinkedIn: lowercase and no white space anywhere.
    expect(normalizeAudienceEmail('linkedin', 'Jo hn@Example.com')).toBe('john@example.com')
    // Google: and on gmail.com / googlemail.com, no dots and no plus suffix.
    expect(normalizeAudienceEmail('google', ' John.Smith+ads@Gmail.com')).toBe('johnsmith@gmail.com')
    expect(normalizeAudienceEmail('google', 'j.s+x@googlemail.com')).toBe('js@googlemail.com')
    // Other domains keep both.
    expect(normalizeAudienceEmail('google', 'John.Smith+ads@example.com')).toBe('john.smith+ads@example.com')
    expect(hashAudienceEmail('google', 'John.Smith@gmail.com')).toBe(
      '3586de92bb3636d0885a12eff961429a32e4ebd764b96f50d85d016f9338d586',
    )
  })

  it('refuses what is not an address', () => {
    for (const raw of [null, undefined, '', 'nobody', '@example.com', 'a@', 'a@b@c', 42]) {
      expect(hashAudienceEmail('meta', raw)).toBeNull()
    }
    expect(normalizeAudienceEmail('google', '+tag@gmail.com')).toBeNull()
  })
})

describe('the country signal', () => {
  it('takes the billing address of an owned workspace first', () => {
    expect(resolveAccountCountry({ billingCountries: ['us'], signupCountry: 'GB' })).toEqual({
      country: 'US',
      source: 'billing',
    })
    expect(resolveAccountCountry({ billingCountries: ['CA'], signupCountry: 'US' })).toEqual({
      country: 'CA',
      source: 'billing',
    })
  })

  it('counts an account as US only when every owned workspace bills from the US', () => {
    expect(resolveAccountCountry({ billingCountries: ['US', 'DE'], signupCountry: 'US' }).country).toBe('DE')
    expect(resolveAccountCountry({ billingCountries: ['US', 'US'], signupCountry: null }).country).toBe('US')
  })

  it('falls back to the sign-up country, then to nothing', () => {
    expect(resolveAccountCountry({ billingCountries: [], signupCountry: 'us' })).toEqual({
      country: 'US',
      source: 'signup',
    })
    expect(resolveAccountCountry({ billingCountries: ['United States'], signupCountry: null })).toEqual({
      country: null,
      source: null,
    })
  })
})

describe('eligibility', () => {
  it('includes a verified US account holder', () => {
    expect(adAudienceExclusion(account())).toBeNull()
  })

  it.each([
    ['no-email', { email: null }],
    ['disabled', { disabled: true }],
    ['staff', { staff: true }],
    ['locked', { locked: true }],
    ['banned', { banned: true }],
    ['opted-out', { optedOut: true }],
    ['unverified', { emailVerified: false }],
    ['no-country', { signupCountry: null }],
    ['not-us', { signupCountry: 'GB' }],
    ['not-us', { billingCountries: ['MX'], signupCountry: 'US' }],
  ] as const)('leaves out %s', (reason, overrides) => {
    expect(adAudienceExclusion(account(overrides))).toBe(reason)
  })

  it("leaves out the operator's own domain", () => {
    expect(
      adAudienceExclusion(account({ email: 'Zed@Operator.Example' }), {
        internalDomains: ['operator.example'],
      }),
    ).toBe('internal')
  })

  it('names the ban before the opt-out, so a banned account never reads as a choice', () => {
    expect(adAudienceExclusion(account({ locked: true, optedOut: true }))).toBe('locked')
  })
})

describe('the diff', () => {
  it('adds what is new and removes what is gone', () => {
    expect(diffAudience(['a', 'b', 'c'], ['b', 'c', 'd', 'e'])).toEqual({
      toAdd: ['d', 'e'],
      toRemove: ['a'],
    })
    expect(diffAudience([], ['x'])).toEqual({ toAdd: ['x'], toRemove: [] })
    expect(diffAudience(['x'], ['x'])).toEqual({ toAdd: [], toRemove: [] })
  })

  it('holds a night that loses more than half of a real audience', () => {
    expect(isSuspiciousShrink(100, 49)).toBe(true)
    expect(isSuspiciousShrink(100, 50)).toBe(false)
    expect(isSuspiciousShrink(10, 0)).toBe(false)
  })
})

const ENV = {
  META_AUDIENCE_SYNC_ACCESS_TOKEN: 'meta-token',
  META_AUDIENCE_SYNC_AUDIENCE_ID: '2384000000000',
  GOOGLE_AUDIENCE_SYNC_CLIENT_ID: 'client-id',
  GOOGLE_AUDIENCE_SYNC_CLIENT_SECRET: 'client-secret',
  GOOGLE_AUDIENCE_SYNC_REFRESH_TOKEN: 'refresh-token',
  GOOGLE_AUDIENCE_SYNC_CUSTOMER_ID: '841-500-9958',
  GOOGLE_AUDIENCE_SYNC_LOGIN_CUSTOMER_ID: '',
  GOOGLE_AUDIENCE_SYNC_USER_LIST_ID: '9000001',
  LINKEDIN_AUDIENCE_SYNC_ACCESS_TOKEN: 'li-token',
  LINKEDIN_AUDIENCE_SYNC_SEGMENT_ID: 'urn:li:dmpSegment:10804',
}

describe('configuration', () => {
  it('reads every provider and normalizes its ids', () => {
    const config = readAdAudienceConfig(ENV)
    expect(config.meta).toEqual({ accessToken: 'meta-token', audienceId: '2384000000000' })
    expect(config.google?.customerId).toBe('8415009958')
    expect(config.google?.loginCustomerId).toBeNull()
    expect(config.linkedin?.segmentId).toBe('10804')
  })

  it('skips a half-configured provider and names what it lacks', () => {
    const config = readAdAudienceConfig({ ...ENV, META_AUDIENCE_SYNC_AUDIENCE_ID: ' ' })
    expect(config.meta).toBeNull()
    expect(config.missing.meta).toEqual(['META_AUDIENCE_SYNC_AUDIENCE_ID'])
    expect(readAdAudienceConfig({}).missing.linkedin).toEqual([
      'LINKEDIN_AUDIENCE_SYNC_ACCESS_TOKEN',
      'LINKEDIN_AUDIENCE_SYNC_SEGMENT_ID',
    ])
  })
})

describe('provider requests', () => {
  const config = readAdAudienceConfig(ENV) as Required<AdAudienceConfig> & {
    meta: NonNullable<AdAudienceConfig['meta']>
    google: NonNullable<AdAudienceConfig['google']>
    linkedin: NonNullable<AdAudienceConfig['linkedin']>
  }
  const many = Array.from({ length: 10_001 }, (_, index) => sha256Hex(`p${index}@example.com`))

  it('builds the Meta replace session in batches of 10,000', () => {
    const requests = buildMetaReplaceRequests(config.meta, many, 1_760_000_000_000)
    expect(requests).toHaveLength(2)
    expect(requests[0].url).toBe('https://graph.facebook.com/v25.0/2384000000000/usersreplace')
    expect(requests[0].body).toMatchObject({
      payload: { schema: 'EMAIL_SHA256' },
      session: {
        session_id: 1_760_000_000_000,
        batch_seq: 1,
        last_batch_flag: false,
        estimated_num_total: 10_001,
      },
      access_token: 'meta-token',
    })
    expect(((requests[0].body as { payload: { data: string[] } }).payload.data)).toHaveLength(10_000)
    expect(requests[1].body).toMatchObject({
      payload: { data: [many[10_000]] },
      session: { batch_seq: 2, last_batch_flag: true },
    })
  })

  it('builds the Google token exchange and Data Manager calls', () => {
    const token = buildGoogleTokenRequest(config.google)
    expect(token.url).toBe('https://oauth2.googleapis.com/token')
    expect(Object.fromEntries(new URLSearchParams(token.body as string))).toEqual({
      grant_type: 'refresh_token',
      client_id: 'client-id',
      client_secret: 'client-secret',
      refresh_token: 'refresh-token',
    })

    const [ingest] = buildGoogleMemberRequests(config.google, 'ya29.token', 'ingest', [TEST_HASH])
    expect(ingest.url).toBe('https://datamanager.googleapis.com/v1/audienceMembers:ingest')
    expect(ingest.headers['Authorization']).toBe('Bearer ya29.token')
    expect(ingest.body).toEqual({
      destinations: [
        {
          operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '8415009958' },
          productDestinationId: '9000001',
        },
      ],
      audienceMembers: [{ userData: { userIdentifiers: [{ emailAddress: TEST_HASH }] } }],
      encoding: 'HEX',
      termsOfService: { customerMatchTermsOfServiceStatus: 'ACCEPTED' },
    })
    // No consent is asserted for anybody.
    expect(JSON.stringify(ingest.body)).not.toContain('consent')

    const withManager = readAdAudienceConfig({ ...ENV, GOOGLE_AUDIENCE_SYNC_LOGIN_CUSTOMER_ID: '123-456-7890' })
    const [remove] = buildGoogleMemberRequests(
      withManager.google as NonNullable<AdAudienceConfig['google']>,
      't',
      'remove',
      [TEST_HASH],
    )
    expect(remove.url).toBe('https://datamanager.googleapis.com/v1/audienceMembers:remove')
    expect(remove.body).toMatchObject({
      destinations: [{ loginAccount: { accountType: 'GOOGLE_ADS', accountId: '1234567890' } }],
    })
    expect(remove.body).not.toHaveProperty('termsOfService')
    expect(buildGoogleMemberRequests(config.google, 't', 'ingest', many)).toHaveLength(2)
  })

  it('builds the LinkedIn batch in runs of 5,000', () => {
    const requests = buildLinkedInUserRequests(config.linkedin, 'REMOVE', many)
    expect(requests).toHaveLength(3)
    expect(requests[0].url).toBe('https://api.linkedin.com/rest/dmpSegments/10804/users')
    expect(requests[0].headers).toMatchObject({
      Authorization: 'Bearer li-token',
      'LinkedIn-Version': '202609',
      'X-Restli-Protocol-Version': '2.0.0',
      'X-RestLi-Method': 'BATCH_CREATE',
    })
    expect((requests[0].body as { elements: unknown[] }).elements[0]).toEqual({
      action: 'REMOVE',
      userIds: [{ idType: 'SHA256_EMAIL', idValue: many[0] }],
    })
    expect(linkedInRefusedCount({ elements: [{ status: 201 }, { status: 400 }] })).toBe(1)
    expect(linkedInRefusedCount(null)).toBe(0)
  })
})

/*==========================================
 * ONE RUN, AGAINST AN IN-MEMORY STORE
 *=========================================*/

type Docs = Map<string, Record<string, unknown>>

/**
 * Just enough Firestore for the run: paths, select, an id range, set, delete,
 * and a collection group paged by path.
 */
function fakeFirestore(seed: Record<string, Record<string, unknown>> = {}) {
  const docs: Docs = new Map(Object.entries(seed))
  const get = (data: Record<string, unknown>, path: string) =>
    path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], data)
  const snapshot = (path: string) => {
    const data = docs.get(path)
    return {
      id: path.split('/').pop() as string,
      exists: Boolean(data),
      data: () => data,
      get: (field: string) => (data ? get(data, field) : undefined),
      ref: { path, delete: async () => void docs.delete(path) },
    }
  }
  const collection = (base: string): any => {
    const children = () =>
      [...docs.keys()]
        .filter((path) => path.startsWith(`${base}/`) && !path.slice(base.length + 1).includes('/'))
        .sort()
    const query = (filter: (id: string) => boolean = () => true): any => ({
      select: () => query(filter),
      where: (_field: unknown, op: string, value: string) =>
        query((id) => filter(id) && (op === '>=' ? id >= value : op === '<' ? id < value : true)),
      get: async () => ({
        docs: children()
          .filter((path) => filter(path.split('/').pop() as string))
          .map(snapshot),
      }),
    })
    return {
      ...query(),
      doc: (id: string) => {
        const path = `${base}/${id}`
        return {
          get: async () => snapshot(path),
          set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
            docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...data } : data)
          },
          collection: (name: string) => collection(`${path}/${name}`),
        }
      },
    }
  }
  const collectionGroup = (name: string): any => {
    const group = (after: string | null, size: number): any => ({
      orderBy: () => group(after, size),
      select: () => group(after, size),
      limit: (next: number) => group(after, next),
      startAfter: (snap: { ref: { path: string } }) => group(snap.ref.path, size),
      get: async () => ({
        docs: [...docs.keys()]
          .filter((path) => {
            const parts = path.split('/')
            return parts.length % 2 === 0 && parts[parts.length - 2] === name
          })
          .sort()
          .filter((path) => after === null || path > after)
          .slice(0, size)
          .map(snapshot),
      }),
    })
    return group(null, Infinity)
  }
  return { docs, firestore: { collection, collectionGroup } as unknown as FirebaseFirestore.Firestore }
}

/** A fetch that records each call and answers from a script. */
function recordingFetch(answer: (url: string) => { status: number; body: unknown } = () => ({
  status: 200,
  body: {},
})) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = []
  const fetcher: AudienceFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body })
    const { status, body } = url.endsWith('/token')
      ? { status: 200, body: { access_token: 'ya29.fresh' } }
      : answer(url)
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }
  return { calls, fetcher }
}

describe('reading the accounts', () => {
  it('joins Auth with the opt-out, the sign-up and billing countries, the locks and the ban list', async () => {
    const now = 1_760_000_000_000
    const { firestore } = fakeFirestore({
      'users/a': { acquisition: { geo: { country: 'US' } } },
      'users/b': { adAudienceOptOut: { atMs: 1, by: 'staff-1' } },
      'orgs/o1': { ownerUid: 'c', contact: { address: { country: 'CA' } } },
      'orgs/o2': { ownerUid: 'c', contact: { address: { country: 'US' } } },
      'lockdowns/user--d': { reason: 'abuse', untilMs: now - 1 },
      'lockdowns/user--e': { reason: 'maintenance', untilMs: now - 1 },
      'lockdowns/user--f': { reason: 'security' },
      'lockdowns/platform': { reason: 'manual' },
    })
    const record = (uid: string, email?: string) => ({
      record: { uid, email, emailVerified: true, disabled: false },
    })
    const pages = [
      { users: [record('a', 'a@x.com'), record('b', 'b@x.com')], nextPageToken: 'p2' },
      { users: [record('c', 'c@x.com'), record('d'), record('e', 'E@x.com'), record('f', 'f@x.com')], nextPageToken: null },
    ]
    const { accounts } = await readAdAudienceAccounts({
      firestore,
      listUserPage: async (_size, token) => (token ? pages[1] : pages[0]),
      bannedEmails: async (emails) => new Set(emails.filter((email) => email === 'E@x.com').map((e) => e.toLowerCase())),
      now,
    })
    const by = Object.fromEntries(accounts.map((entry) => [entry.uid, entry]))
    expect(by['a']).toMatchObject({ signupCountry: 'US', optedOut: false, locked: false })
    expect(by['b'].optedOut).toBe(true)
    expect(by['c'].billingCountries).toEqual(['CA', 'US'])
    // An expired abuse lock is still a ban; an expired maintenance lock is not.
    expect(by['d'].locked).toBe(true)
    expect(by['e']).toMatchObject({ locked: false, banned: true })
    expect(by['f'].locked).toBe(true)
  })
})

describe('a run', () => {
  const eligible = [
    account({ uid: 'u1', email: 'one@example.com' }),
    account({ uid: 'u2', email: 'two@example.com' }),
    account({ uid: 'u3', email: 'abroad@example.com', signupCountry: 'FR' }),
  ]
  const config = readAdAudienceConfig(ENV)
  const base = {
    flagOn: true,
    config,
    internalDomains: [],
    accounts: eligible,
    now: 1_760_000_000_000,
    log: () => undefined,
  }

  it('sends nothing on a dry run, and reports counts only', async () => {
    const { firestore, docs } = fakeFirestore()
    const { calls, fetcher } = recordingFetch()
    const report = await runAdAudienceSync({ ...base, dryRun: true, firestore, fetch: fetcher })
    expect(calls).toEqual([])
    expect(docs.size).toBe(0)
    expect(report.eligible).toBe(2)
    expect(report.excluded['not-us']).toBe(1)
    expect(report.providers.meta).toMatchObject({ outcome: 'dry-run', eligible: 2, toAdd: 2, toRemove: 0 })
    // Neither an address nor a hash is in the report.
    const text = JSON.stringify(report)
    expect(text).not.toContain('@example.com')
    expect(text).not.toContain(hashAudienceEmail('meta', 'one@example.com') as string)
  })

  it('sends nothing while the flag is off', async () => {
    const { firestore } = fakeFirestore()
    const { calls, fetcher } = recordingFetch()
    const report = await runAdAudienceSync({ ...base, dryRun: false, flagOn: false, firestore, fetch: fetcher })
    expect(calls).toEqual([])
    expect(report.providers.google.outcome).toBe('flag-off')
  })

  it('skips an unconfigured provider with the variables it lacks', async () => {
    const { firestore } = fakeFirestore()
    const { calls, fetcher } = recordingFetch()
    const lines: string[] = []
    const report = await runAdAudienceSync({
      ...base,
      dryRun: false,
      config: readAdAudienceConfig({}),
      firestore,
      fetch: fetcher,
      log: (line) => lines.push(line),
    })
    expect(calls).toEqual([])
    expect(report.providers.linkedin).toMatchObject({ outcome: 'unconfigured' })
    expect(lines.join('\n')).toContain('linkedin skipped — set LINKEDIN_AUDIENCE_SYNC_ACCESS_TOKEN')
  })

  it('sends each provider its diff, records what it sent, and removes on the next night', async () => {
    const { firestore, docs } = fakeFirestore()
    const first = recordingFetch()
    const report = await runAdAudienceSync({ ...base, dryRun: false, firestore, fetch: first.fetcher })
    expect(report.providers.meta.outcome).toBe('sent')
    expect(report.providers.google.outcome).toBe('sent')
    expect(report.providers.linkedin.outcome).toBe('sent')
    expect(first.calls.map((call) => call.url)).toEqual([
      'https://graph.facebook.com/v25.0/2384000000000/usersreplace',
      'https://oauth2.googleapis.com/token',
      'https://datamanager.googleapis.com/v1/audienceMembers:ingest',
      'https://api.linkedin.com/rest/dmpSegments/10804/users',
    ])
    expect(await readSentHashes(firestore, 'google')).toHaveLength(2)
    expect(docs.get('adAudienceSync/meta')).toMatchObject({ lastOutcome: 'sent', members: 2, lastAdded: 2 })

    // u2 is erased: the next night removes their hash, and Meta replaces.
    const second = recordingFetch()
    const next = await runAdAudienceSync({
      ...base,
      accounts: [eligible[0]],
      dryRun: false,
      now: base.now + 86_400_000,
      firestore,
      fetch: second.fetcher,
    })
    expect(next.providers.google).toMatchObject({ outcome: 'sent', toAdd: 0, toRemove: 1 })
    expect(second.calls.map((call) => call.url)).toContain(
      'https://datamanager.googleapis.com/v1/audienceMembers:remove',
    )
    const linkedin = second.calls.find((call) => call.url.includes('linkedin'))
    expect(JSON.parse(linkedin?.body ?? '{}').elements).toEqual([
      {
        action: 'REMOVE',
        userIds: [{ idType: 'SHA256_EMAIL', idValue: hashAudienceEmail('linkedin', 'two@example.com') }],
      },
    ])
    expect(await readSentHashes(firestore, 'linkedin')).toEqual([hashAudienceEmail('linkedin', 'one@example.com')])

    // Nothing changed the third night: nothing is sent.
    const third = recordingFetch()
    const quiet = await runAdAudienceSync({
      ...base,
      accounts: [eligible[0]],
      dryRun: false,
      firestore,
      fetch: third.fetcher,
    })
    expect(third.calls).toEqual([])
    expect(quiet.providers.meta.outcome).toBe('unchanged')
  })

  it('keeps the stored set when a provider refuses, and fails that provider alone', async () => {
    const { firestore } = fakeFirestore()
    const { fetcher } = recordingFetch((url) =>
      url.includes('linkedin')
        ? { status: 403, body: { message: 'Not enough permissions to access: dmpSegments' } }
        : { status: 200, body: {} },
    )
    const report = await runAdAudienceSync({ ...base, dryRun: false, firestore, fetch: fetcher })
    expect(report.providers.linkedin).toMatchObject({
      outcome: 'failed',
      error: 'linkedin answered 403: Not enough permissions to access: dmpSegments',
    })
    expect(report.providers.meta.outcome).toBe('sent')
    expect(await readSentHashes(firestore, 'linkedin')).toEqual([])
  })

  it('holds a night that would empty most of the audience, unless forced', async () => {
    const big = Array.from({ length: 30 }, (_, index) =>
      account({ uid: `u${index}`, email: `p${index}@example.com` }),
    )
    const { firestore } = fakeFirestore()
    await runAdAudienceSync({ ...base, accounts: big, dryRun: false, firestore, fetch: recordingFetch().fetcher })
    const held = recordingFetch()
    const report = await runAdAudienceSync({
      ...base,
      accounts: big.slice(0, 5),
      dryRun: false,
      firestore,
      fetch: held.fetcher,
    })
    expect(held.calls).toEqual([])
    expect(report.providers.meta.outcome).toBe('held-shrink')
    const forced = await runAdAudienceSync({
      ...base,
      accounts: big.slice(0, 5),
      dryRun: false,
      force: true,
      firestore,
      fetch: recordingFetch().fetcher,
    })
    expect(forced.providers.meta.outcome).toBe('sent')
  })
})

/*==========================================
 * STAGE LISTS (AGL-4072)
 *=========================================*/

const NOW = 1_760_000_000_000
const DAY = 86_400_000

const facts = (overrides: Partial<AdAudienceStageFacts> = {}): AdAudienceStageFacts => ({
  createdAtMs: NOW - 90 * DAY,
  ownsPaidWorkspace: false,
  ownsPublishedSite: false,
  lastActivityAtMs: NOW - DAY,
  ...overrides,
})

describe('who is in which stage', () => {
  it('puts an account in exactly one of paid, free published and free not published', () => {
    expect(adAudienceStages(account({ stageFacts: facts() }), NOW)).toEqual(['free-unpublished'])
    expect(adAudienceStages(account({ stageFacts: facts({ ownsPublishedSite: true }) }), NOW)).toEqual([
      'free-published',
    ])
    // Paid wins over published: a paying account is in the paid list only.
    expect(
      adAudienceStages(account({ stageFacts: facts({ ownsPaidWorkspace: true, ownsPublishedSite: true }) }), NOW),
    ).toEqual(['paid'])
  })

  it('adds lapsed on top, and puts an account read without stage facts in none', () => {
    expect(
      adAudienceStages(account({ stageFacts: facts({ ownsPaidWorkspace: true, lastActivityAtMs: null }) }), NOW),
    ).toEqual(['paid', 'lapsed'])
    expect(adAudienceStages(account(), NOW)).toEqual([])
  })

  it('lapses only past 30 days of age and 30 days of quiet', () => {
    const window = AD_AUDIENCE_LAPSE_MS
    expect(window).toBe(30 * DAY)
    // Exactly 30 days old is not yet older than the window.
    expect(isLapsedAccount(facts({ createdAtMs: NOW - window, lastActivityAtMs: null }), NOW)).toBe(false)
    expect(isLapsedAccount(facts({ createdAtMs: NOW - window - 1, lastActivityAtMs: null }), NOW)).toBe(true)
    // Activity exactly 30 days ago is still inside the window.
    expect(isLapsedAccount(facts({ lastActivityAtMs: NOW - window }), NOW)).toBe(false)
    expect(isLapsedAccount(facts({ lastActivityAtMs: NOW - window - 1 }), NOW)).toBe(true)
    // No creation time is no telling it from an account made today.
    expect(isLapsedAccount(facts({ createdAtMs: null, lastActivityAtMs: null }), NOW)).toBe(false)
  })

  it("counts a page as published and the owner's only when a person worked on it", () => {
    const live = { publishedAt: NOW - DAY, createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY + 1_000 }
    // The starter page every new site is born with, published and untouched.
    expect(isOwnPublishedScreen(live, NOW)).toBe(false)
    expect(isOwnPublishedScreen({ ...live, createdBy: 'u1' }, NOW)).toBe(true)
    expect(isOwnPublishedScreen({ ...live, updatedAt: NOW - DAY }, NOW)).toBe(true)
    expect(isOwnPublishedScreen({ ...live, createdBy: 'u1', publishedAt: NOW + DAY }, NOW)).toBe(false)
    expect(isOwnPublishedScreen({ ...live, createdBy: 'u1', deletedAt: NOW }, NOW)).toBe(false)
    expect(isOwnPublishedScreen({ ...live, createdBy: 'u1', publishedAt: null }, NOW)).toBe(false)
    // A Firestore timestamp reads the same as its milliseconds.
    expect(
      isOwnPublishedScreen({ ...live, createdBy: 'u1', publishedAt: { toMillis: () => NOW - DAY } }, NOW),
    ).toBe(true)
  })

  it('skips the change-log entries the platform writes under the person', () => {
    expect(isRealActivityAction('Edited the page')).toBe(true)
    for (const action of ['ai.job.output', 'Created the site', 'Started from the starter site', '', null]) {
      expect(isRealActivityAction(action)).toBe(false)
    }
    expect(instantMs({ _seconds: 2 })).toBe(2_000)
    expect(instantMs('2026-10-01T00:00:00Z')).toBe(Date.parse('2026-10-01T00:00:00Z'))
    expect(instantMs('soon')).toBeNull()
  })

  it('counts each stage only among the eligible', () => {
    const selection = selectAdAudience(
      [
        account({ uid: 'a', stageFacts: facts({ ownsPaidWorkspace: true }) }),
        account({ uid: 'b', stageFacts: facts({ ownsPublishedSite: true, lastActivityAtMs: null }) }),
        account({ uid: 'c', stageFacts: facts() }),
        // Left out of the audience, so out of every stage too.
        account({ uid: 'd', signupCountry: 'FR', stageFacts: facts({ ownsPaidWorkspace: true }) }),
      ],
      [],
      NOW,
    )
    expect(
      Object.fromEntries(Object.entries(selection.stages).map(([stage, list]) => [stage, list.length])),
    ).toEqual({ 'free-unpublished': 1, 'free-published': 1, paid: 1, lapsed: 1 })
  })
})

describe('stage configuration', () => {
  it('names one list id variable per provider and stage', () => {
    expect(stageListVariable('meta', 'free-unpublished')).toBe(
      'META_AUDIENCE_SYNC_STAGE_FREE_UNPUBLISHED_AUDIENCE_ID',
    )
    expect(stageListVariable('google', 'lapsed')).toBe('GOOGLE_AUDIENCE_SYNC_STAGE_LAPSED_USER_LIST_ID')
    expect(stageListVariable('linkedin', 'paid')).toBe('LINKEDIN_AUDIENCE_SYNC_STAGE_PAID_SEGMENT_ID')
  })

  it('skips a stage whose id is unset, and names it', () => {
    const config = readAdAudienceConfig(ENV)
    expect(config.stages.paid.meta).toBeNull()
    expect(config.stages.paid.missing.meta).toEqual(['META_AUDIENCE_SYNC_STAGE_PAID_AUDIENCE_ID'])
    expect(config.stages.lapsed.google).toBeNull()
    // The all-holders list is read exactly as before.
    expect(config.meta).toEqual({ accessToken: 'meta-token', audienceId: '2384000000000' })
  })

  it('reuses the provider credentials for a stage, without needing the all-holders id', () => {
    const config = readAdAudienceConfig({
      ...ENV,
      META_AUDIENCE_SYNC_AUDIENCE_ID: '',
      GOOGLE_AUDIENCE_SYNC_USER_LIST_ID: '',
      META_AUDIENCE_SYNC_STAGE_PAID_AUDIENCE_ID: ' 2384000000099 ',
      GOOGLE_AUDIENCE_SYNC_STAGE_PAID_USER_LIST_ID: '9000-099',
      LINKEDIN_AUDIENCE_SYNC_STAGE_PAID_SEGMENT_ID: 'urn:li:dmpSegment:20099',
    })
    expect(config.meta).toBeNull()
    expect(config.stages.paid.meta).toEqual({ accessToken: 'meta-token', audienceId: '2384000000099' })
    expect(config.stages.paid.google).toMatchObject({ customerId: '8415009958', userListId: '9000099' })
    expect(config.stages.paid.linkedin).toEqual({ accessToken: 'li-token', segmentId: '20099' })
    // A stage with its id but no credentials is skipped like any list.
    const bare = readAdAudienceConfig({ META_AUDIENCE_SYNC_STAGE_LAPSED_AUDIENCE_ID: '1' })
    expect(bare.stages.lapsed.meta).toBeNull()
    expect(bare.stages.lapsed.missing.meta).toEqual(['META_AUDIENCE_SYNC_ACCESS_TOKEN'])
  })
})

describe('reading the stage facts', () => {
  it('reads the plan, the own published pages and recent activity, never a sign-in time', async () => {
    const us = { acquisition: { geo: { country: 'US' } } }
    const { firestore } = fakeFirestore({
      ...Object.fromEntries(
        ['paid', 'canceled', 'comped', 'starter', 'new', 'internal'].map((uid) => [`users/${uid}`, us]),
      ),
      // Paid on a live subscription.
      'orgs/o1': { ownerUid: 'paid', plan: 'pro', billingStatus: 'active', hosts: { h1: true } },
      // A canceled subscription is Free, whatever plan it names.
      'orgs/o2': { ownerUid: 'canceled', plan: 'pro', billingStatus: 'canceled', hosts: { h2: true } },
      // A staff comp is the plan it grants.
      'orgs/o3': { ownerUid: 'comped', plan: 'free', entitlements: { planComp: { plan: 'pro' } } },
      'orgs/o4': { ownerUid: 'starter', plan: 'free', hosts: { h4: true } },
      'hosts/h2/screens/home': { publishedAt: NOW - DAY, createdBy: 'canceled' },
      // The untouched starter home: published, but not the owner's doing.
      'hosts/h4/screens/home': { publishedAt: NOW - DAY, createdAt: NOW - 40 * DAY, updatedAt: NOW - 40 * DAY },
      // A page under some other `screens` is not a site's.
      'templates/t1/screens/home': { publishedAt: NOW - DAY, createdBy: 'starter' },
    })
    const record = (uid: string, createdDaysAgo: number, email = `${uid}@example.com`) => ({
      record: {
        uid,
        email,
        emailVerified: true,
        disabled: false,
        metadata: {
          creationTime: new Date(NOW - createdDaysAgo * DAY).toUTCString(),
          // Signed in an hour ago — silently, for all this read can tell.
          lastSignInTime: new Date(NOW - 3_600_000).toUTCString(),
          lastRefreshTime: new Date(NOW - 3_600_000).toUTCString(),
        },
      },
    })
    const asked: string[] = []
    const { accounts } = await readAdAudienceAccounts({
      firestore,
      listUserPage: async () => ({
        users: [
          record('paid', 90),
          record('canceled', 90),
          record('comped', 90),
          record('starter', 90),
          record('new', 5),
          record('internal', 90, 'internal@operator.example'),
        ],
        nextPageToken: null,
      }),
      bannedEmails: async () => new Set(),
      now: NOW,
      internalDomains: ['operator.example'],
      recentActivity: async (uid, sinceMs) => {
        asked.push(uid)
        expect(sinceMs).toBe(NOW - AD_AUDIENCE_LAPSE_MS)
        return uid === 'paid' ? NOW - 2 * DAY : null
      },
    })
    const by = Object.fromEntries(accounts.map((entry) => [entry.uid, entry.stageFacts]))
    expect(by['paid']).toMatchObject({ ownsPaidWorkspace: true, lastActivityAtMs: NOW - 2 * DAY })
    expect(by['canceled']).toMatchObject({ ownsPaidWorkspace: false, ownsPublishedSite: true })
    expect(by['comped']?.ownsPaidWorkspace).toBe(true)
    expect(by['starter']).toMatchObject({ ownsPaidWorkspace: false, ownsPublishedSite: false })
    // Only accounts in the audience and old enough to lapse have their log read.
    expect(asked.sort()).toEqual(['canceled', 'comped', 'paid', 'starter'])
    const stages = selectAdAudience(accounts, ['operator.example'], NOW).stages
    // The hour-old sign-in is not activity: every quiet old account lapsed.
    expect(stages.lapsed.map((entry) => entry.uid).sort()).toEqual(['canceled', 'comped', 'starter'])
    expect(stages.paid.map((entry) => entry.uid).sort()).toEqual(['comped', 'paid'])
    expect(stages['free-published'].map((entry) => entry.uid)).toEqual(['canceled'])
    expect(stages['free-unpublished'].map((entry) => entry.uid).sort()).toEqual(['new', 'starter'])
  })
})

describe('a stage read that fails', () => {
  it('leaves that account in no stage, never lapsed by mistake, and reads on', async () => {
    const { firestore } = fakeFirestore({
      'users/a': { acquisition: { geo: { country: 'US' } } },
      'users/b': { acquisition: { geo: { country: 'US' } } },
    })
    const old = new Date(NOW - 90 * DAY).toUTCString()
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { accounts } = await readAdAudienceAccounts({
      firestore,
      listUserPage: async () => ({
        users: ['a', 'b'].map((uid) => ({
          record: {
            uid,
            email: `${uid}@example.com`,
            emailVerified: true,
            disabled: false,
            metadata: { creationTime: old },
          },
        })),
        nextPageToken: null,
      }),
      bannedEmails: async () => new Set(),
      now: NOW,
      recentActivity: async (uid) => {
        if (uid === 'a') throw new Error('deadline exceeded')
        return null
      },
    })
    spy.mockRestore()
    const selection = selectAdAudience(accounts, [], NOW)
    // Both stay in the all-holders audience.
    expect(selection.eligible).toHaveLength(2)
    expect(accounts.find((entry) => entry.uid === 'a')?.stageFacts).toBeUndefined()
    expect(selection.stages.lapsed.map((entry) => entry.uid)).toEqual(['b'])
  })
})

describe('a run with stage lists', () => {
  const people = [
    account({ uid: 'p1', email: 'paid1@example.com', stageFacts: facts({ ownsPaidWorkspace: true }) }),
    account({ uid: 'p2', email: 'paid2@example.com', stageFacts: facts({ ownsPaidWorkspace: true }) }),
    account({ uid: 'f1', email: 'free1@example.com', stageFacts: facts({ lastActivityAtMs: null }) }),
  ]
  const config = readAdAudienceConfig({
    ...ENV,
    META_AUDIENCE_SYNC_STAGE_PAID_AUDIENCE_ID: '2384000000077',
    GOOGLE_AUDIENCE_SYNC_STAGE_PAID_USER_LIST_ID: '9000077',
  })
  const base = {
    flagOn: true,
    config,
    internalDomains: [],
    accounts: people,
    now: NOW,
    log: () => undefined,
  }

  it("reports every stage's count on a dry run, set or not, and nothing per person", async () => {
    const { firestore, docs } = fakeFirestore()
    const { calls, fetcher } = recordingFetch()
    const report = await runAdAudienceSync({ ...base, dryRun: true, firestore, fetch: fetcher })
    expect(calls).toEqual([])
    expect(docs.size).toBe(0)
    expect(report.stages['paid']).toMatchObject({
      eligible: 2,
      providers: { meta: { outcome: 'dry-run', toAdd: 2 }, linkedin: { outcome: 'unconfigured' } },
    })
    expect(report.stages['free-unpublished'].eligible).toBe(1)
    expect(report.stages['lapsed']).toMatchObject({
      eligible: 1,
      providers: { meta: { outcome: 'unconfigured', missing: ['META_AUDIENCE_SYNC_STAGE_LAPSED_AUDIENCE_ID'] } },
    })
    expect(report.stages['free-published'].eligible).toBe(0)
    const text = JSON.stringify(report)
    expect(text).not.toContain('@example.com')
    expect(text).not.toContain(hashAudienceEmail('meta', 'paid1@example.com') as string)
  })

  it('sends each stage list to its own id and keeps its own ledger', async () => {
    const { firestore, docs } = fakeFirestore()
    const first = recordingFetch()
    const report = await runAdAudienceSync({ ...base, dryRun: false, firestore, fetch: first.fetcher })
    expect(report.providers.meta).toMatchObject({ outcome: 'sent', eligible: 3 })
    expect(report.stages.paid.providers.meta).toMatchObject({ outcome: 'sent', eligible: 2 })
    expect(report.stages.paid.providers.google).toMatchObject({ outcome: 'sent', eligible: 2 })
    const metaCalls = first.calls.filter((call) => call.url.includes('graph.facebook.com'))
    expect(metaCalls.map((call) => call.url)).toEqual([
      'https://graph.facebook.com/v25.0/2384000000000/usersreplace',
      'https://graph.facebook.com/v25.0/2384000000077/usersreplace',
    ])
    // Two replace sessions in one ad account in one run: two session ids.
    const sessions = metaCalls.map((call) => JSON.parse(call.body).session.session_id)
    expect(new Set(sessions).size).toBe(2)
    const ingest = first.calls.filter((call) => call.url.endsWith('audienceMembers:ingest'))
    expect(ingest.map((call) => JSON.parse(call.body).destinations[0].productDestinationId)).toEqual([
      '9000001',
      '9000077',
    ])
    expect(adAudienceLedgerId('google', 'paid')).toBe('google--paid')
    expect(await readSentHashes(firestore, 'google')).toHaveLength(3)
    expect(await readSentHashes(firestore, 'google', 'paid')).toHaveLength(2)
    expect(docs.get('adAudienceSync/meta--paid')).toMatchObject({
      provider: 'meta',
      stage: 'paid',
      lastOutcome: 'sent',
      members: 2,
    })
    expect(docs.get('adAudienceSync/meta')).not.toHaveProperty('stage')

    // p2's workspace stops paying: only the paid list loses them.
    const second = recordingFetch()
    const next = await runAdAudienceSync({
      ...base,
      accounts: [people[0], { ...people[1], stageFacts: facts() }, people[2]],
      dryRun: false,
      firestore,
      fetch: second.fetcher,
    })
    expect(next.providers.google).toMatchObject({ outcome: 'unchanged' })
    expect(next.stages.paid.providers.google).toMatchObject({ outcome: 'sent', toAdd: 0, toRemove: 1 })
    expect(await readSentHashes(firestore, 'google')).toHaveLength(3)
    expect(await readSentHashes(firestore, 'google', 'paid')).toEqual([
      hashAudienceEmail('google', 'paid1@example.com'),
    ])
  })

  it('guards each stage list on its own', async () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      account({ uid: `p${index}`, email: `p${index}@example.com`, stageFacts: facts({ ownsPaidWorkspace: true }) }),
    )
    const { firestore } = fakeFirestore()
    await runAdAudienceSync({ ...base, accounts: many, dryRun: false, firestore, fetch: recordingFetch().fetcher })
    // Most of them stop paying but stay account holders: the paid list alone is held.
    const shrunk = await runAdAudienceSync({
      ...base,
      accounts: many.map((entry, index) => (index < 5 ? entry : { ...entry, stageFacts: facts() })),
      dryRun: false,
      firestore,
      fetch: recordingFetch().fetcher,
    })
    expect(shrunk.providers.google.outcome).toBe('unchanged')
    expect(shrunk.stages.paid.providers.google.outcome).toBe('held-shrink')
    expect(await readSentHashes(firestore, 'google', 'paid')).toHaveLength(30)
    // An empty stage is never sent as an empty replace.
    const none = await runAdAudienceSync({
      ...base,
      accounts: many.map((entry) => ({ ...entry, stageFacts: facts() })),
      dryRun: false,
      force: true,
      firestore,
      fetch: recordingFetch().fetcher,
    })
    expect(none.stages.paid.providers.meta.outcome).toBe('empty')
  })
})

describe('the indexes the activity read runs on', () => {
  /**
   * A collection group gets no automatic single-field index, and a missing
   * one answers FAILED_PRECONDITION on every call: the lapsed list would
   * fail every night. Both reads are an equality and a `createdAt` range,
   * newest first, so each needs exactly this COLLECTION_GROUP shape.
   */
  const config = JSON.parse(
    readFileSync(join(__dirname, '../../../../../../../cloud/firebase-firestore.indexes.json'), 'utf8'),
  ) as {
    indexes: Array<{
      collectionGroup: string
      queryScope: string
      fields: Array<{ fieldPath: string; order?: string }>
    }>
  }
  it.each([
    ['activity', 'actorId'],
    ['aiJobs', 'createdBy'],
  ])('%s has (%s, createdAt DESC) at collection-group scope', (group, field) => {
    expect(
      config.indexes.some(
        (index) =>
          index.collectionGroup === group &&
          index.queryScope === 'COLLECTION_GROUP' &&
          JSON.stringify(index.fields.map((entry) => [entry.fieldPath, entry.order])) ===
            JSON.stringify([
              [field, 'ASCENDING'],
              ['createdAt', 'DESCENDING'],
            ]),
      ),
    ).toBe(true)
  })
})
