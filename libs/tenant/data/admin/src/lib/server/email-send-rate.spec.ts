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
  claimOrgEmailSendBudget,
  emailOrgSendRateWindowDocId,
  readOrgEmailSendWindow,
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

describe('the per-org share of the platform hour', () => {
  const ORG = 'org_alpha'
  const ORG_PATH = `${RATE_LIMIT_COLLECTION}/${emailOrgSendRateWindowDocId(WINDOW_START, ORG)}`
  /** 25% of the 2,000/hour default. */
  const ORG_CEILING = 500

  it('derives the ceiling from the live platform ceiling', async () => {
    const firestore = makeFirestore()
    const claim = await claimOrgEmailSendBudget({
      orgId: ORG,
      count: 1,
      platformPerHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
      now: NOW,
      firestore,
    })
    expect(claim.ceiling).toBe(ORG_CEILING)
    // A staff ramp moves both together — the share is of whatever is live,
    // so the two ceilings cannot drift into contradiction.
    const ramped = await claimOrgEmailSendBudget({
      orgId: 'org_beta',
      count: 1,
      platformPerHour: 8_000,
      now: NOW,
      firestore,
    })
    expect(ramped.ceiling).toBe(2_000)
  })

  it('grants a send that fits and counts it', async () => {
    const firestore = makeFirestore()
    const claim = await claimOrgEmailSendBudget({
      orgId: ORG,
      count: 300,
      platformPerHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
      now: NOW,
      firestore,
    })
    expect(claim.allowed).toBe(true)
    expect(claim.used).toBe(0)
    expect(claim.remaining).toBe(200)
    expect(docs.get(ORG_PATH)?.count).toBe(300)
    expect(docs.get(ORG_PATH)?.orgId).toBe(ORG)
  })

  /**
   * THE REFUSAL, AND WHAT IT MUST CARRY.
   *
   * A workspace at its ceiling is refused with the numbers in hand — used,
   * ceiling and when the window rolls — because a refusal that does not state
   * its number is the silent cap this product keeps rediscovering.
   */
  it('refuses a workspace at its ceiling and states every number', async () => {
    const firestore = makeFirestore()
    await claimOrgEmailSendBudget({
      orgId: ORG,
      count: 450,
      platformPerHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
      now: NOW,
      firestore,
    })
    const refused = await claimOrgEmailSendBudget({
      orgId: ORG,
      count: 100,
      platformPerHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
      now: NOW,
      firestore,
    })
    expect(refused.allowed).toBe(false)
    expect(refused.used).toBe(450)
    expect(refused.ceiling).toBe(ORG_CEILING)
    expect(refused.remaining).toBe(50)
    expect(refused.retryAtMs).toBe(WINDOW_START + EMAIL_SEND_RATE_WINDOW_MS)
  })

  it('a refused claim writes nothing', async () => {
    const firestore = makeFirestore()
    await claimOrgEmailSendBudget({
      orgId: ORG,
      count: 500,
      platformPerHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
      now: NOW,
      firestore,
    })
    const before = docs.get(ORG_PATH)?.count
    const refused = await claimOrgEmailSendBudget({
      orgId: ORG,
      count: 1,
      platformPerHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
      now: NOW,
      firestore,
    })
    expect(refused.allowed).toBe(false)
    // A campaign retried next hour must not have spent budget on being told no.
    expect(docs.get(ORG_PATH)?.count).toBe(before)
  })

  /**
   * The other tenants are the whole point. One org exhausting its share must
   * leave every other org's share untouched — that is the difference between
   * a fairness control and a second platform ceiling.
   */
  it('one workspace at its ceiling does not refuse another', async () => {
    const firestore = makeFirestore()
    await claimOrgEmailSendBudget({
      orgId: ORG,
      count: 500,
      platformPerHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
      now: NOW,
      firestore,
    })
    const other = await claimOrgEmailSendBudget({
      orgId: 'org_beta',
      count: 500,
      platformPerHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
      now: NOW,
      firestore,
    })
    expect(other.allowed).toBe(true)
    expect(other.used).toBe(0)
  })

  it('two concurrent campaigns cannot both take the same headroom', async () => {
    const firestore = makeFirestore()
    afterRead = async () => {
      await claimOrgEmailSendBudget({
        orgId: ORG,
        count: 400,
        platformPerHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
        now: NOW,
        firestore,
      })
    }
    const second = await claimOrgEmailSendBudget({
      orgId: ORG,
      count: 400,
      platformPerHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
      now: NOW,
      firestore,
    })
    expect(aborts).toBeGreaterThan(0)
    // The re-run reads the raised figure and is refused. A read-then-write
    // cap is not a cap.
    expect(second.allowed).toBe(false)
    expect(second.used).toBe(400)
    expect(docs.get(ORG_PATH)?.count).toBe(400)
  })

  it('fails OPEN when the counter is unreachable', async () => {
    const firestore = makeFirestore({ failReads: true })
    const claim = await claimOrgEmailSendBudget({
      orgId: ORG,
      count: 500,
      platformPerHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
      now: NOW,
      firestore,
    })
    // A refusal produced by a Firestore blip is a refused campaign for a
    // paying customer; the hour of pacing it buys back is not worth it.
    expect(claim.allowed).toBe(true)
    expect(claim.degraded).toBe(true)
    expect(claim.ceiling).toBe(ORG_CEILING)
  })

  it('a parked control grants everything and still reports the ceiling', async () => {
    const firestore = makeFirestore()
    const claim = await claimOrgEmailSendBudget({
      orgId: ORG,
      count: 5_000,
      platformPerHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
      enabled: false,
      now: NOW,
      firestore,
    })
    expect(claim.allowed).toBe(true)
    expect(claim.ceiling).toBe(ORG_CEILING)
    expect(docs.get(ORG_PATH)).toBeUndefined()
  })

  it('does not read a corrupt counter as headroom', async () => {
    const firestore = makeFirestore()
    writeDoc(ORG_PATH, { count: -900 }, false)
    const claim = await claimOrgEmailSendBudget({
      orgId: ORG,
      count: 600,
      platformPerHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
      now: NOW,
      firestore,
    })
    // A negative counter must not read as 1,500 of headroom on a 500 ceiling.
    expect(claim.allowed).toBe(false)
    expect(claim.used).toBe(0)
  })

  it('carries the TTL field and not the health probe field', async () => {
    const firestore = makeFirestore()
    await claimOrgEmailSendBudget({
      orgId: ORG,
      count: 1,
      platformPerHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
      now: NOW,
      firestore,
    })
    const written = docs.get(ORG_PATH)!
    expect(written.expiresAt).toBeInstanceOf(Date)
    expect(written.sentAtMs).toBe(NOW)
    // `lastAtMs` would compete with the degradation markers the rate-limiter
    // health probe queries this collection to find.
    expect(written.lastAtMs).toBeUndefined()
  })

  it('reads a window back for a usage surface without claiming anything', async () => {
    const firestore = makeFirestore()
    await claimOrgEmailSendBudget({
      orgId: ORG,
      count: 120,
      platformPerHour: EMAIL_SEND_RATE_DEFAULT_PER_HOUR,
      now: NOW,
      firestore,
    })
    const window = await readOrgEmailSendWindow({ orgId: ORG, now: NOW, firestore })
    expect(window.used).toBe(120)
    expect(window.resetMs).toBe(WINDOW_START + EMAIL_SEND_RATE_WINDOW_MS)
    // Still 120 — a read is not a claim.
    expect(docs.get(ORG_PATH)?.count).toBe(120)
  })

  it('reports a quiet hour as zero rather than throwing', async () => {
    const firestore = makeFirestore()
    const window = await readOrgEmailSendWindow({ orgId: ORG, now: NOW, firestore })
    expect(window.used).toBe(0)
  })
})
