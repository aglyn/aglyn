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
 * kill switch. Nothing here reaches Google.
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

const db = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      path: `${name}/${id}`,
      get: async () => snapshotOf(`${name}/${id}`),
      set: async (value: Doc) => {
        store.set(`${name}/${id}`, { ...value })
      },
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
  resetLinkReputationLookupForTests,
} from '@aglyn/shared-util-email/link-reputation'
import {
  createWebRiskHttpClient,
  installLinkReputationLookup,
  lookupHostReputation,
  parseWebRiskSearch,
  resetWebRiskForTests,
  WEB_RISK_CACHE_COLLECTION,
  WEB_RISK_CLEAN_TTL_MS,
  WEB_RISK_MEMORY_CLEAN_TTL_MS,
  WebRiskHttpError,
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
    const answer = await lookupHostReputation(['conservascaorvi.example', 'bakery.example', 'neighbour.aglyn.app'])
    expect(answer.hits).toEqual([{ host: 'conservascaorvi.example', threats: ['SOCIAL_ENGINEERING'] }])
    expect(answer.clean.sort()).toEqual(['bakery.example', 'neighbour.aglyn.app'])
    expect(answer.unknown).toEqual([])
    expect(asked.sort()).toEqual(['https://bakery.example/', 'https://conservascaorvi.example/'])
  })

  it('caches each answer: memory first, then the store, then the API', async () => {
    const { client, asked } = fakeClient(clean)
    resetWebRiskForTests(client)
    await lookupHostReputation(['bakery.example'])
    expect(store.get(`${WEB_RISK_CACHE_COLLECTION}/bakery.example`)).toMatchObject({
      host: 'bakery.example',
      threats: [],
      listed: false,
    })
    // Memory: no store read, no call.
    getAllCalls = 0
    await lookupHostReputation(['bakery.example'])
    expect(asked).toHaveLength(1)
    expect(getAllCalls).toBe(0)
    // A fresh process: the store answers, still no call.
    resetWebRiskForTests(client)
    await lookupHostReputation(['bakery.example'])
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
    await lookupHostReputation(['listed.example'], { nowMs: now })
    await lookupHostReputation(['listed.example'], { nowMs: now + 4 * 60_000 })
    expect(asked).toHaveLength(1)
    await lookupHostReputation(['listed.example'], { nowMs: now + 6 * 60_000 })
    expect(asked).toHaveLength(2)

    const stored = store.get(`${WEB_RISK_CACHE_COLLECTION}/listed.example`) as Doc
    expect(stored['expiresAtMs']).toBe(now + 5 * 60_000)
  })

  it('trusts a clean answer from memory for minutes and from the store for hours', async () => {
    const now = Date.now()
    const { client, asked } = fakeClient(clean)
    resetWebRiskForTests(client)
    await lookupHostReputation(['fine.example'], { nowMs: now })
    const stored = store.get(`${WEB_RISK_CACHE_COLLECTION}/fine.example`) as Doc
    expect(Number(stored['expiresAtMs']) - Number(stored['checkedAtMs'])).toBe(WEB_RISK_CLEAN_TTL_MS)
    // Past the memory window the store answers — a listing the daily re-check
    // wrote there reaches a warm process this way.
    getAllCalls = 0
    await lookupHostReputation(['fine.example'], { nowMs: now + WEB_RISK_MEMORY_CLEAN_TTL_MS + 1 })
    expect(getAllCalls).toBe(1)
    expect(asked).toHaveLength(1)
  })

  it('reads an error as unknown — never a listing — logs a warning, and caches nothing', async () => {
    const { client } = fakeClient(async () => {
      throw new Error('socket hang up')
    })
    resetWebRiskForTests(client)
    const answer = await lookupHostReputation(['flaky.example'])
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
    const answer = await lookupHostReputation(['slow.example'], { deadlineMs: 30 })
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
    await lookupHostReputation(['one.example'])
    const answer = await lookupHostReputation(['two.example'])
    expect(answer.unknown).toEqual(['two.example'])
    expect(asked).toEqual(['https://one.example/'])
  })

  it('looks nothing up while the kill switch is off', async () => {
    store.set('platformSettings/webRisk', { enabled: false })
    const { client, asked } = fakeClient(clean)
    resetWebRiskForTests(client)
    const answer = await lookupHostReputation(['any.example'])
    expect(answer.unknown).toEqual(['any.example'])
    expect(asked).toEqual([])
  })

  it('reads every host unknown when the deployment has no credential at all', async () => {
    resetWebRiskForTests(null)
    const answer = await lookupHostReputation(['any.example'])
    expect(answer.unknown).toEqual(['any.example'])
  })

  it('caps how many hosts one lookup asks about', async () => {
    const { client, asked } = fakeClient(clean)
    resetWebRiskForTests(client)
    const hosts = Array.from({ length: 25 }, (_, index) => `site${index}.example`)
    const answer = await lookupHostReputation(hosts)
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
