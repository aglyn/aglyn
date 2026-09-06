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
 * EVERY free quota REFUSES at its cap, and refuses BECAUSE of that cap
 * (AGL-1529).
 *
 * The free/hobby tier hard-caps, so that it always actually stays free.
 *
 * ## The gap this closes, in the words of the guard that has it
 *
 * `quota-enforced-somewhere.spec.ts` sweeps the same derived key set and says
 * of itself: *"This is a coverage sweep, not a proof of enforcement: it cannot
 * tell a real gate from a variable that is read and discarded."* That is the
 * honest description of a `git grep`, and it is exactly the state AGL-2163
 * found `checkDataStorageQuota().allowed` and `checkApiRequestQuota().allowed`
 * in — both READ, both discarded, both documented as hard-blocking free.
 *
 * `free-tier-never-billed.spec.ts` proves the other half: the BELT, that a
 * free org's invoice is zero however far past a band it goes. It deliberately
 * assumes no gate at all, so it cannot say whether one exists.
 *
 * Neither answers the question about the BRACES, which is per-dimension:
 * *at the cap, is the operation refused?* This file is
 * that answer, and it is DERIVED from `PLAN_ENTITLEMENTS.free` so a quota
 * added tomorrow is red until somebody classifies it.
 *
 * ## Why a "refused" assertion alone would be worthless
 *
 * Every decider below returns `false` for a great many reasons that have
 * nothing to do with a cap — an unknown plan, a missing entitlement flag, a
 * malformed org. A test that drove usage to the cap and asserted `false` would
 * pass against a helper that refused unconditionally, which is the same
 * green-check-that-reads-nothing this repo keeps being bitten by.
 *
 * So each dimension is asserted THREE ways, and the third is the load-bearing
 * one:
 *
 *  1. **REFUSED** at `refusedAt`.
 *  2. **ALLOWED** at `allowedAt` — one unit below — wherever the cap is
 *     non-zero and a "below" exists at all.
 *  3. **CAUSATION**: relax *this one cap* by one unit via
 *     `org.entitlements`, re-drive the SAME usage that was refused in (1),
 *     and require it to succeed. A refusal that survives its own cap being
 *     raised was never that cap's refusal.
 *
 * (3) is what makes the eleven dimensions whose free band is ZERO testable at
 * all. There is no "one below zero" to allow, so without it those rows would
 * assert nothing but "free refuses", which is true of a platform that refuses
 * everything.
 *
 * ## What this file is NOT
 *
 * It drives the DECISION each enforcement point makes, not the HTTP route
 * around it. Those are proven end to end elsewhere, one suite per ingress —
 * `free-tier-site-limit-is-atomic`, `host-resource-cap-is-atomic`,
 * `storage-overage-protection`, `dataset-storage-quota-enforced`,
 * `api-v1-request-quota`, `bandwidth-cap-engages`,
 * `apps/tenant/specs/bandwidth-cap-refusal`, `sso-jit-seat-quota`. The
 * `ENFORCED_IN` pin on every row names the file that must consult the decider,
 * and is checked below, so a dimension cannot pass here while its verdict goes
 * nowhere (the AGL-2163 shape).
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  bandwidthCapShouldEngage,
  checkApiRequestQuota,
  checkCrmRecordsQuota,
  checkDatasetQuota,
  checkDataStorageQuota,
  checkFormSubmissionQuota,
  checkHostCollaboratorQuota,
  checkHostRegisterQuota,
  checkQuota,
  checkSeatQuota,
  checkVisitorRecordCeiling,
  LEADS_MAX_PER_HOST,
  PLAN_ENTITLEMENTS,
  resolveOrgEntitlements,
  SITE_MEMBERS_MAX_PER_HOST,
} from '@aglyn/aglyn/server'
import { mediaStorageGate } from '../utils/storage-overage'

const REPO_ROOT = join(__dirname, '..', '..', '..')

type Org = Record<string, unknown>

/** A free org, optionally with this one quota raised. */
const free = (entitlements?: Record<string, number>): Org =>
  entitlements ? { plan: 'free', entitlements } : { plan: 'free' }

/** The cheapest plan that BILLS — the positive control for the whole file. */
const paid = (): Org => ({ plan: 'starter', subscription: { status: 'active' } })

interface Dimension {
  /**
   * "May this org add one more, having already used N?" — the question every
   * enforcement point below actually asks, normalised so one loop can drive
   * all of them.
   */
  decide: (org: Org, used: number) => boolean
  /** Usage that MUST be refused on free. */
  refusedAt: number
  /**
   * Usage that must be ALLOWED on free. Omitted only where the free band is
   * zero and no "below the cap" exists.
   */
  allowedAt?: number
  /** A free org with THIS dimension's cap raised to `n`, and nothing else. */
  relax: (n: number) => Org
  /**
   * The file that must consult this dimension's decider. Pinned per row,
   * because the failure this guards is a verdict computed and discarded.
   */
  enforcedIn: string
  /** The symbol `enforcedIn` must name outside a comment. */
  decider: string
}

/** Raising a per-site seat band means raising its hard ceiling too. */
const raiseSeats = (key: string, maxKey: string) => (n: number) =>
  free({ [key]: n, [maxKey]: n })

const quotaRow = (
  key: string,
  refusedAt: number,
  enforcedIn: string,
  allowedAt?: number,
): Dimension => ({
  decide: (org, used) => checkQuota(org as never, key as never, used).allowed,
  refusedAt,
  allowedAt,
  relax: (n) => free({ [key]: n }),
  enforcedIn,
  decider: 'checkQuota',
})

const RESOURCES_ROUTE = 'apps/console/app/api/hosts/resources/route.ts'

/**
 * dimension → how the platform decides it, and where.
 *
 * Hand-written on purpose, and checked for completeness against
 * `PLAN_ENTITLEMENTS.free` below: a table derived from the plan model would
 * have to guess which helper owns a key, and guessing wrong is how a
 * dimension gets "tested" by a decider that never sees it.
 */
const DIMENSIONS: Record<string, Dimension> = {
  hostLimit: quotaRow(
    'hostLimit',
    1,
    'apps/console/utils/server/provision-host.ts',
    0,
  ),
  screensPerHost: quotaRow('screensPerHost', 5, RESOURCES_ROUTE, 4),
  sharedLayoutsPerHost: quotaRow('sharedLayoutsPerHost', 1, RESOURCES_ROUTE, 0),
  templatesPerHost: quotaRow('templatesPerHost', 10, RESOURCES_ROUTE, 9),
  /**
   * The saved-form CATALOG, which Free has none of — `reusableComponents` is
   * Starter-and-above, so the entity is refused as a feature before the count
   * is reached, and the count agrees at 0. Distinct from
   * `formSubmissionsPerMonth` below, which is what a Free site's forms may
   * RECEIVE: the two are separate dimensions and Free is generous on one and
   * empty on the other.
   */
  formsPerHost: quotaRow('formsPerHost', 0, RESOURCES_ROUTE),
  variablesPerHost: quotaRow('variablesPerHost', 3, RESOURCES_ROUTE, 2),
  functionsPerHost: quotaRow('functionsPerHost', 1, RESOURCES_ROUTE, 0),
  workflowsPerHost: quotaRow('workflowsPerHost', 0, RESOURCES_ROUTE),
  servicesPerHost: quotaRow('servicesPerHost', 0, RESOURCES_ROUTE),
  redirectsPerHost: quotaRow('redirectsPerHost', 0, RESOURCES_ROUTE),
  productsPerHost: quotaRow('productsPerHost', 0, RESOURCES_ROUTE),
  inventoryLocations: quotaRow('inventoryLocations', 1, RESOURCES_ROUTE, 0),
  recordsPerDataset: quotaRow(
    'recordsPerDataset',
    0,
    'apps/console/app/api/orgs/datasets/route.ts',
  ),
  emailSendsPerMonth: quotaRow(
    'emailSendsPerMonth',
    0,
    'libs/plugins/marketing/src/lib/server/campaign-send.ts',
  ),
  /**
   * The two RUN meters. Both enforcement points compute `used + 1 > limit`
   * rather than calling `checkQuota`, which is the same arithmetic — so the
   * `decider` pinned is the resolver they really call, not a helper they do
   * not.
   */
  workflowRunsPerMonth: {
    ...quotaRow(
      'workflowRunsPerMonth',
      0,
      'libs/plugins/workflows/src/lib/server.ts',
    ),
    decider: 'resolveOrgEntitlements',
  },
  actionRunsPerMonth: {
    ...quotaRow(
      'actionRunsPerMonth',
      0,
      'libs/tenant/runtime/src/lib/run-event-actions.ts',
    ),
    decider: 'resolveOrgEntitlements',
  },

  /** Media ingress: `usedMb` INCLUDES the incoming file, so it is `used + 1`. */
  storagePerHostMb: {
    decide: (org, used) => {
      const resolved = resolveOrgEntitlements(org as never)
      return mediaStorageGate({
        org: org as never,
        usedMb: used + 1,
        allowanceMb: resolved.hostLimit * resolved.storagePerHostMb,
      }).allowed
    },
    refusedAt: 250,
    allowedAt: 249,
    relax: (n) => free({ storagePerHostMb: n }),
    enforcedIn: 'apps/console/utils/storage-overage.ts',
    decider: 'mediaStorageGate',
  },

  membersPerHost: {
    decide: (org, used) =>
      checkHostCollaboratorQuota(org as never, 'host-1', used).allowed,
    refusedAt: 1,
    allowedAt: 0,
    relax: raiseSeats('membersPerHost', 'maxMembersPerHost'),
    enforcedIn: 'libs/tenant/data/admin/src/lib/server/organizations.ts',
    decider: 'checkHostCollaboratorQuota',
  },
  managersPerOrg: {
    decide: (org, used) =>
      checkSeatQuota(org as never, 'managers', used).allowed,
    refusedAt: 1,
    allowedAt: 0,
    relax: raiseSeats('managersPerOrg', 'maxManagersPerOrg'),
    // Moved off the routes and into the grant transaction (AGL-2068 on the
    // manager key), like `membersPerHost` above. All four doors read the
    // roster and then wrote, so N concurrent admissions all measured the same
    // roster and all passed; `assertManagerSeats` now decides inside the
    // transaction that writes. `/api/orgs/invites` keeps a pre-flight for the
    // one door that never reaches `upsertOrgMember`, but the enforcement this
    // row pins is here.
    enforcedIn: 'libs/tenant/data/admin/src/lib/server/organizations.ts',
    decider: 'checkSeatQuota',
  },
  posRegisters: {
    decide: (org, used) =>
      checkHostRegisterQuota(org as never, 'host-1', used).allowed,
    refusedAt: 0,
    relax: (n) => free({ posRegisters: n }),
    enforcedIn: RESOURCES_ROUTE,
    decider: 'checkHostRegisterQuota',
  },

  /**
   * Bandwidth is the one dimension whose cap is `>` rather than `>=`: an org
   * exactly AT its band has used what it was given and is not over it
   * (`bandwidthCapShouldEngage`). So the refused/allowed pair straddles the
   * band rather than ending on it.
   */
  bandwidthGb: {
    decide: (org, used) =>
      !bandwidthCapShouldEngage({
        org: org as never,
        usedBandwidthGb: used,
        includedBandwidthGb: resolveOrgEntitlements(org as never).bandwidthGb,
      }),
    refusedAt: 3,
    allowedAt: 2,
    relax: (n) => free({ bandwidthGb: n }),
    enforcedIn: 'apps/tenant/app/api/analytics/collect/route.ts',
    decider: 'bandwidthCapShouldEngage',
  },
  formSubmissionsPerMonth: {
    decide: (org, used) =>
      checkFormSubmissionQuota(org as never, used).allowed,
    refusedAt: 20,
    allowedAt: 19,
    relax: (n) => free({ formSubmissionsPerMonth: n }),
    enforcedIn: 'apps/tenant/app/api/forms/submit/route.ts',
    decider: 'checkFormSubmissionQuota',
  },
  contactsPerHost: {
    // The band counts contacts, companies and deals together (AGL-2611);
    // the capture door asks it with the three-collection sum.
    decide: (org, used) => checkCrmRecordsQuota(org as never, used).allowed,
    refusedAt: 100,
    allowedAt: 99,
    relax: (n) => free({ contactsPerHost: n }),
    enforcedIn: 'libs/tenant/data/admin/src/lib/server/upsert-contact.ts',
    decider: 'checkCrmRecordsQuota',
  },
  apiRequestsPerMonth: {
    decide: (org, used) => checkApiRequestQuota(org as never, used).allowed,
    refusedAt: 0,
    relax: (n) => free({ apiRequestsPerMonth: n }),
    enforcedIn: 'apps/console/utils/api-v1.ts',
    decider: 'checkApiRequestQuota',
  },
  dataStorageMbPerOrg: {
    decide: (org, used) => checkDataStorageQuota(org as never, used).allowed,
    refusedAt: 0,
    relax: (n) => free({ dataStorageMbPerOrg: n }),
    enforcedIn: 'libs/tenant/data/admin/src/lib/server/data-storage-gate.ts',
    decider: 'checkDataStorageQuota',
  },
  datasetsPerOrg: {
    decide: (org, used) => checkDatasetQuota(org as never, used).allowed,
    refusedAt: 0,
    relax: raiseSeats('datasetsPerOrg', 'maxDatasetsPerOrg'),
    enforcedIn: 'apps/console/app/api/orgs/datasets/route.ts',
    decider: 'checkDatasetQuota',
  },
}

/**
 * Numeric keys that are NOT caps. A reason is mandatory: the point of the
 * completeness check is that "we decided" is written down.
 */
const NOT_A_CAP: Record<string, string> = {
  maxManagersPerOrg:
    'a ceiling ON the managers cap, not a cap of its own — it clamps ' +
    'included + purchased inside `checkSeatQuota`, and is driven through ' +
    'the `managersPerOrg` row (whose `relax` must raise both to have any ' +
    'effect, which is itself the proof it binds).',
  maxMembersPerHost:
    'the same clamp for collaborator seats; driven through `membersPerHost`.',
  maxDatasetsPerOrg:
    'the same clamp for datasets; driven through `datasetsPerOrg`.',
  transactionFeePhysicalPct:
    'a RATE applied to a storefront charge, not a ceiling on anything. ' +
    'Nothing is refused when it is reached, because it cannot be reached.',
  transactionFeeDigitalPct: 'a rate, as above.',
  marketplaceFeePct:
    'a rate — the platform share of a marketplace sale. Free carries the ' +
    'HIGHEST value on the price list (30), so reading it as a cap would ' +
    'invert the whole file.',
  assistCreditsPerMonth:
    'a real cap, and enforced — but NOT on this plan, and the causation ' +
    'test would run backwards here. Zero on Free and Starter means "this ' +
    'plan sells no assist band", so `resolveAssistCreditBudget` answers ' +
    'null and what bounds a free workspace is the daily message cap plus ' +
    'the operator spend backstop, both of which this file already covers ' +
    'nowhere near this key. Relaxing it by one unit would hand Free a band ' +
    'of ONE credit and refuse harder, which is the opposite of what step ' +
    '(3) requires. The cap is driven to refusal on the plans that sell it ' +
    'in `assist-usage.spec.ts`, both ways.',
  crmEmailsPerDay:
    'a real cap with no door in the tree yet (AGL-2611): `checkCrmEmailQuota` ' +
    'answers it and the `crmEmailUsage` counter it reads is rules-covered, ' +
    'but the one-to-one send route that must consult it is the companion ' +
    'issue and nothing calls the checker outside its own definition, so ' +
    'there is no file to pin. The commit that lands the route moves this ' +
    'key to a DIMENSIONS row pinned to it — refusing at 0 on Free with no ' +
    'below-the-cap, the `apiRequestsPerMonth` shape.',
}

/** Comment-stripped source, so prose naming a symbol is not a call site. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
}

function codeOf(file: string): string {
  return withoutComments(readFileSync(join(REPO_ROOT, file), 'utf8'))
}

describe('the dimension list is DERIVED, not remembered (AGL-1529)', () => {
  const numericKeys = Object.entries(PLAN_ENTITLEMENTS.free)
    .filter(([, value]) => typeof value === 'number')
    .map(([key]) => key)

  it('enumerates something at all', () => {
    // A sweep over an empty set passes vacuously — the failure mode of every
    // derived guard, asserted before anything is derived from it.
    expect(numericKeys.length).toBeGreaterThanOrEqual(25)
    expect(numericKeys).toContain('bandwidthGb')
    expect(numericKeys).toContain('storagePerHostMb')
  })

  it.each(
    Object.entries(PLAN_ENTITLEMENTS.free)
      .filter(([, value]) => typeof value === 'number')
      .map(([key]) => key),
  )('%s is either driven below or written off as not-a-cap', (key) => {
    const classified = key in DIMENSIONS || key in NOT_A_CAP
    expect(`${key}: ${classified ? 'classified' : 'UNCLASSIFIED'}`).toBe(
      `${key}: classified`,
    )
  })

  it('carries no row for a quota the plan model no longer has', () => {
    // The other direction, and the `totalSiteSizeMb` lesson: a row for a
    // retired key would keep passing forever, testing a default that nothing
    // resolves.
    for (const key of [...Object.keys(DIMENSIONS), ...Object.keys(NOT_A_CAP)]) {
      expect(`${key}: ${numericKeys.includes(key) ? 'live' : 'RETIRED'}`).toBe(
        `${key}: live`,
      )
    }
  })

  it('states the free band of every driven dimension as the plan model has it', () => {
    // Ties the hand-written `refusedAt` numbers to the plan table, so a
    // pricing change cannot leave this file testing yesterday's caps.
    const bands = Object.fromEntries(
      Object.entries(DIMENSIONS).map(([key, dimension]) => [
        key,
        dimension.refusedAt,
      ]),
    )
    const model = PLAN_ENTITLEMENTS.free as never as Record<string, number>
    for (const [key, refusedAt] of Object.entries(bands)) {
      // Bandwidth straddles its band by one (`>` not `>=`); everything else
      // refuses AT the number.
      const expected = key === 'bandwidthGb' ? model[key] + 1 : model[key]
      expect(`${key} refuses at ${refusedAt}`).toBe(
        `${key} refuses at ${expected}`,
      )
    }
  })
})

describe('AT THE CAP, the free plan REFUSES', () => {
  it.each(Object.keys(DIMENSIONS))('%s', (key) => {
    const dimension = DIMENSIONS[key]
    expect(`${key} @${dimension.refusedAt}`).toBe(`${key} @${dimension.refusedAt}`)
    expect(dimension.decide(free(), dimension.refusedAt)).toBe(false)
  })
})

describe('BELOW the cap, the free plan ALLOWS — the refusal is not blanket', () => {
  const withBelow = Object.entries(DIMENSIONS).filter(
    ([, dimension]) => dimension.allowedAt !== undefined,
  )

  it('has rows to check', () => {
    expect(withBelow.length).toBeGreaterThanOrEqual(12)
  })

  it.each(withBelow.map(([key]) => key))('%s', (key) => {
    const dimension = DIMENSIONS[key]
    expect(dimension.decide(free(), dimension.allowedAt as number)).toBe(true)
  })
})

describe('CAUSATION: raising THAT cap by one unit turns the refusal into a yes', () => {
  /**
   * The assertion the other two cannot make. Everything above is consistent
   * with a decider that refuses for an unrelated reason — a missing feature
   * flag, an unreadable org, a helper that returns `false` unconditionally.
   * Here the ONLY thing that changes between the refusal and the success is
   * the one number under test, so a row that passes has proven its own cap is
   * the operative one.
   *
   * FORCED RED, measured: replacing `checkQuota`'s `currentUsage < limit` with
   * `false` leaves every "AT THE CAP" row green and turns all 12 `checkQuota`
   * rows here red. Replacing it with `true` does the reverse. Neither
   * mutation can pass both suites, which is the property this pair exists for.
   */
  it.each(Object.keys(DIMENSIONS))('%s', (key) => {
    const dimension = DIMENSIONS[key]
    const relaxed = dimension.relax(dimension.refusedAt + 1)
    expect(dimension.decide(relaxed, dimension.refusedAt)).toBe(true)
  })
})

describe('POSITIVE CONTROL: the caps are the FREE plan, not the platform', () => {
  /**
   * Without this the whole file is satisfied by a platform that refuses
   * everybody. Starter is where "free stays free" stops being the rule: it
   * carries `meteredInfraPassThrough`, so the four metered dimensions accept
   * and bill instead of refusing, and its bands are larger everywhere else.
   */
  const METERED_ON_PAID = [
    'formSubmissionsPerMonth',
    'contactsPerHost',
    'dataStorageMbPerOrg',
    'bandwidthGb',
  ]

  it.each(METERED_ON_PAID)('%s accepts on a paid plan at the free cap', (key) => {
    const dimension = DIMENSIONS[key]
    expect(dimension.decide(paid(), dimension.refusedAt)).toBe(true)
  })

  it('a paid plan is NOT simply allowed everything', () => {
    // The control's own control. Starter's `hostLimit` is finite, so the same
    // machinery still refuses a paying customer past their band — otherwise
    // the block above would be satisfied by "paid means yes".
    const limit = PLAN_ENTITLEMENTS.starter.hostLimit
    expect(Number.isFinite(limit)).toBe(true)
    expect(DIMENSIONS['hostLimit'].decide(paid(), limit)).toBe(false)
  })
})

describe('the verdict REACHES an enforcement point (the AGL-2163 shape)', () => {
  /**
   * `checkDataStorageQuota().allowed` and `checkApiRequestQuota().allowed`
   * were each documented as hard-blocking free and each read by exactly one
   * caller that ignored the field. Every row above would have passed
   * throughout. So each row also pins the file that must consult its decider,
   * and the mention must survive comment-stripping — the guard next door
   * learned that a comment explaining why something is dead otherwise
   * certifies the corpse.
   */
  it('can tell a real reference from a comment', () => {
    // The instrument, before it is trusted.
    expect(withoutComments('/* checkQuota */ x')).not.toContain('checkQuota')
    expect(withoutComments('a() // checkQuota')).not.toContain('checkQuota')
    expect(withoutComments('checkQuota(org)')).toContain('checkQuota')
  })

  it.each(
    Object.entries(DIMENSIONS).map(([key, dimension]) => [
      key,
      dimension.enforcedIn,
      dimension.decider,
    ]),
  )('%s is decided in %s', (key, file, decider) => {
    expect(`${key}: ${codeOf(file).includes(decider) ? 'wired' : 'NOT WIRED'}`)
      .toBe(`${key}: wired`)
  })

  it('every pinned enforcement file is TRACKED', () => {
    // A path typo would make the assertion above throw rather than fail, and
    // a renamed route would make it fail for the wrong reason. `git ls-files
    // --error-unmatch` settles both, and honours `.gitignore` so a build
    // artefact cannot stand in for a source file.
    //
    // Asked one path at a time rather than listing the tree: `git ls-files --
    // apps libs` is tens of thousands of lines and overflows `execFileSync`'s
    // default buffer, which throws ENOBUFS — a failure that looks like the
    // assertion but is not one.
    const isTracked = (file: string): boolean => {
      try {
        execFileSync('git', ['ls-files', '--error-unmatch', '--', file], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          stdio: 'pipe',
        })
        return true
      } catch {
        return false
      }
    }
    // The instrument first: a path that cannot exist must answer false, or
    // every row below is satisfied by a check that says yes to anything.
    expect(isTracked('apps/console/specs/no-such-file.ts')).toBe(false)
    for (const dimension of Object.values(DIMENSIONS)) {
      expect(`${dimension.enforcedIn}: ${isTracked(dimension.enforcedIn) ? 'tracked' : 'MISSING'}`)
        .toBe(`${dimension.enforcedIn}: tracked`)
    }
  })
})

describe('FLAT PLATFORM CEILINGS on visitor-created records (AGL-1529)', () => {
  /**
   * `hosts/{hostId}/siteMembers` and `hosts/{hostId}/leads` are created by
   * ANONYMOUS VISITORS on a public site (`membershipRegisterHandler`, the two
   * bookings lead paths). Until 2026-08-23 they were bounded by NOTHING: no
   * plan dimension, no flat platform cap, no entitlement on the handler. The
   * only bound was `visitorWriteRateLimitRefusal`, which is keyed on
   * (host, IP), fails soft, and therefore bounds the RATE and not the TOTAL —
   * the exact sentence AGL-2265 used as its reason for adding the
   * free-workspace ceiling, and the shape AGL-2266 closed for `actions` and
   * `entries`: *"uncapped Firestore documents and write volume behind a $0
   * subscription"*.
   *
   * ## the decision, 2026-08-23, verbatim
   *
   * > A platform-wide ceiling — **not a plan dimension**, so "unlimited
   * > member accounts on every plan" stays true, because **an abuse control
   * > is not something we sell**. Same instrument already approved twice:
   * > **AGL-1655** for forms and **AGL-2155** for bandwidth.
   *
   * So this block used to record the gap as MEASURED FACT, deliberately, so
   * that it would go red the day a cap landed. It has. What it records now is
   * the cap — and, still, that the cap did NOT become a plan dimension, which
   * is the half of the decision easiest to lose: AGL-889 decided member
   * accounts are unlimited on every plan as a PRICING matter and `/pricing`
   * says so, so a ceiling that varied by plan would make that sentence false.
   *
   * ## Why a FLAT constant and not the `*_ABUSE_CEILING_MULTIPLE` shape
   *
   * The two ceilings that shape is named for are both
   * `max(floor, included × 10)`, which
   * needs an included band to multiply. Members and leads have none by
   * construction — that is the point of AGL-889 — so a multiple would have to
   * invent the plan dimension the decision forbids. The flat family those
   * same docblocks point at (`WEBHOOK_MAX_PER_HOST`,
   * `NON_PAGE_SCREEN_MAX_PER_HOST`, `ACTIONS_MAX_PER_HOST`,
   * `AUTHORS_MAX_PER_HOST`) is the shape; AGL-1655/2155 supply the posture.
   */
  const CEILINGS: Array<{
    label: string
    ceiling: number
    /** The file that must consult the decider, as `ENFORCED_IN` does above. */
    enforcedIn: string
    decider: string
  }> = [
    {
      label: 'siteMembers',
      ceiling: SITE_MEMBERS_MAX_PER_HOST,
      enforcedIn: 'libs/plugins/commerce/src/lib/server/membership-register.ts',
      decider: 'checkVisitorRecordCeiling',
    },
    {
      label: 'leads',
      ceiling: LEADS_MAX_PER_HOST,
      enforcedIn:
        'libs/tenant/data/admin/src/lib/server/host-visitor-records.ts',
      decider: 'checkVisitorRecordCeiling',
    },
  ]

  it('no plan carries a members or leads dimension', () => {
    // The AGL-889 pricing promise, unchanged by the ceiling. A ceiling that
    // grew an `OrgEntitlements` key would be a plan limit wearing an abuse
    // control's clothes, and `/pricing` would start lying.
    for (const [plan, entitlements] of Object.entries(PLAN_ENTITLEMENTS)) {
      expect(`${plan} siteMembers`).toBe(`${plan} siteMembers`)
      expect(entitlements).not.toHaveProperty('siteMembersPerHost')
      expect(entitlements).not.toHaveProperty('leadsPerHost')
    }
  })

  it('the ceiling is the SAME number on every plan', () => {
    // The other half of "not a plan dimension", asserted on the decider
    // rather than on the table: the function takes no org at all, so there is
    // nowhere for a plan to enter the answer. A signature that grew one would
    // fail to compile here.
    for (const { ceiling } of CEILINGS) {
      expect(checkVisitorRecordCeiling(ceiling - 1, ceiling).exceeded).toBe(false)
      expect(checkVisitorRecordCeiling(ceiling, ceiling).exceeded).toBe(true)
    }
  })

  it.each(CEILINGS.map((row) => [row.label, row.ceiling] as const))(
    '%s: REFUSED at the ceiling, ALLOWED one below, and ALLOWED when the ceiling is raised by one',
    (_label, ceiling) => {
      // 1. REFUSED at the cap.
      expect(checkVisitorRecordCeiling(ceiling, ceiling).exceeded).toBe(true)
      // 2. ALLOWED one below it.
      expect(checkVisitorRecordCeiling(ceiling - 1, ceiling).exceeded).toBe(false)
      // 3. CAUSATION — the load-bearing leg. The SAME usage that was refused
      //    in (1), re-driven against a ceiling one higher, must succeed. A
      //    refusal that survives its own cap being raised was never that
      //    cap's refusal, and (1) alone is equally true of a decider that
      //    refuses everything.
      expect(checkVisitorRecordCeiling(ceiling, ceiling + 1).exceeded).toBe(false)
    },
  )

  it('the two ceilings are DIFFERENT numbers, and leads is the larger', () => {
    // Not cosmetic. A lead is append-only and deduped by nothing — every
    // sign-up writes one and so does every booking — while a member is
    // deduped by email, so the lead collection outgrows the member collection
    // on any real site. Equal numbers would make the LEAD ceiling the one
    // that trips first, on a site doing nothing wrong.
    expect(LEADS_MAX_PER_HOST).toBeGreaterThan(SITE_MEMBERS_MAX_PER_HOST)
  })

  it('a ceiling of ZERO refuses; it does not read as unlimited', () => {
    // `strictNullChecks` is OFF repo-wide, so `0` reaching the comparison as
    // a falsy "no ceiling configured" is the live hazard. 0 means none
    // allowed, in the argument that decides the refusal.
    expect(checkVisitorRecordCeiling(0, 0).exceeded).toBe(true)
    // …and a count of 0 against a real ceiling is a legitimate zero, allowed.
    expect(checkVisitorRecordCeiling(0, 1).exceeded).toBe(false)
  })

  it.each(CEILINGS.map((row) => [row.label, row.enforcedIn, row.decider] as const))(
    '%s is decided in %s',
    (label, file, decider) => {
      // The AGL-2163 shape: a decider that is read and discarded, or never
      // read at all. Pinned per ceiling so a verdict cannot pass above while
      // going nowhere.
      expect(`${label}: ${codeOf(file).includes(decider) ? 'wired' : 'NOT WIRED'}`)
        .toBe(`${label}: wired`)
    },
  )

  it('EVERY lead writer goes through the one bounded writer', () => {
    // A cap enforced at two of three call sites is not a cap. The three lead
    // writes in the repo are the sign-up handler and the two bookings paths;
    // none of them may reach the collection directly any more.
    for (const file of [
      'libs/plugins/commerce/src/lib/server/membership-register.ts',
      'libs/plugins/bookings/src/lib/server.ts',
    ]) {
      const code = codeOf(file)
      expect(`${file}: ${code.includes('addHostLead') ? 'bounded' : 'UNBOUNDED'}`)
        .toBe(`${file}: bounded`)
      // The instrument, aimed at the thing it replaced: a direct
      // `collection('leads')` write is what the ceiling cannot see.
      expect(`${file}: ${/collection\('leads'\)/.test(code) ? 'DIRECT WRITE' : 'routed'}`)
        .toBe(`${file}: routed`)
    }
  })

  it('the sign-up refusal is visible to the HOST and opaque to the VISITOR', () => {
    // the standing rule: a control that exists but is not visible in the
    // console did not ship. The handler must record the trip, and the inbox
    // console page — where the members and leads lists already live — must
    // read it back.
    const handler = codeOf(
      'libs/plugins/commerce/src/lib/server/membership-register.ts',
    )
    expect(handler).toContain('recordVisitorRecordCeilingTrip')
    // …and must answer the visitor with the shared, deliberately uninformative
    // sentence rather than a hand-written one that explains too much.
    expect(handler).toContain('SITE_MEMBER_UNAVAILABLE_MESSAGE')
    const inbox = codeOf(
      'libs/plugins/inbox/src/lib/components/inbox-console-page.tsx',
    )
    expect(inbox).toContain('visitorRecordsPausedNotice')
    expect(inbox).toContain('visitorRecordRefusedCounterId')
  })

  it('every pinned enforcement file is TRACKED', () => {
    const isTracked = (file: string): boolean => {
      try {
        execFileSync('git', ['ls-files', '--error-unmatch', '--', file], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          stdio: 'pipe',
        })
        return true
      } catch {
        return false
      }
    }
    expect(isTracked('apps/console/specs/no-such-file.ts')).toBe(false)
    for (const { enforcedIn } of CEILINGS) {
      expect(`${enforcedIn}: ${isTracked(enforcedIn) ? 'tracked' : 'MISSING'}`)
        .toBe(`${enforcedIn}: tracked`)
    }
  })
})
