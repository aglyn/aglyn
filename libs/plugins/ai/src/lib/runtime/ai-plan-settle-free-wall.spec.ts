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
import { aiFreePageSectionsWithin, aiSettlePlanFreeWall, validateAiBuildPlan } from './ai-doctrine-validators'
import { LIVE_CANDLE_ANSWER } from '../jobs/fixtures/ai-candle-shop-free-plan-recording'

/*
 * A Free plan past the wall is trimmed to fit (AGL-3737, AGL-3969). The live
 * candle-shop start of 2026-10-12 planned a home of 7 and a second page of 2
 * against a wall of 8, on all three answers, and stopped needing input; the
 * beta.265 eval's Free candle shop asked for 11, its re-ask for more than 8,
 * and was refused.
 */

const FREE_ORG: Partial<AglynOrgBilling> & { ownerUid: string } = { plan: 'free', ownerUid: 'owner-1' }
const PAID_ORG: Partial<AglynOrgBilling> = { plan: 'pro' }
const EMPTY = emptyAiSiteInventory('host-1')

const storeJob = { kind: 'site', inputs: { businessType: 'a candle shop', pages: 2 } } as unknown as AiJob
const FREE_SITE = aiSitePlanCapabilities(
  storeJob,
  aiPlanCapabilitiesFrom(FREE_ORG, { layout: [], template: [] }),
) as AiPlanCapabilities
const PAID_SITE = aiSitePlanCapabilities(
  storeJob,
  aiPlanCapabilitiesFrom(PAID_ORG, { layout: [], template: [] }),
) as AiPlanCapabilities

const page = (title: string, slug: string, sections: string[]): AiBuildPlan['screens'][number] => ({
  title,
  slug,
  layout: 'new:Main layout',
  template: null,
  record: null,
  duplicateOf: null,
  nav: true,
  seoTitle: `${title} | Wick & Pour`,
  seoDescription: `${title} for a small-batch candle shop that pours soy candles by hand.`,
  sections: sections.map((name) => ({
    name,
    uses: /newsletter/i.test(name) ? ['new:Newsletter'] : [],
    items: 0,
  })),
})

const CREATE: AiBuildPlan['create'] = [
  { kind: 'layout', name: 'Main layout', why: 'The site has none.', duplicateOf: null, fields: ['header', 'nav', 'main', 'footer'] },
  { kind: 'form', name: 'Newsletter', why: 'Shoppers sign up for new pours.', duplicateOf: null, fields: ['email'] },
]

const plan = (...screens: AiBuildPlan['screens']): AiBuildPlan => ({ reuse: [], create: CREATE, screens })
const names = (settled: AiBuildPlan) => settled.screens.map((screen) => screen.sections.map((section) => section.name))
const wallCodes = (checked: AiBuildPlan, capabilities: AiPlanCapabilities) =>
  validateAiBuildPlan(checked, EMPTY, null, capabilities)
    .map((violation) => violation.code)
    .filter((code) => code === 'plan-over-free-wall')

const CANDLE_HOME = page('Home', '/', [
  'hero',
  'bestsellers',
  'shop by scent',
  'our story',
  'why soy',
  'customer reviews',
  'newsletter sign-up',
])
const CANDLE_SHOP = page('Shop', '/shop', ['shop intro', 'product grid'])

describe('a Free plan past the wall', () => {
  it('is past the wall of 8 as the live candle-shop start planned it: a home of 7 and a shop of 2', () => {
    expect(wallCodes(plan(CANDLE_HOME, CANDLE_SHOP), FREE_SITE)).toEqual(['plan-over-free-wall'])
  })

  it('takes the candle home’s last band it does not need, never the shop’s grid, and then fits', () => {
    const settled = aiSettlePlanFreeWall(plan(CANDLE_HOME, CANDLE_SHOP), EMPTY, FREE_SITE)
    expect(names(settled)).toEqual([
      ['hero', 'bestsellers', 'shop by scent', 'our story', 'why soy', 'newsletter sign-up'],
      ['shop intro', 'product grid'],
    ])
    expect(wallCodes(settled, FREE_SITE)).toEqual([])
  })

  it('is settled by the plan check itself, so the answer is kept rather than re-asked', () => {
    const checked = aiDoctrinePlanCheck(EMPTY, null, FREE_SITE)(plan(CANDLE_HOME, CANDLE_SHOP) as never)
    expect(checked.violations.map((violation) => violation.code)).not.toContain('plan-over-free-wall')
    expect(checked.value?.screens.map((screen) => screen.sections.length)).toEqual([6, 2])
  })

  it('takes from the other page when it is further past its share, keeping a section that says how to reach the owner', () => {
    const home = page('Home', '/', ['hero', 'bestsellers', 'shop by scent', 'our story', 'newsletter sign-up'])
    const about = page('About', '/about', ['about hero', 'our process', 'the makers', 'visit the studio'])
    const settled = aiSettlePlanFreeWall(plan(home, about), EMPTY, FREE_SITE)
    expect(names(settled)[1]).toEqual(['about hero', 'our process', 'visit the studio'])
    // The home it did not need to touch is the same object.
    expect(settled.screens[0]).toBe(home)
  })

  it('shares a 6 + 4 out as 5 + 3, one from each, as the recorded yoga redo did', () => {
    const home = page('Home', '/', ['hero', 'bestsellers', 'shop by scent', 'our story', 'customer reviews', 'newsletter sign-up'])
    const about = page('About', '/about', ['about hero', 'our process', 'the makers', 'visit the studio'])
    const settled = aiSettlePlanFreeWall(plan(home, about), EMPTY, FREE_SITE)
    expect(names(settled)).toEqual([
      ['hero', 'bestsellers', 'shop by scent', 'our story', 'newsletter sign-up'],
      ['about hero', 'our process', 'visit the studio'],
    ])
    expect(wallCodes(settled, FREE_SITE)).toEqual([])
  })

  it('takes two from the other page’s end when it has them, the home at five untouched', () => {
    const home = page('Home', '/', ['hero', 'bestsellers', 'shop by scent', 'our story', 'newsletter sign-up'])
    const shop = page('Shop', '/shop', ['shop intro', 'product grid', 'candle care', 'shipping', 'gift help'])
    const settled = aiSettlePlanFreeWall(plan(home, shop), EMPTY, FREE_SITE)
    expect(names(settled)[1]).toEqual(['shop intro', 'product grid', 'candle care'])
    expect(settled.screens[0]).toBe(home)
    expect(wallCodes(settled, FREE_SITE)).toEqual([])
  })

  it('never takes the home under five, and then takes a section the other page keeps only by its name', () => {
    const home = page('Home', '/', ['hero', 'bestsellers', 'shop by scent', 'our story', 'newsletter sign-up'])
    const shop = page('Shop', '/shop', ['shop intro', 'product grid', 'visit the studio', 'contact us', 'get started'])
    const settled = aiSettlePlanFreeWall(plan(home, shop), EMPTY, FREE_SITE)
    expect(settled.screens[0]).toBe(home)
    expect(names(settled)[1]).toEqual(['shop intro', 'product grid', 'visit the studio'])
    expect(wallCodes(settled, FREE_SITE)).toEqual([])
  })

  it('takes a section that places something only where another section still places it', () => {
    const home = page('Home', '/', ['hero', 'bestsellers', 'shop by scent', 'our story', 'newsletter sign-up'])
    const shop = page('Shop', '/shop', ['shop intro', 'product grid', 'newsletter sign-up', 'join the list'])
    const twice = {
      ...shop,
      sections: shop.sections.map((section) => (section.name === 'join the list' ? { ...section, uses: ['new:Newsletter'] } : section)),
    }
    const settled = aiSettlePlanFreeWall(plan(home, twice), EMPTY, FREE_SITE)
    expect(names(settled)[1]).toEqual(['shop intro', 'product grid', 'newsletter sign-up'])
    expect(wallCodes(settled, FREE_SITE)).toEqual([])
  })

  it('leaves the plan for the wall to re-ask only when no section past it may go: an opening, a grid, a lone placement', () => {
    const home = page('Home', '/', ['hero', 'bestsellers', 'shop by scent', 'our story', 'why soy'])
    const shop = page('Shop', '/shop', ['shop intro', 'product grid', 'newsletter sign-up'])
    const over = plan(home, { ...shop, sections: [...shop.sections, { name: 'gift finder', uses: ['new:Gift finder'], items: 0 }] })
    expect(aiSettlePlanFreeWall(over, EMPTY, FREE_SITE)).toBe(over)
    expect(wallCodes(over, FREE_SITE)).toEqual(['plan-over-free-wall'])
  })

  it('trims a plan further past the wall to the wall, never under it', () => {
    const shop = page('Shop', '/shop', ['shop intro', 'product grid', 'candle care', 'shipping', 'gift help'])
    const settled = aiSettlePlanFreeWall(plan(CANDLE_HOME, shop), EMPTY, FREE_SITE)
    expect(names(settled).flat()).toHaveLength(8)
    expect(names(settled)[1].slice(0, 2)).toEqual(['shop intro', 'product grid'])
    expect(settled.screens[0].sections.length).toBeGreaterThanOrEqual(5)
    expect(wallCodes(settled, FREE_SITE)).toEqual([])
  })

  it('is re-asked, untouched, when it splits a list into sections, which the re-ask joins', () => {
    const home = page('Home', '/', ['hero', 'bestsellers', 'shop by scent', 'our story', 'newsletter sign-up'])
    const shop = page('Shop', '/shop', ['shop intro', 'product grid', 'candle: lavender', 'candle: cedar'])
    const one = (name: string) => ({ name, uses: [], items: 1 })
    const split = plan(home, {
      ...shop,
      sections: [...shop.sections.slice(0, 2), one('candle: lavender'), one('candle: cedar'), one('candle: fig')],
    })
    expect(aiSettlePlanFreeWall(split, EMPTY, FREE_SITE)).toBe(split)
  })

  it('is re-asked when a site start plans more pages than its cap', () => {
    const over = plan(
      page('Home', '/', ['hero', 'our story']),
      page('Shop', '/shop', ['product grid']),
      page('About', '/about', ['about']),
    )
    expect(aiSettlePlanFreeWall(over, EMPTY, FREE_SITE)).toBe(over)
  })

  it('leaves a plan inside the wall, and a paid plan, as they are', () => {
    const fits = plan(page('Home', '/', ['hero', 'bestsellers', 'our story', 'why soy', 'newsletter sign-up']), CANDLE_SHOP)
    expect(aiSettlePlanFreeWall(fits, EMPTY, FREE_SITE)).toBe(fits)
    const paid = plan(CANDLE_HOME, CANDLE_SHOP)
    expect(aiSettlePlanFreeWall(paid, EMPTY, PAID_SITE)).toBe(paid)
    expect(aiSettlePlanFreeWall(paid, EMPTY, null)).toBe(paid)
  })

  it('trims a Free page job one past its wall from the end, never its opening', () => {
    const site = { ...EMPTY, layouts: [{ id: 'laySite', name: 'Site layout', parentId: null }] }
    const rows = [{ id: 'laySite', kind: undefined, sourceType: undefined, deletedAt: undefined }]
    const free = aiPlanCapabilitiesFrom(FREE_ORG, { layout: rows, template: [] })
    const fits = aiFreePageSectionsWithin({ layouts: 0, pages: 1 })
    const sections = Array.from({ length: fits + 1 }, (_, index) => (index === 0 ? 'hero' : `band ${index}`))
    const one: AiBuildPlan = {
      reuse: [{ kind: 'layout', id: 'laySite', purpose: 'the site header and footer' }],
      create: [],
      screens: [{ ...page('Services', '/services', sections), layout: 'laySite' }],
    }
    const settled = aiSettlePlanFreeWall(one, site, free)
    expect(names(settled)[0]).toEqual(sections.slice(0, fits))
    expect(validateAiBuildPlan(settled, site, null, free).map((violation) => violation.code)).not.toContain(
      'plan-over-free-wall',
    )
  })
})

/*
 * The beta.265 eval's Free candle shop (AGL-3969) asked for 11 sections and
 * its re-ask for more than 8, and the step stopped. Those bytes were not
 * kept, so this is the recorded 2026-10-16 answer (laySite reused on an empty
 * site, a starter screen duplicated, descriptions in every section's uses)
 * with two more bands, a home's reviews and the shop's contact, to make 11.
 */
const overBudgetCandle = (): AiBuildPlan => {
  const answer = JSON.parse(JSON.stringify(LIVE_CANDLE_ANSWER)) as AiBuildPlan
  const [home, shop] = answer.screens
  home.sections.splice(home.sections.length - 1, 0, { name: 'Customer reviews', uses: ['review quotes'], items: 3 })
  shop.sections.push({ name: 'Contact us', uses: ['contact details'], items: 0 })
  return answer
}
const total = (checked: AiBuildPlan | undefined) =>
  checked?.screens.reduce((sum, screen) => sum + screen.sections.length, 0)

describe('a Free candle-shop plan over its budget settles, never refuses (AGL-3969)', () => {
  it('asks for 11 sections against a wall of 8', () => {
    expect(total(overBudgetCandle())).toBe(11)
  })

  it('is trimmed to the full 8 by the plan check, with no finding to re-ask or refuse', () => {
    const checked = aiDoctrinePlanCheck(EMPTY, null, FREE_SITE)(overBudgetCandle() as never)
    expect(checked.violations).toEqual([])
    expect(total(checked.value)).toBe(8)
    const [home, shop] = (checked.value as AiBuildPlan).screens.map((screen) => screen.sections.map((section) => section.name))
    // The home keeps its opening, its fewest five and its sign-up; the shop its opening and its grid.
    expect(home[0]).toBe('Hero that sells first')
    expect(home.length).toBeGreaterThanOrEqual(5)
    expect(home).toContain('Newsletter sign-up')
    expect(shop.slice(0, 2)).toEqual(['Short title', 'Product grid'])
    // The one creation it places is still placed.
    expect(checked.value?.screens.flatMap((screen) => screen.sections.flatMap((section) => section.uses))).toContain(
      'new:newsletterForm',
    )
  })

  it('keeps a recorded plan inside the wall as it was answered', () => {
    const answer = JSON.parse(JSON.stringify(LIVE_CANDLE_ANSWER)) as AiBuildPlan
    answer.screens[1].sections.pop()
    const asked = answer.screens.map((screen) => screen.sections.map((section) => section.name))
    const checked = aiDoctrinePlanCheck(EMPTY, null, FREE_SITE)(answer as never)
    expect(checked.violations).toEqual([])
    expect(checked.value?.screens.map((screen) => screen.sections.map((section) => section.name))).toEqual(asked)
  })
})
