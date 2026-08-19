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
 * The free plan's bandwidth cap, decided (AGL-1967/2070/2155).
 *
 * Every case here is paired with the case that must answer the other way, so
 * no assertion can be satisfied by a predicate that simply returns `true`.
 * The pairs that matter most:
 *
 *  - free over the band REFUSES / **paid over the same band SERVES** — a cap
 *    that stopped paying customers would be a worse bug than the hole;
 *  - the marker's month matches REFUSES / **last month's marker SERVES** — the
 *    self-clearing property, which is the only thing that ever lifts the cap
 *    if the cron never runs again;
 *  - an org that upgrades SERVES **with the marker still on the document** —
 *    the release path a customer who has just paid actually experiences.
 */

import {
  BANDWIDTH_CAP_CODE,
  BANDWIDTH_CAP_RETRY_AFTER_SECONDS,
  bandwidthCapEngaged,
  bandwidthCapMonthKey,
  bandwidthCapNotice,
  bandwidthCapShouldEngage,
} from './bandwidth-cap'
import { PLAN_ENTITLEMENTS } from './plan-entitlements'

const NOW = new Date('2026-08-19T12:00:00.000Z')
const THIS_MONTH = '2026-08'
const LAST_MONTH = '2026-07'

/** Free's published band. LOCKED — pricing may not move (Zach, 2026-08-18). */
const FREE_BANDWIDTH_GB = 5

const freeOrg = (cap?: unknown) =>
  ({
    plan: 'free',
    ...(cap === undefined ? {} : { bandwidthCap: cap }),
  }) as never
const paidOrg = (cap?: unknown) =>
  ({
    plan: 'starter',
    subscription: { status: 'active' },
    ...(cap === undefined ? {} : { bandwidthCap: cap }),
  }) as never

const engagedMarker = (month: string) => ({ month, engagedAt: 1 })

describe('the band this cap is built on is the published one', () => {
  it('free is 5 GB', () => {
    // If this moves, the cap starts refusing at a number nobody published.
    expect(PLAN_ENTITLEMENTS.free.bandwidthGb).toBe(FREE_BANDWIDTH_GB)
  })
})

describe('bandwidthCapShouldEngage — the writer half', () => {
  it('ENGAGES for a free org past its band', () => {
    expect(
      bandwidthCapShouldEngage({
        org: freeOrg(),
        usedBandwidthGb: 500,
        includedBandwidthGb: FREE_BANDWIDTH_GB,
      }),
    ).toBe(true)
  })

  it('POSITIVE CONTROL: never engages for a PAID org past the same band', () => {
    // Without this the cap could be satisfied by refusing everybody, which
    // would break the older and larger promise: a metered plan bills the
    // excess and is never cut off. 100× the free band on a paid plan.
    expect(
      bandwidthCapShouldEngage({
        org: paidOrg(),
        usedBandwidthGb: 500,
        includedBandwidthGb: FREE_BANDWIDTH_GB,
      }),
    ).toBe(false)
  })

  it('does NOT engage a free org exactly AT its band', () => {
    // `>` not `>=`: an org that used what it was given is not over it.
    expect(
      bandwidthCapShouldEngage({
        org: freeOrg(),
        usedBandwidthGb: FREE_BANDWIDTH_GB,
        includedBandwidthGb: FREE_BANDWIDTH_GB,
      }),
    ).toBe(false)
  })

  it('never engages against an UNLIMITED band', () => {
    // Enterprise also answers false to `planMetersInfraOverage`, so the plan
    // check alone would not have stopped this.
    expect(
      bandwidthCapShouldEngage({
        org: { plan: 'enterprise' } as never,
        usedBandwidthGb: 1_000_000,
        includedBandwidthGb: Number.POSITIVE_INFINITY,
      }),
    ).toBe(false)
  })
})

describe('bandwidthCapEngaged — the reader half', () => {
  it('REFUSES a free org whose marker names the current month', () => {
    expect(bandwidthCapEngaged(freeOrg(engagedMarker(THIS_MONTH)), NOW)).toBe(
      true,
    )
  })

  it('POSITIVE CONTROL: SERVES a paid org carrying the identical marker', () => {
    // The same fixture, the same month, the only difference being the plan.
    // A cap satisfied by refusing everything fails right here.
    expect(bandwidthCapEngaged(paidOrg(engagedMarker(THIS_MONTH)), NOW)).toBe(
      false,
    )
  })

  it('SERVES once the month rolls over, with NOTHING cleared', () => {
    // The self-clearing property. The marker is still on the document and no
    // writer has touched it — the month simply stopped matching. This is the
    // only lift path that survives the cron never running again.
    expect(bandwidthCapEngaged(freeOrg(engagedMarker(LAST_MONTH)), NOW)).toBe(
      false,
    )
  })

  it('RELEASES an org that upgrades, marker still on the document', () => {
    // What a customer who has just paid actually experiences: the org doc is
    // rewritten by Stripe's webhook with a new plan, this predicate re-derives
    // it, and the site is back on the next 60s cache TTL — no cron, no clear.
    const upgraded = {
      plan: 'starter',
      subscription: { status: 'active' },
      bandwidthCap: engagedMarker(THIS_MONTH),
    } as never
    expect(bandwidthCapEngaged(upgraded, NOW)).toBe(false)
  })

  it('re-engages a DOWNGRADED org — the plan is read, not the marker', () => {
    // The other direction of the same re-derivation: a dead subscription
    // resolves back to free, and the current month's marker bites again.
    const lapsed = {
      plan: 'starter',
      subscription: { status: 'canceled' },
      bandwidthCap: engagedMarker(THIS_MONTH),
    } as never
    expect(bandwidthCapEngaged(lapsed, NOW)).toBe(true)
  })

  it('never refuses an ENTERPRISE org, marker or no marker', () => {
    expect(
      bandwidthCapEngaged(
        {
          plan: 'enterprise',
          bandwidthCap: engagedMarker(THIS_MONTH),
        } as never,
        NOW,
      ),
    ).toBe(false)
  })

  describe('FAILS OPEN on everything unrecognised', () => {
    // An unreadable org doc is an outage. Each of these serving is the
    // difference between a cost control and a platform-wide takedown.
    it.each([
      ['a null org', null],
      ['an undefined org', undefined],
      ['a free org with no marker at all', freeOrg()],
      ['a marker that is not an object', freeOrg('2026-08')],
      ['a marker with no month', freeOrg({ engagedAt: 1 })],
      ['a marker with a null month', freeOrg({ month: null })],
      ['a marker with a malformed month', freeOrg({ month: '2026-8' })],
    ])('%s serves', (_label, org) => {
      expect(bandwidthCapEngaged(org as never, NOW)).toBe(false)
    })
  })
})

describe('bandwidthCapMonthKey', () => {
  it('is the UTC YYYY-MM the usage counters are keyed by', () => {
    expect(bandwidthCapMonthKey(NOW)).toBe(THIS_MONTH)
  })

  it('rolls at the UTC boundary, not a local one', () => {
    // 2026-08-31T23:30 in a UTC+2 zone is already September locally. The
    // counters this cap is derived from are UTC-keyed, so this must be too.
    expect(bandwidthCapMonthKey(new Date('2026-08-31T23:30:00.000Z'))).toBe(
      '2026-08',
    )
    expect(bandwidthCapMonthKey(new Date('2026-09-01T00:00:00.000Z'))).toBe(
      '2026-09',
    )
  })
})

describe('the visitor notice', () => {
  const notice = bandwidthCapNotice()

  it('says the site is paused and that it comes back', () => {
    expect(notice.title).toMatch(/traffic limit/i)
    expect(notice.body).toMatch(/next month/i)
  })

  it('discloses NOTHING about the owner’s account', () => {
    // The reader is a stranger to this site (the AGL-1666 constraint). A plan
    // name, a price, a band or an upgrade prompt on a page shown to somebody
    // else's readers is the owner's business published without their consent.
    const words = `${notice.title} ${notice.body}`.toLowerCase()
    for (const leak of [
      'free',
      'plan',
      'upgrade',
      'billing',
      'invoice',
      'gb',
      '$',
      'aglyn',
    ]) {
      expect(words).not.toContain(leak)
    }
  })

  it('does not blame the visitor', () => {
    expect(notice.body).toMatch(/nothing is wrong with your connection/i)
  })
})

describe('the refusal contract', () => {
  it('retries in an hour, not at the month boundary', () => {
    // The arithmetically correct answer can be three weeks, and the site can
    // come back in a minute when the owner upgrades.
    expect(BANDWIDTH_CAP_RETRY_AFTER_SECONDS).toBe(3600)
  })

  it('carries a code, because the STATUS discriminates nothing', () => {
    // A capped site and a locked site both answer 503 on purpose — it is the
    // only status that tells a crawler to come back rather than to de-index.
    expect(BANDWIDTH_CAP_CODE).toBe('bandwidth-cap')
  })
})
