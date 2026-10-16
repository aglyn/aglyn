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
import { AI_PLAN_SETTLED_FORM, aiSettlePlanUndeclaredUses } from './ai-doctrine-validators'

/*
 * A section's creation the plan never declares is settled where it has one
 * answer (AGL-3845). The live candle-shop start of 2026-10-16 (Free) placed
 * `new:contactForm` in "Care, shipping and contact" on both answers and
 * stopped needing input: camelCase hid the form, so it read as a component.
 */

const FREE_ORG: Partial<AglynOrgBilling> & { ownerUid: string } = { plan: 'free', ownerUid: 'owner-1' }
const EMPTY = emptyAiSiteInventory('host-1')
const storeJob = { kind: 'site', inputs: { businessType: 'a candle shop', pages: 2 } } as unknown as AiJob
const FREE_SITE = aiSitePlanCapabilities(
  storeJob,
  aiPlanCapabilitiesFrom(FREE_ORG, { layout: [], template: [] }),
) as AiPlanCapabilities

const withCreate = (patch: Partial<AiPlanCapabilities['create']>): AiPlanCapabilities => ({
  ...FREE_SITE,
  create: { ...FREE_SITE.create, ...patch },
})
const FORMS_OPEN = withCreate({ form: { allowed: true, left: null } as never })
const NO_FORMS = withCreate({ form: { allowed: false, left: 0, reason: 'this plan has no room for another form' } as never })
const COMPONENTS_OPEN = withCreate({ component: { allowed: true, left: null } as never })

const CREATE: AiBuildPlan['create'] = [
  { kind: 'layout', name: 'Main layout', why: 'The site has none.', duplicateOf: null, fields: ['header', 'nav', 'main', 'footer'] },
]

const section = (name: string, uses: string[] = []) => ({ name, uses, items: 0 })
const plan = (sections: ReturnType<typeof section>[]): AiBuildPlan => ({
  reuse: [],
  create: CREATE,
  screens: [
    {
      title: 'Home',
      slug: '/',
      layout: 'new:Main layout',
      template: null,
      record: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Home | Wick & Pour',
      seoDescription: 'Hand-poured soy candles from a small-batch candle shop, shipped to your door.',
      sections,
    },
  ],
})

const usesOf = (settled: AiBuildPlan) => settled.screens[0].sections.map((one) => one.uses)

describe('aiSettlePlanUndeclaredUses (AGL-3845)', () => {
  it('declares a camelCase form the job can make, in words, and points the section at it', () => {
    const settled = aiSettlePlanUndeclaredUses(
      plan([section('hero'), section('Care, shipping and contact', ['new:contactForm'])]),
      EMPTY,
      FORMS_OPEN,
    )
    expect(settled.create.find((one) => one.kind === 'form')).toEqual({
      kind: 'form',
      name: 'Contact form',
      why: AI_PLAN_SETTLED_FORM.why,
      duplicateOf: null,
      fields: [...AI_PLAN_SETTLED_FORM.fields],
    })
    expect(usesOf(settled)).toEqual([[], ['new:Contact form']])
  })

  it('gives a newsletter form only an email, once however often it is placed', () => {
    const settled = aiSettlePlanUndeclaredUses(
      plan([section('hero', ['new:newsletterSignupForm']), section('footer note', ['new:newsletterSignupForm'])]),
      EMPTY,
      FORMS_OPEN,
    )
    expect(settled.create.filter((one) => one.kind === 'form')).toEqual([
      expect.objectContaining({ name: 'Newsletter signup form', fields: ['email'] }),
    ])
    expect(usesOf(settled)).toEqual([['new:Newsletter signup form'], ['new:Newsletter signup form']])
  })

  it('takes a form out of the section where the job can make no more', () => {
    const settled = aiSettlePlanUndeclaredUses(
      plan([section('Care, shipping and contact', ['new:contactForm'])]),
      EMPTY,
      NO_FORMS,
    )
    expect(settled.create).toEqual(CREATE)
    expect(usesOf(settled)).toEqual([[]])
  })

  it('takes out a component a site start may not make', () => {
    expect(FREE_SITE.create.component.allowed).toBe(false)
    const settled = aiSettlePlanUndeclaredUses(plan([section('Shop by scent', ['new:ScentFinder'])]), EMPTY, FREE_SITE)
    expect(usesOf(settled)).toEqual([[]])
  })

  it('leaves a component the job could declare for the rule to ask about', () => {
    const asked = plan([section('Shop by scent', ['new:ScentFinder'])])
    expect(aiSettlePlanUndeclaredUses(asked, EMPTY, COMPONENTS_OPEN)).toBe(asked)
  })

  it('leaves a plan alone without capabilities, or with nothing undeclared', () => {
    const asked = plan([section('Care, shipping and contact', ['new:contactForm'])])
    expect(aiSettlePlanUndeclaredUses(asked, EMPTY, null)).toBe(asked)
    const clean = plan([section('hero')])
    expect(aiSettlePlanUndeclaredUses(clean, EMPTY, FREE_SITE)).toBe(clean)
  })

  it('no longer refuses the live candle-shop answer on Free', () => {
    const checked = aiDoctrinePlanCheck(EMPTY, null, FREE_SITE)(
      plan([
        section('hero'),
        section('bestsellers'),
        section('our story'),
        section('scents'),
        section('Care, shipping and contact', ['new:contactForm']),
      ]) as never,
    )
    expect(checked.violations.map((violation) => violation.code)).not.toContain('plan-creation-undeclared')
  })
})
