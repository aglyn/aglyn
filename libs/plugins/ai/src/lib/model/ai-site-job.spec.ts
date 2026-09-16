/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
 * What a site scaffold admits (AGL-2911): the inputs its doors take, the
 * plans it can build, and the estimate a member reads before confirming one.
 *
 * The estimate is the guard rail the issue asks for, so the number it is
 * counted in is pinned to the machine's own nominal rather than copied.
 */

import { AI_JOB_STEP_RESERVE_CREDITS } from '../jobs/ai-jobs'
import type { AiBuildPlan, AiBuildPlanScreen } from './ai-build-plan'
import {
  AI_SITE_MAX_SECTIONS,
  AI_SITE_NOMINAL_SECTIONS,
  AI_SITE_PAGES,
  AI_SITE_PASS_CREDITS,
  aiPlanCreditEstimate,
  aiPlanPasses,
  aiSiteCreditEstimate,
  aiSitePlanPrerequisites,
  aiSitePlanRefusal,
  parseAiSiteJobInputs,
} from './ai-site-job'

function screen(overrides: Partial<AiBuildPlanScreen> = {}): AiBuildPlanScreen {
  return {
    title: 'Home',
    slug: 'home',
    layout: null,
    template: null,
    duplicateOf: null,
    nav: true,
    seoTitle: 'Home',
    seoDescription: 'The home page',
    sections: [{ name: 'hero', uses: [], items: 0 }],
    ...overrides,
  }
}

function plan(overrides: Partial<AiBuildPlan> = {}): AiBuildPlan {
  return {
    reuse: [],
    create: [],
    screens: Array.from({ length: AI_SITE_PAGES.min }, (_, index) =>
      screen({
        title: `Page ${index}`,
        slug: `page-${index}`,
        nav: index === 0,
      }),
    ),
    ...overrides,
  }
}

describe('a scaffold’s inputs', () => {
  it('reads the business, the page count and the per-site variables', () => {
    expect(
      parseAiSiteJobInputs({
        businessType: ' dog groomer ',
        pages: 6,
        businessName: 'Wag & Co',
        city: 'Austin',
        brand: 'teal',
        batchId: 'b-1',
      }),
    ).toEqual({
      businessType: 'dog groomer',
      pages: 6,
      businessName: 'Wag & Co',
      city: 'Austin',
      brand: 'teal',
      welcomeEmail: true,
      batchId: 'b-1',
    })
  })

  it('defaults the variables, the welcome email and the batch', () => {
    expect(parseAiSiteJobInputs({ businessType: 'bakery', pages: 4 })).toEqual({
      businessType: 'bakery',
      pages: 4,
      businessName: '',
      city: '',
      brand: '',
      welcomeEmail: true,
      batchId: null,
    })
  })

  it('takes a welcome email off only when it is explicitly false', () => {
    const off = parseAiSiteJobInputs({
      businessType: 'bakery',
      pages: 4,
      welcomeEmail: false,
    })
    expect(typeof off === 'string' ? off : off.welcomeEmail).toBe(false)
  })

  it('refuses a missing business, a page count outside the band and a bad batch', () => {
    expect(parseAiSiteJobInputs({ pages: 4 })).toMatch(/what kind of business/)
    expect(parseAiSiteJobInputs({ businessType: 'bakery', pages: 3 })).toMatch(
      new RegExp(`${AI_SITE_PAGES.min} to ${AI_SITE_PAGES.max}`),
    )
    expect(parseAiSiteJobInputs({ businessType: 'bakery', pages: 9 })).toMatch(
      /pages must be/,
    )
    expect(
      parseAiSiteJobInputs({ businessType: 'bakery', pages: 4.5 }),
    ).toMatch(/pages must be/)
    expect(
      parseAiSiteJobInputs({
        businessType: 'bakery',
        pages: 4,
        batchId: 'not a batch/id',
      }),
    ).toMatch(/batchId/)
  })

  it('refuses a variable longer than a name', () => {
    expect(
      parseAiSiteJobInputs({
        businessType: 'bakery',
        pages: 4,
        city: 'x'.repeat(200),
      }),
    ).toMatch(/city must be text/)
  })
})

describe('the plans a scaffold can build', () => {
  it('admits a plan of four to eight pages with a navigation entry', () => {
    expect(aiSitePlanRefusal(plan())).toBeNull()
  })

  it('refuses a plan outside the page band', () => {
    expect(aiSitePlanRefusal(plan({ screens: [screen()] }))).toMatch(
      /builds 1 page/,
    )
    expect(
      aiSitePlanRefusal(
        plan({
          screens: Array.from({ length: AI_SITE_PAGES.max + 1 }, (_, index) =>
            screen({ slug: `p${index}` }),
          ),
        }),
      ),
    ).toMatch(new RegExp(`${AI_SITE_PAGES.min} to ${AI_SITE_PAGES.max}`))
  })

  it('refuses a page with nothing to build and one with more sections than a scaffold builds', () => {
    const none = plan()
    none.screens[1] = screen({ title: 'Empty', slug: 'empty', sections: [] })
    expect(aiSitePlanRefusal(none)).toMatch(/“Empty” has no sections/)
    const many = plan()
    many.screens[1] = screen({
      title: 'Long',
      slug: 'long',
      sections: Array.from(
        { length: AI_SITE_MAX_SECTIONS + 1 },
        (_, index) => ({
          name: `section ${index}`,
          uses: [],
          items: 0,
        }),
      ),
    })
    expect(aiSitePlanRefusal(many)).toMatch(
      new RegExp(`holds ${AI_SITE_MAX_SECTIONS}`),
    )
  })

  it('refuses two pages at one address, and a plan with no page in the navigation', () => {
    const clash = plan()
    clash.screens[1] = screen({ title: 'Twin', slug: 'PAGE-0' })
    expect(aiSitePlanRefusal(clash)).toMatch(/share the address/)
    const hidden = plan({
      screens: plan().screens.map((row) => ({ ...row, nav: false })),
    })
    expect(aiSitePlanRefusal(hidden)).toMatch(/navigation/)
  })

  it('builds its own layout, form and palette change, and refuses the rest', () => {
    const own = plan({
      create: [
        {
          kind: 'layout',
          name: 'Site frame',
          why: 'every page',
          duplicateOf: null,
          fields: [],
        },
        {
          kind: 'form',
          name: 'Contact',
          why: 'rule 3',
          duplicateOf: null,
          fields: ['email'],
        },
        {
          kind: 'theme-change',
          name: 'Palette',
          why: 'the brand',
          duplicateOf: null,
          fields: ['palette.primary.main'],
        },
      ],
    })
    expect(aiSitePlanRefusal(own)).toBeNull()
    const outside = plan({
      create: [
        {
          kind: 'component',
          name: 'Price card',
          why: 'repeats',
          duplicateOf: null,
          fields: [],
        },
      ],
    })
    expect(aiSitePlanRefusal(outside)).toMatch(
      /Create the component “Price card” on the Components page/,
    )
    expect(aiSitePlanPrerequisites(outside)).toEqual([
      { kind: 'component', name: 'Price card' },
    ])
  })

  it('names an unbuildable reference the create list does not carry', () => {
    const dangling = plan()
    dangling.screens[0] = screen({
      slug: 'home',
      sections: [{ name: 'hero', uses: ['new:Hero band'], items: 0 }],
    })
    expect(aiSitePlanPrerequisites(dangling)).toEqual([
      { kind: 'component', name: 'Hero band' },
    ])
  })

  it('lists several prerequisites in one sentence, each once', () => {
    const several = plan({
      create: [
        {
          kind: 'component',
          name: 'Card',
          why: 'repeats',
          duplicateOf: null,
          fields: [],
        },
        {
          kind: 'dataset',
          name: 'Menu',
          why: 'entries',
          duplicateOf: null,
          fields: [],
        },
        {
          kind: 'component',
          name: 'Card',
          why: 'again',
          duplicateOf: null,
          fields: [],
        },
      ],
    })
    const refusal = aiSitePlanRefusal(several) ?? ''
    expect(refusal).toContain(
      'the component “Card” on the Components page and the dataset “Menu” on the Datasets page',
    )
    expect(refusal.match(/Card/g)).toHaveLength(1)
  })
})

describe('what a scaffold is estimated to cost', () => {
  it('counts in the machine’s own nominal credits per step', () => {
    expect(AI_SITE_PASS_CREDITS).toBe(AI_JOB_STEP_RESERVE_CREDITS)
  })

  it('is a pass per section, one more per page, and one per thing it creates', () => {
    const counted = plan({
      create: [
        {
          kind: 'layout',
          name: 'Frame',
          why: 'every page',
          duplicateOf: null,
          fields: [],
        },
        {
          kind: 'form',
          name: 'Contact',
          why: 'rule 3',
          duplicateOf: null,
          fields: [],
        },
      ],
      screens: [
        screen({ slug: 'a', sections: [{ name: 'hero', uses: [], items: 0 }] }),
        screen({
          slug: 'b',
          nav: false,
          sections: [
            { name: 'hero', uses: [], items: 0 },
            { name: 'grid', uses: [], items: 3 },
          ],
        }),
        screen({
          slug: 'c',
          nav: false,
          sections: [{ name: 'hero', uses: [], items: 0 }],
        }),
        screen({
          slug: 'd',
          nav: false,
          sections: [{ name: 'hero', uses: [], items: 0 }],
        }),
      ],
    })
    // (1 + 1) + (2 + 1) + (1 + 1) + (1 + 1) + two creations
    expect(aiPlanPasses(counted)).toBe(11)
    expect(aiPlanPasses(counted, { welcomeEmail: true })).toBe(12)
    expect(aiPlanCreditEstimate(counted)).toBe(11 * AI_SITE_PASS_CREDITS)
  })

  it('counts a creation a scaffold does not build as nobody’s pass', () => {
    const outside = plan({
      screens: [screen()],
      create: [
        {
          kind: 'component',
          name: 'Card',
          why: 'repeats',
          duplicateOf: null,
          fields: [],
        },
      ],
    })
    expect(aiPlanPasses(outside)).toBe(2)
  })

  it('estimates from the page count before a plan names the sections', () => {
    // the plan step, then each page's nominal sections and its listing, then
    // the layout and the form.
    const pages = 6
    expect(aiSiteCreditEstimate(pages)).toBe(
      (1 + pages * (AI_SITE_NOMINAL_SECTIONS + 1) + 2) * AI_SITE_PASS_CREDITS,
    )
    expect(aiSiteCreditEstimate(pages, { welcomeEmail: true })).toBe(
      aiSiteCreditEstimate(pages) + AI_SITE_PASS_CREDITS,
    )
  })

  it('grows with the site', () => {
    expect(aiSiteCreditEstimate(AI_SITE_PAGES.max)).toBeGreaterThan(
      aiSiteCreditEstimate(AI_SITE_PAGES.min),
    )
  })
})
