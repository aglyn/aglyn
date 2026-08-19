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
 *
 * @jest-environment node
 */

// Without a top-level import or export TypeScript treats this file as a global
// script, so its top-level `const`s collide with identically-named ones in
// sibling specs (TS2451/TS2393). The marker makes it a module.
export {}

/**
 * THE WEBHOOK HEALTH PROBE COUNTS THE COLLECTION IT WRITES (AGL-2308).
 *
 * `livemodeDecision` claims a LIVE event in `stripeEvents` and a TEST event in
 * `stripeEventsTest` — the AGL-2040 segregation, so `stripeEvents` stays a
 * pure record of live traffic. `/api/health/billing` counted `'stripeEvents'`
 * unconditionally.
 *
 * On every test-mode and preview deployment that is a collection the webhook
 * never writes, so `processed` was 0 beside a non-zero Stripe `emitted` count,
 * permanently — a plausible, permanent red on precisely the deployment shape
 * used to rehearse the webhook end to end. A health check that is wrong the
 * same way every time is worse than one that is missing: it trains people to
 * ignore it.
 *
 * WHAT THIS CATCHES. Not "does the file mention `stripeEventsTest`" — a
 * comment satisfies that. The probe is driven for real and the Firestore
 * double records WHICH collection was asked for, under two different
 * `STRIPE_SECRET_KEY` values. A route that hardcoded either constant answers
 * the same string twice and dies.
 */

const mockCollectionsRead: string[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {},
}))

jest.mock('firebase-admin/app', () => ({
  __esModule: true,
  getApp: () => ({}),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  Timestamp: { fromMillis: (value: number) => ({ value }) },
  getFirestore: () => ({
    collection: (name: string) => {
      mockCollectionsRead.push(name)
      return {
        where: () => ({
          count: () => ({ get: async () => ({ data: () => ({ count: 7 }) }) }),
        }),
      }
    },
  }),
}))

const ORIGINAL_ENV = process.env
const ORIGINAL_FETCH = global.fetch

/** Every Stripe census arm answers, so the probe reaches the Firestore read. */
function stubStripe() {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ data: [] }),
  })) as unknown as typeof fetch
}

/**
 * A fresh module registry per call: the probe is memoized for five minutes,
 * so a second invocation in the same registry would replay the first answer
 * and both assertions below would be about one run.
 */
async function probeWith(secretKey: string): Promise<string[]> {
  jest.resetModules()
  mockCollectionsRead.length = 0
  process.env = {
    ...ORIGINAL_ENV,
    STRIPE_SECRET_KEY: secretKey,
    NEXT_PUBLIC_CONSOLE_ORIGIN: 'https://app.aglyn.com',
  } as NodeJS.ProcessEnv
  stubStripe()
  const { GET } = require('../app/api/health/billing/route')
  await GET()
  return [...mockCollectionsRead]
}

afterEach(() => {
  process.env = ORIGINAL_ENV
  global.fetch = ORIGINAL_FETCH
})

describe('/api/health/billing counts this deployment’s claims (AGL-2308)', () => {
  it('a LIVE deployment counts stripeEvents', async () => {
    expect(await probeWith('sk_live_not_a_real_key')).toContain('stripeEvents')
  })

  it('a TEST deployment counts stripeEventsTest — the collection it writes', async () => {
    const read = await probeWith('sk_test_not_a_real_key')
    expect(read).toContain('stripeEventsTest')
    // And NOT the live one. Reading both would still report a figure, and it
    // would be the live deployment's traffic on a test deployment's dashboard.
    expect(read).not.toContain('stripeEvents')
  })

  it('THE TWO DIFFER — a hardcoded constant answers the same string twice', async () => {
    const live = await probeWith('sk_live_not_a_real_key')
    const test = await probeWith('sk_test_not_a_real_key')
    expect(live).not.toEqual(test)
  })
})
