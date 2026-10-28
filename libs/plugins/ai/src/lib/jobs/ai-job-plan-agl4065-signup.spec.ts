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
 * THE HOME'S NEWSLETTER BAND IS THE PLATFORM'S EMAIL FIELD (AGL-4065). The
 * 2026-10-25 Berm & Bolt Moto Parts plan ended its home with
 * `{"name":"Newsletter sign-up","uses":["new:Parts inquiry form"]}`: the plan
 * prompt names the band without saying it is the platform's own field, the
 * model put its inquiry form there, the listings then left the sign-up out
 * of a section that places a form, and the home drew the parts inquiry form
 * under the heading "Newsletter sign-up".
 *
 * Replayed offline on the recorded plan: the storefront settle the plan step
 * runs, and the placements the pages are handed.
 */

import type { AiBuildPlan } from '../model/ai-build-plan'
import { aiLayoutListingPlacements } from '../layout-language/ai-layout-listings'
import { AI_SITE_STORE_HOME_BANDS, aiSiteStorefrontPlan } from './ai-job-plan-step'
import { BERM_BOLT_FORM, BERM_BOLT_SCREENS } from './fixtures/ai-site-agl4065-datasets'

const PLAN: AiBuildPlan = { reuse: [], create: [BERM_BOLT_FORM], screens: BERM_BOLT_SCREENS }

const sectionNamed = (plan: Pick<AiBuildPlan, 'screens'>, screenId: string, name: string) =>
  plan.screens.find((screen) => screen.id === screenId)?.sections.find((section) => section.name === name)

describe('a store home’s "Newsletter sign-up" band (AGL-4065)', () => {
  it('loses the inquiry form the plan put in it, which stays on the contact page', () => {
    const settled = aiSiteStorefrontPlan(PLAN, { paid: true })
    expect(sectionNamed(settled, 'fxStoreHome', 'Newsletter sign-up')?.uses).toEqual([])
    expect(sectionNamed(settled, 'fxStoreContact', 'Parts inquiry form')?.uses).toEqual(['new:Parts inquiry form'])
    // The home gains no second copy of the form: it already has a page.
    const home = settled.screens.find((screen) => screen.id === 'fxStoreHome')
    expect(home?.sections.filter((section) => section.uses.includes('new:Parts inquiry form'))).toEqual([])
  })

  it('is where the platform places the store’s sign-up field', () => {
    const settled = aiSiteStorefrontPlan(PLAN, { paid: true })
    const home = settled.screens.find((screen) => screen.id === 'fxStoreHome')
    const index = home?.sections.findIndex((section) => section.name === 'Newsletter sign-up') ?? -1
    expect(index).toBeGreaterThan(0)
    expect(aiLayoutListingPlacements('signup', settled.screens)).toEqual([{ screenId: 'fxStoreHome', section: index, role: 'index' }])
  })

  it('keeps a form that lived only in the sign-up band, in a band of its own before it', () => {
    const only: AiBuildPlan = {
      ...PLAN,
      screens: BERM_BOLT_SCREENS.map((screen) =>
        screen.id === 'fxStoreContact' ? { ...screen, sections: screen.sections.filter((section) => !section.uses.length) } : screen,
      ),
    }
    const settled = aiSiteStorefrontPlan(only, { paid: true })
    const home = settled.screens.find((screen) => screen.id === 'fxStoreHome')
    const names = home?.sections.map((section) => section.name) ?? []
    expect(names[names.length - 1]).toBe('Newsletter sign-up')
    expect(home?.sections[names.length - 2]).toEqual({ name: 'Parts inquiry', uses: ['new:Parts inquiry form'], items: 0 })
    expect(home?.sections[names.length - 1]?.uses).toEqual([])
  })

  it('is described to the plan as the platform’s own email field, never one of its forms', () => {
    expect(AI_SITE_STORE_HOME_BANDS).toBe(
      'a hero that sells first and a "Newsletter sign-up" band last (the platform\'s own email field — never one of your forms), and between them "Bestsellers" (the platform lists the real products), "Shop by collection" with 3 or 4 items, the brand story, why buy here with 3 or 4 items and "Customer reviews" (the platform shows the store\'s real ones)',
    )
  })
})
