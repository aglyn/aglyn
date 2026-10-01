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
 * The Web Risk lookup (AGL-3451): the `uris.search` client over a mocked
 * HTTP layer, the two-layer cache, the deadline, the failure modes and the
 * kill switch; and the `'url'` lookup mode (AGL-3459) — what it sends, its
 * cache, its cap and a listing that names one path on a clean host. Nothing
 * here reaches Google.
 */

type Doc = Record<string, unknown>
const store = new Map<string, Doc>()
let getAllCalls = 0

const snapshotOf = (path: string) => {
  const data = store.get(path)
  return {
    id: path.split('/').pop(),
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

const docRef = (path: string) => ({
  path,
  get: async () => snapshotOf(path),
  set: async (value: Doc) => {
    store.set(path, { ...value })
  },
  delete: async () => {
    store.delete(path)
  },
})

const db = {
  collection: (name: string) => ({
    doc: (id: string) => docRef(`${name}/${id}`),
    where: (field: string, op: string, value: number) => ({
      limit: (take: number) => ({
        get: async () => ({
          docs: [...store.keys()]
            .filter((key) => key.startsWith(`${name}/`) && op === '<' && Number(store.get(key)?.[field]) < value)
            .slice(0, take)
            .map((key) => ({ id: key.split('/').pop(), ref: docRef(key) })),
        }),
      }),
    }),
  }),
  getAll: async (...refs: Array<{ path: string }>) => {
    getAllCalls += 1
    return refs.map((ref) => snapshotOf(ref.path))
  },
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => db }) },
}))

import {
  getLinkReputationLookup,
  MAX_REPUTATION_URLS_PER_LOOKUP,
  resetLinkReputationLookupForTests,
} from '@aglyn/shared-util-email/link-reputation'
import {
  createWebRiskHttpClient,
  installLinkReputationLookup,
  lookupLinkReputation,
  parseWebRiskSearch,
  reapExpiredWebRiskUrlVerdicts,
  resetWebRiskForTests,
  WEB_RISK_CACHE_COLLECTION,
  WEB_RISK_CLEAN_TTL_MS,
  WEB_RISK_URL_CACHE_COLLECTION,
  WEB_RISK_URL_VERDICT_GRACE_MS,
  WEB_RISK_MEMORY_CLEAN_TTL_MS,
  WebRiskHttpError,
  webRiskLookupMode,
  webRiskUrlVerdictId,
  type WebRiskClient,
  type WebRiskSearchResult,
} from './web-risk'

const LISTED = { threat: { threatTypes: ['SOCIAL_ENGINEERING'], expireTime: '2026-10-01T22:04:57.678Z' } }

/** A client whose answers the test decides, counting what it was asked. */
function fakeClient(answer: (uri: string) => Promise<WebRiskSearchResult>) {
  const asked: string[] = []
  const client: WebRiskClient = {
    searchUri: async (uri) => {
      asked.push(uri)
      return answer(uri)
    },
  }
  return { client, asked }
}

const clean = async (): Promise<WebRiskSearchResult> => ({ threats: [], expireTimeMs: null })

beforeEach(() => {
  store.clear()
  getAllCalls = 0
  resetWebRiskForTests(null)
  resetLinkReputationLookupForTests()
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe('the uris.search client', () => {
  it('asks for the three threat types about one URI, as the service account', async () => {
    const fetch = jest.fn(async () => new Response(JSON.stringify(LISTED), { status: 200 }))
    const client = createWebRiskHttpClient({ accessToken: async () => 'token-1', fetch: fetch as never })
    await expect(client.searchUri('https://temps-juenes.example/')).resolves.toEqual({
      threats: ['SOCIAL_ENGINEERING'],
      expireTimeMs: Date.parse('2026-10-01T22:04:57.678Z'),
    })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    const parsed = new URL(url)
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://webrisk.googleapis.com/v1/uris:search')
    expect(parsed.searchParams.getAll('threatTypes')).toEqual([
      'SOCIAL_ENGINEERING',
      'MALWARE',
      'UNWANTED_SOFTWARE',
    ])
    expect(parsed.searchParams.get('uri')).toBe('https://temps-juenes.example/')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-1')
  })

  it('reads an empty answer as not listed, and ignores threat types it does not ask about', () => {
    expect(parseWebRiskSearch({})).toEqual({ threats: [], expireTimeMs: null })
    expect(parseWebRiskSearch(null)).toEqual({ threats: [], expireTimeMs: null })
    expect(parseWebRiskSearch({ threat: { threatTypes: ['MALWARE', 'SOMETHING_NEW'] } })).toEqual({
      threats: ['MALWARE'],
      expireTimeMs: null,
    })
  })

  it('throws on a status that is not an answer, and without a credential', async () => {
    const fetch = jest.fn(async () => new Response('denied', { status: 403 }))
    const client = createWebRiskHttpClient({ accessToken: async () => 'token-1', fetch: fetch as never })
    await expect(client.searchUri('https://a.example/')).rejects.toBeInstanceOf(WebRiskHttpError)
    const keyless = createWebRiskHttpClient({ accessToken: async () => null, fetch: fetch as never })
    await expect(keyless.searchUri('https://a.example/')).rejects.toThrow(/credential/)
  })

  it('gives up on a call that outlasts its timeout', async () => {
    const fetch = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const client = createWebRiskHttpClient({
      accessToken: async () => 'token-1',
      fetch: fetch as never,
      timeoutMs: 20,
    })
    await expect(client.searchUri('https://slow.example/')).rejects.toThrow('aborted')
  })
})

describe('a reputation lookup', () => {
  it('asks only about the host, and answers listed, clean and the platform’s own without asking', async () => {
    const { client, asked } = fakeClient(async (uri) =>
      uri === 'https://conservascaorvi.example/'
        ? { threats: ['SOCIAL_ENGINEERING'], expireTimeMs: Date.now() + 60_000 }
        : { threats: [], expireTimeMs: null },
    )
    resetWebRiskForTests(client)
    const answer = await lookupLinkReputation(['conservascaorvi.example', 'bakery.example', 'neighbour.aglyn.app'])
    expect(answer.hits).toEqual([{ host: 'conservascaorvi.example', threats: ['SOCIAL_ENGINEERING'] }])
    expect(answer.clean.sort()).toEqual(['bakery.example', 'neighbour.aglyn.app'])
    expect(answer.unknown).toEqual([])
    expect(asked.sort()).toEqual(['https://bakery.example/', 'https://conservascaorvi.example/'])
  })

  it('caches each answer: memory first, then the store, then the API', async () => {
    const { client, asked } = fakeClient(clean)
    resetWebRiskForTests(client)
    await lookupLinkReputation(['bakery.example'])
    expect(store.get(`${WEB_RISK_CACHE_COLLECTION}/bakery.example`)).toMatchObject({
      host: 'bakery.example',
      threats: [],
      listed: false,
    })
    // Memory: no store read, no call.
    getAllCalls = 0
    await lookupLinkReputation(['bakery.example'])
    expect(asked).toHaveLength(1)
    expect(getAllCalls).toBe(0)
    // A fresh process: the store answers, still no call.
    resetWebRiskForTests(client)
    await lookupLinkReputation(['bakery.example'])
    expect(asked).toHaveLength(1)
    expect(getAllCalls).toBe(1)
  })

  it('keeps a listing no longer than its expireTime, and a clean answer only so long', async () => {
    const now = Date.now()
    const { client, asked } = fakeClient(async () => ({
      threats: ['MALWARE'],
      expireTimeMs: now + 5 * 60_000,
    }))
    resetWebRiskForTests(client)
    await lookupLinkReputation(['listed.example'], { nowMs: now })
    await lookupLinkReputation(['listed.example'], { nowMs: now + 4 * 60_000 })
    expect(asked).toHaveLength(1)
    await lookupLinkReputation(['listed.example'], { nowMs: now + 6 * 60_000 })
    expect(asked).toHaveLength(2)

    const stored = store.get(`${WEB_RISK_CACHE_COLLECTION}/listed.example`) as Doc
    expect(stored['expiresAtMs']).toBe(now + 5 * 60_000)
  })

  it('trusts a clean answer from memory for minutes and from the store for hours', async () => {
    const now = Date.now()
    const { client, asked } = fakeClient(clean)
    resetWebRiskForTests(client)
    await lookupLinkReputation(['fine.example'], { nowMs: now })
    const stored = store.get(`${WEB_RISK_CACHE_COLLECTION}/fine.example`) as Doc
    expect(Number(stored['expiresAtMs']) - Number(stored['checkedAtMs'])).toBe(WEB_RISK_CLEAN_TTL_MS)
    // Past the memory window the store answers — a listing the daily re-check
    // wrote there reaches a warm process this way.
    getAllCalls = 0
    await lookupLinkReputation(['fine.example'], { nowMs: now + WEB_RISK_MEMORY_CLEAN_TTL_MS + 1 })
    expect(getAllCalls).toBe(1)
    expect(asked).toHaveLength(1)
  })

  it('reads an error as unknown — never a listing — logs a warning, and caches nothing', async () => {
    const { client } = fakeClient(async () => {
      throw new Error('socket hang up')
    })
    resetWebRiskForTests(client)
    const answer = await lookupLinkReputation(['flaky.example'])
    expect(answer).toMatchObject({ hits: [], clean: [], unknown: ['flaky.example'] })
    expect(console.warn).toHaveBeenCalled()
    expect(store.has(`${WEB_RISK_CACHE_COLLECTION}/flaky.example`)).toBe(false)
  })

  it('answers by the deadline; a late call reads unknown and still fills the cache', async () => {
    let finish: (value: WebRiskSearchResult) => void = () => undefined
    const { client } = fakeClient(
      () =>
        new Promise<WebRiskSearchResult>((resolve) => {
          finish = resolve
        }),
    )
    resetWebRiskForTests(client)
    const started = Date.now()
    const answer = await lookupLinkReputation(['slow.example'], { deadlineMs: 30 })
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(answer.unknown).toEqual(['slow.example'])
    finish({ threats: [], expireTimeMs: null })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.get(`${WEB_RISK_CACHE_COLLECTION}/slow.example`)).toMatchObject({ listed: false })
  })

  it('backs off when the API refuses the credential, instead of asking on every page', async () => {
    const { client, asked } = fakeClient(async () => {
      throw new WebRiskHttpError(403, 'Web Risk API has not been used in project')
    })
    resetWebRiskForTests(client)
    await lookupLinkReputation(['one.example'])
    const answer = await lookupLinkReputation(['two.example'])
    expect(answer.unknown).toEqual(['two.example'])
    expect(asked).toEqual(['https://one.example/'])
  })

  it('looks nothing up while the kill switch is off', async () => {
    store.set('platformSettings/webRisk', { enabled: false })
    const { client, asked } = fakeClient(clean)
    resetWebRiskForTests(client)
    const answer = await lookupLinkReputation(['any.example'])
    expect(answer.unknown).toEqual(['any.example'])
    expect(asked).toEqual([])
  })

  it('reads every host unknown when the deployment has no credential at all', async () => {
    resetWebRiskForTests(null)
    const answer = await lookupLinkReputation(['any.example'])
    expect(answer.unknown).toEqual(['any.example'])
  })

  it('caps how many hosts one lookup asks about', async () => {
    const { client, asked } = fakeClient(clean)
    resetWebRiskForTests(client)
    const hosts = Array.from({ length: 25 }, (_, index) => `site${index}.example`)
    const answer = await lookupLinkReputation(hosts)
    expect(asked).toHaveLength(20)
    expect(answer.unknown).toHaveLength(5)
  })

  it('puts itself behind the shared screen’s reputation seam', async () => {
    const { client } = fakeClient(async () => ({ threats: ['UNWANTED_SOFTWARE'], expireTimeMs: Date.now() + 60_000 }))
    resetWebRiskForTests(client)
    expect(getLinkReputationLookup()).toBeNull()
    installLinkReputationLookup()
    await expect(getLinkReputationLookup()?.(['bad.example'])).resolves.toMatchObject({
      hits: [{ host: 'bad.example', threats: ['UNWANTED_SOFTWARE'] }],
    })
  })
})

describe('the lookup mode (AGL-3459)', () => {
  const KIT = 'https://bakery.example/wp-content/uploads/secure/login.php'
  const urlMode = () => store.set('platformSettings/webRisk', { lookupMode: 'url' })
  /** Lists one address and nothing else. */
  const listsKit = () =>
    fakeClient(async (uri) =>
      uri === KIT
        ? { threats: ['SOCIAL_ENGINEERING'], expireTimeMs: Date.now() + 5 * 60_000 }
        : { threats: [], expireTimeMs: null },
    )

  it('sends only the host by default, whatever addresses it is handed', async () => {
    const { client, asked } = listsKit()
    resetWebRiskForTests(client)
    const answer = await lookupLinkReputation(['bakery.example'], { urls: [KIT] })
    expect(asked).toEqual(['https://bakery.example/'])
    expect(answer).toMatchObject({ hits: [], clean: ['bakery.example'], unknown: [] })
    await expect(webRiskLookupMode()).resolves.toBe('host')
  })

  it("reads anything but exactly 'url' as 'host', and a switched-off lookup as 'host'", async () => {
    for (const lookupMode of ['URL', 'path', true, null]) {
      store.set('platformSettings/webRisk', { lookupMode })
      resetWebRiskForTests(null)
      await expect(webRiskLookupMode()).resolves.toBe('host')
    }
    store.set('platformSettings/webRisk', { lookupMode: 'url', enabled: false })
    resetWebRiskForTests(null)
    await expect(webRiskLookupMode()).resolves.toBe('host')
    urlMode()
    resetWebRiskForTests(null)
    await expect(webRiskLookupMode()).resolves.toBe('url')
  })

  it("in 'url' mode asks about the host first, then its address — and a listed path holds while the host is clean", async () => {
    urlMode()
    const { client, asked } = listsKit()
    resetWebRiskForTests(client)
    const answer = await lookupLinkReputation(['bakery.example'], { urls: [KIT] })
    expect(asked).toEqual(['https://bakery.example/', KIT])
    expect(answer.hits).toEqual([{ host: 'bakery.example', url: KIT, threats: ['SOCIAL_ENGINEERING'] }])
    expect(answer.clean).toEqual(['bakery.example'])
    expect(answer.looked).toBe(2)
  })

  it('never sends a query string, a fragment or a user:password@, even when handed one', async () => {
    urlMode()
    const { client, asked } = fakeClient(clean)
    resetWebRiskForTests(client)
    await lookupLinkReputation(['bakery.example'], {
      urls: [
        'https://jane:hunter2@Bakery.example:443/a/./b/../order?email=jane@doe.example&token=abc#jane@doe.example',
      ],
    })
    expect(asked).toEqual(['https://bakery.example/', 'https://bakery.example/a/order'])
    for (const uri of asked) expect(uri).not.toMatch(/[?#@]|jane|hunter2|token/)
  })

  it('does not ask about the addresses of a host that is itself listed', async () => {
    urlMode()
    const { client, asked } = fakeClient(async (uri) =>
      uri === 'https://kit.example/'
        ? { threats: ['MALWARE'], expireTimeMs: Date.now() + 60_000 }
        : { threats: [], expireTimeMs: null },
    )
    resetWebRiskForTests(client)
    const answer = await lookupLinkReputation(['kit.example'], { urls: ['https://kit.example/a/b'] })
    expect(asked).toEqual(['https://kit.example/'])
    expect(answer.hits).toEqual([{ host: 'kit.example', threats: ['MALWARE'] }])
  })

  it('caches each address like a host: memory, then the store under its hash, with the same TTLs', async () => {
    urlMode()
    const now = Date.now()
    const { client, asked } = listsKit()
    resetWebRiskForTests(client)
    const menu = 'https://bakery.example/menu'
    await lookupLinkReputation(['bakery.example'], { urls: [KIT, menu], nowMs: now })
    expect(asked).toHaveLength(3)
    const listedDoc = store.get(`${WEB_RISK_URL_CACHE_COLLECTION}/${webRiskUrlVerdictId(KIT)}`) as Doc
    expect(listedDoc).toMatchObject({
      url: KIT,
      host: 'bakery.example',
      listed: true,
      threats: ['SOCIAL_ENGINEERING'],
    })
    const cleanDoc = store.get(`${WEB_RISK_URL_CACHE_COLLECTION}/${webRiskUrlVerdictId(menu)}`) as Doc
    expect(Number(cleanDoc['expiresAtMs']) - Number(cleanDoc['checkedAtMs'])).toBe(WEB_RISK_CLEAN_TTL_MS)

    // Memory: no store read, no call.
    getAllCalls = 0
    await lookupLinkReputation(['bakery.example'], { urls: [KIT, menu], nowMs: now })
    expect(asked).toHaveLength(3)
    expect(getAllCalls).toBe(0)

    // A fresh process: the store answers hosts and addresses in one round trip.
    resetWebRiskForTests(client)
    const answer = await lookupLinkReputation(['bakery.example'], { urls: [KIT, menu], nowMs: now })
    expect(asked).toHaveLength(3)
    expect(getAllCalls).toBe(1)
    expect(answer.hits).toEqual([{ host: 'bakery.example', url: KIT, threats: ['SOCIAL_ENGINEERING'] }])

    // Past the listing's expireTime the address is asked again.
    resetWebRiskForTests(client)
    await lookupLinkReputation(['bakery.example'], { urls: [KIT], nowMs: now + 6 * 60_000 })
    expect(asked.filter((uri) => uri === KIT)).toHaveLength(2)
  })

  it(`asks about at most ${MAX_REPUTATION_URLS_PER_LOOKUP} addresses per lookup, deduplicated and a host at a time`, async () => {
    urlMode()
    const { client, asked } = fakeClient(clean)
    resetWebRiskForTests(client)
    const urls = [
      ...Array.from({ length: 40 }, (_, index) => `https://docs.example/page/${index}`),
      ...Array.from({ length: 40 }, (_, index) => `https://docs.example/page/${index}?utm=${index}`),
      'https://other.example/the-one-link',
    ]
    await lookupLinkReputation(['docs.example', 'other.example'], { urls })
    const addresses = asked.filter((uri) => !/^https:\/\/[^/]+\/$/.test(uri))
    expect(addresses).toHaveLength(MAX_REPUTATION_URLS_PER_LOOKUP)
    expect(new Set(addresses).size).toBe(addresses.length)
    // The one link to another site is not crowded out by forty to the first.
    expect(addresses).toContain('https://other.example/the-one-link')
  })

  it('answers hosts and addresses by the same deadline; a late address reads unknown and still fills the cache', async () => {
    urlMode()
    let finish: (value: WebRiskSearchResult) => void = () => undefined
    const { client } = fakeClient((uri) =>
      uri === KIT
        ? new Promise<WebRiskSearchResult>((resolve) => {
            finish = resolve
          })
        : clean(),
    )
    resetWebRiskForTests(client)
    const started = Date.now()
    const answer = await lookupLinkReputation(['bakery.example'], { urls: [KIT], deadlineMs: 30 })
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(answer).toMatchObject({ hits: [], clean: ['bakery.example'], unknown: [KIT] })
    finish({ threats: ['MALWARE'], expireTimeMs: Date.now() + 60_000 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.get(`${WEB_RISK_URL_CACHE_COLLECTION}/${webRiskUrlVerdictId(KIT)}`)).toMatchObject({
      listed: true,
    })
  })

  it('reads a failed address as unknown, never as a listing', async () => {
    urlMode()
    const { client } = fakeClient(async (uri) => {
      if (uri === KIT) throw new Error('socket hang up')
      return { threats: [], expireTimeMs: null }
    })
    resetWebRiskForTests(client)
    const answer = await lookupLinkReputation(['bakery.example'], { urls: [KIT] })
    expect(answer).toMatchObject({ hits: [], clean: ['bakery.example'], unknown: [KIT] })
  })

  it('looks nothing up while the kill switch is off, whatever the mode', async () => {
    store.set('platformSettings/webRisk', { lookupMode: 'url', enabled: false })
    const { client, asked } = listsKit()
    resetWebRiskForTests(client)
    const answer = await lookupLinkReputation(['bakery.example'], { urls: [KIT] })
    expect(asked).toEqual([])
    expect(answer).toMatchObject({ hits: [], unknown: ['bakery.example'] })
  })

  it('hands the addresses through the shared seam', async () => {
    urlMode()
    const { client } = listsKit()
    resetWebRiskForTests(client)
    installLinkReputationLookup()
    await expect(getLinkReputationLookup()?.(['bakery.example'], { urls: [KIT] })).resolves.toMatchObject({
      hits: [{ host: 'bakery.example', url: KIT }],
    })
  })

  it('deletes addresses’ stored answers a day after they expire, and keeps the rest', async () => {
    const now = Date.now()
    const old = `${WEB_RISK_URL_CACHE_COLLECTION}/old`
    const recent = `${WEB_RISK_URL_CACHE_COLLECTION}/recent`
    store.set(old, { url: 'https://a.example/x', expiresAtMs: now - WEB_RISK_URL_VERDICT_GRACE_MS - 1 })
    store.set(recent, { url: 'https://a.example/y', expiresAtMs: now - 60_000 })
    store.set(`${WEB_RISK_CACHE_COLLECTION}/a.example`, { host: 'a.example', expiresAtMs: 0 })
    await expect(reapExpiredWebRiskUrlVerdicts({ nowMs: now })).resolves.toBe(1)
    expect(store.has(old)).toBe(false)
    expect(store.has(recent)).toBe(true)
    expect(store.has(`${WEB_RISK_CACHE_COLLECTION}/a.example`)).toBe(true)
  })
})
