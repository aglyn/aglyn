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
 * The media CDN's per-caller limit (AGL-2812).
 *
 * Every refusal here is earned by driving the real durable counter past its
 * ceiling, and every fail-open claim is made by breaking that counter the ways
 * it breaks in production: the store down, a contended document, and a store
 * that says nothing until the budget runs out.
 */

import {
  MEDIA_CDN_IMAGE_RATE_LIMIT,
  MEDIA_CDN_NON_IMAGE_RATE_LIMIT,
  MEDIA_CDN_RATE_LIMIT_BUDGET_MS,
  type MediaCdnRateLimitOptions,
  mediaCdnRateLimitCaller,
  mediaCdnRateLimitKey,
  mediaCdnRateLimitRefusal,
} from './media-cdn-rate-limit'
import {
  consumeRateLimit,
  RATE_LIMIT_TRANSACTION_BUDGET_MS,
  resetRateLimitDegradationForTests,
} from './rate-limit-store'

type Fault = 'unavailable' | 'contended' | 'silent' | null

/**
 * A counter store with the two round trips `consumeRateLimit` makes. The
 * increment is applied from the sentinel's real `operand`, so a production
 * call that stopped incrementing would stop refusing here too.
 */
function counterStore() {
  const counts = new Map<string, number>()
  const state: { fault: Fault; calls: number } = { fault: null, calls: 0 }
  const answer = async (): Promise<void> => {
    state.calls += 1
    if (state.fault === 'unavailable') {
      throw Object.assign(new Error('14 UNAVAILABLE'), { code: 14 })
    }
    if (state.fault === 'contended') {
      throw Object.assign(new Error('4 DEADLINE_EXCEEDED'), { code: 4 })
    }
    if (state.fault === 'silent') await new Promise<never>(() => undefined)
  }
  return {
    counts,
    state,
    runTransaction: async () => undefined,
    collection: (name: string) => ({
      doc: (id: string) => ({
        set: async (value: Record<string, unknown>) => {
          await answer()
          const operand = (value['count'] as { operand?: unknown } | undefined)
            ?.operand
          const path = `${name}/${id}`
          counts.set(
            path,
            (counts.get(path) ?? 0) + (typeof operand === 'number' ? operand : 0),
          )
        },
        get: async () => {
          await answer()
          return {
            get: (field: string) =>
              field === 'count' ? counts.get(`${name}/${id}`) : undefined,
          }
        },
      }),
    }),
  }
}

/** 15 s into a counter window, so a refusal has 45 s left to wait. */
const NOW = Date.UTC(2026, 8, 11, 12, 0, 15)

function ask(
  store: ReturnType<typeof counterStore>,
  overrides: Partial<MediaCdnRateLimitOptions> = {},
) {
  return mediaCdnRateLimitRefusal({
    headers: { 'x-forwarded-for': '203.0.113.7' },
    rateClass: 'non-image',
    limit: 3,
    nowMs: NOW,
    firestore: store,
    ...overrides,
  })
}

async function verdicts(
  count: number,
  store: ReturnType<typeof counterStore>,
  overrides: Partial<MediaCdnRateLimitOptions> = {},
) {
  const answers: Array<{ retryAfterSeconds: number } | null> = []
  for (let i = 0; i < count; i += 1) answers.push(await ask(store, overrides))
  return answers
}

const environment = {
  vercel: process.env['VERCEL'],
  depth: process.env['AGLYN_TRUSTED_PROXY_COUNT'],
}

beforeAll(() => {
  // Off the platform, one trusted proxy: the RIGHTMOST forwarding hop is the
  // caller. Pinned so a CI runner's environment cannot change which hop counts.
  delete process.env['VERCEL']
  delete process.env['AGLYN_TRUSTED_PROXY_COUNT']
})

afterAll(() => {
  if (environment.vercel !== undefined) process.env['VERCEL'] = environment.vercel
  if (environment.depth !== undefined) {
    process.env['AGLYN_TRUSTED_PROXY_COUNT'] = environment.depth
  }
})

beforeEach(() => {
  resetRateLimitDegradationForTests()
  // The store's degradation log is expected on the fault paths below.
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('AGL-2812 · the media CDN limit refuses a caller past its ceiling', () => {
  it('admits a caller up to the ceiling and refuses the next, with the seconds left in its window', async () => {
    const store = counterStore()
    expect(await verdicts(5, store)).toEqual([
      null,
      null,
      null,
      { retryAfterSeconds: 45 },
      { retryAfterSeconds: 45 },
    ])
  })

  it('counts every caller on its own', async () => {
    const store = counterStore()
    await verdicts(4, store)
    expect(
      await ask(store, { headers: { 'x-forwarded-for': '198.51.100.20' } }),
    ).toBeNull()
  })

  it('keeps images and everything else on separate budgets', async () => {
    const store = counterStore()
    expect((await verdicts(4, store))[3]).not.toBeNull()
    expect(await ask(store, { rateClass: 'image' })).toBeNull()
  })

  it('gives no fresh budget to a caller that prepends forwarding entries', async () => {
    const store = counterStore()
    const answers = []
    for (let i = 1; i <= 4; i += 1) {
      answers.push(
        await ask(store, {
          headers: { 'x-forwarded-for': `198.51.100.${i}, 203.0.113.7` },
        }),
      )
    }
    expect(answers).toEqual([null, null, null, { retryAfterSeconds: 45 }])
  })

  it('counts an IPv6 caller by its /64, so rotating the interface id buys nothing', async () => {
    const store = counterStore()
    for (const suffix of ['a', 'b', 'c']) {
      expect(
        await ask(store, { headers: { 'x-forwarded-for': `2001:db8:1:2::${suffix}` } }),
      ).toBeNull()
    }
    expect(
      await ask(store, { headers: { 'x-forwarded-for': '2001:db8:1:2:ffff::1' } }),
    ).toEqual({ retryAfterSeconds: 45 })
    expect(
      await ask(store, { headers: { 'x-forwarded-for': '2001:db8:1:3::1' } }),
    ).toBeNull()
  })

  it('admits a request with no readable address, and never touches the counter', async () => {
    const store = counterStore()
    expect(await verdicts(5, store, { headers: {} })).toEqual([
      null,
      null,
      null,
      null,
      null,
    ])
    expect(store.state.calls).toBe(0)
  })
})

describe('AGL-2812 · the limit fails open when the counter cannot answer', () => {
  it('admits every request while the store is down, past the ceiling too', async () => {
    const store = counterStore()
    store.state.fault = 'unavailable'
    expect(await verdicts(6, store)).toEqual([null, null, null, null, null, null])
    expect(store.state.calls).toBeGreaterThan(0)
  })

  it('admits a contended count, although the store itself answers allowed: false', async () => {
    const store = counterStore()
    store.state.fault = 'contended'
    // The trap this guards: the store's own verdict reads as a refusal.
    await expect(
      consumeRateLimit('media-cdn:non-image:203.0.113.7', {
        limit: 3,
        now: NOW,
        firestore: store,
      }),
    ).resolves.toMatchObject({ allowed: false, contended: true })
    expect(await verdicts(5, store)).toEqual([null, null, null, null, null])
  })

  it('admits a count that has not answered inside its budget, as soon as the budget is spent', async () => {
    const store = counterStore()
    store.state.fault = 'silent'
    const started = Date.now()
    expect(await ask(store, { budgetMs: 30 })).toBeNull()
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('admits when reading the caller throws', async () => {
    const store = counterStore()
    const headers = {
      get: () => {
        throw new Error('header reader failed')
      },
    }
    expect(await ask(store, { headers })).toBeNull()
  })

  it('waits for a count for less time than the store would', () => {
    expect(MEDIA_CDN_RATE_LIMIT_BUDGET_MS).toBeLessThan(
      RATE_LIMIT_TRANSACTION_BUDGET_MS,
    )
  })
})

describe('AGL-2812 · the ceilings against measured traffic', () => {
  /**
   * The busiest minute each class took across the WHOLE route in production
   * request logs read on 2026-09-11 (the tenant's last seven days, and the
   * sixteen hours the console retains). A ceiling below five times these is
   * within reach of traffic the route has really served from one address.
   */
  const BUSIEST_MINUTE = { images: 98, nonImages: 31, crawlers: 32 }

  it('sits at least five times above the busiest measured minute in its class', () => {
    expect(MEDIA_CDN_IMAGE_RATE_LIMIT).toBeGreaterThanOrEqual(
      5 * Math.max(BUSIEST_MINUTE.images, BUSIEST_MINUTE.crawlers),
    )
    expect(MEDIA_CDN_NON_IMAGE_RATE_LIMIT).toBeGreaterThanOrEqual(
      5 * BUSIEST_MINUTE.nonImages,
    )
  })
})

describe('AGL-2812 · the caller a count is kept under', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2::a', '2001:db8:1:2::/64'],
    ['2001:0db8:0001:0002:0000:0000:0000:000a', '2001:db8:1:2::/64'],
    ['2001:db8::', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['1:2:3:4:5:6:7:8', '1:2:3:4::/64'],
    ['1::2::3', '1::2::3'],
    ['1:2:3:4:5:6:7:8::', '1:2:3:4:5:6:7:8::'],
  ])('%s counts as %s', (address, caller) => {
    expect(mediaCdnRateLimitCaller(address)).toBe(caller)
  })

  it('names the class and the caller in the key, never the asset', () => {
    expect(mediaCdnRateLimitKey('image', '203.0.113.7')).toBe(
      'media-cdn:image:203.0.113.7',
    )
    expect(mediaCdnRateLimitKey('non-image', '2001:db8:1:2::a')).toBe(
      'media-cdn:non-image:2001:db8:1:2::/64',
    )
  })
})
