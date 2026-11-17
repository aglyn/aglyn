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
  BANDWIDTH_CAP_GRACE_MS,
  bandwidthCapEngaged,
  bandwidthCapGraceUntil,
  bandwidthCapMarker,
  bandwidthCapMonthKey,
  bandwidthCapNotice,
  bandwidthCapShouldEngage,
  bandwidthGraceForEngagement,
  bandwidthGraceOutlastsMonth,
  bandwidthGraceOwnerNotice,
  bandwidthPausedOwnerNotice,
  BANDWIDTH_GRACE_SURGE_SENTENCE,
  formatBandwidthGraceDeadline,
} from './bandwidth-cap'
import { bandwidthCeilingNotice } from './plan-entitlements'
import { PLAN_ENTITLEMENTS } from './plan-entitlements'

const NOW = new Date('2026-08-19T12:00:00.000Z')
const THIS_MONTH = '2026-08'
const LAST_MONTH = '2026-07'

/** Free's published band. LOCKED — pricing may not move (decided). */
const FREE_BANDWIDTH_GB = 2

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
  it('free is 2 GB', () => {
    // If this moves, the cap starts refusing at a number nobody published.
    // Free is the one plan whose bandwidth cannot be metered — there is no
    // subscription to bill an overage onto — so the band is both what it
    // gives away and where it stops.
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

  it('says only that the site is temporarily unavailable (AGL-4232)', () => {
    expect(notice.body).toBe('This site is temporarily unavailable.')
    expect(notice.title).toBe('Temporarily unavailable')
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
      'limit',
      'traffic',
      'bandwidth',
      'month',
    ]) {
      expect(words).not.toContain(leak)
    }
  })

})

describe('the ABUSE CEILING\'s visitor notice (AGL-4232)', () => {
  it('is the pause\'s own neutral sentence, with nothing about traffic or plans', () => {
    const notice = bandwidthCeilingNotice()
    expect(notice).toEqual(bandwidthCapNotice())
    for (const leak of ['traffic', 'plan', 'upgrade', 'month', 'owner']) {
      expect(`${notice.title} ${notice.body}`.toLowerCase()).not.toContain(leak)
    }
  })
})

/**
 * THE ONE-TIME GRACE (AGL-4232): the first time a site goes over, ever, it
 * stays online for 72 hours; then it pauses as before. In a later month it
 * pauses at the limit. Each case is paired with the one that answers the
 * other way.
 */
describe('the one-time grace', () => {
  const nowMs = NOW.getTime()
  const inGrace = { month: THIS_MONTH, engagedAt: nowMs, graceUntil: nowMs + BANDWIDTH_CAP_GRACE_MS }

  it('is 72 hours', () => {
    expect(BANDWIDTH_CAP_GRACE_MS).toBe(72 * 60 * 60 * 1000)
  })

  it('under the band nothing engages, so there is no grace and no pause', () => {
    expect(
      bandwidthCapShouldEngage({ org: freeOrg(), usedBandwidthGb: 1.6, includedBandwidthGb: FREE_BANDWIDTH_GB }),
    ).toBe(false)
    expect(bandwidthCapEngaged(freeOrg(), NOW)).toBe(false)
    expect(bandwidthCapGraceUntil(freeOrg(), NOW)).toBeNull()
  })

  it('the first time over, the site SERVES during the grace, and the deadline is readable', () => {
    const org = freeOrg(inGrace)
    expect(bandwidthCapEngaged(org, NOW)).toBe(false)
    expect(bandwidthCapEngaged(org, new Date(nowMs + BANDWIDTH_CAP_GRACE_MS - 1))).toBe(false)
    expect(bandwidthCapGraceUntil(org, NOW)).toBe(inGrace.graceUntil)
  })

  it('when the grace ends the site PAUSES, with no write', () => {
    const org = freeOrg(inGrace)
    const after = new Date(nowMs + BANDWIDTH_CAP_GRACE_MS)
    expect(bandwidthCapEngaged(org, after)).toBe(true)
    expect(bandwidthCapGraceUntil(org, after)).toBeNull()
  })

  it('an engagement with no grace pauses at once', () => {
    expect(bandwidthCapEngaged(freeOrg(engagedMarker(THIS_MONTH)), NOW)).toBe(true)
    expect(bandwidthCapGraceUntil(freeOrg(engagedMarker(THIS_MONTH)), NOW)).toBeNull()
  })

  it('an upgrade during the grace or the pause brings the site back, and warns of nothing', () => {
    expect(bandwidthCapEngaged(paidOrg(inGrace), new Date(nowMs + BANDWIDTH_CAP_GRACE_MS))).toBe(false)
    expect(bandwidthCapGraceUntil(paidOrg(inGrace), NOW)).toBeNull()
  })

  it('is granted only to sites that never had it', () => {
    expect(bandwidthGraceForEngagement([{}], nowMs)).toEqual({
      graceUntil: nowMs + BANDWIDTH_CAP_GRACE_MS,
      grants: true,
    })
    expect(bandwidthGraceForEngagement([], nowMs)).toEqual({ graceUntil: null, grants: false })
  })

  it('a site that had it in an earlier month pauses at once: no month rollover re-arms it', () => {
    const lastMonth = nowMs - 40 * 24 * 3_600_000
    expect(bandwidthGraceForEngagement([{ bandwidthGraceUsedAt: lastMonth }], nowMs)).toEqual({
      graceUntil: null,
      grants: false,
    })
    // An org with one site that had it and one that did not: the org pauses.
    expect(
      bandwidthGraceForEngagement([{ bandwidthGraceUsedAt: lastMonth }, {}], nowMs).grants,
    ).toBe(false)
  })

  it('the WORKSPACE stamp blocks a new grant: a deleted site re-made gets none (AGL-4232)', () => {
    const lastMonth = nowMs - 40 * 24 * 3_600_000
    expect(bandwidthGraceForEngagement([{}], nowMs, { bandwidthGraceUsedAt: lastMonth })).toEqual({
      graceUntil: null,
      grants: false,
    })
    // …and a running one is still carried from either stamp.
    const grantedAt = nowMs - 3_600_000
    expect(bandwidthGraceForEngagement([{}], nowMs, { bandwidthGraceUsedAt: grantedAt })).toEqual({
      graceUntil: grantedAt + BANDWIDTH_CAP_GRACE_MS,
      grants: false,
    })
    // Both absent: granted.
    expect(bandwidthGraceForEngagement([{}], nowMs, {}).grants).toBe(true)
  })

  it('a re-engage from a stale org doc carries a RUNNING grace forward, never cuts it short', () => {
    const grantedAt = nowMs - 3_600_000
    expect(bandwidthGraceForEngagement([{ bandwidthGraceUsedAt: grantedAt }], nowMs)).toEqual({
      graceUntil: grantedAt + BANDWIDTH_CAP_GRACE_MS,
      grants: false,
    })
  })

  it('the marker carries the grace only when there is one', () => {
    const base = { month: THIS_MONTH, nowMs, pageViews: 10.4, includedPageViews: 9.6 }
    expect(bandwidthCapMarker({ ...base, graceUntil: null })).toEqual({
      month: THIS_MONTH,
      engagedAt: nowMs,
      pageViews: 10,
      includedPageViews: 10,
    })
    expect(bandwidthCapMarker({ ...base, graceUntil: 5 }).graceUntil).toBe(5)
  })

  it('tells the OWNER the deadline in plain words, with the way past it', () => {
    const notice = bandwidthGraceOwnerNotice({
      graceUntil: Date.UTC(2026, 10, 19, 15, 4),
      month: '2026-11',
      used: 'the 2,070 page views its plan includes',
      resumesOn: 'December 1',
    })
    expect(formatBandwidthGraceDeadline(Date.UTC(2026, 10, 19, 15, 4))).toBe(
      'Thursday, November 19 at 3:04 PM UTC',
    )
    expect(notice.title).toBe('Upgrade or {site} pauses on Thursday, November 19 at 3:04 PM UTC')
    expect(notice.body).toMatch(/stays online until Thursday, November 19 at 3:04 PM UTC/)
    expect(notice.body).toMatch(/Upgrade in Billing before then/)
    expect(notice.body).toMatch(/until December 1/)
    // Given once (per workspace's sites), never "per site" (AGL-4232).
    expect(notice.body).toMatch(/This extra time is given once,/)
    expect(notice.body).not.toMatch(/once per site/)
    // The ceiling stays the cost bound during the grace, and that is said.
    expect(notice.body).toContain(BANDWIDTH_GRACE_SURGE_SENTENCE)
    expect(BANDWIDTH_GRACE_SURGE_SENTENCE).toBe(
      'An unusually large surge of traffic can still pause it before then.',
    )
  })

  it('a grace CARRIED into a new month says the extra time was already given', () => {
    const notice = bandwidthGraceOwnerNotice({
      graceUntil: Date.UTC(2026, 11, 2, 9, 0),
      month: '2026-12',
      used: 'the 2,070 page views its plan includes',
      resumesOn: 'January 1',
      carried: true,
    })
    expect(notice.title).toBe('Upgrade or {site} pauses on Wednesday, December 2 at 9:00 AM UTC')
    expect(notice.body).toMatch(/when the extra time it was already given ends/)
    expect(notice.body).toMatch(/until January 1/)
  })

  it('a pause is told plainly: when it lifts, that nothing is charged, and the way back', () => {
    const notice = bandwidthPausedOwnerNotice({
      used: 'the 2 GB of traffic its plan includes',
      resumesOn: 'December 1',
    })
    expect(notice.title).toBe('{site} paused — monthly traffic limit reached')
    expect(notice.body).toMatch(/"temporarily unavailable" notice instead of its pages until December 1/)
    expect(notice.body).toMatch(/Nothing is charged/)
    expect(notice.body).toMatch(/as soon as you upgrade in Billing/)
  })

  it('a grace that outlasts the month names no pause date, because none comes', () => {
    // Granted on November 29: 72 hours ends December 2, after the 1st resets
    // the count, so the site never pauses on that date.
    const graceUntil = Date.UTC(2026, 11, 2, 9, 0)
    expect(bandwidthGraceOutlastsMonth(graceUntil, '2026-11')).toBe(true)
    expect(bandwidthGraceOutlastsMonth(Date.UTC(2026, 10, 30, 23, 59), '2026-11')).toBe(false)
    // The boundary itself: ending AT the reset is no pause either.
    expect(bandwidthGraceOutlastsMonth(Date.UTC(2026, 11, 1), '2026-11')).toBe(true)
    const notice = bandwidthGraceOwnerNotice({
      graceUntil,
      month: '2026-11',
      used: 'the 2,070 page views its plan includes',
      resumesOn: 'December 1',
    })
    expect(notice.title).toBe('{site} is past its monthly traffic limit and stays online')
    expect(`${notice.title} ${notice.body}`).not.toMatch(/pauses on|until \w+day/)
    expect(notice.body).toMatch(/stays online/)
    expect(notice.body).toMatch(/starts again on December 1/)
    expect(notice.body).toMatch(/has now been used/)
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
