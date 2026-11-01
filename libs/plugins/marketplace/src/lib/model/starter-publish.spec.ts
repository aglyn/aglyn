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

import { SITE_STARTER_MAX_SCREENS } from '@aglyn/aglyn/app-utils/site-starter'
import type { SiteStarterBuiltinReading } from '@aglyn/aglyn/app-utils/site-starter-theme'
import {
  starterPublishBody,
  starterPublishPages,
  starterPublishSteps,
  starterRefusalLink,
  type StarterPublishFacts,
} from './starter-publish'

/**
 * "Publish as a starter" before the click (AGL-4049): what it will capture,
 * what stands in the way and where each is fixed, and the body it sends.
 * Every setup step the door refuses for is said here first, so the dialog
 * shows it disabled with the reason rather than after the publish.
 */

const READY: StarterPublishFacts = {
  plan: { ready: true, locked: false, planLabel: 'Pro', upgradeHref: '/acme/billing#plans' },
  profile: { handle: 'acme', stripeAccountId: 'acct_1', stripeChargesEnabled: true },
  pages: { count: 3, hasHome: true },
  priceUsd: 0,
  marketplacePath: '/acme/marketplace',
  pagesPath: '/acme/hosts/bistro/screens',
}

const ids = (facts: StarterPublishFacts) => starterPublishSteps(facts).map((step) => step.id)

describe('starterPublishPages', () => {
  it('counts the pages the door captures: routed, saved at least once, not deleted', () => {
    const pages = starterPublishPages({ home: '/', about: 'about', draft: 'draft', gone: 'gone' }, [
      { $id: 'home', versionId: 'v1' },
      { $id: 'about', versionId: 'v3' },
      { $id: 'draft' },
      { $id: 'gone', versionId: 'v1', deletedAt: 'then' },
      // An email screen is never in the routing map, so never a page.
      { $id: 'newsletter', versionId: 'v1', kind: 'email' },
    ])
    expect(pages).toEqual({ count: 2, hasHome: true })
  })

  it('has no Home page when the page at / was never saved', () => {
    expect(starterPublishPages({ home: '/', about: 'about' }, [{ $id: 'home' }, { $id: 'about', versionId: 'v1' }]))
      .toEqual({ count: 1, hasHome: false })
  })

  it('reads junk as no pages', () => {
    expect(starterPublishPages(null, [])).toEqual({ count: 0, hasHome: false })
    expect(starterPublishPages('pages', [{ $id: 'x', versionId: 'v1' }])).toEqual({ count: 0, hasHome: false })
  })
})

describe('starterPublishSteps', () => {
  it('asks for nothing when the plan sells, the profile is set up and the site has a Home page', () => {
    expect(starterPublishSteps(READY)).toEqual([])
  })

  it('never refuses while a read is still pending', () => {
    expect(
      starterPublishSteps({
        ...READY,
        plan: { ready: false, locked: false },
        profile: undefined,
        pages: null,
        priceUsd: 29,
      }),
    ).toEqual([])
  })

  it('names the plan that sells on the marketplace, linking the plans', () => {
    const [step] = starterPublishSteps({ ...READY, plan: { ...READY.plan, locked: true } })
    expect(step).toEqual({
      id: 'plan',
      text: 'Publishing to the marketplace is included from Pro.',
      href: '/acme/billing#plans',
      actionLabel: 'See plans',
    })
  })

  it('asks for a publisher profile, linking Marketplace → Publisher Profile', () => {
    const [step] = starterPublishSteps({ ...READY, profile: null })
    expect(step).toMatchObject({ id: 'profile', href: '/acme/marketplace/profile', actionLabel: 'Publisher Profile' })
    // A profile document with no handle is no profile, as the door reads it.
    expect(ids({ ...READY, profile: { displayName: 'Acme' } })).toEqual(['profile'])
  })

  it('asks for payouts only for a starter with a price, linking Marketplace → Payouts', () => {
    const unpaid = { ...READY, profile: { handle: 'acme' } }
    expect(ids(unpaid)).toEqual([])
    const [step] = starterPublishSteps({ ...unpaid, priceUsd: 29 })
    expect(step).toMatchObject({ id: 'payouts', href: '/acme/marketplace/payouts', actionLabel: 'Payouts' })
    expect(ids({ ...READY, profile: { handle: 'acme', stripeAccountId: 'acct_1' }, priceUsd: 29 })).toEqual(['payouts'])
    expect(ids({ ...READY, priceUsd: 29 })).toEqual([])
  })

  it("says, in the door's own words, that a starter needs a published Home page", () => {
    const [step] = starterPublishSteps({ ...READY, pages: { count: 2, hasHome: false } })
    expect(step).toMatchObject({ id: 'home', href: '/acme/hosts/bistro/screens', actionLabel: 'Pages' })
    expect(step.text).toMatch(/^A starter needs a published Home page at \//)
  })

  it('says how many pages a starter may have, and how many this site has', () => {
    const [step] = starterPublishSteps({ ...READY, pages: { count: SITE_STARTER_MAX_SCREENS + 1, hasHome: true } })
    expect(step.id).toBe('pages')
    expect(step.text).toBe(
      `A starter can have at most ${SITE_STARTER_MAX_SCREENS} pages, and this site has ${SITE_STARTER_MAX_SCREENS + 1}.`,
    )
  })

  it('lists every step at once, the setup steps first', () => {
    expect(
      ids({
        ...READY,
        plan: { ...READY.plan, locked: true },
        profile: null,
        priceUsd: 29,
        pages: { count: 0, hasHome: false },
      }),
    ).toEqual(['plan', 'profile', 'home'])
  })

  it('names the step without a link until the workspace address is known', () => {
    const [step] = starterPublishSteps({ ...READY, profile: null, marketplacePath: null })
    expect(step.href).toBeNull()
  })
})

describe('starterRefusalLink', () => {
  it('links where a setup refusal is fixed, from what the dialog read', () => {
    expect(starterRefusalLink({ ...READY, plan: { ...READY.plan, locked: true } })).toEqual({
      href: '/acme/billing#plans',
      actionLabel: 'See plans',
    })
    expect(starterRefusalLink({ ...READY, profile: null })).toEqual({
      href: '/acme/marketplace/profile',
      actionLabel: 'Publisher Profile',
    })
    expect(starterRefusalLink({ ...READY, priceUsd: 29 })).toEqual({
      href: '/acme/marketplace/payouts',
      actionLabel: 'Payouts',
    })
    // Nothing read says which: the profile, where the other two are set up.
    expect(starterRefusalLink(READY)).toEqual({ href: '/acme/marketplace/profile', actionLabel: 'Publisher Profile' })
  })
})

describe('starterPublishBody', () => {
  const builtin: SiteStarterBuiltinReading = {
    theme: { kind: 'builtin', base: 'bootstrap', brand: { light: { primary: '#0a4' }, dark: {} }, fonts: 'inter' },
    baseName: 'Bootstrap',
    fontsCarried: true,
  }

  it('sends nothing until a theme is chosen: neither is chosen for the publisher', () => {
    expect(starterPublishBody({ choice: null, builtin, kind: null })).toBeNull()
  })

  it("sends the site's built-in as it read it, a base starter, and the closest style", () => {
    expect(starterPublishBody({ choice: 'builtin', builtin, kind: 'restaurant' })).toEqual({
      theme: builtin.theme,
      mode: 'base',
      facets: { kind: 'restaurant' },
    })
  })

  it("sends the full theme for the door to read off the site, and no style when none is chosen", () => {
    expect(starterPublishBody({ choice: 'full', builtin: null, kind: null })).toEqual({
      theme: { kind: 'full' },
      mode: 'base',
      facets: { kind: null },
    })
  })

  it('sends nothing for a built-in the site does not wear', () => {
    expect(starterPublishBody({ choice: 'builtin', builtin: null, kind: null })).toBeNull()
  })
})
