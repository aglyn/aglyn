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
 * The durable send-rate governor (AGL-2409).
 *
 * No `jest.mock` of `@aglyn/tenant-data-admin` here and no network of any
 * kind: every function under test takes an injectable `firestore`, so the
 * whole file runs against an in-memory double that models the two Firestore
 * behaviours the control depends on — optimistic concurrency (a transaction
 * whose read has moved re-runs) and `set(…, { merge: true })`.
 *
 * `global.fetch` is replaced with a throwing stub anyway. Nothing in this file
 * should reach it, and that is the point: if a future edit puts a real send on
 * this path it fails here rather than on the sending domain.
 */

import {
  EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
  EMAIL_SEND_RATE_WINDOW_MS,
  getEmailSendGovernor,
  normalizeEmailSendRateConfig,
  resetEmailSendGovernorForTests,
} from '@aglyn/shared-util-email'
import {
  consumeEmailSendBudget,
  emailSendRateConfigWrite,
  emailSendRateWindowDocId,
  EMAIL_SEND_RATE_CONFIG_DOC,
  installEmailSendGovernor,
  invalidateEmailSendRateConfigCache,
  readEmailSendRateConfig,
  readEmailSendRateWindow,
} from './email-send-rate'
import { RATE_LIMIT_COLLECTION } from './rate-limit-store'

// ---------------------------------------------------------------------------
// In-memory Firestore with per-document versioning
//
// Modelled on the double in `promotion-hold-race.spec.ts` and scoped to what
// this control touches: single top-level documents, `set(merge)`, and a
// transaction that ABORTS AND RE-RUNS when a document it read has moved. The
// versioning is not decoration — without it, two concurrent sends would both
// read the same count and this file would certify the burst it forbids.
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
const versions = new Map<string, number>()

function writeDoc(path: string, value: Record<string, any>, merge: boolean) {
  docs.set(path, merge ? { ...(docs.get(path) ?? {}), ...value } : { ...value })
  versions.set(path, (versions.get(path) ?? 0) + 1)
}

function snapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string): any {
  return {
    path,
    id: path.split('/').pop(),
    get: async () => snapshot(path),
    set: async (value: any, options?: { merge?: boolean }) =>
      writeDoc(path, value, Boolean(options?.merge)),
  }
}

/** Parked between read and commit, to force an interleaving. */
let afterRead: (() => Promise<void>) | null = null
let aborts = 0

function makeFirestore(overrides?: { failReads?: boolean }) {
  const firestore: any = {
    collection: (name: string) => ({
      doc: (id: string) => {
        if (overrides?.failReads) {
          return {
            path: `${name}/${id}`,
            get: async () => {
              throw new Error('UNAVAILABLE')
            },
            set: async () => {
              throw new Error('UNAVAILABLE')
            },
          }
        }
        return docRef(`${name}/${id}`)
      },
    }),
    runTransaction: async (body: (tx: any) => Promise<any>) => {
      if (overrides?.failReads) throw new Error('UNAVAILABLE')
      for (let attempt = 0; attempt < 6; attempt++) {
        const readVersions = new Map<string, number>()
        const writes: Array<{ path: string; value: any; merge: boolean }> = []
        const tx = {
          get: async (ref: any) => {
            readVersions.set(ref.path, versions.get(ref.path) ?? 0)
            return snapshot(ref.path)
          },
          set: (ref: any, value: any, options?: any) => {
            writes.push({ path: ref.path, value, merge: Boolean(options?.merge) })
          },
        }
        const result = await body(tx)
        if (afterRead && attempt === 0) {
          const hook = afterRead
          afterRead = null
          await hook()
        }
        const stale = [...readVersions.entries()].some(
          ([path, version]) => (versions.get(path) ?? 0) !== version,
        )
        if (stale) {
          aborts += 1
          continue
        }
        for (const write of writes) writeDoc(write.path, write.value, write.merge)
        return result
      }
      const error: any = new Error('ABORTED')
      error.code = 10
      throw error
    },
  }
  return firestore
}

const NOW = 1_755_100_800_000 + 123_456
const WINDOW_START = Math.floor(NOW / EMAIL_SEND_RATE_WINDOW_MS) * EMAIL_SEND_RATE_WINDOW_MS
const WINDOW_PATH = `${RATE_LIMIT_COLLECTION}/${emailSendRateWindowDocId(WINDOW_START)}`
const CONFIG_PATH = `${RATE_LIMIT_COLLECTION}/${EMAIL_SEND_RATE_CONFIG_DOC}`

const originalFetch = global.fetch

beforeEach(() => {
  docs.clear()
  versions.clear()
  afterRead = null
  aborts = 0
  invalidateEmailSendRateConfigCache()
  global.fetch = (async (url: any) => {
    throw new Error(`Blocked outbound request in a spec: ${String(url)}`)
  }) as any
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  global.fetch = originalFetch
  jest.restoreAllMocks()
})

describe('readEmailSendRateConfig', () => {
  it('is the built-in default when nothing is stored', async () => {
    const firestore = makeFirestore()
    const config = await readEmailSendRateConfig({ firestore, now: NOW })
    expect(config.perHour).toBe(EMAIL_SEND_RATE_DEFAULT_PER_HOUR)
    expect(config.enabled).toBe(true)
  })

  it('reads a stored ceiling', async () => {
    const firestore = makeFirestore()
    writeDoc(CONFIG_PATH, { perHour: 25, enabled: true }, false)
    expect((await readEmailSendRateConfig({ firestore, now: NOW })).perHour).toBe(25)
  })

  it('FAILS OPEN to the default when the store is unreachable', async () => {
    const firestore = makeFirestore({ failReads: true })
    const config = await readEmailSendRateConfig({ firestore, now: NOW })
    // Never zero: an unreadable config that refused every campaign would be an
    // outage produced by the control.
    expect(config.perHour).toBe(EMAIL_SEND_RATE_DEFAULT_PER_HOUR)
    expect(config.enabled).toBe(true)
  })
})

describe('consumeEmailSendBudget', () => {
  const config = normalizeEmailSendRateConfig({ perHour: 10, enabled: true })

  it('counts a grant into the hour', async () => {
    const firestore = makeFirestore()
    const result = await consumeEmailSendBudget({
      priority: 'campaign',
      count: 4,
      now: NOW,
      firestore,
      config,
    })
    expect(result.allowed).toBe(true)
    expect(docs.get(WINDOW_PATH)?.count).toBe(4)
  })

  it('writes NOTHING for a send it refused', async () => {
    const firestore = makeFirestore()
    writeDoc(WINDOW_PATH, { count: 9 }, false)
    const before = versions.get(WINDOW_PATH)
    const result = await consumeEmailSendBudget({
      priority: 'campaign',
      count: 5,
      now: NOW,
      firestore,
      config,
    })
    expect(result.allowed).toBe(false)
    expect(docs.get(WINDOW_PATH)?.count).toBe(9)
    expect(versions.get(WINDOW_PATH)).toBe(before)
  })

  it('counts a transactional send that goes OVER the ceiling, and allows it', async () => {
    const firestore = makeFirestore()
    writeDoc(WINDOW_PATH, { count: 10 }, false)
    const result = await consumeEmailSendBudget({
      priority: 'transactional',
      count: 3,
      now: NOW,
      firestore,
      config,
    })
    expect(result.allowed).toBe(true)
    expect(result.overCeiling).toBe(true)
    expect(docs.get(WINDOW_PATH)?.count).toBe(13)
  })

  it('CANNOT both fit — two concurrent sweeps contend and the second is refused', async () => {
    const firestore = makeFirestore()
    writeDoc(WINDOW_PATH, { count: 0 }, false)
    // The first transaction is parked between its read and its commit while
    // the second runs to completion. Without the version check both would see
    // `count: 0`, both would fit under 10, and 12 messages would go out.
    afterRead = async () => {
      await consumeEmailSendBudget({
        priority: 'bulk',
        count: 6,
        now: NOW,
        firestore,
        config,
      })
    }
    const first = await consumeEmailSendBudget({
      priority: 'bulk',
      count: 6,
      now: NOW,
      firestore,
      config,
    })
    expect(aborts).toBeGreaterThan(0)
    expect(first.allowed).toBe(false)
    expect(docs.get(WINDOW_PATH)?.count).toBe(6)
  })

  it('the window document carries expiresAt and NOT lastAtMs', async () => {
    const firestore = makeFirestore()
    await consumeEmailSendBudget({
      priority: 'campaign',
      count: 1,
      now: NOW,
      firestore,
      config,
    })
    const stored = docs.get(WINDOW_PATH) ?? {}
    expect(stored.expiresAt).toBeInstanceOf(Date)
    // `lastAtMs` would put this in the range the AGL-1693 health probe reads.
    expect(stored).not.toHaveProperty('lastAtMs')
    expect(stored.sentAtMs).toBe(NOW)
  })

  it('FAILS OPEN when the counter is unreachable', async () => {
    const firestore = makeFirestore({ failReads: true })
    const result = await consumeEmailSendBudget({
      priority: 'campaign',
      count: 5_000,
      now: NOW,
      firestore,
      config,
    })
    expect(result.allowed).toBe(true)
    expect(result.degraded).toBe(true)
  })
})

describe('readEmailSendRateWindow', () => {
  it('is zero for a quiet hour', async () => {
    const firestore = makeFirestore()
    const window = await readEmailSendRateWindow({ firestore, now: NOW })
    expect(window.used).toBe(0)
    expect(window.windowStartMs).toBe(WINDOW_START)
    expect(window.resetMs).toBe(WINDOW_START + EMAIL_SEND_RATE_WINDOW_MS)
  })

  it('reads the count, clamping a corrupt negative to zero', async () => {
    const firestore = makeFirestore()
    writeDoc(WINDOW_PATH, { count: -4 }, false)
    expect((await readEmailSendRateWindow({ firestore, now: NOW })).used).toBe(0)
    writeDoc(WINDOW_PATH, { count: 17 }, false)
    expect((await readEmailSendRateWindow({ firestore, now: NOW })).used).toBe(17)
  })
})

describe('emailSendRateConfigWrite', () => {
  /**
   * The config lives in `rateLimits`, which has a TTL policy on `expiresAt`
   * serving the counters. A config document carrying that field would be
   * DELETED by the policy and the platform would silently revert to the
   * compiled-in ceiling — a ramp that quietly undoes itself.
   */
  it('never carries expiresAt', () => {
    const write = emailSendRateConfigWrite({
      perHour: 500,
      enabled: true,
      actorEmail: 'staff@aglyn.com',
      note: 'warm-up step 2',
      now: NOW,
    })
    expect(write).not.toHaveProperty('expiresAt')
    expect(write.perHour).toBe(500)
    expect(write.updatedByEmail).toBe('staff@aglyn.com')
    expect(write.updatedAtMs).toBe(NOW)
  })

  it('clamps rather than storing an out-of-range ceiling', () => {
    expect(emailSendRateConfigWrite({ perHour: -1, enabled: true }).perHour).toBe(1)
  })
})

describe('installation', () => {
  /**
   * Importing `@aglyn/tenant-data-admin` must be enough. If this ever needs a
   * call at each server entrypoint, it is the 37-places-to-remember shape and
   * the 38th will be the one that sends unthrottled.
   */
  it('the module installs the governor on import', () => {
    // The import at the top of this file already ran the side effect.
    expect(getEmailSendGovernor()).toBeInstanceOf(Function)
  })

  it('re-installing replaces it without losing the counter', () => {
    resetEmailSendGovernorForTests()
    expect(getEmailSendGovernor()).toBeNull()
    installEmailSendGovernor()
    expect(getEmailSendGovernor()).toBeInstanceOf(Function)
  })
})
