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

import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { AiBuildPlan } from '../model/ai-build-plan'
import type { AiPlanCapabilities } from '../model/ai-plan-capabilities'
import { emptyAiSiteInventory } from '../model/ai-site-inventory'
import { aiPlanCapabilitiesFrom } from '../jobs/ai-job-drafts'
import { aiSitePlanCapabilities } from '../jobs/ai-job-plan-step'
import type { AiJob } from '../model/ai-jobs.types'
import { aiDoctrinePlanCheck } from './ai-doctrine'
import { aiSettlePlanUnknownIds } from './ai-doctrine-validators'
import { LIVE_CANDLE_ANSWER } from '../jobs/fixtures/ai-candle-shop-free-plan-recording'

/*
 * References to nothing are taken out before the rules read the plan
 * (AGL-3845). LIVE_CANDLE_ANSWER is the Free candle-shop plan the beta.260
 * pre-promotion eval recorded on 2026-10-16 (its re-ask, the answer that was
 * refused).
 */

const FREE_ORG: Partial<AglynOrgBilling> & { ownerUid: string } = { plan: 'free', ownerUid: 'owner-1' }
const EMPTY = emptyAiSiteInventory('host-1')
const candleJob = {
  kind: 'site',
  inputs: { businessType: 'a small-batch candle shop selling hand-poured soy candles online', pages: 2 },
} as unknown as AiJob
const FREE_SITE = aiSitePlanCapabilities(
  candleJob,
  aiPlanCapabilitiesFrom(FREE_ORG, { layout: [], template: [] }),
) as AiPlanCapabilities

const answer = (): AiBuildPlan => JSON.parse(JSON.stringify(LIVE_CANDLE_ANSWER)) as AiBuildPlan

describe('aiSettlePlanUnknownIds (AGL-3845)', () => {
  it('drops a reuse, a duplicate and section uses that name nothing the site has', () => {
    const settled = aiSettlePlanUnknownIds(answer(), EMPTY)
    expect(settled.reuse).toEqual([])
    expect(settled.screens.map((screen) => [screen.layout, screen.duplicateOf])).toEqual([
      [null, null],
      [null, null],
    ])
    // Only the plan's own creation is still placed.
    expect(settled.screens.flatMap((screen) => screen.sections.flatMap((section) => section.uses))).toEqual(['new:newsletterForm'])
  })

  it('keeps what the site has, what the plan creates, and a creation the plan has not declared yet', () => {
    const inventory = { ...EMPTY, layouts: [{ id: 'lay-1', name: 'Site layout' }], forms: [{ id: 'frm-1', name: 'Contact' }] } as never
    const plan: AiBuildPlan = {
      reuse: [{ kind: 'layout', id: 'lay-1', purpose: 'the frame' }],
      create: [],
      screens: [
        {
          title: 'Home',
          slug: '/',
          layout: 'lay-1',
          template: null,
          record: null,
          duplicateOf: null,
          nav: true,
          seoTitle: 'Home',
          seoDescription: 'A home page.',
          sections: [{ name: 'contact', uses: ['frm-1', 'new:Quote request'], items: 0 }],
        },
      ],
    } as never
    expect(aiSettlePlanUnknownIds(plan, inventory)).toBe(plan)
  })

  it('no longer refuses the live Free candle-shop answer', () => {
    const checked = aiDoctrinePlanCheck(EMPTY, null, FREE_SITE)(LIVE_CANDLE_ANSWER as never)
    expect(checked.violations.map((violation) => violation.code)).toEqual([])
    // The wall's trim had room once the descriptions came out: eight sections fit.
    expect(checked.value?.screens.reduce((total, screen) => total + screen.sections.length, 0)).toBeLessThanOrEqual(8)
  })
})
