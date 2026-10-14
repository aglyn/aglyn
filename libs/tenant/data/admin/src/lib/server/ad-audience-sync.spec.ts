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
 * No network: every request is captured, never sent.
 */

import {
  adAudienceExclusion,
  buildGoogleMemberRequests,
  buildGoogleTokenRequest,
  buildLinkedInUserRequests,
  buildMetaReplaceRequests,
  diffAudience,
  hashAudienceEmail,
  isSuspiciousShrink,
  linkedInRefusedCount,
  normalizeAudienceEmail,
  readAdAudienceConfig,
  resolveAccountCountry,
  sha256Hex,
  type AdAudienceAccount,
  type AdAudienceConfig,
} from './ad-audience-sync'
import {
  readAdAudienceAccounts,
  readSentHashes,
  runAdAudienceSync,
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

/** Just enough Firestore for the run: paths, select, an id range, set, delete. */
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
      ref: { delete: async () => void docs.delete(path) },
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
  return { docs, firestore: { collection } as unknown as FirebaseFirestore.Firestore }
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
      listUsers: async (_size, token) => (token ? pages[1] : pages[0]),
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
