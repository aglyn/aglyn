/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * WHAT THE ORPHAN SWEEP SELECTS, AND THE FOUR NAMES IT MUST NEVER SELECT.
 *
 * The planner is pure, so every one of these is decided without a provider, a
 * zone or a Firestore — which is what makes the pool assertion worth having.
 * A test that needed a live account to prove "we did not delete shared2" is a
 * test nobody runs.
 */

export {}

import {
  planSendingDomainReap,
  type ClaimOwnership,
  type SendingDomainClaim,
} from './reap-sending-domains'
import { sharedSendingPool } from '@aglyn/shared-util-email'

const NOW = Date.UTC(2026, 7, 31, 12, 0, 0)
const DAY = 24 * 60 * 60 * 1000
const OPTIONS = { minAgeHours: 24, maxReaps: 100, now: NOW }

type Row = SendingDomainClaim & { owner: ClaimOwnership }

/** A healthy claim: a live host pinning exactly this label. */
function claim(overrides: Partial<Row> = {}): Row {
  const label = String(overrides.label ?? 'northwind')
  return {
    label,
    hostId: 'HostAbc',
    orgId: 'org123',
    domain: `${label}.mail.aglyn.app`,
    claimedAtMs: NOW - 30 * DAY,
    orphanedAtMs: null,
    teardownDetail: null,
    teardownAttempts: 0,
    ...overrides,
    owner: {
      hostExists: true,
      hostLabel: label,
      orgExists: true,
      ...(overrides.owner ?? {}),
    },
  }
}

describe('⛔ the shared pool is never selected', () => {
  /*
   * The most important assertion in this change.
   *
   * `shared1.mail.aglyn.app` … `shared4` are verified, live, and belong to NO
   * host: every site without a domain of its own sends its receipts, password
   * resets and booking confirmations on one, assigned by hash rather than by a
   * stored pointer. "Nothing owns this" is therefore an exact description of a
   * live pool member, and an orphan reaper is by default the program that
   * deletes all four.
   *
   * They have no label claim in the real system — pool labels are reserved
   * against tenants and `ensureHostSendingDomain` is the only writer of that
   * collection — so this fixture is deliberately impossible. That is the
   * point: the refusal must not depend on the sweep's starting point, because
   * a future change to where it starts would remove the protection silently.
   */
  it('refuses a pool member even when the fixture forces one into the scan', () => {
    const pool = sharedSendingPool('mail.aglyn.app', 4)
    expect(pool).toHaveLength(4)

    const rows = pool.map((domain, index) =>
      claim({
        label: `shared${index + 1}`,
        domain,
        // Every signal that would mark an ordinary claim as an orphan, at
        // once: the host is gone, the org is gone, and an erasure has already
        // stamped the debt. Nothing may make a pool member reapable.
        hostId: 'HostGone',
        orphanedAtMs: NOW - DAY,
        owner: { hostExists: false, hostLabel: null, orgExists: false },
      }),
    )

    const plan = planSendingDomainReap(rows, OPTIONS)

    expect(plan.toReap).toEqual([])
    expect(plan.poolProtected.sort()).toEqual([...pool].sort())
  })

  it('refuses a pool member the CURRENT pool size no longer reaches', () => {
    // A deployment shrunk from eight to four still holds `shared5`..`shared8`
    // at the provider. They are still infrastructure, and a membership test
    // against today's pool would hand all four to the reaper.
    const plan = planSendingDomainReap(
      [
        claim({
          label: 'shared7',
          domain: 'shared7.mail.aglyn.app',
          orphanedAtMs: NOW - DAY,
          owner: { hostExists: false, hostLabel: null, orgExists: false },
        }),
      ],
      OPTIONS,
    )

    expect(plan.toReap).toEqual([])
    expect(plan.poolProtected).toEqual(['shared7.mail.aglyn.app'])
  })

  it('refuses the pool while reaping the tenant orphan standing beside it', () => {
    /*
     * THE CONTROL, and the case that fails if the planner is ever made to
     * select everything. The two blocks above pass for a planner that reaps
     * nothing at all — which would be a leak that never closes and a green
     * suite saying otherwise. One run, both answers.
     */
    const rows = [
      ...sharedSendingPool('mail.aglyn.app', 4).map((domain, index) =>
        claim({
          label: `shared${index + 1}`,
          domain,
          owner: { hostExists: false, hostLabel: null, orgExists: false },
        }),
      ),
      claim({
        label: 'northwind',
        hostId: 'HostGone',
        owner: { hostExists: false, hostLabel: null, orgExists: false },
      }),
    ]

    const plan = planSendingDomainReap(rows, OPTIONS)

    expect(plan.toReap.map((row) => row.domain)).toEqual([
      'northwind.mail.aglyn.app',
    ])
    expect(plan.poolProtected).toHaveLength(4)
  })
})

describe('an owner that is gone', () => {
  it('reaps a claim whose host document no longer exists', () => {
    const plan = planSendingDomainReap(
      [
        claim({
          hostId: 'HostGone',
          owner: { hostExists: false, hostLabel: null, orgExists: true },
        }),
      ],
      OPTIONS,
    )

    expect(plan.toReap).toEqual([
      {
        label: 'northwind',
        domain: 'northwind.mail.aglyn.app',
        hostId: 'HostGone',
        orgId: 'org123',
        reason: 'host-gone',
        attempts: 0,
      },
    ])
  })

  it('reaps a claim whose WORKSPACE is gone', () => {
    const plan = planSendingDomainReap(
      [claim({ owner: { hostExists: true, hostLabel: 'northwind', orgExists: false } })],
      OPTIONS,
    )

    expect(plan.toReap.map((row) => row.reason)).toEqual(['org-gone'])
  })

  it('reaps a claim the host has since stopped pinning', () => {
    // A `restartHostSendingDomain` whose release half-ran: the host lives and
    // pins its new label, and the old domain holds a provider slot that
    // nothing will ever look for again.
    const plan = planSendingDomainReap(
      [claim({ owner: { hostExists: true, hostLabel: 'northwind-2', orgExists: true } })],
      OPTIONS,
    )

    expect(plan.toReap.map((row) => row.reason)).toEqual(['label-reassigned'])
  })

  it('reaps a debt an erasure recorded, carrying the attempt count', () => {
    const plan = planSendingDomainReap(
      [
        claim({
          orphanedAtMs: NOW - 2 * DAY,
          teardownDetail: 'provider-release',
          teardownAttempts: 3,
          owner: { hostExists: false, hostLabel: null, orgExists: false },
        }),
      ],
      OPTIONS,
    )

    expect(plan.toReap.map((row) => [row.reason, row.attempts])).toEqual([
      ['erased', 3],
    ])
  })
})

describe('an owner that is still there', () => {
  it('leaves a live site completely alone', () => {
    const plan = planSendingDomainReap([claim()], OPTIONS)

    expect(plan.toReap).toEqual([])
    expect(plan.live).toBe(1)
  })

  it('does not treat a claim it cannot attribute as an orphan', () => {
    /*
     * A claim with no `hostId` cannot be released by the ordinary path either
     * — `releaseHostSendingDomain` matches on the host id before deleting the
     * claim — so it is a broken record for a person to look at. Reading "I
     * cannot tell who owns this" as "nobody owns this" would be deleting on
     * the strength of missing data, which is the mistake that makes an orphan
     * reaper dangerous.
     */
    const plan = planSendingDomainReap(
      [
        claim({
          hostId: null,
          owner: { hostExists: false, hostLabel: null, orgExists: true },
        }),
      ],
      OPTIONS,
    )

    expect(plan.toReap).toEqual([])
    expect(plan.live).toBe(1)
  })

  it('reports an erased claim that names no host rather than half-acting on it', () => {
    // `releaseHostSendingDomain` addresses `hosts/{hostId}` and matches the
    // claim's own host id before deleting it, so this one cannot be settled by
    // the ordinary path — and an empty document id is not a request Firestore
    // accepts at all. A person has to look at it.
    const plan = planSendingDomainReap(
      [
        claim({
          hostId: null,
          orphanedAtMs: NOW - DAY,
          owner: { hostExists: false, hostLabel: null, orgExists: false },
        }),
      ],
      OPTIONS,
    )

    expect(plan.toReap).toEqual([])
    expect(plan.unusable).toEqual(['northwind'])
  })

  it("never touches a customer's own verified domain", () => {
    const plan = planSendingDomainReap(
      [
        claim({
          label: 'acme-com',
          domain: 'acme.com',
          owner: { hostExists: false, hostLabel: null, orgExists: false },
        }),
      ],
      // The label still resolves inside our apex, so the stored domain is what
      // has to be believed here — see the note on re-derivation in the planner.
      { ...OPTIONS, maxReaps: 100 },
    )

    // `acme-com` is a legal label, so the planner re-derives
    // `acme-com.mail.aglyn.app` and reaps THAT rather than the customer's own
    // name. Either way `acme.com` is never a candidate.
    expect(plan.toReap.map((row) => row.domain)).toEqual([
      'acme-com.mail.aglyn.app',
    ])
    expect(plan.toReap.map((row) => row.domain)).not.toContain('acme.com')
  })
})

describe('the guards on the sweep itself', () => {
  it('waits out a young claim before calling it an orphan', () => {
    /*
     * The race it exists for: `ensureHostSendingDomain` writes the claim
     * BEFORE it points the host at it, so for that instant a perfectly healthy
     * claim looks exactly like a reassigned label.
     */
    const plan = planSendingDomainReap(
      [
        claim({
          claimedAtMs: NOW - 60 * 1000,
          owner: { hostExists: false, hostLabel: null, orgExists: true },
        }),
      ],
      OPTIONS,
    )

    expect(plan.toReap).toEqual([])
    expect(plan.tooNew).toBe(1)
  })

  it('does NOT make a recorded debt wait — that one was not inferred', () => {
    const plan = planSendingDomainReap(
      [
        claim({
          claimedAtMs: NOW - 60 * 1000,
          orphanedAtMs: NOW - 60 * 1000,
          owner: { hostExists: false, hostLabel: null, orgExists: true },
        }),
      ],
      OPTIONS,
    )

    expect(plan.toReap.map((row) => row.reason)).toEqual(['erased'])
    expect(plan.tooNew).toBe(0)
  })

  it('caps the releases one run may make, and says how many it deferred', () => {
    const rows = Array.from({ length: 5 }, (_unused, index) =>
      claim({
        label: `site-${index}`,
        hostId: `HostGone${index}`,
        owner: { hostExists: false, hostLabel: null, orgExists: false },
      }),
    )

    const plan = planSendingDomainReap(rows, { ...OPTIONS, maxReaps: 2 })

    expect(plan.toReap).toHaveLength(2)
    expect(plan.deferredByCap).toBe(3)
    expect(plan.scanned).toBe(5)
  })

  it('reports a claim that names no usable domain rather than acting on it', () => {
    const plan = planSendingDomainReap(
      [
        claim({
          label: '',
          domain: '',
          owner: { hostExists: false, hostLabel: null, orgExists: false },
        }),
      ],
      OPTIONS,
    )

    expect(plan.toReap).toEqual([])
    expect(plan.unusable).toEqual(['(no label)'])
  })
})
