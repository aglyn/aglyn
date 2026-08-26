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

// Drives the RED path of `check:decision-log` (AGL-1908). A change-control
// rule nothing can fail is a comment, so every verdict below is a shape the
// guard must refuse — and each has a negative control proving the same input
// passes once the missing thing is supplied.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WATCHED,
  DECISION_LOG_PATH,
  REQUIRED_FIELDS,
  priceSurface,
  surfaceDelta,
  parseDecisionLog,
  changeControlVerdicts,
  driveCrossCheckVerdicts,
} from './decision-log.mjs'
import { overallExitCode } from './pricing-drift.mjs'

const ENTITLEMENTS_PATH = WATCHED[0].path
const METERING_PATH = WATCHED[1].path

/** A minimal but shape-faithful `plan-entitlements.ts`. */
const entitlements = ({ proMonthly = 56, businessScheduled = true, cogsStorage = 0.026 } = {}) => `
export const PLAN_ENTITLEMENTS: Record<OrgPlan, ResolvedOrgEntitlements> = {
  free: {
    scheduledPublishing: false,
    marketplaceFeePct: 30,
  },
  pro: {
    scheduledPublishing: false,
    marketplaceFeePct: 20,
  },
  business: {
    scheduledPublishing: ${businessScheduled},
    marketplaceFeePct: 20,
  },
}

export const PLAN_PRICING: Record<OrgPlan, PlanPricing> = {
  free: {
    basePriceMonthlyUsd: 0,
  },
  pro: {
    basePriceMonthlyUsd: ${proMonthly},
  },
  business: {
    basePriceMonthlyUsd: 139,
  },
}

export const METERED_MARKUP = 1.3

export const EVENT_CALENDAR_ADDON_MONTHLY_USD = 9

export const POS_REGISTER_ADDON_MONTHLY_USD = 89

export const ORG_COGS_UNIT_RATES_USD = {
  storagePerGbMonth: ${cogsStorage},
  perPageView: 0.0001,
  perFormSubmission: 0.00005,
}
`

const metering = ({ storage = 0.026 } = {}) => `
export const METERED_UNIT_RATES_USD = {
  storagePerGbMonth: ${storage},
  perPageView: 0.0001,
  perFormSubmission: 0.00005,
}
`

const sources = (opts = {}) => ({
  [ENTITLEMENTS_PATH]: entitlements(opts),
  [METERING_PATH]: metering(opts),
})

const GOOD_LOG = `# Decision Log

## 2026-08-19 — Free tier hard-caps at three workspaces per person

- **Decided by:** 3 but provide a control in the staff console.
- **Scope:** packaging
- **Evidence:** \`81c432500\`, AGL-2265
`

const verdictFor = (verdicts, key) => verdicts.find((v) => v.key === key)

test('the price surface parses every watched constant', () => {
  const { values, unreadable } = priceSurface(sources())
  assert.deepEqual(unreadable, [])
  assert.equal(values['PLAN_PRICING.pro.basePriceMonthlyUsd'], 56)
  assert.equal(values['PLAN_ENTITLEMENTS.business.scheduledPublishing'], true)
  assert.equal(values['PLAN_ENTITLEMENTS.free.marketplaceFeePct'], 30)
  assert.equal(values['METERED_MARKUP'], 1.3)
  assert.equal(values['POS_REGISTER_ADDON_MONTHLY_USD'], 89)
  assert.equal(values['ORG_COGS_UNIT_RATES_USD.storagePerGbMonth'], 0.026)
  assert.equal(values['METERED_UNIT_RATES_USD.storagePerGbMonth'], 0.026)
})

test('an unparseable constant is UNREADABLE, never a silent "nothing moved"', () => {
  const broken = sources()
  broken[ENTITLEMENTS_PATH] = broken[ENTITLEMENTS_PATH].replace(
    'export const PLAN_PRICING',
    'export const PLAN_PRICE_TABLE',
  )
  const { unreadable } = priceSurface(broken)
  assert.ok(unreadable.some((u) => u.key === 'PLAN_PRICING'))

  const verdicts = changeControlVerdicts({
    baseSources: sources(),
    headSources: broken,
    baseLog: GOOD_LOG,
    headLog: GOOD_LOG,
  })
  assert.equal(overallExitCode(verdicts), 2)
})

test('a missing watched file at either ref is UNREADABLE', () => {
  const gone = { ...sources(), [METERING_PATH]: null }
  const { unreadable } = priceSurface(gone)
  assert.ok(unreadable.some((u) => u.key === METERING_PATH))
})

test('a comment-only change moves nothing and needs no entry', () => {
  const head = sources()
  head[ENTITLEMENTS_PATH] = `// a new docblock explaining what the margin excludes\n${head[ENTITLEMENTS_PATH]}`
  const verdicts = changeControlVerdicts({
    baseRef: 'origin/production',
    baseSources: sources(),
    headSources: head,
    baseLog: GOOD_LOG,
    headLog: GOOD_LOG,
  })
  assert.equal(verdictFor(verdicts, 'change-control').status, 'in-sync')
  assert.equal(overallExitCode(verdicts), 0)
})

test('RED: a moved PRICE with an unchanged Decision Log', () => {
  const verdicts = changeControlVerdicts({
    baseRef: 'origin/production',
    baseSources: sources(),
    headSources: sources({ proMonthly: 60 }),
    baseLog: GOOD_LOG,
    headLog: GOOD_LOG,
  })
  const v = verdictFor(verdicts, 'change-control')
  assert.equal(v.status, 'differs')
  assert.match(v.detail, /PLAN_PRICING\.pro\.basePriceMonthlyUsd 56 → 60/)
  assert.equal(overallExitCode(verdicts), 1)
})

test('GREEN control: the same move WITH a Decision Log edit', () => {
  const verdicts = changeControlVerdicts({
    baseRef: 'origin/production',
    baseSources: sources(),
    headSources: sources({ proMonthly: 60 }),
    baseLog: GOOD_LOG,
    headLog: `${GOOD_LOG}\n## 2026-08-24 — Pro moves to $60\n\n- **Decided by:** Zach\n- **Scope:** pricing\n- **Evidence:** AGL-0000\n`,
  })
  assert.equal(verdictFor(verdicts, 'change-control').status, 'in-sync')
})

test('RED: a moved ENTITLEMENT with an unchanged Decision Log — the entry-scheduling shape', () => {
  const verdicts = changeControlVerdicts({
    baseRef: 'origin/production',
    baseSources: sources(),
    headSources: sources({ businessScheduled: false }),
    baseLog: GOOD_LOG,
    headLog: GOOD_LOG,
  })
  const v = verdictFor(verdicts, 'change-control')
  assert.equal(v.status, 'differs')
  assert.match(v.detail, /PLAN_ENTITLEMENTS\.business\.scheduledPublishing true → false/)
})

test('RED: a moved COGS rate — it changes the published rate through the markup', () => {
  const verdicts = changeControlVerdicts({
    baseRef: 'origin/production',
    baseSources: sources(),
    headSources: sources({ cogsStorage: 0.03 }),
    baseLog: GOOD_LOG,
    headLog: GOOD_LOG,
  })
  assert.equal(verdictFor(verdicts, 'change-control').status, 'differs')
})

test('RED: no Decision Log file at all', () => {
  const verdicts = changeControlVerdicts({
    baseSources: sources(),
    headSources: sources(),
    baseLog: null,
    headLog: null,
  })
  assert.equal(verdictFor(verdicts, 'log:present').status, 'differs')
  assert.equal(overallExitCode(verdicts), 1)
})

test('RED: a Decision Log with no dated entry cannot satisfy a rule about the log', () => {
  const verdicts = changeControlVerdicts({
    baseSources: sources(),
    headSources: sources(),
    baseLog: '# Decision Log\n',
    headLog: '# Decision Log\n',
  })
  assert.equal(verdictFor(verdicts, 'log:entries').status, 'differs')
})

test('RED: an entry missing any required field is not a decision', () => {
  for (const field of REQUIRED_FIELDS) {
    const stripped = GOOD_LOG.split('\n')
      .filter((line) => !line.startsWith(`- **${field}:**`))
      .join('\n')
    const { problems } = parseDecisionLog(stripped)
    assert.ok(
      problems.some((p) => p.detail.includes(`**${field}:**`)),
      `dropping ${field} must be refused`,
    )
    const verdicts = changeControlVerdicts({
      baseSources: sources(),
      headSources: sources(),
      baseLog: stripped,
      headLog: stripped,
    })
    assert.equal(overallExitCode(verdicts), 1, `dropping ${field} must exit 1`)
  }
  // Negative control: the untouched log has no problems.
  assert.deepEqual(parseDecisionLog(GOOD_LOG).problems, [])
})

test('a non-dated `##` section ends an entry and is not itself one', () => {
  const { entries } = parseDecisionLog(
    `${GOOD_LOG}\n## Open decisions\n\n- **Decided by:** nobody yet\n`,
  )
  assert.equal(entries.length, 1)
  assert.equal(entries[0].date, '2026-08-19')
})

test('the Drive leg reds when a pricing-scoped entry is absent from the Drive log', () => {
  const priced = GOOD_LOG.replace('**Scope:** packaging', '**Scope:** pricing, packaging')
  const { entries } = parseDecisionLog(priced)

  const missing = driveCrossCheckVerdicts(entries, '# Log\n\n## 2026-08-09 — something else\n')
  assert.equal(missing[0].status, 'differs')

  const present = driveCrossCheckVerdicts(entries, '# Log\n\n## 2026-08-19 — the same decision\n')
  assert.equal(present[0].status, 'in-sync')

  // Drive unmounted is neither a pass nor a fail — the caller prints a note.
  assert.deepEqual(driveCrossCheckVerdicts(entries, null), [])

  // A non-pricing entry is not asked of Drive at all.
  assert.deepEqual(driveCrossCheckVerdicts(parseDecisionLog(GOOD_LOG).entries, '# Log\n'), [])
})

test('surfaceDelta reports added and removed keys, not only changed ones', () => {
  assert.deepEqual(surfaceDelta({ a: 1 }, { a: 1, b: 2 }), [{ key: 'b', from: undefined, to: 2 }])
  assert.deepEqual(surfaceDelta({ a: 1 }, {}), [{ key: 'a', from: 1, to: undefined }])
})

test('the guard names the file a contributor has to edit', () => {
  const verdicts = changeControlVerdicts({
    baseSources: sources(),
    headSources: sources({ proMonthly: 60 }),
    baseLog: GOOD_LOG,
    headLog: GOOD_LOG,
  })
  assert.match(verdictFor(verdicts, 'change-control').detail, new RegExp(DECISION_LOG_PATH))
})
