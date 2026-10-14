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
 * A store's own pages, added by an Assist build (AGL-3676): a build that
 * makes the site a store gets the account, cart and policy pages a site
 * start's store gets, only the ones the site lacks, at no credits.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiBuildPlan, AiBuildPlanScreen } from './ai-build-plan'
import {
  aiBuildCreditRange,
  aiBuildFirstPagePlan,
  aiBuildInitialLedger,
  aiBuildPlanShapeRefusal,
  aiBuildUnits,
  AI_BUILD_LIMITS,
} from './ai-build-job'
import {
  AI_BUILD_PRODUCT_OP,
  AI_BUILD_STORE_OP,
  AI_BUILD_STORE_SLOT,
  aiBuildMakesStore,
  aiBuildStorePagesAdded,
  aiBuildStorePagesFor,
  aiBuildStorePagesOf,
  aiBuildStorePagesStillMissing,
  aiStorePagesForSite,
} from './ai-build-store-pages'

const screen = (title: string, slug: string, extra: Partial<AiBuildPlanScreen> = {}): AiBuildPlanScreen => ({
  title,
  slug,
  layout: null,
  template: null,
  duplicateOf: null,
  nav: true,
  seoTitle: title,
  seoDescription: title,
  sections: [{ name: 'Intro', uses: [], items: 0 }],
  record: null,
  ...extra,
})

const product = (name: string) => ({
  slot: `i-${name}`,
  op: AI_BUILD_PRODUCT_OP,
  name,
  why: 'Sold here.',
  dependsOn: [],
  degrade: 'omit' as const,
  args: { name },
})

const shopPlan = (extra: Partial<AiBuildPlan> = {}): AiBuildPlan => ({
  reuse: [],
  create: [],
  screens: [screen('Shop', '/shop')],
  items: [product('Amber candle')],
  ...extra,
})

describe('which builds make a site a store', () => {
  it('names the commerce plugin’s product operation as it registers it', () => {
    const source = readFileSync(join(__dirname, '../../../../commerce/src/lib/server/product-ai-capability.ts'), 'utf8')
    expect(source).toContain(`export const PRODUCT_AI_OP = '${AI_BUILD_PRODUCT_OP}'`)
  })

  it('a build that makes products, a product page template or a Shop page; never a gallery’s Collections page', () => {
    expect(aiBuildMakesStore({ screens: [], items: [product('Mug')] })).toBe(true)
    expect(aiBuildMakesStore({ screens: [screen('Shop', '/shop')] })).toBe(true)
    expect(aiBuildMakesStore({ screens: [screen('Our products', '/products')] })).toBe(true)
    expect(
      aiBuildMakesStore({ screens: [], items: [{ ...product('Product page'), op: 'template', args: { subject: 'product' } }] }),
    ).toBe(true)
    expect(aiBuildMakesStore({ screens: [screen('Collections', '/collections'), screen('About', '/about')] })).toBe(false)
    expect(aiBuildMakesStore({ screens: [], items: [{ ...product('Post page'), op: 'template', args: { subject: 'entry' } }] })).toBe(
      false,
    )
  })
})

describe('the store pages a build adds', () => {
  it('adds every store page to a site that has none, with what their words link', () => {
    const added = aiBuildStorePagesFor(shopPlan(), {
      store: true,
      pages: [{ slug: '/', title: 'Home' }, { slug: 'contact', title: 'Contact' }],
    })
    expect(added?.pages.map((page) => [page.key, page.href, page.planned ?? null])).toEqual([
      ['account', '/account', null],
      ['cart', '/cart', null],
      ['shipping', '/shipping-returns', null],
      ['privacy', '/privacy', null],
      ['terms', '/terms', null],
    ])
    expect(added?.facts).toEqual({ contactPath: '/contact', shopPath: '/shop', shippingPath: '/shipping-returns' })
  })

  it('skips the ones the site already has, by address or by what the page says it is', () => {
    const added = aiBuildStorePagesFor(shopPlan(), {
      store: true,
      pages: [
        { slug: 'privacy-policy', title: 'Privacy Policy' },
        { slug: 'cart', title: 'Cart' },
        { slug: 'delivery', title: 'Delivery & returns' },
      ],
    })
    expect(aiBuildStorePagesAdded({ storePages: added }).map((page) => page.key)).toEqual(['account', 'terms'])
    expect(added?.pages.find((page) => page.key === 'privacy')).toMatchObject({ href: '/privacy-policy', planned: 'Privacy Policy' })
    expect(added?.facts.shippingPath).toBe('/delivery')
  })

  it('a planned page at a store page’s address is that page', () => {
    const added = aiBuildStorePagesFor(shopPlan({ screens: [screen('Shop', '/shop'), screen('Terms & conditions', '/terms-and-conditions')] }), {
      store: true,
      pages: [],
    })
    expect(aiBuildStorePagesAdded({ storePages: added }).map((page) => page.key)).toEqual(['account', 'cart', 'shipping', 'privacy'])
  })

  it('adds none where the site cannot have a store, the build makes none, or every page is there', () => {
    expect(aiBuildStorePagesFor(shopPlan(), { store: false, pages: [] })).toBeNull()
    expect(aiBuildStorePagesFor({ screens: [screen('About', '/about')] },{ store: true, pages: [] })).toBeNull()
    const all = ['account', 'cart', 'shipping-returns', 'privacy', 'terms'].map((slug) => ({ slug, title: slug }))
    expect(aiBuildStorePagesFor(shopPlan(), { store: true, pages: all })).toBeNull()
  })

  it('a record template is no page at its own address', () => {
    expect(aiStorePagesForSite([{ slug: 'account', title: 'Account', template: true }])[0].planned).toBeUndefined()
  })

  it('once it runs, writes only what the site still lacks', () => {
    const kept = aiBuildStorePagesFor(shopPlan(), { store: true, pages: [] })?.pages ?? []
    const now = aiBuildStorePagesStillMissing(kept, [{ slug: 'my-account', title: 'My account' }])
    expect(now.find((page) => page.key === 'account')).toMatchObject({ planned: 'My account', href: '/my-account' })
    expect(now.filter((page) => !page.planned).map((page) => page.key)).toEqual(['cart', 'shipping', 'privacy', 'terms'])
  })

  it('reads a kept plan’s store pages, and none from a plan kept before them', () => {
    expect(aiBuildStorePagesOf({})).toBeNull()
    expect(aiBuildStorePagesOf({ storePages: { pages: [{ key: 'nope', href: '/x' }], facts: {} } })).toBeNull()
  })
})

describe('the store pages unit of a build', () => {
  const plan = (): AiBuildPlan => {
    const base = shopPlan()
    return { ...base, storePages: aiBuildStorePagesFor(base, { store: true, pages: [] }) ?? undefined }
  }

  it('is the build’s last unit, costs nothing, and is no part of the plan’s size', () => {
    const units = aiBuildUnits(plan())
    expect(units.map((unit) => unit.slot)).toEqual(['i-Amber candle', 'p0', AI_BUILD_STORE_SLOT])
    expect(units[2]).toMatchObject({ op: AI_BUILD_STORE_OP, label: 'Account, cart and policy pages', deps: [] })
    expect(aiBuildInitialLedger(units).map((row) => row.slot)).toContain(AI_BUILD_STORE_SLOT)
    const without = aiBuildCreditRange(shopPlan())
    expect(aiBuildCreditRange(plan())).toEqual(without)
    expect(aiBuildCreditRange(plan(), { slots: new Set([AI_BUILD_STORE_SLOT]) }).ceiling).toBe(0)
  })

  it('does not count toward the most one build holds', () => {
    const full: AiBuildPlan = {
      ...plan(),
      items: Array.from({ length: AI_BUILD_LIMITS.units - 1 }, (_, index) => product(`Product ${index}`)),
    }
    expect(aiBuildUnits(full)).toHaveLength(AI_BUILD_LIMITS.units + 1)
    expect(aiBuildPlanShapeRefusal(full)).toBeNull()
  })

  it('a smaller first build keeps them only while it still makes a store', () => {
    const withHome: AiBuildPlan = {
      ...shopPlan({ screens: [screen('Home', '/'), screen('Shop', '/shop')], items: [] }),
    }
    const kept = { ...withHome, storePages: aiBuildStorePagesFor(withHome, { store: true, pages: [] }) ?? undefined }
    const smaller = aiBuildFirstPagePlan(kept)
    expect(smaller?.screens.map((one) => one.title)).toEqual(['Home'])
    expect(smaller?.storePages).toBeUndefined()
    // A home page and the store's own pages alone is no smaller build.
    const homeOnly = { ...kept, screens: [screen('Home', '/')], items: [product('Mug')] }
    expect(aiBuildUnits(homeOnly).map((unit) => unit.slot)).toEqual(['i-Mug', 'p0', AI_BUILD_STORE_SLOT])
  })
})
