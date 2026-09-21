/**
 * @jest-environment node
 */
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
 * The AI plugin's staff alerts on provider spend (AGL-2984), driven through a
 * fake sweep context that keeps what the contributor records and what it
 * hands the sweep's senders. The usage-alerts cron specs drive the same rules
 * through the real sweep; this pins the rules, their guard keys and their
 * words on their own.
 */

import { resolveAssistCreditBudget } from '@aglyn/aglyn/app-utils/assist-credits'
import { aiAddonName } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  listUsageAlertContributors,
  resetUsageAlertContributorsForTests,
  type UsageAlertContext,
  type UsageStaffAlert,
} from '@aglyn/aglyn/plugin-manager/usage-alert-contributors'
import { registerAiServerDeclarations } from '../declarations.server'
import {
  AI_CEILING_GUARD_KEY,
  AI_MARGIN_GUARD_KEY,
  evaluateAiUsageAlerts,
} from './ai-usage-alerts'

const MONTH = '2026-09'
const LAST_MONTH = '2026-08'

/** A Pro org, which sells an AI credit band. */
const PRO_ORG = { plan: 'pro', slug: 'acme' }

/**
 * An org with no band of its own, so the operator backstop — the repo default
 * when nothing is configured — is the ceiling its reservations refuse at.
 *
 * The band is a per-org `assistCreditsPerMonth` override rather than the
 * plan's own row: since AGL-3203 no plan rows at zero (Starter includes 750),
 * so an explicit override is the only way an org reaches the null budget bare
 * Starter used to resolve to.
 */
const NO_BAND_ORG = {
  plan: 'starter',
  slug: 'acme',
  entitlements: { assistCreditsPerMonth: 0 },
}

type Guards = Record<string, { month?: string; threshold?: number }>

interface FakeSweep {
  context: UsageAlertContext
  /** Every guard the contributor recorded, in order. */
  recorded: Array<{ key: string; threshold: number }>
  /** Every alert the contributor handed the sweep's senders, in order. */
  sent: UsageStaffAlert[]
}

/**
 * One org's evaluation. `seeding` makes `recordAlert` answer `false`, as the
 * sweep does on an org's first, silent pass.
 */
function fakeSweep(options: {
  assistUsd: number
  guards?: Guards
  org?: Record<string, unknown>
  orgSlug?: string | null
  seeding?: boolean
}): FakeSweep {
  const recorded: FakeSweep['recorded'] = []
  const sent: UsageStaffAlert[] = []
  const context: UsageAlertContext = {
    orgId: 'org-1',
    orgSlug: options.orgSlug === undefined ? 'acme' : options.orgSlug,
    org: options.org ?? PRO_ORG,
    month: MONTH,
    spend: {
      meteredUsd: 0,
      assistUsd: options.assistUsd,
      totalUsd: 0,
      assistBilled: false,
      meteredFresh: false,
    },
    guards: options.guards ?? {},
    recordAlert: (key, threshold) => {
      recorded.push({ key, threshold })
      return !options.seeding
    },
    alertStaff: async (alert) => {
      sent.push(alert)
    },
  }
  return { context, recorded, sent }
}

/** A margin guard far enough ahead that a reading never re-announces it. */
const MARGIN_ALREADY_SPOKEN = { assistCogs: { month: MONTH, threshold: 1_000 } }

function clearEnvironment(): void {
  delete process.env.ASSIST_ORG_MONTHLY_COGS_ALERT_USD
  delete process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD
}

beforeEach(clearEnvironment)
afterAll(clearEnvironment)

describe('the margin guard (AGL-2984)', () => {
  it('fires at the review threshold, in the words staff read', async () => {
    const band = resolveAssistCreditBudget(PRO_ORG as never)
    // The premise: Pro sells a band, so the body names one.
    expect(band).not.toBeNull()
    const { context, recorded, sent } = fakeSweep({ assistUsd: 25 })

    await evaluateAiUsageAlerts(context)

    expect(recorded).toEqual([{ key: 'assistCogs', threshold: 1 }])
    expect(sent).toEqual([
      {
        quota: 'assistCogs',
        threshold: 1,
        title: 'Assist token spend is $25.00 for one org this month',
        body:
          `acme has run about $25.00 of ${PLATFORM_BRAND_NAME} Assist tokens in ${MONTH}, ` +
          'past the $25 review threshold. Assist is a plan entitlement with no per-token ' +
          'price, so this is margin, not revenue. ' +
          `The ${aiAddonName()} add-on is off, with an AI credit band of ${band?.toLocaleString()}.`,
        link: '/admin/orgs',
        emailContext: 'assist-margin',
      },
    ])
  })

  it('says whether the org carries the add-on, and when it has no band', async () => {
    const withAddon = fakeSweep({
      assistUsd: 30,
      org: { plan: 'pro', seatAddons: { aiAddon: 1 } },
    })
    await evaluateAiUsageAlerts(withAddon.context)
    expect(withAddon.sent[0].body).toContain(
      `The ${aiAddonName()} add-on is on, with an AI credit band of `,
    )

    // The premise: this org sells no band. Since AGL-3203 that is a per-org
    // `assistCreditsPerMonth: 0` override and never a plan row — Starter's
    // own row includes 750 credits.
    expect(resolveAssistCreditBudget(NO_BAND_ORG as never)).toBeNull()
    const noBand = fakeSweep({ assistUsd: 30, org: NO_BAND_ORG })
    await evaluateAiUsageAlerts(noBand.context)
    expect(noBand.sent[0].body).toContain(
      `The ${aiAddonName()} add-on is off, with no AI credit band.`,
    )
  })

  it('escalates at the next whole multiple rather than going quiet', async () => {
    const { context, recorded, sent } = fakeSweep({
      assistUsd: 50,
      guards: {
        assistCogs: { month: MONTH, threshold: 1 },
        // Past the ceiling too, and already announced: this counts the margin
        // alert alone.
        assistCeiling: { month: MONTH, threshold: 1 },
      },
    })

    await evaluateAiUsageAlerts(context)

    expect(recorded).toEqual([{ key: 'assistCogs', threshold: 2 }])
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      quota: 'assistCogs',
      threshold: 2,
      title: 'Assist token spend is $50.00 for one org this month',
    })
  })

  it('stays quiet below the threshold', async () => {
    const { context, recorded, sent } = fakeSweep({ assistUsd: 24.99 })
    await evaluateAiUsageAlerts(context)
    expect(recorded).toEqual([])
    expect(sent).toEqual([])
  })

  it('stays quiet once this month recorded the multiple, and speaks again next month', async () => {
    const thisMonth = fakeSweep({
      assistUsd: 30,
      guards: { assistCogs: { month: MONTH, threshold: 1 } },
    })
    await evaluateAiUsageAlerts(thisMonth.context)
    expect(thisMonth.recorded).toEqual([])
    expect(thisMonth.sent).toEqual([])

    const lastMonth = fakeSweep({
      assistUsd: 30,
      guards: { assistCogs: { month: LAST_MONTH, threshold: 1 } },
    })
    await evaluateAiUsageAlerts(lastMonth.context)
    expect(lastMonth.sent.map((alert) => alert.quota)).toEqual(['assistCogs'])
  })

  it('follows the configured review threshold', async () => {
    process.env.ASSIST_ORG_MONTHLY_COGS_ALERT_USD = '10'
    const { context, sent } = fakeSweep({ assistUsd: 30 })
    await evaluateAiUsageAlerts(context)
    expect(sent).toHaveLength(1)
    expect(sent[0].threshold).toBe(3)
    expect(sent[0].body).toContain('past the $10 review threshold')
  })
})

describe('the hard ceiling (AGL-2984)', () => {
  it('announces the refusal at the shipped ceiling, in the words staff read', async () => {
    // The premise: the default binds a workspace with no band of its own.
    expect(resolveAssistCreditBudget(NO_BAND_ORG as never)).toBeNull()
    const { context, recorded, sent } = fakeSweep({
      org: NO_BAND_ORG,
      assistUsd: 41,
      // $41 is still 1x of the review threshold, announced earlier this month.
      guards: { assistCogs: { month: MONTH, threshold: 1 } },
    })

    await evaluateAiUsageAlerts(context)

    expect(recorded).toEqual([{ key: 'assistCeiling', threshold: 1 }])
    expect(sent).toEqual([
      {
        quota: 'assistCeiling',
        threshold: 1,
        title: 'Assist is REFUSING acme — the $40 monthly spend ceiling is crossed',
        body:
          `acme has run about $41.00 of ${PLATFORM_BRAND_NAME} Assist tokens in ${MONTH}, ` +
          'past the $40 ceiling. Every further Assist request from this organization is ' +
          'refused until the month rolls over — the assistant is not degraded or slowed, ' +
          'it is off. The customer keeps whatever messages their plan has left, and the ' +
          'refusal says so in its own words.',
        link: '/admin/orgs',
        emailContext: 'assist-ceiling',
      },
    ])
  })

  it('announces once a month, however far past the ceiling the spend climbs', async () => {
    const announced = fakeSweep({
      org: NO_BAND_ORG,
      assistUsd: 4_000,
      guards: {
        ...MARGIN_ALREADY_SPOKEN,
        assistCeiling: { month: MONTH, threshold: 1 },
      },
    })
    await evaluateAiUsageAlerts(announced.context)
    expect(announced.recorded).toEqual([])
    expect(announced.sent).toEqual([])

    const lastMonth = fakeSweep({
      org: NO_BAND_ORG,
      assistUsd: 4_000,
      guards: {
        ...MARGIN_ALREADY_SPOKEN,
        assistCeiling: { month: LAST_MONTH, threshold: 1 },
      },
    })
    await evaluateAiUsageAlerts(lastMonth.context)
    expect(lastMonth.sent.map((alert) => alert.quota)).toEqual(['assistCeiling'])
  })

  it('says nothing when the operator turned the ceiling off', async () => {
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = 'off'
    const { context, recorded, sent } = fakeSweep({
      org: NO_BAND_ORG,
      assistUsd: 10_000,
      guards: MARGIN_ALREADY_SPOKEN,
    })
    await evaluateAiUsageAlerts(context)
    expect(recorded).toEqual([])
    expect(sent).toEqual([])
  })

  it('follows the operator’s number when one is configured', async () => {
    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '500'
    const under = fakeSweep({ org: NO_BAND_ORG, assistUsd: 100, guards: MARGIN_ALREADY_SPOKEN })
    await evaluateAiUsageAlerts(under.context)
    expect(under.sent).toEqual([])

    const over = fakeSweep({ org: NO_BAND_ORG, assistUsd: 500, guards: MARGIN_ALREADY_SPOKEN })
    await evaluateAiUsageAlerts(over.context)
    expect(over.sent.map((alert) => alert.title)).toEqual([
      'Assist is REFUSING acme — the $500 monthly spend ceiling is crossed',
    ])
  })

  it('names the org by its id when the document carries no slug', async () => {
    const { context, sent } = fakeSweep({
      org: NO_BAND_ORG,
      assistUsd: 41,
      orgSlug: null,
      guards: { assistCogs: { month: MONTH, threshold: 1 } },
    })
    await evaluateAiUsageAlerts(context)
    expect(sent[0].title).toBe(
      'Assist is REFUSING org-1 — the $40 monthly spend ceiling is crossed',
    )
    expect(sent[0].body.startsWith('org-1 has run about $41.00 ')).toBe(true)
  })
})

/**
 * Announced only where the reservation refuses. The repo default binds a
 * workspace with no band; every other org is measured against its band or an
 * operator's explicit figure, and a stop it never makes is not announced.
 */
describe('the hard ceiling is the one this org is refused at', () => {
  it('a band sold past is not refused at the default, and is announced only past an operator’s figure', async () => {
    const quiet = fakeSweep({ assistUsd: 41, guards: MARGIN_ALREADY_SPOKEN })
    await evaluateAiUsageAlerts(quiet.context)
    expect(quiet.recorded).toEqual([])
    expect(quiet.sent).toEqual([])

    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '500'
    const over = fakeSweep({ assistUsd: 500, guards: MARGIN_ALREADY_SPOKEN })
    await evaluateAiUsageAlerts(over.context)
    expect(over.sent.map((alert) => alert.title)).toEqual([
      'Assist is REFUSING acme — the $500 monthly spend ceiling is crossed',
    ])
  })

  it('a band that is a wall is the workspace’s own limit, unless an operator’s figure sits below it', async () => {
    // Enterprise sells nothing past its band, so the band refuses first.
    const wall = { plan: 'enterprise', slug: 'acme' }
    const atBand = fakeSweep({ org: wall, assistUsd: 4_000, guards: MARGIN_ALREADY_SPOKEN })
    await evaluateAiUsageAlerts(atBand.context)
    expect(atBand.sent).toEqual([])

    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '25'
    const underOperator = fakeSweep({ org: wall, assistUsd: 30, guards: MARGIN_ALREADY_SPOKEN })
    await evaluateAiUsageAlerts(underOperator.context)
    expect(underOperator.sent.map((alert) => alert.title)).toEqual([
      'Assist is REFUSING acme — the $25 monthly spend ceiling is crossed',
    ])
  })

  it('an uncapped staff comp is announced only past an operator’s explicit figure (AGL-3049)', async () => {
    const internal = {
      plan: 'enterprise',
      enterprise: true,
      slug: 'acme',
      entitlements: {
        planComp: {
          plan: 'enterprise',
          uncapped: true,
          reason: 'other',
          note: 'Internal workspace',
          grantedBy: 'staff-1',
        },
      },
    }
    const quiet = fakeSweep({ org: internal, assistUsd: 4_000, guards: MARGIN_ALREADY_SPOKEN })
    await evaluateAiUsageAlerts(quiet.context)
    expect(quiet.recorded).toEqual([])
    expect(quiet.sent).toEqual([])

    process.env.ASSIST_ORG_MONTHLY_COGS_LIMIT_USD = '200'
    const over = fakeSweep({ org: internal, assistUsd: 250, guards: MARGIN_ALREADY_SPOKEN })
    await evaluateAiUsageAlerts(over.context)
    expect(over.sent.map((alert) => alert.title)).toEqual([
      'Assist is REFUSING acme — the $200 monthly spend ceiling is crossed',
    ])
  })

  it('the margin guard names an uncapped comp as the reason there is no band (AGL-3049)', async () => {
    const { context, sent } = fakeSweep({
      assistUsd: 30,
      org: {
        plan: 'enterprise',
        entitlements: {
          planComp: { plan: 'enterprise', uncapped: true, reason: 'other', grantedBy: 'staff-1' },
        },
      },
    })
    await evaluateAiUsageAlerts(context)
    expect(sent[0].body).toContain(
      `The ${aiAddonName()} add-on is off, with no AI credit band (an uncapped staff comp).`,
    )
  })
})

describe('one org, both alerts (AGL-2984)', () => {
  it('evaluates the margin guard before the hard ceiling', async () => {
    const { context, recorded, sent } = fakeSweep({ org: NO_BAND_ORG, assistUsd: 41 })
    await evaluateAiUsageAlerts(context)
    expect(recorded).toEqual([
      { key: 'assistCogs', threshold: 1 },
      { key: 'assistCeiling', threshold: 1 },
    ])
    expect(sent.map((alert) => alert.quota)).toEqual(['assistCogs', 'assistCeiling'])
  })

  it('records both guards and sends nothing on a seeding sweep', async () => {
    const { context, recorded, sent } = fakeSweep({
      org: NO_BAND_ORG,
      assistUsd: 41,
      seeding: true,
    })
    await evaluateAiUsageAlerts(context)
    expect(recorded).toEqual([
      { key: 'assistCogs', threshold: 1 },
      { key: 'assistCeiling', threshold: 1 },
    ])
    expect(sent).toEqual([])
  })

  it('exports the guard keys the sweep records under', () => {
    expect([AI_MARGIN_GUARD_KEY, AI_CEILING_GUARD_KEY]).toEqual([
      'assistCogs',
      'assistCeiling',
    ])
  })
})

describe('the server declarations register the contributor (AGL-2984)', () => {
  it('registers once, again after a reset, and its evaluate reaches these rules', async () => {
    resetUsageAlertContributorsForTests()
    expect(listUsageAlertContributors()).toEqual([])
    registerAiServerDeclarations()
    registerAiServerDeclarations()

    const registered = listUsageAlertContributors()
    expect(registered.map((entry) => `${entry.pluginId}:${entry.id}`)).toEqual([
      'ai:provider-spend',
    ])

    const { context, recorded, sent } = fakeSweep({
      org: NO_BAND_ORG,
      assistUsd: 41,
      seeding: true,
    })
    await registered[0].evaluate(context)
    expect(recorded.map((entry) => entry.key)).toEqual(['assistCogs', 'assistCeiling'])
    expect(sent).toEqual([])
  })
})
