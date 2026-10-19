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

import type { StaffOrgAiResponse } from './staff-org-ai'
import {
  creditReturnMeters,
  creditReturnable,
  marginTone,
  overageStateSentence,
  poolPartsSentence,
  staffOrgAiView,
  staffUserAiView,
  usd,
} from './staff-org-ai-view'

const ZERO_COUNTS = { queued: 0, running: 0, needs_input: 0, needs_review: 0, done: 0, failed: 0, canceled: 0 }

const response = (patch: Partial<StaffOrgAiResponse> = {}): StaffOrgAiResponse => ({
  month: '2026-10',
  addon: { on: true, tier: 'boost', priceUsd: 19, since: '2026-09-01T00:00:00.000Z', sinceSource: 'stripe' },
  pool: {
    planCredits: 5000,
    overrideCredits: null,
    addonCredits: 8000,
    totalCredits: 13000,
    usedCredits: 2500,
    returnedCredits: 0,
    billedUsd: 2.5,
    providerUsd: 1.25,
    remainingCredits: 10500,
    projectedCredits: 7500,
    projectedUsd: 7.5,
    messages: 40,
    deflected: 7,
  },
  overage: {
    overageCredits: 0,
    rateUsdPer1k: 1.5,
    accruedUsd: 0,
    sellsOverage: true,
    hardCap: false,
    capUsd: null,
    capReached: false,
    bandRefuses: false,
  },
  refusals: { band: 1, cap: 0, messages: 0, budget: 0, allotment: 0, account: 0, requests: 0, refusals: 0, platform: 0, total: 1 },
  jobs: { counts: { ...ZERO_COUNTS, done: 2 }, recent: [], truncated: false },
  users: [],
  margin: {
    addonRevenueUsd: 20,
    planAssistShareUsd: 5,
    overageRevenueUsd: 0,
    revenueUsd: 25,
    spendUsd: 1.25,
    underwater: false,
    thresholdUsd: 50,
    multiple: 0,
    contribution: { month: null, marginPct: null, rating: null },
  },
  account: null,
  ...patch,
})

describe('the staff AI card as it prints (AGL-3667)', () => {
  it('names the parts of the pool, the override replacing the plan band', () => {
    const view = response()
    expect(poolPartsSentence(view.pool, 'Aglyn AI')).toBe('5,000 plan band + 8,000 Aglyn AI tier')
    expect(poolPartsSentence({ ...view.pool, overrideCredits: 12000, addonCredits: 0 }, 'Aglyn AI')).toBe('12,000 staff override')
  })

  it('says what an uncapped comp, a walled band and a capped overage mean', () => {
    const { overage } = response()
    expect(overageStateSentence(overage, true)).toMatch(/uncapped staff comp/)
    expect(overageStateSentence({ ...overage, hardCap: true })).toMatch(/band switch is on/)
    expect(overageStateSentence({ ...overage, sellsOverage: false })).toBe('Not sold past the band on this plan.')
    expect(overageStateSentence({ ...overage, capUsd: 10, capReached: true })).toBe(
      'Stopped — the org’s $10.00 overage ceiling is reached.',
    )
    expect(overageStateSentence(overage)).toBe('Sold at $1.50 per 1,000, no ceiling set.')
  })

  it('goes red when spend passes what AI brings in, and amber past the review threshold', () => {
    const { margin } = response()
    expect(marginTone(margin)).toBe('success')
    expect(marginTone({ ...margin, multiple: 2 })).toBe('warning')
    expect(marginTone({ ...margin, underwater: true })).toBe('error')
  })

  it('prints four places under a dollar and two above', () => {
    expect(usd(0.08)).toBe('$0.0800')
    expect(usd(12)).toBe('$12.00')
    expect(usd(null)).toBe('—')
  })

  it('offers the meters a workspace has, and caps a give-back at the lower of two', () => {
    expect(creditReturnMeters(true, false).map((meter) => meter.value)).toEqual(['workspace'])
    expect(creditReturnMeters(true, true).map((meter) => meter.value)).toEqual(['both', 'workspace', 'account'])
    expect(creditReturnable('both', 900, 120)).toBe(120)
    expect(creditReturnable('account', null, 120)).toBe(120)
    expect(creditReturnable('both', 900, null)).toBe(0)
  })

  it('starts a job give-back at its spend, never more than the month used', () => {
    const data = response({
      pool: { ...response().pool, usedCredits: 100 },
      jobs: {
        counts: { ...ZERO_COUNTS, done: 2 },
        truncated: true,
        recent: [
          { id: 'j1', kind: 'page', status: 'needs_input', creditsReserved: 500, creditsSpent: 340.2, createdAt: null, createdBy: null },
          { id: 'j2', kind: '', status: 'done', creditsReserved: 0, creditsSpent: 0, createdAt: null, createdBy: 'u1' },
        ],
      },
    })
    const view = staffOrgAiView(data, 'Aglyn AI')
    expect(view.jobs.recent.map((job) => [job.id, job.giveBack, job.status, job.kind])).toEqual([
      ['j1', 100, 'needs input', 'page'],
      ['j2', 0, 'done', '—'],
    ])
    expect(view.jobs.floor).toMatch(/a floor/)
    expect(view.jobs.chips).toContain('needs input 0')
  })

  it('tells a failed jobs read from an idle org, and leaves tokens out of an older route', () => {
    expect(staffOrgAiView(response({ jobs: null }), 'Aglyn AI').jobs).toMatchObject({ failedRead: true, empty: false })
    const idle = staffOrgAiView(response({ jobs: { counts: ZERO_COUNTS, recent: [], truncated: false } }), 'Aglyn AI')
    expect(idle.jobs).toMatchObject({ failedRead: false, empty: true })
    expect(idle.tokens).toBeNull()
  })

  it('words the add-on row for off, and for a date Stripe could not give', () => {
    const off = staffOrgAiView(response({ addon: { on: false, tier: null, priceUsd: null, since: null, sinceSource: 'no-subscription' } }), 'Aglyn AI')
    expect(off.addon).toMatchObject({ status: 'Aglyn AI off', price: 'No tier', since: null, sinceNote: '' })
    const unreachable = staffOrgAiView(response({ addon: { on: true, tier: 'boost', priceUsd: 19, since: null, sinceSource: 'unavailable' } }), 'Aglyn AI')
    expect(unreachable.addon.sinceNote).toBe('Stripe not reachable')
  })

  it('carries the owner allowance for a Free workspace and the meters to give it back to', () => {
    const view = staffOrgAiView(
      response({ account: { uid: 'u1', month: '2026-10', usedCredits: 27, limitCredits: 300, returnedCredits: 200 } }),
      'Aglyn AI',
    )
    expect(view.pool.allowance).toBe('Owner’s Free allowance: 27 of 300 used across their free workspaces (200 given back)')
    expect(view.giveBack).toMatchObject({ defaultMeter: 'both', returnable: 27 })
    expect(view.giveBack.summary).toBe('Used this month, and so the most to give back: workspace band 2,500, owner’s Free allowance 27.')
  })

  it('prints the account card: a row per workspace month, and the allowance', () => {
    const view = staffUserAiView({
      rows: [{ orgId: 'o1', orgName: null, slug: null, month: '2026-09', credits: 1200, requests: 3, refusals: 1 }],
      allowance: null,
    })
    expect(view.rows).toEqual([
      { orgId: 'o1', workspace: 'o1', month: 'September 2026', headline: '1,200 credits', detail: '3 requests · 1 refusals' },
    ])
    expect(view.allowance).toBe('')
    expect(view.giveBack.returnable).toBe(0)
    expect(staffUserAiView({ rows: [], allowance: null }).empty).toMatch(/^No AI usage attributed/)
  })
})
